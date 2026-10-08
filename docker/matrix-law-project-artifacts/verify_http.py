"""Synthetic HTTP acceptance against the isolated 2035 stack, without API mocks."""

from __future__ import annotations

import hashlib
import json
import subprocess
from uuid import uuid4

import httpx

BASE = "http://127.0.0.1:2035"


def request(client, method, path, *, status=200, **kwargs):
    headers = dict(kwargs.pop("headers", {}))
    if token := client.cookies.get("csrf_token"):
        headers["X-CSRF-Token"] = token
    response = client.request(method, path, headers=headers, **kwargs)
    if response.status_code != status:
        # Never print session cookies or auth response bodies.
        code = (
            response.json().get("error", {})
            if "json" in response.headers.get("content-type", "")
            else {}
        )
        raise AssertionError(
            f"{method} {path}: expected {status}, got {response.status_code}; {code}"
        )
    return response


def provision(client, suffix):
    request(
        client,
        "POST",
        "/api/v1/auth/register",
        status=201,
        json={
            "email": f"p1-{suffix}@example.com",
            "password": "Synthetic-P1-password-12345",
        },
    )
    tenant = request(
        client,
        "POST",
        "/api/law/tenants",
        status=201,
        headers={"Idempotency-Key": str(uuid4())},
        json={"slug": f"p1-{suffix}", "name": "合成 P1 验证租户"},
    ).json()["data"]["tenant"]
    prefix = f"/api/law/tenants/{tenant['id']}/matters"
    matter = request(
        client,
        "POST",
        prefix,
        status=201,
        headers={"Idempotency-Key": str(uuid4())},
        json={"kind": "consultation", "title": "合成零散法律咨询"},
    ).json()["data"]["matter"]
    thread_id = str(uuid4())
    request(
        client,
        "POST",
        "/api/threads",
        json={"thread_id": thread_id, "metadata": {}},
        status=200,
    )
    request(
        client,
        "POST",
        f"{prefix}/{matter['id']}/threads",
        status=201,
        headers={"Idempotency-Key": str(uuid4())},
        json={"thread_id": thread_id, "purpose": "matter-chat"},
    )
    return f"{prefix}/{matter['id']}/project-artifacts", thread_id


def main():
    with (
        httpx.Client(
            base_url=BASE, timeout=60, trust_env=False, headers={"Origin": BASE}
        ) as alice,
        httpx.Client(
            base_url=BASE, timeout=60, trust_env=False, headers={"Origin": BASE}
        ) as bob,
    ):
        path, thread = provision(alice, uuid4().hex[:12])
        other_path, _ = provision(bob, uuid4().hex[:12])
        content = "# 合成法律咨询笔记\n\n这不是客户材料。".encode()
        digest = hashlib.sha256(content).hexdigest()
        fields = {
            "title": "合成咨询笔记",
            "kind": "note",
            "byte_size": str(len(content)),
            "source_thread_id": thread,
            "source_artifact_path": "/mnt/user-data/outputs/note.md",
            "source_revision_sha256": digest,
        }
        key = str(uuid4())

        def save(*, key=key, extra=None, body=content, expected=201):
            sha = hashlib.sha256(body).hexdigest()
            return request(
                alice,
                "POST",
                path,
                status=expected,
                headers={"Idempotency-Key": key, "X-Content-SHA256": sha},
                data={
                    **fields,
                    "byte_size": str(len(body)),
                    "source_revision_sha256": sha,
                    **(extra or {}),
                },
                files={"file": ("note.md", body, "text/markdown")},
            )

        first = save().json()["data"]
        item, version = first["artifact"], first["artifact_version"]
        assert (
            version["review_status"] == "unreviewed"
            and version["source_provenance"] == "client_asserted"
        )
        replay = save().json()
        assert (
            replay["meta"]["idempotent_replay"]
            and replay["data"]["artifact_version"]["id"] == version["id"]
        )
        second_content = content + "\n\n第二版合成补充。".encode()
        second = save(
            key=str(uuid4()),
            extra={"project_artifact_id": item["id"], "expected_version": "1"},
            body=second_content,
        ).json()["data"]
        assert second["artifact_version"]["version_number"] == 2
        save(
            key=str(uuid4()),
            extra={"project_artifact_id": item["id"], "expected_version": "1"},
            expected=409,
        )
        versions_path = f"{path}/{item['id']}/versions"
        versions = request(alice, "GET", versions_path).json()["data"]["items"]
        assert len(versions) == 2
        for row, expected in [
            (version, content),
            (second["artifact_version"], second_content),
        ]:
            url = f"{versions_path}/{row['id']}/content"
            downloaded = request(alice, "GET", url)
            assert downloaded.content == expected
            assert hashlib.sha256(downloaded.content).hexdigest() == row["sha256"]
            request(bob, "GET", url, status=404)
            request(bob, "GET", url.replace(path, other_path), status=404)
        request(bob, "GET", path, status=404)
        assert len(request(alice, "GET", path).json()["data"]["items"]) == 1
        # Standard harmless antivirus test marker; never execute these bytes.
        eicar = b"X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"
        save(key=str(uuid4()), body=eicar, expected=422)
        scanner = "matrix-law-project-artifacts-clamav-1"
        subprocess.run(
            ["docker", "stop", "--time", "10", scanner], check=True, capture_output=True
        )
        try:
            request(
                alice, "GET", f"{versions_path}/{version['id']}/content", status=503
            )
            save(key=str(uuid4()), expected=503)
        finally:
            subprocess.run(
                ["docker", "start", scanner], check=True, capture_output=True
            )
        assert len(request(alice, "GET", versions_path).json()["data"]["items"]) == 2
        print(
            json.dumps(
                {
                    "result": "passed",
                    "transport": "real nginx/Gateway HTTP",
                    "cases": [
                        "cookie-auth+CSRF",
                        "consultation-without-case-number",
                        "save+real-S3+ClamAV",
                        "idempotent-replay",
                        "append",
                        "stale-version-conflict",
                        "old/new-byte-exact-download",
                        "cross-tenant-read-denial",
                        "forged-scope-denial",
                        "EICAR-rejected",
                        "scanner-offline-save/download-fail-closed",
                    ],
                    "artifact_id": item["id"],
                    "thread_id": thread,
                },
                ensure_ascii=False,
            )
        )


if __name__ == "__main__":
    main()
