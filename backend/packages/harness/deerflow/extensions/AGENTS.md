### Python Extension System (Runtime and Distribution)

Third-party Python packages can expose an `install(registry, config)` function and be
loaded, in deterministic order, from the startup-only top-level `plugins:` list in
`config.yaml`. Keep this list out of `extensions_config.json`: the latter is writable
through Gateway APIs, while importing Python entry points is an operator-controlled code
execution boundary. A plugin marked `required: true` fails Gateway construction when it
cannot load; optional plugins fail open with attributed diagnostics.

Packaged extensions use one PEP 621 entry point in the
`deerflow.extensions` group, for example
`example = "deerflow_extension_example:install"`. The operator CLI is dispatched from
the existing `deerflow` console script to `extensions/cli.py` and exposes only these
surfaces: `install SOURCE [--yes]`, `list`, `enable NAME`, `disable NAME`, and
`remove NAME`. `NAME` resolves against the entry-point name, distribution name, or
`module:install` value. The root `make extension-*` targets are convenience wrappers;
because they execute from `backend/`, documentation should use absolute local source
paths with `SOURCE=` unless backend-relative behavior is intentional.

`ExtensionManager` owns the package/config transaction. Install runs a controlled
`uv add --project <backend> --group extensions --no-workspace --no-sync -- <source>`, updates the dedicated
`[dependency-groups].extensions` list and `uv.lock`, discovers exactly one packaging entry
point, and inserts or adopts one
managed `plugins:` record with `name`, `package`, `use`, `enabled`, `required`, and
private `config`. New records are written `required: false`, matching the loader default:
`required: true` turns any later load failure — a broken wheel, a missing native library, a
deleted snapshot — into a Gateway startup abort recoverable only through shell access, so
it is an explicit `install --required` opt-in rather than the managed default. Adoption of
an existing hand-written record preserves whatever `required` the operator already chose.
Enable/disable changes only the host-level `enabled` flag and preserves
private configuration. Remove runs `uv remove --group extensions`, removes the plugin
record, and deletes its managed source snapshot. Install validates the selected config
file before running any uv command, because `uv add`/`uv sync` execute the package's build
backend: a config this manager could never write to must fail before that code runs, not
afterwards through rollback.
Failed install/remove operations restore `pyproject.toml` and `uv.lock` and resynchronize
the restored environment; that second restore runs even when the recovery sync itself fails
(a recovery sync without `--locked` writes a lock while resolving), and a failing recovery
sync reports the original failure alongside it. The restore is deliberately not blanket:
when recovery detects a concurrent external edit to the dependency files or the config it
preserves that edit and raises instead, and `remove` leaves the plugin deactivated in that
case rather than reviving a record whose package declaration may already be gone. A
cancellation skips the recovery sync entirely — the declarations are already restored and
the next locked startup sync reconciles the environment, whereas blocking an interrupt on a
full dependency resolve invites a second interrupt that escapes the handler mid-transaction.
Package mutation is deferred from environment mutation: after `uv add/remove`
updates the declaration and lock, one `uv sync --locked --all-packages` preserves the same
config-/environment-detected optional extras as normal startup. All three uv calls pin the
backend project explicitly and discard UV environment overrides that could redirect the
project, working directory, sync mode, lock policy, or target environment — including
`UV_PYTHON`, which would swap the interpreter that then loads the extension entry point,
and `UV_INSECURE_HOST`, which would remove the TLS validation the HTTPS-only source rule
depends on; index, proxy, cache, and credential-provider settings remain available.
The `--no-workspace` boundary requires uv 0.8.0 or newer. The stock Docker paths pin uv
0.11.1, and the manager fails before mutation when the host uv is older.
All install/remove/enable/disable mutations for a checkout hold the cross-process
`.deer-flow/extension-manager.lock`; remove deactivates config before changing the package
declaration, and rollback preserves a concurrent external config edit instead of replacing
it. The MVP has no in-place upgrade: operators retain private config, remove the old
package, install the new source pin, and restore that config.

