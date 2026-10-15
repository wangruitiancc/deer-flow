#!/usr/bin/env bash
set -euo pipefail
umask 077

if [[ -z "${MATRIX_LAW_TEST_PYTHON:-}" || ! -x "${MATRIX_LAW_TEST_PYTHON}" ]]; then
  printf 'Set MATRIX_LAW_TEST_PYTHON to the executable isolated test interpreter.\n' >&2
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
IMAGE="postgres:16-alpine"
CONTAINER="deerflow-w13-auth-pg-$$-$(date +%s)"

if ! docker image inspect "${IMAGE}" >/dev/null 2>&1; then
  printf 'Required local test image %s is unavailable; refusing an implicit image pull.\n' "${IMAGE}" >&2
  exit 2
fi
if docker container inspect "${CONTAINER}" >/dev/null 2>&1; then
  printf 'Refusing to replace pre-existing container %s.\n' "${CONTAINER}" >&2
  exit 2
fi

cleanup() {
  if docker container inspect "${CONTAINER}" >/dev/null 2>&1; then
    docker rm --force "${CONTAINER}" >/dev/null
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

docker run --detach \
  --name "${CONTAINER}" \
  --label codex.scope=isolated-w13-auth-test \
  --env POSTGRES_USER=postgres \
  --env POSTGRES_PASSWORD= \
  --env POSTGRES_HOST_AUTH_METHOD=trust \
  --env POSTGRES_DB=deerflow_w13_auth_test \
  --publish 127.0.0.1::5432 \
  --tmpfs /var/lib/postgresql/data:rw,noexec,nosuid,size=1g \
  "${IMAGE}" >/dev/null

ready=0
for _ in $(seq 1 60); do
  if docker exec "${CONTAINER}" pg_isready -U postgres -d deerflow_w13_auth_test >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
if [[ "${ready}" != 1 ]]; then
  printf 'Ephemeral PostgreSQL did not become ready; container will be removed.\n' >&2
  exit 1
fi

mapping="$(docker port "${CONTAINER}" 5432/tcp)"
if [[ "${mapping}" != 127.0.0.1:* ]]; then
  printf 'Refusing non-loopback PostgreSQL port mapping.\n' >&2
  exit 2
fi
port="${mapping##*:}"
export DEERFLOW_TEST_POSTGRES_URL="postgresql://postgres@127.0.0.1:${port}/deerflow_w13_auth_test"
export PYTHONPATH="${ROOT}/backend/packages/harness:${ROOT}/backend/packages/extension-api:${ROOT}/backend${PYTHONPATH:+:${PYTHONPATH}}"

"${MATRIX_LAW_TEST_PYTHON}" - <<'PY'
import os
from sqlalchemy.engine import make_url

value = make_url(os.environ["DEERFLOW_TEST_POSTGRES_URL"])
if (
    value.drivername != "postgresql"
    or value.host != "127.0.0.1"
    or value.username != "postgres"
    or value.password is not None
    or value.database != "deerflow_w13_auth_test"
    or value.query
):
    raise SystemExit("Refusing unsafe W13 PostgreSQL test URL")
PY

cd "${ROOT}/backend"
"${MATRIX_LAW_TEST_PYTHON}" -m pytest tests/test_password_reset_postgres.py -q -p no:cacheprovider
