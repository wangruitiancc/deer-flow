from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

import yaml


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Prepare private, disposable Phase 9 DeerFlow configuration."
    )
    parser.add_argument("--deer-flow-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    source_root = args.deer_flow_root.resolve()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(output, 0o700)

    config = yaml.safe_load((source_root / "config.yaml").read_text())
    # The test stack never needs a live model provider. Replace the complete
    # model list so no operator credential can enter the disposable config.
    config["models"] = [
        {
            "name": "phase9-mock",
            "display_name": "Phase 9 Mock",
            "use": "langchain_openai:ChatOpenAI",
            "model": "phase9-mock",
            "api_key": "phase9-test-only",
            "base_url": "http://unused-model.invalid/v1",
            "request_timeout": 5.0,
            "max_retries": 0,
            "context_window": 32000,
            "max_tokens": 1024,
            "supports_thinking": False,
            "supports_vision": False,
        }
    ]
    config["database"] = {
        "backend": "postgres",
        "postgres_url": "$DATABASE_URL",
        "postgres_schema": "deerflow",
        "pool_recycle": 300,
        "command_timeout": 30,
    }
    config["run_events"] = {"backend": "db"}

    plugins = config.setdefault("plugins", [])
    law = next((item for item in plugins if item.get("name") == "matrix-law"), None)
    if law is None:
        raise RuntimeError("matrix-law plugin is missing from DeerFlow config.yaml")
    law.update(
        {
            "enabled": True,
            "required": True,
            "table_prefix": "law_",
        }
    )
    law_config = law.setdefault("config", {})
    law_config.update(
        {
            "api_prefix": "/api/law",
            "audit_payload_max_bytes": 8192,
            "deployment_mode": "shadow",
            "database": {
                "enabled": True,
                "schema_name": "deerflow",
                "api_url_env": "MATRIX_LAW_API_DATABASE_URL",
                "worker_url_env": "MATRIX_LAW_WORKER_DATABASE_URL",
            },
            "object_storage": {
                "enabled": True,
                "endpoint": "http://minio:9000",
                "region": "us-east-1",
                "bucket": "matrix-law-phase9",
                "verify_tls": False,
                "request_timeout_seconds": 30,
                "max_upload_bytes": 52_428_800,
                "server_side_encryption": "none",
            },
            "malware_scan": {
                "enabled": True,
                "host": "clamav",
                "port": 3310,
                "connect_timeout_seconds": 5,
                "scan_timeout_seconds": 120,
            },
            "evidence_lifecycle": {
                "worker_enabled": False,
                "poll_interval_seconds": 5,
                "batch_size": 4,
                "lease_seconds": 60,
                "max_attempts": 3,
                "retry_delay_seconds": 5,
            },
            "ocr": {
                "worker_enabled": True,
                "default_provider": "local_ppv6",
                "adapter": "matrix-ocr-http-v1",
                "endpoint": "http://matrix-ocr:8090",
                "verify_tls": False,
                "request_timeout_seconds": 120,
                "max_response_bytes": 52_428_800,
                "poll_interval_seconds": 1,
                "batch_size": 1,
                "lease_seconds": 120,
                "max_attempts": 3,
                "retry_delay_seconds": 2,
                # Force every real OCR block through the review gate in the
                # disposable acceptance environment. Production-candidate
                # deployments separately require two distinct verifiers.
                "review_confidence_threshold": 1.0,
                "review_required_verifications": 1,
            },
        }
    )

    config_path = output / "config.yaml"
    config_path.write_text(yaml.safe_dump(config, sort_keys=False), encoding="utf-8")
    extensions_path = output / "extensions_config.json"
    source_extensions = source_root / "extensions_config.json"
    extensions = json.loads(source_extensions.read_text()) if source_extensions.exists() else {}
    extensions_path.write_text(json.dumps(extensions, indent=2) + "\n", encoding="utf-8")
    os.chmod(config_path, 0o600)
    os.chmod(extensions_path, 0o600)
    print(f"Phase 9 runtime configuration prepared at {output}")


if __name__ == "__main__":
    main()