Local-directory installs are snapshots, not editable links. The manager validates the
source, derives the destination from the normalized distribution name, and copies it to
`backend/extensions/sources/<distribution>/`. It ignores Git metadata, virtual
environments, Python caches, and bytecode; rejects symbolic links, path-escaping
distribution names, and likely credential files; and the root `.dockerignore` explicitly
re-includes the entire managed tree so package READMEs, native modules, and assets reach
the backend builder. These checks prevent common packaging accidents, not malicious
code. Both Python build hooks and imported extension code execute with Gateway
privileges, so the CLI requires confirmation (or explicit `--yes`) and accepts only
trusted operator sources; source URLs containing embedded credentials are rejected.
Remote direct references are limited to HTTPS, and remote Git sources must use public
Git-over-HTTPS (with loopback HTTP accepted for local tooling). SSH Git URLs are rejected
because the stock Docker builder does not forward host SSH credentials; relative paths and
local wheels must use the managed directory snapshot path instead. Git's SCP-like shorthand
(`git@host:org/repo.git`) carries no URL scheme, so it is detected before the scheme rules
and reported with the same public-HTTPS correction rather than the local-path message.
Local wheel and `file://` sources are rejected because they cannot be reproduced inside the
Docker build context; local code must enter through the directory-snapshot path. Stock
production builds support public package indexes and public HTTPS Git sources reachable by
the builder; authenticated source configuration must not be embedded in the recorded URL.
Source validation alone cannot catch environment-driven resolution (for example a
`UV_FIND_LINKS` wheelhouse turning a plain package requirement into a local wheel
reference), so after every `uv add/remove` the manager audits the new lock before syncing
or enabling anything. Any local reference that the stock backend image build cannot
reproduce — absolute paths, `file:` URLs, or relative paths outside the project root, its
exact workspace members, and the managed `extensions/sources/` snapshots — fails the whole
transaction and rolls back the dependency files, config, snapshot, and environment. A
loopback URL recorded in the lock is warned about rather than rolled back: `127.0.0.1`
inside the image builder is a different machine, so the reference is just as
non-reproducible, but unlike an environment-driven wheelhouse resolution it is a source the
operator typed deliberately. A private-network index is left alone entirely — a builder on
that network can reach it. A
config with duplicate top-level `plugins:` keys is rejected outright rather than managed
against one block while the Gateway reads another.

The managed `plugins:` block is rewritten in place, and both of its boundaries come from
the YAML parser rather than a key-shaped pattern. `AppConfig` allows extra top-level keys,
so a neighbouring section may be named anything YAML accepts (`my.key`, `2fa`, `$schema`, a
non-ASCII word); a pattern that fails to recognize the next key does not fail loudly, it
reports "no next section" and the rewrite replaces that neighbour and its whole subtree.
Trailing comments below a file-final block are preserved for the same reason — the manager
appends `plugins:` at end of file, so that is the steady-state shape.

Dependency synchronization has one lock authority: the manager's `uv add/remove` calls
are the only extension workflow allowed to update `backend/uv.lock`, and each mutation is
followed by the local-source audit described above. The `extensions`
group is included in `[tool.uv].default-groups` alongside `dev`. Root/backend install
targets use `uv sync --locked`; direct backend `make dev`/`make gateway` use
`uv run --locked`; the local full-stack launcher and Docker-dev entrypoint perform one
locked sync and then launch with `uv run --no-sync`; the production Docker builder syncs
the same copied backend project and lock, and both image runtime commands use
`--no-sync`. Thus production may download locked remote artifacts while building an
image, but production container startup never resolves or installs an extension from the
network. Local and Docker-dev pre-start syncs may fetch missing locked artifacts.
`docker/dev-entrypoint.sh` retries a failed sync once after recreating `.venv`, but keeps
`--locked` on the retry: that repairs a broken virtualenv, not a stale lock. A second
failure aborts with recovery instructions instead of starting uvicorn against an
environment that does not match the lock, because startup must never silently resolve
dependencies.
That discipline assumes the uv writing the lock and the uv reading it stay compatible, so
uv is pinned rather than floating: `backend/Dockerfile`'s `UV_IMAGE` is the single source of
truth, both compose defaults repeat it, and every `astral-sh/setup-uv` step pins the same
version so CI exercises the manager against the binary production actually runs. Otherwise a
newer uv can bump `uv.lock`'s `revision` (or make `uv lock --check` disagree with a lock
generated elsewhere) while CI stays green, and the pinned uv in the production image then
fails on the committed lock. `backend/tests/test_ci_uv_version_pin.py` keeps the four
locations in step, which makes a uv upgrade one deliberate, reviewable change.
Rebuild the Gateway image after changing the managed set. Every install, enable, disable,
remove, or config mutation also requires a Gateway restart because plugin loading is
startup-only.
The root management wrappers bootstrap the checkout environment without the extension group
via `uv run --frozen --no-group extensions`, so a broken or disappeared extension source cannot
trigger project validation before the operator can list, disable, or remove it, while a
fresh checkout can still install the non-extension environment from the existing lock. After CLI
entry, the manager owns the controlled locked sync.

