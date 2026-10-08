# Matrix Structure Private Sidecar

`matrix-structure` is the isolated PP-StructureV3 table/formula service used by MatrixFlow Law. It accepts only
single-page PNG images from `matrix-ocr`; source evidence files, database credentials and tenant context never enter
this process.

## Capability boundary

- Protocol: `matrix-structure-http-v1`.
- Model stack: `paddleocr 3.2.0`, `paddlepaddle 3.2.2`, `paddlex 3.2.1`.
- Layout: `PP-DocLayout_plus-L`.
- Table and formula models are loaded from the explicit cache described by `resources/models.manifest.json`.
- Every model directory is checked by file count, total bytes and a canonical tree SHA-256 before PaddleOCR imports.
- `/v1/structure/health` and `/v1/structure/analyze` require a private Bearer Token.
- Analyze accepts only PNG, an exact `Content-Length`, source SHA-256 and explicit table/formula flags.
- Responses and errors are `private, no-store`; logs contain request metadata only, never image bytes or recognized
  table/formula content.

The sidecar returning healthy does not by itself make MatrixFlow Law production-ready. Capability exposure also
requires the `matrix-ocr` adapter, private-network deployment, resource/fault gates and legal-domain gold quality.

## Local validation

The 2.9GB model cache is intentionally excluded from Git. Model fetching is a separate, explicit preparation step;
runtime startup verifies the checked-in manifest and fails closed on any missing or changed model file.

```bash
uv sync --frozen
uv run ruff check .
uv run pytest

PADDLE_PDX_CACHE_HOME=/path/to/cache \
uv run matrix-structure-assets verify \
  --cache-root /path/to/cache \
  --manifest resources/models.manifest.json
```

Run locally only after verification:

```bash
MATRIX_STRUCTURE_HTTP_TOKEN="replace-with-a-random-private-token" \
MATRIX_STRUCTURE_CACHE_ROOT=/path/to/cache \
uv run matrix-structure
```

## Container boundary

The Docker builder downloads the official model set and immediately verifies it against the checked-in tree hashes.
The runtime image contains the verified cache and does not download models during normal startup. Deploy it as a
non-root, read-only container with no Linux capabilities, a temporary writable `/tmp`, strict CPU/RAM/PID limits and
an internal Docker network shared only with `matrix-ocr`. The private network should have no Internet route; this is
the runtime enforcement that prevents a future dependency change from silently fetching a missing model.

The image is large by design and should not be merged into the lightweight text OCR container. Do not publish port
8091 on the host or expose it through Nginx/Gateway.

## Environment

| Name | Default | Purpose |
| --- | --- | --- |
| `MATRIX_STRUCTURE_HTTP_TOKEN` | none | Required private Bearer Token, at least 24 characters |
| `MATRIX_STRUCTURE_BIND_HOST` | `127.0.0.1` | Bind address; container uses `0.0.0.0` |
| `MATRIX_STRUCTURE_PORT` | `8091` | Private port |
| `MATRIX_STRUCTURE_MAX_UPLOAD_BYTES` | `26214400` | Per rendered page limit |
| `MATRIX_STRUCTURE_CACHE_ROOT` | `resources/models` | Verified PaddleX cache root |
| `MATRIX_STRUCTURE_MODEL_MANIFEST` | `resources/models.manifest.json` | Checked-in asset lock |
| `MATRIX_STRUCTURE_TEMP_ROOT` | system temp | Parent for request-scoped 0600 images |
