# Matrix Law Helm Chart

Deploys the Matrix Law multi-tenant legal Agent stack to Kubernetes: **gateway** (backend + embedded
LangGraph runtime), **frontend** (Next.js), **nginx** (internal reverse proxy
preserving the compose routing), and the **provisioner** (K8s-native sandbox
that spawns code-execution Pods on demand).

The Matrix Law module is required by the rendered configuration. Public Agent
runs must resolve an authorized active legal work item before durable admission; the item may be a case,
one-off consultation, contract review, research task, or legal draft. This is
not a general-purpose DeerFlow deployment profile.

The Web workspace is likewise legal-only: it lands on the legal-work workspace and
does not expose generic new-chat, custom-agent, scheduler, or channel navigation.
Only a thread created and bound from an authorized legal work item can enter the chat
execution surface.

This chart translates the production `docker/docker-compose.yaml` into native
Kubernetes resources. No existing repo files are modified.

## Prerequisites

- A Kubernetes cluster (Docker Desktop K8s, OrbStack, kind, k3d, or a real cluster).
- `kubectl` + `helm` 3.8+ installed (OCI registry support stabilized in 3.8; earlier 3.x needs `HELM_EXPERIMENTAL_OCI=1`).
- The three DeerFlow images — either the published ones (see "Install the
  published chart" below) or built locally (see step 1).
- An Ingress controller (e.g. ingress-nginx) if you enable `ingress`.

## Install the published chart (GHCR)

The chart and all three images are published to GHCR on every `v*` release tag
(see `.github/workflows/container.yaml` and `chart.yaml`). Skip the build step
and install directly:

```bash
helm install deer-flow oci://ghcr.io/<owner>/charts/deer-flow \
  --version <version> \
  -n deer-flow --create-namespace \
  -f my-values.yaml
```

where `<owner>` is the GitHub owner the chart is published from and `<version>`
matches the release tag without the leading `v` (tag `v0.1.0` → `--version
0.1.0`).

> **Note:** the helm chart is new in 2.1.0 - no chart was published before it.
> It publishes to `oci://ghcr.io/<owner>/charts/deer-flow` (the `charts/` prefix
> keeps it distinct from the `deer-flow-{backend,frontend,provisioner}` image
> packages).

Point the chart at the published images:

```yaml
image:
  registry: ghcr.io/<owner>     # owner prefix; images are <owner>/deer-flow-<name>
  tag: "<version>"              # match the release tag (sans leading `v`)
  pullSecrets:
    - { name: regcred }         # only if the GHCR package is private
```

The chart's `gatewayImage` / `frontendImage` / `provisionerImage` defaults
already match the published image names (`deer-flow-backend`,
`deer-flow-frontend`, `deer-flow-provisioner`), so only `registry` and `tag`
are required. New GHCR packages default to **private** — flip the package to
public in its GHCR settings page for unauthenticated pulls, otherwise create a
pull secret (step 1) and reference it via `image.pullSecrets`.

> The OCI chart and the images are versioned independently of the chart's
> `appVersion`; always set `image.tag` to the release that matches your chart
> `--version` unless you have a reason to pin differently.

## 1. Build & push images (custom builds only)

Skip this section if you're using the published chart above. To build the
images yourself from the existing Dockerfiles:

```bash
REGISTRY=ghcr.io/yourorg
TAG=latest

# backend - build with the `postgres` extra so multi-replica deploys can use
# shared Postgres (matches the published image)
docker build -t $REGISTRY/deer-flow-backend:$TAG --build-arg UV_EXTRAS=postgres -f backend/Dockerfile .
# frontend
docker build -t $REGISTRY/deer-flow-frontend:$TAG -f frontend/Dockerfile .
# provisioner
docker build -t $REGISTRY/deer-flow-provisioner:$TAG -f docker/provisioner/Dockerfile docker/provisioner

docker push $REGISTRY/deer-flow-backend:$TAG
docker push $REGISTRY/deer-flow-frontend:$TAG
docker push $REGISTRY/deer-flow-provisioner:$TAG
```

These names match the chart's `gatewayImage` / `frontendImage` /
`provisionerImage` defaults, so only `image.registry` and `image.tag` need to
point at them.

If your registry needs auth, create a pull secret:

```bash
kubectl create secret docker-registry regcred \
  --docker-server=ghcr.io \
  --docker-username=youruser \
  --docker-password=yourtoken \
  -n deer-flow
```

## 2. Configure values

Copy and edit `values.yaml` → `my-values.yaml`. At minimum set:

```yaml
image:
  registry: ghcr.io/yourorg
  tag: latest
  pullSecrets:
    - { name: regcred }

ingress:
  enabled: true
  className: nginx
  host: deer-flow.example.com
  tls:
    enabled: true
    secretName: deer-flow-tls

secrets:
  OPENAI_API_KEY: sk-...
  # add channel tokens, search keys, etc. as needed
```

The default ingress annotations permit a 100 MiB local `.skill` archive plus
multipart framing, stream request bodies without ingress buffering, and allow
up to 600 seconds for validation. If you replace `ingress.annotations`,
preserve equivalent size, streaming, and response-timeout settings for your
ingress controller or local skill uploads may fail before DeerFlow completes
the installation.

Provide your model config under `config` (keep secrets as `$VAR` references —
they resolve from the `secrets` map):

```yaml
config: |
  config_version: 39
  models:
    - name: gpt-4
      use: langchain_openai:ChatOpenAI
      model: gpt-4
      api_key: $OPENAI_API_KEY
      request_timeout: 600.0
  sandbox:
    use: deerflow.community.aio_sandbox:AioSandboxProvider
    provisioner_url: http://provisioner:8002
  database:
    backend: postgres
    postgres_url: $DATABASE_URL
    pool_recycle: 300
    command_timeout: 30
  checkpointer:
    type: postgres
    connection_string: $DATABASE_URL
  stream_bridge:
    type: redis   # cross-pod SSE; URL from DEER_FLOW_STREAM_BRIDGE_REDIS_URL
  # Tools MUST be listed explicitly - the agent gets none otherwise
  # (BUILTIN_TOOLS only adds present_file + ask_clarification). The chart
  # default in values.yaml enables the sandbox tools + web tools (web_search,
  # web_fetch, image_search - no API key); when you override `config:`, copy
  # them in. Full list in values.yaml / config.example.yaml. The web tools need
  # outbound egress from the gateway pod.
  tool_groups:
    - name: web
    - name: file:read
    - name: file:write
    - name: bash
  tools:
    - name: web_search
      group: web
      use: deerflow.community.ddg_search.tools:web_search_tool
      max_results: 5
    - name: web_fetch
      group: web
      use: deerflow.community.jina_ai.tools:web_fetch_tool
      timeout: 10
    - name: image_search
      group: web
      use: deerflow.community.image_search.tools:image_search_tool
      max_results: 5
    - name: bash
      group: bash
      use: deerflow.sandbox.tools:bash_tool
    # also: ls, read_file, glob, grep, write_file, str_replace (see values.yaml)
```

`$DATABASE_URL` is injected from the postgres Secret (see below). The
`checkpointer:` section is required for multi-replica operation — the LangGraph
Store (cross-thread memory + thread list) reads it and does not fall back to
`database:`. `stream_bridge.type: redis` is the default and routes live SSE
events through the bundled redis StatefulSet (or `redis.external`).
Because `config:` is a single override blob, a partial `config:` replaces the
chart default entirely - keep the `tools:`/`tool_groups:` block (or the agent
will have no tools) and the `sandbox:`/`database:`/`checkpointer:`/`stream_bridge:`
sections shown above.

`extensionsConfig` is an initial seed, not a live read-only mount. An init
container copies it into
`/app/backend/.deer-flow/extensions-config/extensions_config.json`, where the
Gateway can persist MCP and skill-state API updates. With
`persistence.home.enabled: true`, the runtime file is kept on the home PVC and
is not overwritten by later Helm upgrades; delete that runtime file before a
pod restart only when you intentionally want a changed `extensionsConfig` seed
to replace it. With persistence disabled, the writable copy uses `emptyDir`
and is reseeded whenever the Pod is replaced.

## 3. Install (from a local chart checkout)

For a custom build or local development, install from the chart directory:

```bash
helm install deer-flow deploy/helm/deer-flow \
  -n deer-flow --create-namespace \
  -f my-values.yaml
```

## 4. Verify

```bash
kubectl -n deer-flow get pods
kubectl -n deer-flow port-forward svc/nginx 2026:2026
curl http://localhost:2026/health          # gateway health via nginx
```

Hit the Ingress host (map it in `/etc/hosts` for local clusters) to load the UI.

Provisioner sanity check:

```bash
kubectl -n deer-flow exec deploy/deer-flow-provisioner -- curl -s localhost:8002/health
```

## Architecture notes

- **PostgreSQL is the default database.** A bundled single-instance postgres
  StatefulSet (`postgresql.enabled: true`) runs in the namespace and the gateway
  connects via the in-cluster Service. The DSN is auto-generated into a Secret
  (key `database-url`) and injected as `DATABASE_URL`; `config.yaml` references
  it as `$DATABASE_URL` in `database.postgres_url`. Schema is bootstrapped
  automatically on gateway startup (alembic `create_all` + `stamp head`).
  For real HA, disable the bundled instance and point at a managed DB:
  ```yaml
  postgresql:
    enabled: false
    external:
      host: mydb.example.com   # or set databaseUrl / existingSecret
      port: 5432
      database: deerflow
      username: deerflow
      password: changeme
  ```
- **Readiness, drain, and graceful shutdown.** `/health` is process liveness and remains 200 while the Gateway
  drains; `/ready` is fail-closed during startup and returns 503 after drain begins. The readiness probe uses
  `/ready` with a two-second period and one-failure threshold, while liveness stays on `/health`. The `preStop`
  hook first creates the file named by `DEER_FLOW_GATEWAY_DRAIN_MARKER`, which immediately makes `/ready`
  return 503, then waits `gateway.preStopSleepSeconds` (default 10s) for EndpointSlice, Service, ingress, and
  external load balancers to remove the pod before Kubernetes sends SIGTERM. The production command uses
  `exec`, so SIGTERM reaches Uvicorn rather than stopping at PID 1's shell. The pod's
  `terminationGracePeriodSeconds` defaults to 90s and MUST include the preStop window, channel/browser shutdown,
  the 5s run drain, the memory-queue drain (`memory.shutdown_flush_timeout_seconds`, default 30s), and a safety
  buffer. **When any component budget grows, raise `gateway.terminationGracePeriodSeconds` too.** A probe or
  template render is not proof that a specific cloud load balancer has completed connection draining; verify
  that behavior in the target cluster.
- **Prometheus metrics and alert templates.** Helm enables the Gateway's internal `/metrics` endpoint with
  `DEER_FLOW_METRICS_ENABLED=true` and annotates the ClusterIP Gateway Service for scraping. Metrics use route
  templates plus method/status-class and a fixed response kind only; tenant, user, thread, raw URL, request body, and
  credentials never become labels. End-to-end latency distinguishes ordinary requests from long-lived SSE sessions,
  and the p99 alert filters to ordinary requests. Set `gateway.metrics.serviceMonitor.enabled=true` only when the
  Prometheus Operator CRD exists. Likewise,
  `gateway.metrics.prometheusRule.enabled=true` renders opt-in alerts for sustained 5xx ratio, p99 latency, and zero
  available Gateway replicas. Tune every threshold from measured non-production load before production; rendered
  rules are an alerting contract, not evidence that Prometheus is installed, scraping, routing notifications, or
  meeting an SLO in a target cluster.
- **Gateway replicas.** Postgres + the Redis stream bridge make persisted state
  and live SSE cross-pod-visible. This fork also uses database run admission,
  owner leases, orphan reconciliation, durable delivery receipts, and explicit
  `orphan_recovered` / `gateway_shutdown` recovery events. The default remains
  one replica because multi-replica operation is conditional: configure shared
  Postgres, `run_events.backend: db`, Redis stream bridge,
  `run_ownership.heartbeat_enabled: true`, and database-backed agent storage;
  keep process-local browser sessions disabled. A recovered or gracefully
  interrupted Agent request is terminalized and must be sent as a new run; it
  is not resumed or automatically replayed. Validate rolling replacement and
  failure recovery in the target cluster before increasing replicas.
- **Top-level run overload protection.** The Matrix deployment profile starts with provisional limits of 32 active
  Agent runs globally, 8 per legal tenant, and 4 per authenticated user. Shared PostgreSQL serializes admission across Gateway Pods;
  rejected requests fail fast with HTTP 429, `Retry-After`, and `X-DeerFlow-Overload: run-capacity`. Requests are
  not queued or replayed. These initial values are safety defaults, not measured capacity or an SLO; tune them with
  representative non-production load. The tenant key is a one-way digest resolved from trusted matter context and is
  never exported as a metric label. The limit prevents one tenant from monopolizing all slots, but does not reserve a
  minimum share or provide perfect fairness when the global cap is already exhausted.
- **Scheduled task recovery.** If a deployment explicitly enables
  `scheduler.multi_instance: true`, it must use shared Postgres,
  `run_ownership.heartbeat_enabled: true`, and `run_events.backend: db`.
  Scheduler startup then preserves live scheduled runs owned by another Pod,
  atomically takes over only expired leases, and fences stale post-launch
  bookkeeping. `max_concurrent_runs` is a shared global cap across Pods,
  including pre-launch dispatch reservations. Restart all Gateway Pods after
  changing these startup-only settings. This does not remove the broader
  Gateway replica limitations described above.
- **Redis stream bridge.** A bundled single-instance redis StatefulSet
  (`redis.enabled: true`, `redis:7-alpine`) runs in the namespace and the
  gateway connects via the in-cluster Service. Per-run SSE events are stored in
  Redis Streams (PR #3191) so a client connected to any gateway pod receives
  live events and reconnect resumes from `Last-Event-ID`. The URL is
  auto-generated into a Secret (key `redis-url`) and injected as
  `DEER_FLOW_STREAM_BRIDGE_REDIS_URL`; `config.yaml` sets `stream_bridge.type:
  redis` by default. No-auth by default (ClusterIP isolation, matching compose);
  set `redis.auth.password` to enable AUTH. For a managed Redis, disable the
  bundled instance and point at it via `redis.external`.
- **Persistence.** A PVC (`<release>-home`) backs `/app/backend/.deer-flow`
  (sqlite DB, memory, custom agents, per-thread user-data). The gateway mounts
  it with `subPath: deer-flow` so the layout matches the provisioner's PVC
  user-data mode. Default `ReadWriteOnce`; use `ReadWriteMany` (NFS) on
  multi-node clusters so sandbox Pods on other nodes can mount it.
- **Provisioner RBAC.** The provisioner gets a ServiceAccount with a namespaced
  Role (get/list/watch/create/delete on pods + services) and a narrow ClusterRole
  (namespace get/create). It uses in-cluster service-account creds — no
  kubeconfig mount. The unused update/patch/pods-exec/events verbs were dropped
  (audited against `docker/provisioner/app.py`).
- **Skills.** Disabled by default (emptyDir at `/app/skills`). Populate via
  `skills.existingClaim` or `skills.configMap`, or bake skills into a custom
  gateway image.

## Security

### Enforced posture

All workloads run as **non-root** with **all Linux capabilities dropped**. No
container escalates privileges or runs as uid 0.

| workload | runAsUser | fsGroup | writable-path handling |
|---|---|---|---|
| gateway | 1000 | 1000 | `.deer-flow` PVC group-writable via fsGroup; `PYTHONDONTWRITEBYTECODE=1` suppresses `.pyc` writes; `UV_CACHE_DIR=/tmp` |
| frontend | 1000 (`node`) | 1000 | `emptyDir` at `/app/frontend/.next/cache` (root-owned in the image) |
| nginx | 101 (`nginx`) | 101 | command writes the rendered config to `/tmp/nginx.conf` and loads `nginx -c /tmp/nginx.conf` (since `/etc/nginx` is root-owned); `emptyDir` at `/var/cache/nginx` |
| provisioner | 1000 | — | no PVC; `PYTHONDONTWRITEBYTECODE=1` |
| postgres | 999 (`postgres`) | 999 | official `postgres:16` entrypoint detects non-root and skips the chown/gosu dance; data PVC group-writable via fsGroup |
| redis | 999 (`redis`) | 999 | official `redis:7-alpine` entrypoint detects non-root and skips the gosu dance; data PVC group-writable via fsGroup |

Every container sets:

- `runAsNonRoot: true`
- `allowPrivilegeEscalation: false`
- `capabilities.drop: ["ALL"]`
- `seccompProfile: { type: RuntimeDefault }`

All listening ports are >1024 (8001 / 3000 / 2026 / 8002 / 5432), so no
`NET_BIND_SERVICE` capability is required.

**ConfigMap rollout.** ConfigMaps mount via `subPath`, which does **not** receive
in-place updates — a `helm upgrade` that changes only a ConfigMap would leave
pods on stale config. Each pod template carries a `checksum/*` annotation (SHA256
of the rendered ConfigMap): `checksum/config` + `checksum/extensions` on the
gateway, `checksum/nginx` on nginx. Any content change alters the pod spec and
triggers a rolling restart.

**Resource defaults.** Every workload ships with modest requests+limits in
`values.yaml`; override per workload (`gateway.resources`, `frontend.resources`,
`nginx.resources`, `provisioner.resources`, `postgresql.primary.resources`,
`redis.primary.resources`).

### Not yet enforced (deferred hardening)

These are intentionally **not** set in this chart revision. Each can be added
per-workload with testing:

- **`readOnlyRootFilesystem: true`** — makes the container's root filesystem
  immutable so a compromised process can't persist changes to the image. Not
  enabled because it requires auditing every runtime write path and mounting an
  `emptyDir` over each. Known paths:
  - gateway / frontend / nginx / provisioner: `/tmp` (uv cache, python tempfiles,
    the nginx config + pid, node temp) — one `emptyDir` at `/tmp` each.
  - postgres: `/tmp` **and** `/var/run/postgresql` (the Unix-socket dir).
  The first four are mechanical. **postgres is the hard case** — the official
  image writes its socket to `/var/run/postgresql` and isn't designed for a
  read-only root, so it may need socket-path redirection (`PGHOST`/`unix_socket_directories`).
  Optionally, add `USER` directives to the `backend/Dockerfile`,
  `frontend/Dockerfile`, and `docker/provisioner/Dockerfile` so the images are
  non-root by default (defense in depth — the chart already forces the uid via
  `securityContext`, so this is not required). A cluster enforcing the
  `restricted` Pod Security Admission standard would require this setting.
- **Provisioner RBAC narrowing.** The Role grants get/list/watch/create/delete
  on pods and services in the namespace (update/patch/pods-exec/events were
  dropped as unused). These verbs still apply to *all* Pods in the namespace,
  not just sandbox Pods — RBAC can't scope by label, so the remaining
  options are a dedicated sandbox namespace or admission control (OPA/Kyverno).
- **`startupProbe`.** Workloads have readiness + liveness probes but no startup
  probe. The gateway's `livenessProbe.initialDelaySeconds: 30` covers slow starts
  today; a `startupProbe` would let it take arbitrarily long to initialize
  without risking a liveness kill during a cold start (e.g. slow model config
  load).

None of these affect correctness of the current deployment.

### Migrating an existing volume to non-root

`fsGroup` does **not** apply to `subPath` mounts, and it changes group ownership
but not file mode — so a PVC written by an earlier **root** run (e.g. a cluster
that ran the gateway as root before enabling this hardening, or a backup restore
of root-owned files) will keep files like `.jwt_secret` at `0600 root:root`. The
non-root gateway (uid 1000) then can't read them and crashes on the first auth
request with `RuntimeError: Failed to read JWT secret from .../​.jwt_secret`.

**Fresh installs are unaffected** — uid 1000 creates every file as `1000:1000`.

To fix an existing root-written PVC, run a one-shot root pod that chowns the
volume to the gateway uid (1000), then restart the gateway:

```bash
cat <<'EOF' | kubectl apply -n deer-flow -f -
apiVersion: v1
kind: Pod
metadata: { name: fix-home-perms, namespace: deer-flow }
spec:
  restartPolicy: Never
  containers:
    - name: chown
      image: busybox:1.36
      command: ["sh", "-c"]
      args: ["chown -R 1000:1000 /home-pvc/deer-flow && chmod -R g+rwX /home-pvc/deer-flow"]
      volumeMounts:
        - { name: home, mountPath: /home-pvc }
  volumes:
    - name: home
      persistentVolumeClaim: { claimName: deer-flow-deer-flow-home }
EOF
kubectl -n deer-flow wait --for=condition=Ready pod/fix-home-perms --timeout=30s
kubectl -n deer-flow delete pod fix-home-perms
kubectl -n deer-flow rollout restart deploy/deer-flow-deer-flow-gateway
```

(On a single-node cluster the fix pod can mount the RWO PVC concurrently with the
gateway; on multi-node, scale the gateway to 0 first.) A durable alternative —
an opt-in root `volumePermissions` initContainer that chowns on every start (the
Bitnami pattern) — is not yet wired into this chart; it would introduce a root
container, so it's left as an operator decision for now.

## Sandbox Service type

The provisioner exposes each sandbox Pod behind a per-sandbox Service whose type
is controlled by `provisioner.sandboxServiceType` (default `ClusterIP`).

**`ClusterIP` (default, recommended).** The provisioner returns a cluster-DNS
URL - `http://sandbox-<id>-svc.<namespace>.svc.cluster.local:8080` - so the
gateway reaches its sandbox entirely inside the cluster network. No node IP, no
high port, and the code-execution surface is **not** bound on every node's
interfaces. This is correct for the chart, where the gateway always runs
in-cluster.

**`NodePort` (Docker-Compose/hybrid escape hatch).** Set
`provisioner.sandboxServiceType: NodePort` only when the gateway is *not* in K8s
(e.g. the compose dev path, where the gateway is a container reaching sandbox
Pods on the host's Docker Desktop K8s). The provisioner then returns
`http://{NODE_HOST}:{NodePort}`. `NODE_HOST` defaults to the provisioner pod's
node IP via the [downward API](https://kubernetes.io/docs/concepts/workloads/pods/downward-api/)
(`status.hostIP`); because a NodePort is exposed on every node, the gateway can
reach `<node-IP>:<NodePort>` on most clusters without configuration. Override
`provisioner.nodeHost` only if your CNI or network policy blocks pod->node-IP
traffic:

```bash
kubectl get nodes -o wide    # use INTERNAL-IP or EXTERNAL-IP
```

```yaml
provisioner:
  sandboxServiceType: NodePort
  nodeHost: 192.168.x.x
```

On multi-node clusters, also switch `persistence.home.accessMode` to
`ReadWriteMany` (this is orthogonal to the Service type - it governs whether a
sandbox Pod can be scheduled on a node other than the gateway's).

## Lint / dry-run

```bash
helm lint deploy/helm/deer-flow
helm template deer-flow deploy/helm/deer-flow -n deer-flow -f my-values.yaml | \
  kubectl apply --dry-run=client -f -
```

## Uninstall

```bash
helm uninstall deer-flow -n deer-flow
# the PVC is NOT deleted by default — remove it manually if desired:
kubectl -n deer-flow delete pvc -l app.kubernetes.io/instance=deer-flow
```
