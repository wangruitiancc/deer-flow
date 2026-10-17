# AGENTS.md

## Project Overview

DeerFlow is a LangGraph-based AI super agent system with a full-stack architecture. The backend provides a "super agent" with sandbox execution, persistent memory, subagent delegation, and extensible tool integration - all operating in per-thread isolated environments.

**Architecture**:
- **Gateway API** (port 8001): REST API plus embedded LangGraph-compatible agent runtime
- **Frontend** (port 3000): Next.js web interface
- **Nginx** (port 2026): Unified reverse proxy entry point
- **Provisioner** (port 8002, optional in Docker dev): Started only when sandbox is configured for provisioner/Kubernetes mode

**Runtime**: Before changing runtime, persistence, scheduling, MCP or authentication, read [the shared runtime invariants](runtime-guidance.md) and the owning module guide.

## Commands

**Root directory** (for full application):
```bash
make check      # Check system requirements
make install    # Install all dependencies (frontend + backend)
make extension-install SOURCE=...  # Install and enable a trusted Python extension
make extension-list                # List configured Python extensions
make extension-enable NAME=...     # Enable an installed extension
make extension-disable NAME=...    # Disable an extension without uninstalling it
make extension-remove NAME=...     # Remove a managed extension
make detect-thread-boundaries  # Inventory backend executor/thread/event-loop boundaries
make dev        # Start all services (Gateway + Frontend + Nginx), with config.yaml preflight
make start      # Start production services locally
make stop       # Stop all services
```

**Backend directory** (for backend development only):
```bash
make install            # Install backend dependencies
make dev                # Gateway API, reload (port 8001)
make gateway            # Gateway API only (port 8001)
make test               # offline tests (no live/blocking-io)
make test-live          # live tests (real APIs)
make test-blocking-io   # strict Blockbuster gate on tests/blocking_io/
make test-shard SPLITS=4 GROUP=2  # one duration-aware shard
make test-shard-durations  # refresh baseline
make lint               # ruff lint
make format             # ruff format
make migrate-rev MSG="..."  # Autogenerate a new alembic revision (see Schema Migrations section)
```

The backend `make dev` target pre-creates and excludes `DEER_FLOW_HOME`
(default: `backend/.deer-flow`) and `backend/sandbox` from Uvicorn's reload
watcher. Do not replace it with a bare `uvicorn --reload`: agent tasks write
Python and other runtime files below `DEER_FLOW_HOME`, which would otherwise
restart the Gateway during an active run.

More specific `AGENTS.md` files in backend code directories contain the subsystem sections split from this file. Follow the nearest file in the directory tree.

## Architecture

