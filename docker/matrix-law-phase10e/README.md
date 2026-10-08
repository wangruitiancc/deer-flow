# Matrix Law Phase 10E readiness/drain verifier

This disposable verifier checks the application half of the orchestrated
rolling contract against two real Gateway containers:

- `/health` remains 200 as process liveness;
- `/ready` is 200 only after lifespan startup finishes;
- creating `DEER_FLOW_GATEWAY_DRAIN_MARKER` changes `/ready` to 503 `draining`
  without failing `/health`;
- a process restart clears the stale marker during startup and returns to
  `ready`;
- the Gateway still runs Uvicorn as PID 1 and the peer keeps the test load
  balancer healthy during replacement.

It does not emulate Kubernetes EndpointSlice propagation, an ingress
controller, or a cloud load balancer. Those require a running target cluster.
The current local kubeconfig may exist even when its API server is disabled;
do not report a Helm render or this Docker verifier as a Kubernetes rollout.
