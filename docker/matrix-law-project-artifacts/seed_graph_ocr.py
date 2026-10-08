"""Seed only normalized OCR output for graph-source acceptance, not OCR accuracy.

Run over stdin inside the isolated 2035 gateway after a real evidence upload.
Citation creation and all authorization checks remain real HTTP operations.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import sys
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from matrix_law_extension.models import Membership, Tenant
from matrix_law_extension.repositories import OcrJobRepository
from matrix_law_extension.services.ocr_processor import (
    OcrBlockOutput,
    OcrPageOutput,
    OcrProcessResult,
)


async def main() -> None:
    if (
        os.environ.get("AUTH_JWT_SECRET")
        != "synthetic-p1-jwt-secret-not-for-production"
    ):
        raise RuntimeError(
            "OCR fixture seeding only permits the isolated synthetic stack"
        )
    user_id, tenant, matter, item, version, marker = sys.argv[1:]
    tenant_id, matter_id, item_id, version_id = map(
        UUID, [tenant, matter, item, version]
    )
    if marker not in {"original", "rerun", "structured"}:
        raise ValueError("Unknown synthetic OCR marker")
    engine = create_async_engine(
        os.environ["DATABASE_URL"],
        connect_args={"server_settings": {"search_path": "deerflow"}},
    )
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with sessions() as session, session.begin():
            membership = await session.scalar(
                select(Membership)
                .join(Tenant, Tenant.id == Membership.tenant_id)
                .where(
                    Membership.tenant_id == tenant_id,
                    Membership.user_id == user_id,
                    Membership.role == "owner",
                    Membership.status == "active",
                    (
                        Tenant.slug.startswith("graph-")
                        | Tenant.slug.startswith("p1-graph-live-")
                    ),
                )
            )
            if membership is None:
                raise RuntimeError("Synthetic fixture owner/tenant mismatch")
            jobs = OcrJobRepository(session)
            job, duplicate = await jobs.schedule(
                tenant_id=tenant_id,
                matter_id=matter_id,
                evidence_item_id=item_id,
                evidence_version_id=version_id,
                request_fingerprint=hashlib.sha256(
                    f"graph-fixture:{version_id}".encode()
                ).hexdigest(),
                provider="synthetic-graph-fixture",
                language="en",
                enable_table=marker == "structured",
                enable_formula=False,
                requested_by_membership_id=membership.id,
                max_attempts=1,
            )
            if marker == "rerun":
                assert duplicate
                job = await jobs.rerun(
                    tenant_id=tenant_id,
                    matter_id=matter_id,
                    ocr_job_id=job.id,
                    requested_by_membership_id=membership.id,
                )
            else:
                assert not duplicate
            # Own only this newly scheduled fixture; do not claim unrelated jobs.
            job.status = "processing"
            job.attempts = 1
            job.lease_owner = "synthetic-graph-fixture"
            job.started_at = datetime.now(UTC)
            job.lease_expires_at = job.started_at + timedelta(seconds=60)
            await session.flush()
            quote = f"Synthetic OCR {marker} source for graph acceptance."
            blocks = None
            if marker == "structured":
                quote = "Synthetic evidence only. Company A and Company B signed a service contract in August 2026."
                table_text = "Party | Stated unpaid amount | Status\nCompany B | CNY 12000 | Disputed allegation"
                cells = [
                    {
                        "row": row,
                        "column": column,
                        "row_span": 1,
                        "column_span": 1,
                        "text": value,
                    }
                    for row, values in enumerate(
                        [
                            ["Party", "Stated unpaid amount", "Status"],
                            ["Company B", "CNY 12000", "Disputed allegation"],
                        ]
                    )
                    for column, value in enumerate(values)
                ]
                blocks = (
                    OcrBlockOutput(
                        block_index=0,
                        reading_order=0,
                        kind="text",
                        text=quote,
                        confidence=1.0,
                    ),
                    OcrBlockOutput(
                        block_index=1,
                        reading_order=1,
                        kind="table",
                        text=table_text,
                        confidence=1.0,
                        structure={
                            "type": "table",
                            "rows": 2,
                            "columns": 3,
                            "cells": cells,
                        },
                    ),
                )
            result = OcrProcessResult(
                model_version="synthetic-fixture-not-ocr-engine",
                pages=(
                    OcrPageOutput(
                        physical_page_number=1,
                        width_points=600,
                        height_points=800,
                        rotation_degrees=0,
                        text="\n".join(block.text for block in blocks)
                        if blocks
                        else quote,
                        blocks=blocks
                        or (
                            OcrBlockOutput(
                                block_index=0,
                                reading_order=0,
                                kind="text",
                                text=quote,
                                bbox=(0.1, 0.1, 0.9, 0.2),
                                confidence=1.0,
                            ),
                        ),
                    ),
                ),
            )
            assert await jobs.complete_with_result(
                ocr_job_id=job.id,
                worker_id=job.lease_owner,
                attempt=1,
                result=result,
            )
            saved = await jobs.get_result(
                tenant_id=tenant_id, matter_id=matter_id, ocr_job_id=job.id
            )
            assert saved is not None
            pages = await jobs.list_result_pages(
                tenant_id=tenant_id, matter_id=matter_id, ocr_result_id=saved.id
            )
            blocks = await jobs.list_page_blocks(
                tenant_id=tenant_id, matter_id=matter_id, ocr_page_id=pages[0].id
            )
            output = {
                "result_id": str(saved.id),
                "block_id": str(blocks[0].id),
                "quote": quote,
            }
            if marker == "structured":
                output["blocks"] = {str(block.id): block.text for block in blocks}
        print(json.dumps(output))
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
