# Matrix Law Phase 10D rolling-restart profile

This disposable verifier reuses the Phase 10C Compose topology and deterministic
model. It first restarts the idle Gateway B while continuously probing the load
balancer. It then starts a slow Agent run on Gateway A, joins the stream through
Gateway B, gracefully stops A, and requires all of the following:

- the old run becomes `interrupted` with `stop_reason=gateway_shutdown`;
- Gateway B receives `run_recovery_required` before the terminal stream marker;
- every load-balancer health sample remains HTTP 200 while either Gateway is
  replaced;
- the authenticated legal context survives both restarts;
- after A starts again, a new run submitted through the load balancer succeeds
  on the same thread and its message is durable.

The sequence waits 1.25 seconds after B is directly healthy before removing A.
The test Nginx uses a one-second passive `fail_timeout`; direct readiness alone
does not prove the replica has re-entered the proxy's selectable upstream set.
Production orchestration should express the equivalent readiness/drain barrier
through the platform load balancer instead of relying on a fixed sleep.

This is a rolling-restart contract, not seamless resumption. The browser tells
the user to resend; it does not automatically replay a potentially side-effecting
turn. Use only synthetic data, a unique disposable Compose project, and remove
that exact project with its volumes after evidence collection.