The public package is `packages/extension-api/` and must never import `deerflow` or carry
framework dependencies. Extensions declare any FastAPI, LangChain, or LangGraph imports
themselves. Its registry contract exposes nine contribution kinds: middleware
contributors, fail-closed task-admission contributors, task-lifecycle contributors,
system-model-call observers, agent-assembly observers, context-compaction observers,
Gateway-lifetime services, invite-only account-claim handlers, and eager routers. Middleware contributions declare lead/subagent scope, stable
order, and a semantic placement (`MODEL_LOGICAL`, `MODEL_PHYSICAL`, `TOOL_VISIBLE`,
`TOOL_RAW`, or `STANDARD`) rather than a fragile list index. `extensions/stack.py` is the
single final composition point; do not inject inside
the shared base builder because the lead builder appends more middleware afterward.
`extensions/ordering.py` owns host ordering invariants and validates the final composed
stack. Nothing under `extensions/` may import `agents.middlewares` at module scope: the
middleware layer calls into this one, so a module-scope reference points the dependency
backwards and closes a cycle as soon as any middleware imports something under
`extensions/` at module level. Both tables that need middleware classes therefore resolve
on first use — `ordering.py::core_ordering_constraints()` and `stack.py::_anchors()` —
which is `assert_ordering` / composition time, already inside the middleware builder.
Defer by deferring the *call*; do not fake a resolved value with a lazy container
subclass, which reports one answer when iterated and another when measured.

**Agent assembly observation.** `assemble_lead_agent()` returns
`LeadAgentAssembly(graph, descriptor)`; `make_lead_agent()` remains the
graph-only LangGraph Server ABI declared in `langgraph.json` and must keep that
signature. The descriptor
(`deerflow_extension_api.assembly.AgentAssemblyDescriptor`) captures the
resolved model, rendered prompt hash, authorization-filtered tool list,
composed middleware stack with each middleware's declared policy, deferred tool
names, enabled skills, and effective policies — all of which are decided inside
the factory and are unrecoverable afterwards. Its `fingerprint` sorts tools and
skills (assembly order is incidental) but preserves middleware order (stack
order decides what wraps what). It also excludes `build` and `requested_model`:
the fingerprint answers "did this agent's assembly change", so folding in the
host build would move every agent's fingerprint on every redeploy and make that
finer question unanswerable — `build` stays a reported field a consumer can
compare directly. Registered `AgentAssemblyObserver`s are notified
synchronously at the end of construction; failures are contained per observer.
Gateway `resolve_agent_factory()` now returns `assemble_lead_agent`, so every
consumer must unwrap `.graph` — a third-party factory returning a bare graph
stays supported.

`SubagentExecutor` publishes the same descriptor kind for each delegated agent
on `self.assembly_descriptor`. The projection itself lives in
`deerflow/agents/assembly_descriptor.py`: a middleware that implements
`release_policy_parameters()` owns its own identity, and probing private
attributes is the marked fallback for the ones that do not.

Because `IsolatedMiddleware`'s cached subclasses all carry the wrapper's own
class name and module, and the wrapper forwards no `release_policy_parameters`,
describing a contributed middleware directly would collapse every extension's
contribution into one identical descriptor and hide policy changes inside them.
`describe_middleware()` therefore unwraps to `.inner` and records `.source` as
the descriptor's `extension` field, which participates in the fingerprint. It
duck-types on those attributes rather than importing `extensions/isolation.py`:
`extensions/` sits below `agents/`, so importing it there would point the
dependency backwards.

Contributed middlewares are wrapped by `IsolatedMiddleware`: extension failures emit
diagnostics and fail open without repeating a downstream model/tool side effect. The
wrapper mirrors lifecycle hooks, tools, transformers, and state schema implemented by
the inner middleware. LangChain treats each sync/async model or tool wrapper pair as one
capability, so a single-sided wrapper receives a pass-through counterpart; implement
both sides when the extension must observe both synchronous and asynchronous execution
paths.

