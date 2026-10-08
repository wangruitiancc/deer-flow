# Matrix Law Phase 10J tenant-capacity verifier

This disposable low-level verifier uses four independent `RunManager` instances and a
real PostgreSQL database. It proves that the transaction-scoped advisory lock
enforces the Matrix Law per-tenant pending/running limit across Gateway
processes while allowing a different tenant to use its own capacity.

The values are synthetic capacity keys, including one unscoped internal-path
case that does not represent a public Matrix Law run. Public legal runs fail
closed unless their thread is bound to an authorized active legal work item. That item may be a case,
one-off consultation, contract review, research task, or legal draft. Production persists only a one-way
digest resolved from trusted Matrix Law legal-work context; raw tenant ids are not
stored in the DeerFlow run table or exported as metrics labels.

This is concurrency-correctness evidence, not a throughput benchmark, queue,
reserved-capacity guarantee, or proof of perfect scheduling fairness.

`docker-compose.matrix-law-phase10j.yaml` is the companion production-image
black-box check. It creates an isolated PostgreSQL database, applies both the
host `0019` and Matrix Law `0014` migration heads, and starts the final image as
UID/GID 65532 with a read-only root filesystem, all Linux capabilities dropped,
and `no-new-privileges`. Its network-local probe verifies Gateway readiness,
mandatory Matrix Law health, authentication on a legal route, 50 concurrent
liveness calls, and bounded metrics that do not expose a raw tenant marker.
`config-without-law.yaml` is a negative fixture: the production image must exit
before serving when the mandatory Matrix Law admission is removed.

Run it from the repository root with:

```bash
docker compose -f docker/docker-compose.matrix-law-phase10j.yaml up -d --wait gateway
docker compose -f docker/docker-compose.matrix-law-phase10j.yaml run --rm probe
docker compose -f docker/docker-compose.matrix-law-phase10j.yaml down -v
```
