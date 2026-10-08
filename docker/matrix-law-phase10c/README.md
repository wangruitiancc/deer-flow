# Matrix Law Phase 10C Agent failover profile

This directory is a disposable, non-production verification profile for a
real DeerFlow Agent run in the two-Gateway Matrix Law topology. The model is a
deterministic OpenAI-compatible service inside the isolated Compose network;
it sends a deliberately slow token stream so the owning Gateway can be killed
at a known point.

Use these Compose files in order:

1. `docker-compose.matrix-law-phase9-test.yaml`
2. `docker-compose.matrix-law-structure.yaml`
3. `docker-compose.matrix-law-phase10b.yaml`
4. `docker-compose.matrix-law-phase10c.yaml`

The verifier creates a throwaway authenticated user, tenant, matter and bound
thread. It starts the Agent on Gateway A (`127.0.0.1:8019`), observes its Redis
SSE stream from Gateway B (`127.0.0.1:8020`), reconnects with
`Last-Event-ID`, kills only the exact disposable Gateway A container, and
waits for Gateway B to terminalize the orphaned run. It then starts a new run
on the same legal thread through Gateway B and requires that run to succeed.
Before the terminal marker, Gateway B must also expose the structured
`run_recovery_required` control event with `recovery=start_new_run`; this is
the browser contract for telling the user to resend the interrupted request.

This proves safe recovery, not continuation of half-executed computation. The
old run must finish as `error` with `stop_reason=orphan_recovered`; only the new
run may succeed. The Web client deliberately does not auto-replay the old turn,
because a tool may already have committed a non-idempotent side effect.

Always use Compose project name `matrix-law-phase10c` and remove that exact
project with its volumes after evidence is collected. Do not stop or remove the
long-running DeerFlow development project or unrelated containers.