Lead runs and subagents allocate an `ExtensionData` task store only when middleware,
task admission, task-lifecycle, or system-model observation is registered; services and routers are
app-scoped and do not allocate one. Middleware and system-call sites recover the
live store through `EXTENSION_TASK_STORE_KEY` / `task_store_from_runtime()`; lifecycle
contributors receive that same store directly. Each task resolves the immutable
loaded-extension snapshot once and binds that same object through task-store allocation,
hooks, and synchronous agent construction, so a concurrent singleton replacement cannot
mix two extension generations without changing the LangGraph graph-factory ABI. The
graph-build binding is a ContextVar scoped to synchronous construction, so it has already
exited by the time the lead agent delegates; the run worker therefore also publishes the
snapshot on runtime context under the host-internal `EXTENSION_SNAPSHOT_CONTEXT_KEY`,
`task_tool` reads it back through `resolve_run_extensions()` (type-checked — runtime
context is caller-mergeable), and `SubagentExecutor` binds it at construction. That key is
written after the caller merge and popped when the run has none, so a caller-supplied value
is never authoritative. Absent the key — embedded `DeerFlowClient`, standalone LangGraph
Server — the executor keeps its `get_loaded_extensions()` fallback.

The lead worker first awaits every `admit_task` contributor after the run has started but
before agent construction or execution. Admission contributors receive the server-owned
`TaskInfo.user_id`; exceptions, timeouts, and extension-loop dispatch failures propagate
and terminalize the task. This hook is the extension surface for security-sensitive
context validation. It is intentionally separate from the fail-open lifecycle pipeline.
Subagents with a parent run use the same admission path and inherited server user.

The lead worker awaits `on_task_start` after successful admission and awaits `on_task_stop`
after completion persistence/hooks but before clearing any active finalizing barrier or
publishing the stream end. A subagent with a parent `run_id` wraps its execution with the
same start/stop pair. Outcomes are conservative (`completed`, `aborted`, or `failed`),
contributors run in registration order within one bounded budget, and notification failures
are logged and fail open.

Fail-open is decided by the *origin* of a failure, not by its base class, because
`CancelledError` reaches a contributor's `except` for two unrelated reasons. Only a genuine
cancellation of the host task increments `asyncio.Task.cancelling()`, so `_notify_each`
propagates on that and contains everything else: a contributor that lets a `CancelledError`
escape — an extension implementing an internal timeout with cancellation, say — must not
skip its successors, and must not reach the worker's deferred-interrupt path, which would
end an otherwise successful run as cancelled. `KeyboardInterrupt` / `SystemExit` still
propagate.

System-model-call observers cover DeerFlow-owned model invocations that do not pass
through middleware model-call wrappers: goal evaluation, memory extraction, title
generation, and summarization. They receive a request/result snapshot, duration, and the
active task store when one exists; detached system work receives an isolated store. All
three terminal paths are reported without changing the exception the host observes:
success and failure are awaited inline, while cancellation — routine, since
interrupt/rollback admission and shutdown both cancel the run task, with the provider
tokens already spent — is submitted to the notify loop instead of awaited, because a
repeated cancel would interrupt that await before any observer ran. A deployment with no
registered notify loop drops the cancellation observation, exactly as the synchronous
memory bridge does. `SystemModelRequest.messages` normalizes to a tuple at construction: goal and
memory pass a message list while title and summarization pass one prompt string, and a
bare `str` is already a `Sequence`, so without normalization an observer iterating it
would walk characters. Normalizing also copies a live list, which is what makes the frozen
snapshot immutable in fact rather than only by declaration. Gateway registers one canonical extension-notification loop. Awaited lifecycle
hooks and async system observations are dispatched to that loop even when the caller is a
subagent's isolated loop, while synchronous system callbacks submit fire-and-forget work
there. Shutdown stops accepting detached observations before the memory shutdown flush and
resets the loop only after in-flight run/subagent drain ordering is complete.