Matrix Law's managed snapshot mirrors the sibling canonical project; see
[extensions guidance](packages/harness/deerflow/extensions/AGENTS.md#managed-matrix-law-snapshot)
and its package README for identity, RLS, citation, provenance and deployment boundaries.
Graph enforcement requires the configured `LawEnforcementMiddleware` (see linked guide),
not an observational plugin wrapper, and the optional host `read_output_text` capability;
the legal extension owns validation, not the generic Agent. No new file/Agent workflow.
Refresh installed snapshots with `uv sync --locked --extra postgres --reinstall-package matrix-law-extension`.

### Harness / App Split

The backend is split into two layers with a strict dependency direction:

- **Harness** (`packages/harness/deerflow/`): Publishable agent framework package (`deerflow-harness`). Import prefix: `deerflow.*`. Contains agent orchestration, tools, sandbox, models, MCP, skills, config — everything needed to build and run agents.
- **App** (`app/`): Unpublished application code. Import prefix: `app.*`. Contains the FastAPI Gateway API and IM channel integrations (Feishu, Slack, Telegram, DingTalk).

The public extension API also exposes opt-in `ControlledModelRuntime` and
`ControlledMcpRuntime` bindings for verticals that need task-scoped capability
Gateway access. A trusted task-admission hook owns the concrete signer and may
bind it only for a live task; the harness routes fixed-purpose model and managed
MCP calls through it without importing the vertical extension or serializing
credentials. When managed MCP is bound, local `extensions_config.json` MCP
discovery is skipped for that task. Durable managed MCP tools use the normal
`McpTaskService`/driver path: the model receives only a local task id, while
remote job refs and runtime references stay server-side and fail closed after
process loss unless the vertical extension supplies a recoverable resolver. A
missing binding is not a permissive fallback, and embedded/CLI callers remain
outside that authority until they add their own trusted admission path.

For the Matrix Law product only, an enabled controlled-model admission may
accept a model name that is absent from DeerFlow's static model list because
the name comes from the capability-server catalog. This exception is limited
to the single trusted legal admission; ordinary DeerFlow deployments and legal
deployments without controlled models retain the static allowlist. Task
admission and the capability Gateway still fail closed on tenant, member,
deployment, policy, and catalog authorization before model construction.

**Dependency rule**: App imports deerflow, but deerflow never imports app. This boundary is enforced by `tests/test_harness_boundary.py` which runs in CI.

**Import conventions**:
```python
# Harness internal
from deerflow.agents import make_lead_agent
from deerflow.models import create_chat_model

# App internal
from app.gateway.app import app
from app.channels.service import start_channel_service

# App → Harness (allowed)
from deerflow.config import get_app_config

# Harness → App (FORBIDDEN — enforced by test_harness_boundary.py)
# from app.gateway.routers.uploads import ...  # ← will fail CI
```

Package import hygiene: the `deerflow.agents` and `deerflow.subagents` package
roots expose heavyweight graph/executor entrypoints lazily. The
`deerflow.agents:make_lead_agent` LangGraph Server entrypoint is a concrete thin
module-level function because the server resolves graph factories directly from
the module dictionary; the wrapper keeps the lead-agent and skill-cache imports
inside the function so importing the package remains lightweight. Internal
modules that only need lightweight types, config, or registries should import
the concrete submodule instead of adding eager package-root imports that pull in
the tool graph or subagent executor during state/schema imports.

`ThreadMetaStore.search()` keeps JSON filter semantics identical across memory,
SQLite, and PostgreSQL: missing differs from null, bool differs from int, and
float filters accept integer or real JSON numbers through `json_value_matches`.

## Development Workflow

### Test-Driven Development (TDD) — MANDATORY

**Every new feature or bug fix MUST be accompanied by unit tests. No exceptions.**

- Write tests in `backend/tests/` following the existing naming convention `test_<feature>.py`
- Run both offline targets before and after your change: `make test` and `make test-blocking-io`
- Tests must pass before a feature is considered complete
- For lightweight config/utility modules, prefer pure unit tests with no external dependencies
- If a module causes circular import issues in tests, add a `sys.modules` mock in `tests/conftest.py` (see existing example for `deerflow.subagents.executor`)

```bash
# Run default offline tests
make test

# Run strict blocking-I/O tests
make test-blocking-io

# Explicit live integration tests (requires config.yaml and credentials;
# calls real APIs and may create local side effects)
make test-live

# Run a specific test file
PYTHONPATH=. uv run pytest tests/test_<feature>.py -v
```

Direct pytest collection or execution of `tests/test_client_live.py` remains
skipped unless `DEER_FLOW_RUN_LIVE_TESTS=1` is set. Do not add that opt-in to
default CI workflows.

Jina request-failure logging tests set a dummy API key so the separate once-per-process
missing-key warning cannot make assertions depend on test order or shard placement.
Missing-key behavior has its own tests in `tests/test_jina_client.py`.

### Running the Full Application

From the **project root** directory:
```bash
make dev
```

This starts all services and makes the application available at `http://localhost:2026`.

**All startup modes:**

| | **Local Foreground** | **Local Daemon** | **Docker Dev** | **Docker Prod** |
|---|---|---|---|---|
| **Dev** | `./scripts/serve.sh --dev`<br/>`make dev` | `./scripts/serve.sh --dev --daemon`<br/>`make dev-daemon` | `./scripts/docker.sh start`<br/>`make docker-start` | — |
| **Prod** | `./scripts/serve.sh --prod`<br/>`make start` | `./scripts/serve.sh --prod --daemon`<br/>`make start-daemon` | — | `./scripts/deploy.sh`<br/>`make up` |

| Action | Local | Docker Dev | Docker Prod |
|---|---|---|---|
| **Stop** | `./scripts/serve.sh --stop`<br/>`make stop` | `./scripts/docker.sh stop`<br/>`make docker-stop` | `./scripts/deploy.sh down`<br/>`make down` |
| **Restart** | `./scripts/serve.sh --restart [flags]` | `./scripts/docker.sh restart` | — |

**Nginx routing**:
- `/api/langgraph/*` → Gateway embedded runtime (8001), rewritten to `/api/*`
- `/api/*` (other) → Gateway API (8001)
- `/` (non-API) → Frontend (3000)

### Running Backend Services Separately

From the **backend** directory:

```bash
# Gateway API
make gateway
```

Direct access (without nginx):
- Gateway: `http://localhost:8001`

### Frontend Configuration

The frontend uses environment variables to connect to backend services:
- `NEXT_PUBLIC_LANGGRAPH_BASE_URL` - Defaults to `/api/langgraph` (through nginx)
- `NEXT_PUBLIC_BACKEND_BASE_URL` - Defaults to empty string (through nginx)

When using `make dev` from root, the frontend automatically connects through nginx.

## Key Features

### Web Search Recency

DDG, Brave, Tavily, and SearXNG `web_search` share optional
`time_range=day|week|month|year`; omission preserves request shape. DDG maps to
`d|w|m|y`, Brave to `pd|pw|pm|py`, and Tavily/SearXNG pass values unchanged.
For recency, DDGS 9.14.1 uses only enabled Brave, DuckDuckGo, and Yahoo engines
that honor `timelimit`: `auto`/`all` resolves to this set, incompatible configured
engines are removed, and an empty set falls back to it. Re-check on DDGS upgrades.

### File Upload

Multi-file upload with automatic document conversion:
- Endpoint: `POST /api/threads/{thread_id}/uploads`
- Supports: PDF, PPT, Excel, Word documents (converted via `markitdown`)
- Rejects directory inputs before copying so uploads stay all-or-nothing
- Reuses one conversion worker per request when called from an active event loop
- Files stored in thread-isolated directories under the resolving user's bucket (`users/{user_id}/threads/{thread_id}/user-data/uploads`). For IM channels the owner is threaded explicitly via the `user_id=` kwarg (see IM Channels → Owner-scoped file storage); HTTP/embedded callers resolve it from `get_effective_user_id()`
- Duplicate filenames in a single upload request are auto-renamed with `_N` suffixes so later files do not truncate earlier files
- Gateway HTTP uploads stage bytes as `.upload-*.part` files and atomically replace the destination only after size validation. These staging files are hidden from upload listings, agent upload context, and sandbox listing/search tools, and swept on Gateway startup if a hard crash leaves one behind.
- Gateway HTTP upload/list/delete handlers offload filesystem work through `deerflow.utils.file_io.run_file_io`, a dedicated ContextVar-preserving file IO executor. Non-mounted sandbox uploads acquire sandboxes with `SandboxProvider.acquire_async()` and offload `read_bytes()` plus `sandbox.update_file()` together.
- Mounted upload paths skip both sandbox acquisition and per-file synchronization. For AIO remote/provisioner deployments this requires an explicit, accurate `sandbox.thread_data_mounts: true`; omission preserves backend auto-detection.
- Agent receives uploaded file list via `UploadsMiddleware`; title generation continues to use the original user request rather than the injected upload-context wrapper, with attachment-only messages falling back to `New Conversation`

See [docs/FILE_UPLOAD.md](docs/FILE_UPLOAD.md) for details.

### Plan Mode

TodoList middleware for complex multi-step tasks:
- Controlled via runtime config: `config.configurable.is_plan_mode = True`
- Provides `write_todos` tool for task tracking
- One task in_progress at a time, real-time updates

See [docs/plan_mode_usage.md](docs/plan_mode_usage.md) for details.

### Context Summarization

Automatic conversation summarization when approaching token limits:
- Configured in `config.yaml` under `summarization` key
- Trigger types: tokens, messages, or fraction of max input
- Keeps recent messages while summarizing older ones
- Manual compaction uses `POST /api/threads/{id}/compact`, reuses the same
  `DeerFlowSummarizationMiddleware`, writes a new checkpoint with updated
  `messages` and `summary_text`, and bumps only those channel versions.
  The route uses the shared `reserve_checkpoint_write()` boundary (also used by
  manual state updates). Its short-lived `checkpoint_write` thread operation
  shares the durable active-thread uniqueness constraint with run admission,
  preventing either worker-local or cross-worker checkpoint-write races.

See [docs/summarization.md](docs/summarization.md) for details.

### Vision Support

For models with `supports_vision: true`:
- `ViewImageMiddleware` processes images in conversation
- `view_image_tool` added to agent's toolset
- Images are converted to base64 and appended to the model request as a hidden message carrying both a reserved ID prefix and a server-owned metadata marker; Gateway strips that marker from untrusted input, and the middleware requires both identifiers to recognize its own message. The middleware injects inside `wrap_model_call`, so the payload never enters graph state: checkpoints retain only lightweight `viewed_images` metadata, while client-chosen IDs survive. It also sweeps its own message out of every request before rebuilding it, so a payload stranded in an older checkpoint by an interrupted run stops being resent

### Password Recovery

Local-account recovery is optional and remains disabled unless SMTP host, sender,
and a fixed HTTPS public base URL are configured. The reset-only token is
short-lived, read from a URL fragment by the frontend, and consumed through an
atomic user-version update. OAuth-only accounts are not reset through local
password recovery. Read [PASSWORD_RESET.md](docs/PASSWORD_RESET.md) before
changing this flow; production multi-worker deployments also need a shared edge
rate limit.

Local Gateway administrator MFA is implemented in `auth/mfa.py` and
`routers/auth.py`, with persistence in migration `0020_admin_mfa`. It is
opt-in through `AUTH_MFA_REQUIRED_FOR_ADMINS`; the Matrix Law candidate enables
it explicitly. It covers local password admins only. Do not imply OIDC or
capability-platform admins are covered. Keep the 32-byte
`AUTH_MFA_ENCRYPTION_KEY` in the tenant secret store and consistent across
workers. MFA has no supported audited reset command yet; production rollout
remains blocked on a rehearsed recovery and key-rotation procedure. See
`docs/ADMIN_MFA.md`.

Password-reset delivery is a separate auth-owned durable outbox in the shared
database. Persist only encrypted reset tokens, bound to the user, token version,
purpose, and expiry. Claim before SMTP; retry only explicit transient 4xx
responses. Erase uncertain in-flight attempts rather than replaying potentially
accepted SMTP DATA. SMTP credentials and the Fernet key are separate settings;
request limiting is also shared in that auth database and stores only keyed
digests. Invitation and W12 notification mail stay independently gated.

## Code Style

- Uses `ruff` for linting and formatting
- Line length: 240 characters
- Python 3.12+ with type hints
- Double quotes, space indentation

## Documentation

See `docs/` directory for detailed documentation:
- [CONFIGURATION.md](docs/CONFIGURATION.md) - Configuration options
- [ARCHITECTURE.md](docs/ARCHITECTURE.md) - Architecture details
- [API.md](docs/API.md) - API reference
- [SETUP.md](docs/SETUP.md) - Setup guide
- [PASSWORD_RESET.md](docs/PASSWORD_RESET.md) - Password recovery configuration and API
- [ADMIN_MFA.md](docs/ADMIN_MFA.md) - Local Gateway administrator MFA, secret-key handling, scope, and recovery limits
- [FILE_UPLOAD.md](docs/FILE_UPLOAD.md) - File upload feature
- [PATH_EXAMPLES.md](docs/PATH_EXAMPLES.md) - Path types and usage
- [summarization.md](docs/summarization.md) - Context summarization
- [plan_mode_usage.md](docs/plan_mode_usage.md) - Plan mode with TodoList

### Matrix Law W19 Gateway process-crash recovery smoke

From backend/, run .venv/bin/python tests/w19_gateway_process_crash_recovery.py to verify that a persisted synthetic run is reconciled after one real Uvicorn Gateway process is killed and a fresh process starts against the same disposable SQLite state. This is a narrow local recovery check only; it does not establish PostgreSQL/Redis/object-store recovery, multi-host availability, or production stability. It uses no provider credentials or legal case data.

### Reviewed forward-schema rollback bridge

`persistence/managed_schema_compatibility.py` declares only the exact W12→W13 heads and complete catalog hashes taken from the independently verified W13 c1 tenant plan. It is not a configurable version range. Managed startup uses one PostgreSQL repeatable-read snapshot; unknown or unreadable catalogs refuse startup. Never add DDL, fake a version marker, relax RLS, or accept a future revision on its name alone.

The public `deerflow_extension_api.managed_schema_catalog` module shares the existing native deployment catalog format and non-secret reader. Its source originated at native reader SHA `06f5803bcfebc49d8f7287702bfc7622c9d40d5232bef19fa8de90f1e25138e2`; its deliberate path fix uses literal `public` instead of `$user,public` so role deerflow cannot resolve the deerflow schema differently from the operator. Keep full section/type validation, grants, roles and security metadata. The operator's existing fingerprints remain unchanged; verify this using an exact signed materialized schema with operator, framework and API roles before shipping.

Run `tests/test_managed_schema_forward_compatibility.py` plus PostgreSQL engine and harness-boundary regressions. An actual candidate gate must additionally prove old-account CRUD, extension readiness and RLS, and refusal of unknown columns, grants, RLS disablement and runtime BYPASSRLS on a disposable copy. Unit fingerprints alone cannot prove deployability. This compatibility bridge is not yet a cloud release.
