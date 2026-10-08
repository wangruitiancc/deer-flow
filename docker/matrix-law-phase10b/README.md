# Matrix Law Phase 10B failover profile

This directory is a disposable, non-production verification profile for two
Gateway instances sharing PostgreSQL, Redis, MinIO, ClamAV, Matrix OCR and
Matrix Structure. It does not configure an LLM and must not be used with real
client evidence.

Use it together with these Compose files, in order:

1. `docker-compose.matrix-law-phase9-test.yaml`
2. `docker-compose.matrix-law-structure.yaml`
3. `docker-compose.matrix-law-phase10b.yaml`

The load balancer listens only on `127.0.0.1:8018`; the two direct Gateway test
ports are `8019` and `8020`. Both Gateways deliberately share the JWT secret,
database-backed run events and agent definitions, a PostgreSQL checkpointer,
and the Redis stream bridge.

The Playwright configuration is
`frontend/playwright.matrix-law-phase10b.config.ts`. Its single scenario creates
an eight-page synthetic PDF, waits for the OCR lease to be claimed, and expects
an externally orchestrated outage while it polls. The operator must terminate
both original Gateway containers after the job enters `processing`, then start
only `matrix-law-phase10b-gateway-1`. A valid run observes the outage and proves
that the replacement worker completes attempt 2 without duplicate pages.

Always use Compose project name `matrix-law-phase10b` and remove that exact
project with its volumes after evidence is collected. Do not stop or remove the
long-running DeerFlow development project or unrelated containers.
