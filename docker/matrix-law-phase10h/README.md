# Matrix Law Phase 10H Gateway observability verifier

This disposable verifier exercises the final runtime image through real HTTP:

- 50 concurrent `/health` requests must all succeed;
- two unmatched paths containing synthetic secret-like identifiers must be
  rejected by fail-closed auth/routing and aggregated into the constant
  `__unmatched__` route label;
- `/metrics` must not observe itself;
- ordinary health latency must use `response_kind="request"`, never the
  long-lived SSE `stream` series;
- the in-flight gauge must return to zero;
- raw path identifiers must not appear in the exposition;
- with lifespan deliberately disabled for this metrics-only smoke test, the
  readiness gauge must truthfully remain zero.

Client-side latency is printed only as smoke-test evidence. It is not a
production capacity result or an SLO threshold calibration.