`ContextCompactionObserver` reports the one moment a lossy context transform can still be
described: `DeerFlowSummarizationMiddleware.compact_state()` / `acompact_state()` hash each
about-to-be-removed message's content before the summary model call, then — once a summary
is produced and the pre-compaction hooks have run — build a `CompactionEvent` (transform
kind/version, source content hashes, the produced summary's content hash, and the
compacted/kept message counts) and call `notify_context_compacted()`. Once
`_maybe_summarize`/`_amaybe_summarize` remove the source messages from state, that mapping
cannot be reconstructed, so the event is the only record of it. The event is keyed on
`canonical_hash(message.content)` directly — never a stringified copy, which would defeat
`canonical_hash`'s key-order normalization for multimodal (`list[dict]`) content — rather
than a producer-stamped identity key: nothing currently mints a stable per-message identity
for compaction's source messages or its summary, so an identity-keyed field would ship
permanently empty. `notify_context_compacted()` is a
synchronous, fire-and-forget entry point — both the sync and async compaction paths call it
without an `await` — that dispatches to the same registered extension-notification loop
system-model-call cancellation uses, reusing `_notify_each`'s per-observer fail-open
containment. There is no live task to attach at that call site, so observers receive a
detached task store, the same fallback `notify_system_model_call` uses when its caller
supplies none.

Gateway services start in registration order after the persistence engine and session
factory are ready. Each receives the same `ExtensionRuntimeDeps` snapshot containing the
app store, projected host policy, and session factory. Start failures are attributed and
fail open. The runtime captures `app.state.extensions` once, registers cleanup before the
start batch, and stops the attempted service prefix in reverse order after run/subagent
drain but before store, checkpointer, and engine teardown. Each stop has an independent
bounded timeout; failures do not starve later cleanup. A service-originated
`CancelledError` fails open, while a new cancellation of the host task still propagates
through the exit stack. Runtime diagnostics must be appended through
`record_runtime_diagnostics()` so `app.state.extension_diagnostics` remains the canonical
live list.

`ExtensionRuntimeDeps.read_output_text(runtime, path, max_bytes)` is an optional async
host capability for complete UTF-8 output inspection. It reuses native present-files path
normalization, sandbox authorization/acquisition and off-thread reads. It does not use
display truncation; the byte budget is checked after provider I/O, not an allocation cap.
No immutable snapshot or legal approval is implied. Consumers must handle missing readers
and read failures explicitly; domain validation belongs to their extension, not this host port.

`ExtensionRuntimeDeps.create_output_text(runtime, content, suffix)` is an optional native
output creation port. It accepts bounded UTF-8 text and .md/.txt/.json, not a target path;
the host generates a UUID filename in the current thread's outputs. Sandbox authorization,
async acquisition, off-thread local path resolution, per-file locking and read-back verification
are reused. A preexisting target or uncertain absence fails closed. The lock is process-local,
not distributed exclusive creation; failure/cancellation may leave an unpresented draft.
Byte creation uses existing Sandbox.update_file and binary read-back, not model text write/read
that can translate newlines or content paths. Local read-back uses the validated resolved host path;
remote read-back uses download_file. Preserve BOM/CRLF/literal paths; never claim a normalized read is exact bytes.
This port does not publish files, save project versions, run domain authorization or provide
cross-system transactions/replay safety. Domain tools must reauthorize before calling and
declare their write/replay policy. Matrix Law does that with GENERATE_DOCUMENT and forbid.
Its packaged template_assets must match the authoritative Skill assets byte-for-byte;
the six built-ins are read-only and do not provide tenant-custom CRUD or legal approval.
`present_output_files(runtime, paths)` invokes the actual native `present_files` tool
with callbacks and returns its Command. Returning a look-alike artifacts state update
alone does not satisfy the worker's present_files delivery receipt. Domain validation
remains caller-owned (Matrix Law uses this only for its verified new Markdown draft).

`read_uploaded_bytes(runtime, path, max_bytes)` and `create_output_bytes(runtime, bytes, suffix)`
are optional host capabilities, not new model-facing tools. Upload reads require an exact virtual
uploads path and a state bucket matching native user/thread identity. Local POSIX reads reject
hidden components, traversal, symlinks (including post-validation swaps) and nonregular files,
and read at most budget + 1 bytes off-thread. Remote reads use native download_file and its
provider boundaries; byte limits are checked after download. Do not claim local no-follow or
allocation guarantees for remote providers without separate provider verification.
Binary outputs reuse the existing UUID/authorization/lifecycle/lock/update_file/read-back path,
accept safe compound suffixes, and cap at 16 MiB plus the native write budget (80 KiB by default).
Larger legal imports require explicit operator budget configuration, not bypassing that limit.
The existing text port retains its three suffixes and 64 KiB cap. Neither port validates legal
reports, reauthorizes a legal project after I/O, publishes files or automatically saves versions.
Session 56 adds these source-only ports; session 57 wires the managed legal import tool described
below. Paired deployment and strict real-model acceptance remain pending; unit tests are not migration success.

