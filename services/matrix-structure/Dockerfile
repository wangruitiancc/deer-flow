FROM ghcr.io/astral-sh/uv:0.11.12 AS uv

FROM python:3.11-slim-bookworm AS builder

COPY --from=uv /uv /usr/local/bin/uv
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml uv.lock ./
COPY matrix_structure ./matrix_structure
COPY resources/models.manifest.json ./resources/models.manifest.json

RUN uv sync --frozen --no-dev \
    && PADDLE_PDX_MODEL_SOURCE=BOS .venv/bin/python -m matrix_structure.prepare_models \
      --cache-root /app/resources/models \
      --manifest /app/resources/models.manifest.json

FROM python:3.11-slim-bookworm AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 matrix \
    && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin matrix

ENV PATH=/app/.venv/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    PADDLE_PDX_CACHE_HOME=/app/resources/models \
    PADDLE_PDX_MODEL_SOURCE=BOS \
    HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1 \
    MATRIX_STRUCTURE_BIND_HOST=0.0.0.0 \
    MATRIX_STRUCTURE_PORT=8091 \
    MATRIX_STRUCTURE_CACHE_ROOT=/app/resources/models \
    MATRIX_STRUCTURE_MODEL_MANIFEST=/app/resources/models.manifest.json

WORKDIR /app
COPY --from=builder --chown=matrix:matrix /app/.venv ./.venv
COPY --from=builder --chown=matrix:matrix /app/matrix_structure ./matrix_structure
COPY --from=builder --chown=matrix:matrix /app/resources ./resources

USER matrix
EXPOSE 8091

HEALTHCHECK --interval=15s --timeout=10s --start-period=180s --retries=6 \
  CMD ["python", "-c", "import os,urllib.request; r=urllib.request.Request('http://127.0.0.1:8091/v1/structure/health',headers={'Authorization':'Bearer '+os.environ['MATRIX_STRUCTURE_HTTP_TOKEN']}); raise SystemExit(0 if urllib.request.urlopen(r,timeout=5).status==200 else 1)"]

CMD ["python", "-m", "matrix_structure.server"]
