from __future__ import annotations

import asyncio
import base64
import hashlib
import os
from collections.abc import AsyncIterator
from uuid import uuid4

from matrix_law_extension.config import OcrWorkerConfig
from matrix_law_extension.services.http_ocr_processor import MatrixOcrHttpProcessor
from matrix_law_extension.services.ocr_processor import OcrRequest, OcrSource


_BLANK_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
)


async def _chunks(content: bytes) -> AsyncIterator[bytes]:
    midpoint = max(1, len(content) // 2)
    yield content[:midpoint]
    yield content[midpoint:]


async def main() -> None:
    endpoint = os.environ.get("MATRIX_OCR_SMOKE_ENDPOINT", "http://127.0.0.1:18090")
    token = os.environ.get("MATRIX_OCR_HTTP_TOKEN", "")
    if not token:
        raise RuntimeError("MATRIX_OCR_HTTP_TOKEN is required")
    processor = MatrixOcrHttpProcessor(
        OcrWorkerConfig(
            adapter="matrix-ocr-http-v1",
            endpoint=endpoint,
            verify_tls=False,
            request_timeout_seconds=60,
        ),
        token=token,
    )
    try:
        if not await processor.check_ready():
            raise RuntimeError("private OCR service is not ready")
        result = await processor.process(
            source=OcrSource(
                tenant_id=uuid4(),
                matter_id=uuid4(),
                evidence_item_id=uuid4(),
                evidence_version_id=uuid4(),
                media_type="image/png",
                byte_size=len(_BLANK_PNG),
                sha256=hashlib.sha256(_BLANK_PNG).hexdigest(),
            ),
            request=OcrRequest(
                provider="local_ppv6",
                language="auto",
                enable_table=True,
                enable_formula=False,
                attempt=1,
            ),
            chunks=_chunks(_BLANK_PNG),
        )
        assert result.model_version == "ppocrv6-small-1.0"
        assert result.page_count == 1
        print("Matrix Law adapter -> private PP-OCRv6 service smoke: passed")
    finally:
        await processor.close()


if __name__ == "__main__":
    asyncio.run(main())