Routers are constructed eagerly during `install()` and mounted only after all host routes,
so host handlers always win. The Gateway rejects a contributed router atomically when an
earlier host or extension route provably covers one of its paths for the same HTTP method.
The conservative matcher proves common shadows through normalized parameter names,
static-vs-dynamic matching, known built-in-converter containment, supported compound
segments, full-segment `path` catch-alls, and `Mount` descendants reducible to those same
rules. Relationships requiring general regex-language inclusion are allowed rather than
guessed. Host WebSocket routes do not collide with contributed HTTP routes, but contributed
WebSocket routes are rejected until the host can supply authentication and Origin checks.
Because `include_router()` recompiles contributed routes, preflight projects the converter
registry at include time. Nonstandard converters fail closed against reserved security
paths but otherwise prove a shadow only when their normalized matchers are identical.
Host authentication- and CSRF-exempt paths are reserved, including the exact public `/ready`
endpoint used for fail-closed orchestration readiness; contributed Mounts, unsupported
route items, startup/shutdown hooks, and custom router lifespans are rejected; lifetime
resources must use `ExtensionService`. Auth and CSRF classify
`get_request_route_path(request)`, the same root-path-adjusted ASGI path Starlette routes
match; do not switch those security predicates back to reconstructed `request.url.path`.
That helper delegates to the private `starlette._utils.get_route_path` on purpose. Its
requirement is not "strip `root_path` correctly" but "return exactly what the router is
matching on", so importing the dispatcher's own implementation keeps the two in lockstep by
construction. Do not vendor a local copy: a private import that disappears fails loudly at
startup, while a stale copy diverges silently at a security boundary. `starlette` is
therefore a declared, bounded direct dependency so the bump is visible in review, and
`tests/test_gateway_request_path.py` pins the agreement independently of the mechanism.
Any preflight, conflict, or include failure rolls back the whole router without preventing
later routers from mounting. Do not introduce a framework-bound `RouterContributor`
contract: the public registry accepts `Sequence[Any]`
to keep extension-api dependency-free.

Contributed routes are session-authenticated and cannot opt out. Within that, an extension
distinguishes an ordinary user from an administrator through `deerflow_extension_api.auth`:
`resolve_principal(request)` returns the caller, `require_admin(request)` raises
`PermissionError` for anyone else and fails closed when identity cannot be determined.
Extensions receive a projection — user id, admin flag, internal flag, roles — never the
host's auth context. The host installs the resolver on `app.state` (keyed by
`EXTENSION_PRINCIPAL_RESOLVER_KEY`) in `app.gateway.app.create_app()`, after
`AuthMiddleware` is added and before contributed routers are mounted; `resolve_principal`
reads it back at call time, since the router objects a contribution builds during
`install()` exist long before any request (or its identity) does. The host's projection
reads `request.state.user` synchronously (the same field `AuthMiddleware` stamps and
`require_admin_user` in `app/gateway/deps.py` reads as its primary path) rather than the
async, exception-based accessors that exist there for tests and alternative ASGI
compositions — keeping the resolver synchronous keeps it usable from both sync and async
route handlers.

The memory kind reaches those observers through a different shape, and the difference is
deliberate rather than an oversight to be "aligned" away. DeerMem must stay vendorable and
cannot import the extension API, so it reports through the `MemoryCallbacks.on_memory_llm_result`
host hook, which the DeerFlow-side callbacks translate into an observation and submit
without awaiting. It also guards its provider call with `BaseException` rather than
`Exception`, which is safe precisely because that whole path runs on a worker thread — the
debounce timer, or the executor `update_memory` offloads to — where cancelling the awaiting
side never interrupts the running thread, so `CancelledError` cannot arrive there at all.
The host hook wrapper around the callback stays at `Exception`: only the hook's own failures
are non-fatal, and an observability path must not swallow `SystemExit` / `KeyboardInterrupt`.

Gateway `create_app()` loads plugins once, stores the immutable registry on `app.state`
and in the process-wide singleton, mounts contributed routers last, and installs one
canonical live diagnostics list.
Changing `plugins` requires a restart. Any future contribution kind must be added to the
public contract and host runtime in the same slice; never accept a registration method
that the current host silently ignores.

### Extension Manager Test Repositories

`test_extension_manager.py` creates temporary Git repositories for local extension sources.
Temporary commits use an empty repository-local hook directory. They must not run developer or CI Git hooks.
Tests for hook behavior must create and invoke their own hook fixtures.

### Managed Matrix Law snapshot

Session 57 adds `law_import_authorities(files)` over the optional native byte ports. Legal code
cross-checks the complete frontend-v1 conversion report, original UTF-8 bytes/records, every mapping,
stable ID, body/duplicate counts and output digest; it does not rewrite files or invent law/date fields.
Use LegalSourceReader's admitted task, GENERATE_DOCUMENT and minimal audits; reauthorize after both
reads, parsing and each write, then use fresh admission for actual native presentation. Neither
successful format validation nor a digest is legal verification/approval. No automatic project save,
no text-tool fallback, no replay safety or distributed rollback; failure can leave drafts, and an audit
failure after native publication cannot retract its callback receipt. File bytes are checked at creation,
not frozen against later edits. The model sees only two uploaded virtual paths, never scope overrides.
This source-only increment passed real PostgreSQL/NOBYPASSRLS/native ToolNode with synthetic IO/model,
and a real frontend converter parity check. Frontend handoff wording, budget configuration, paired
images and strict live acceptance remain pending; 2035 is not upgraded by snapshot installation.

Session 52 extends the authority v1 contract with legacy_reference sources and reference_only
entries whose text is explicitly null. Require legacy_import, an original record without body,
and a matching source provenance; do not invent placeholder text or loosen ordinary text rules.
Legacy optional articleId/text/source preserve absent/null/empty/blank values within strict
Unicode/size/field limits. Source paths and seed IDs remain inert, never citation authority.
Frontend conversion retains all records and a byte-preserving report, but UI/native delivery
is not yet connected. Paired extension/frontend rollout is required; no database migration
or deployment follows from refreshing the package. Full version continuity remains pending.

Session 49 adds source-only `.law-authorities.json` drafts using existing legal_research artifacts,
not a new storage table or Agent. Native schema/validation tools use admitted scope/READ/audit;
configured enforcement validates current file bytes before native publication, including mixed graph/authority
batches. Save independently validates matching filename/source suffix, JSON kind/schema and project citation
identity before existing scanning/version persistence. Keep ordinary Markdown legal research compatible.
Hashes prove only payload consistency; URLs, completeness and legal analysis are unverified assertions.
Only unreviewed/unverified draft states are accepted, not forged approvals. Publication diagnostics are not
authorization or official-source receipts. Dedicated UI, full favorite history, official verification and
legacy-reference import remain pending; no new runtime deployment is implied by snapshot refresh.

Session 48 adds the source-only `law_search_common_laws` tool and authenticated
`/api/law/common-law-catalog`. These search ten bundled legacy excerpts, not the web or a current
statute database. Preserve IDs/text and legacy literal/JS-trim semantics; never fabricate official URLs,
versions, validity or applicability. The native tool uses LegalSourceReader admission/READ/audit;
off-thread bounded catalog loading is read_only/safe. The HTTP catalog contains no project references.
Official-source verification, native right-panel authority artifacts and legacy favorites import remain pending.

Session 47 supersedes the older deployment notes below: isolated 2035 runs template drafts plus the
management frontend, including blank creation, Markdown import, archive/rename/restore and selected-version
organization copies. Real API/scanning/browser checks and two synthetic real-model workflows passed;
this is not full role coverage or legal-quality acceptance. 2030 is stopped and not upgraded.

The extension head is `0016_custom_templates` (25 domain tables). Isolated 2035 was frozen,
restore-rehearsed and upgraded to 0016; 2030 remains at 0015. Freeze the current candidate
before further deployment; never blindly restore the old baseline over newer user writes.
Template Markdown is bounded inert tenant data, never an operator-owned Skill. Personal history
is owner-only, shared writes require owner/admin, publication copies one selected immutable version,
and deletion is recoverable archival. Seven extension-owned tenant template routes now wrap the repository
with public identity, LawApiRuntime audit/transactions, idempotency and exact-byte scanning.
Reads reauthorize after scanning; replay rechecks write access and stores only IDs/revisions.
The native picker, exact copy, editor and explicit template/project saves passed one real-model
desktop synthetic workflow on 2035. Legacy template import subsequently shipped in session 47;
complete legacy-project migration remains pending. No new Agent runtime.

Custom template tools discover active metadata and open one explicitly selected immutable
version with native output creation/publication. Scope comes only from admitted task identity; scan and
reauthorization fence awaited I/O. Copying an accessible shared template is distinct from updating it;
only document-generating project roles may create a copy. The copy leaves placeholders unchanged, returns
source ID/version/SHA, and has local_write/replay=forbid. Native editor Save-as-template is separate.
`law_create_custom_template_draft` (deployed on isolated 2035) substitutes explicit display values with
legacy placeholder/date syntax. Never infer server time/timezone/seconds or evaluate expressions;
unknown variables stay literal, absent time components become 待填写, output overflow fails closed.
Scan source and rendered bytes; reauthorize after awaits. Use off-thread bounded rendering, native
file creation/presentation and separate source/output digests; do not put submitted values in receipts.
No automatic library/project save. Rendering UI/deployment and individual Markdown import are available
on the session 47 candidate; full project import and production acceptance remain pending.

`backend/extensions/sources/matrix-law-extension/` is a deployable snapshot whose authority
lives in the sibling `matrix-law-deerflow` repository. Its evidence persistence layer keeps
file bytes, credentials, and signed URLs behind a provider-neutral storage port; PostgreSQL
stores only tenant/matter-scoped immutable version metadata. `law_evidence_versions` is
append-only at both repository and PostgreSQL-trigger layers. Do not add host-internal imports,
physical evidence deletion, or storage-provider logic outside the provider-neutral adapter boundary.

Matrix Law enforcement must be explicitly configured through the existing
`extensions.middlewares: [matrix_law_extension.runtime.enforcement:LawEnforcementMiddleware]`
entry point. Observer contributions ignore returned request/result replacements and cannot
block tools. The native configured middleware retrieves its service from the admitted task
store (no process-global service), applies the legal model policy, and validates each
`.law-graph.json` before native publication. Read/validation failures return error ToolMessages;
missing task services and genuine cancellation propagate. The sync graph path rejects publication.
Installing the package without that operator configuration does not enable enforcement.
Its SHA receipt is diagnostic only, never reusable authorization or human-review evidence.
Ordinary file writes/edits and non-graph publication retain native behavior; project saves
remain independently authorized/scanned. This is a publication-time check, not an immutable
file or protection from later edits/concurrent external file mutation.

The Matrix Law C2B snapshot now includes its own provider-neutral S3-compatible adapter, clamd
scanner, evidence routes, and retention/legal-hold deletion worker; this remains extension-owned
code and must not add storage/scanner dependencies or credentials to DeerFlow core. Credentials
come only from `MATRIX_LAW_S3_*` environment variables. Uploads claim idempotency after matter
authorization, stream through byte-size and SHA-256 verification, require a clean scan before the
business transaction commits, and register compensation so a later scan/database/audit failure
removes the UUID-keyed object. Downloads reauthorize every request and recheck scan, deletion, and
object metadata. Archive remains metadata-only; physical deletion requires a due retention policy,
no legal hold, a leased job, and a final row-locked recheck. Production-candidate storage must use
AES256 or aws:kms and fail closed when persisted encryption is absent. Because a managed source
snapshot is installed rather than editable, changing it without changing the distribution version
requires a locked `--reinstall-package matrix-law-extension`; preserve the configured database
extra when refreshing the environment.

`ExtensionRuntimeDeps.worker_metrics` is an optional host-owned, thread-safe recorder for
background worker batches and aggregate queue observations. It accepts only fixed worker names,
batch count/duration/error state, and queue depth/oldest age; never add tenant, matter, membership,
user, task, provider endpoint, or credential values. Failed snapshots preserve the last successful
gauges and increment an identity-free error counter. Metrics are scraped only through the Gateway's
loopback `/metrics` route, remain opt-in, and must not affect task success if reading or recording fails.
