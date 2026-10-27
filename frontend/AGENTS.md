# AGENTS.md

This file provides guidance to AI coding agents (Claude Code, Codex, and others) when working with the DeerFlow frontend. It is the source of truth; the sibling `CLAUDE.md` imports it via `@AGENTS.md`.

## Project Overview

DeerFlow Frontend is a Next.js 16 web interface for an AI agent system. It communicates with a LangGraph-based backend to provide thread-based AI conversations with streaming responses, artifacts, and a skills/tools system.

Product-facing branding is Matrix-Law: use the Matrix-Law wordmark and `matrix-law-symbol.svg` in visible frontend surfaces. Do not expose the DeerFlow name or logo as the product brand. Keep internal API names, storage keys, event fields, and framework documentation technically accurate.

**Stack**: Next.js 16, React 19, TypeScript 5.8, Tailwind CSS 4, pnpm 10.26.2. Requires Node.js 22+ and pnpm 10.26.2+.

### Core dependencies

- **LangGraph SDK** (`@langchain/langgraph-sdk` ^1.5.3) — Agent orchestration and streaming
- **LangChain Core** (`@langchain/core` ^1.1.15) — Fundamental AI building blocks
- **TanStack Query** (`@tanstack/react-query` ^5.90.17) — Server state management
- **UI**: Shadcn UI, MagicUI, React Bits, and Vercel AI SDK elements (generated from registries — see Code Style)

## Commands

| Command          | Purpose                                       |
| ---------------- | --------------------------------------------- |
| `pnpm dev`       | Start the development server with Webpack     |
| `pnpm build`     | Production build                              |
| `pnpm check`     | Lint + type check (run before committing)     |
| `pnpm lint`      | ESLint only                                   |
| `pnpm lint:fix`  | ESLint with auto-fix                          |
| `pnpm format`    | Prettier check (`pnpm format:write` to apply) |
| `pnpm test`      | Run unit tests with Rstest                    |
| `pnpm test:e2e`  | Run E2E tests with Playwright (Chromium)      |
| `pnpm typecheck` | TypeScript type check (`tsc --noEmit`)        |
| `pnpm start`     | Start production server                       |

Unit tests live under `tests/unit/` and mirror the `src/` layout (e.g., `tests/unit/core/api/stream-mode.test.ts` tests `src/core/api/stream-mode.ts`). Powered by Rstest; import source modules via the `@/` path alias.

Webpack is the default development bundler. Use `DEER_FLOW_DEV_BUNDLER=turbo` with `pnpm dev` to opt in to Turbopack when diagnosing a local Next.js bundler issue.

Rstest runs them as two projects (`rstest.config.ts`). `*.test.ts` / `*.test.tsx` run in a plain **node** environment — that is nearly the whole suite, and it is the default for anything that is pure logic. `*.dom.test.ts` / `*.dom.test.tsx` run in **happy-dom**, for tests that need a document: hooks driven through `renderHook` from `@testing-library/react`, and components. Keep the split — a DOM environment costs roughly 3x the runtime of the node suite, so tests that do not render should not opt into it. A hook whose behavior only exists under real React (effect ordering, cleanup on unmount, re-render on store change) belongs in a `.dom.test.*` file rather than a node test that mocks `react` itself.

E2E tests live under `tests/e2e/` and use Playwright with Chromium. They mock all backend APIs via `page.route()` network interception and test real page interactions (navigation, chat input, streaming responses). Config: `playwright.config.ts`.

The separately configured `playwright.matrix-law-project-artifacts.config.ts` uses
the isolated Docker stack at `127.0.0.1:2035` (or explicit `E2E_P1_URL` at the
allowlisted pre-promotion `2036` candidate) with real cookie/CSRF authentication,
PostgreSQL, MinIO and ClamAV. Its test seeds synthetic thread/file fixtures only;
browser requests are not intercepted. Never point it at the main 2030 environment
or persist auth traces. Run it through `scripts/pnpm.py` like other host consumers.
The legal project tree owns only the mapping UI: an owned idle conversation is
detached with its current mapping version before the native DeerFlow thread delete;
another creator's conversation is detached only, and an owned busy thread cannot be
deleted. Keep the two-step partial-failure message explicit, preserve saved project
artifact versions, and return an active deleted thread route to its legal project.
Backend matter permissions and optimistic concurrency remain authoritative.
The graph-specific real-backend spec only allows 2035. It verifies native file edits,
immutable graph versions, real SHA conflicts, unknown citation rejection, member
revocation and database audit decisions with synthetic users; it never invokes a model.
Its graph-source acceptance uploads a synthetic PDF through real scanning/storage,
then seeds only normalized OCR output with the isolated-stack-guarded
`docker/matrix-law-project-artifacts/seed_graph_ocr.py`. Citation APIs, rerun lineage,
archive state and browser reauthorization are real; this does not test OCR accuracy.
Run the existing note spec explicitly when verifying a pre-promotion 2036 candidate.
The real template-picker spec also creates synthetic custom-template history through
the deployed API and selects an explicit older version in the same native dialog.
It verifies metadata-only reads and staged attachments without uploads/runs; it does
not prove the subsequent model/tool delivery chain. Reopen the native artifacts panel
after staging on desktop as well as mobile; staging deliberately closes that panel.
The real template-management spec exercises blank creation, local Markdown import,
rename/archive/restore and explicit historical sharing through deployed UI/API, on desktop
and mobile. It checks bytes/history and cross-tenant denial without model runs or mocks.
Do not run scanner-outage HTTP tests concurrently with these browser tests.

`playwright.matrix-law-legacy-live.config.ts` is separate opt-in real-model acceptance,
never included in ordinary synthetic regression. Launch it only through the sibling
Matrix Law `scripts/verify_live_legal_graph.py --execute-model --with-legacy-ui` orchestrator:
it verifies isolated-stack identity, temporarily supplies the existing model profile,
and restores the non-callable placeholder in finally. The browser uses actual native
conversion/composer/Send/uploads/run/artifact/save controls with synthetic users/materials,
checks preserved original bytes, graph semantics and unmapped sources, and cancels its
unfinished run on failure. Do not enable traces, persist cookies, or run against 2030.

`playwright.matrix-law-template-live.config.ts` is another isolated opt-in acceptance,
started only by `--execute-model --with-template-ui` in that same guarded orchestrator.
It uses the actual template picker and ordinary Send without rewriting the prepared prompt,
then checks exact blank-template bytes, native delivery receipts, right-panel preview and
scanned project saving. Scope filename clicks to the native files tabpanel, not the chat's
same-name changed-file summary. It cancels unfinished runs on failure; never enable traces.

`playwright.matrix-law-custom-template-live.config.ts` requires the sibling opt-in
`--execute-model --with-custom-template-ui` orchestrator and exact candidate image checks.
It imports a synthetic legacy Markdown file through the actual UI, then chooses an older
private version through the real picker/ordinary Send and verifies
native delivery and BOM/CRLF bytes, then uses the native editor and explicit template
append/new-copy/project-save dialogs. Exiting editing preserves source mode: select
the native preview control before asserting Markdown headings. Do not mock APIs,
rewrite the staged prompt, preserve auth traces, or point it at the main environment.

## Architecture

Authorities import behavior and the isolated 2035 acceptance history are described in
[the candidate history](../docs/matrix-law-authorities-candidate-history.md). Preserve its
byte-identical transfer, scope reauthorization and no-model-evidence boundaries.

Session 52 extends authority v1 with legacy_reference sources and reference_only/null-body
entries; require matching legacy provenance and do not loosen ordinary text validation.
Optional old articleId/text/source preserve absent/null/empty/blank differences. Render source
records as inert text, not links or authorized citations; manual summary edits preserve originals.
`core/law/legal-authorities-import.ts` is pure byte conversion only, not an import UI or upload
path. Keep complete BOM/CRLF source text and digests in its report, stable index-based mappings,
duplicates and all original fields. Reject invalid/oversized input/output as a whole; no catalog
lookup, guessed body/date, silent deduplication, model, network or storage. Input is at most
2 MiB/500 records, output must pass the existing complete-file parser/limit. Paired frontend and
extension deployment is mandatory for the new types; no runtime deployment is implied.

`law/LegalAuthoritiesPreview` handles complete formal `.law-authorities.json` files in
the native file detail and saved JSON history, never transient write_file text or truncated
Range previews. Keep Markdown/HTML rendering unchanged. The strict async parser validates
duplicate keys, integer tokens, code-point/byte limits, date precision and source SHA; hide
previous content while parsing and ignore late completion. Invalid content stays available
through native source view, not silent repair. Web source URLs must be browser-valid HTTP(S),
with no credentials/whitespace/backslashes; open only on an explicit click with no referrer.
Source claims, hash matches and saved versions are not official verification or legal approval.
Explicitly expanded project citations use the existing no-store protected API and verify all
returned identity fields. Close/unmount/scope changes abort and discard quotes; repeated reads
reauthorize, but no live revocation of already displayed text is promised. Keep sources/drafts
in memory, not a second cache/editor/store. Editing uses the native CodeEditor/SHA/file Save;
project promotion rereads complete bytes and validates legal_research plus both suffixes.
Saved history is read-only. Native Edit also enables `LegalAuthoritiesEditor` forms for
manual/source collection, entry/question edits and removal/restoration. Apply only validated
immutable transactions to the existing in-memory draft; keep source bytes/IDs/provenance,
reset confirmation on input changes, and require a new basis when dates change. Pin the
document/target and discard late validation after close, scope or editability changes.
Removal preserves entries with a reason; restoration clears that reason in the current draft.
Only saved project versions retain earlier removal reasons, not unsaved intermediate actions.
Use a separate scrolling div around fieldset, with fixed header/footer; fieldset itself does
not reliably constrain scrolling in browsers. Keep generated Dialog primitives unchanged.
Cross-version entry continuity and complete model-driven legacy import remain pending.
Authorities controls are deployed on isolated 2035. The editing E2E covers keyboard
submission and saved removal/restoration history, including narrow and short viewports.
`law-legal-authorities.spec.ts` covers four widths plus invalid/ranged files. The older history
spec asserts production fetch counts; run the joint acceptance against a production build,
not React development StrictMode, without weakening request-count assertions.

`law/CustomTemplateManager` is reached from the custom picker within the same dialog.
List metadata with explicit `include_archived=true`, filter locally with visible pagination,
and pin the selected catalog revision. Rename/archive/restore use metadata-only PATCH and
require explicit confirmation, fresh thread/project/tenant-writer authorization and an
unchanged content-version receipt. Never modify body/history, infer write permission from
read access, or turn a name conflict into overwrite. Archived items retain owner/shared
authorization; they must remain manageable for restore. A first attempt rejects a changed
revision. An uncertain previously sent request may retry only its original key/payload
after reauthorization, letting server idempotency resolve a possibly committed operation.
Do not silently rebase it. Close/source/thread changes cancel late callbacks, not committed
writes. Keep a compact fixed target/action summary visible beside confirmation on small
screens. Saving success means this operation was acknowledged, not that future concurrent
changes cannot occur; refresh the catalog afterward.

`law/CustomTemplateCreate` is reachable even from an empty manager catalog. It creates a
truly empty first version through the existing template POST, not a fake imported file or
model-written skeleton. Default private; shared requires current owner/admin. Pin the form
scope when naming, reset confirmation on name/visibility changes, and reauthorize the
thread/project/member before sending. The small create client forwards only explicit fields,
never an unexpected append target or content. Require a first-version receipt and protected
zero-byte readback before success; preserve same-window retry keys after uncertain writes.
Close/source/thread changes cancel late UI, not committed writes. Keep the target/scope near
confirmation. Do not persist drafts/keys or auto-upload/run/install; later content editing
uses the existing picker, native output editor and explicit template version save. These new
management controls have real-service joint acceptance on isolated 2035; this does not
cover blank-file model editing or the full organization-role matrix.

`law/CustomTemplatePublish` opens from that manager in the same dialog. Only current tenant
owner/admin can publish a readable active template's explicitly selected historical version.
List metadata first; an explicit protected read previews raw text, never HTML. Require a new
copy name and privacy confirmation; reset on changes. Reauthorize before/after source reads,
pin the catalog revision and compare version ID/bytes/SHA. Publish through the existing
`POST /templates/{id}/publish` with only name/version_number and a stable retry key, not
private-to-shared mutation, body upload, complete history or a new Agent path. Verify the
new-copy first-version receipt and protected body readback before claiming success. Lost
responses/readback failure can follow committed writes: same mounted-dialog retries reauthorize
and reuse the original key/payload, never silently rebase. Clear previews after failed
reauthorization; close/source/thread changes cancel late callbacks, not server writes. Keep
source version and organization-copy target visible beside confirmation on small screens.
No legal IDs/body/names/keys in browser storage. Source-only/mock acceptance is not deployment.

`law/CustomTemplateImport` is another source in the existing template dialog, not a
new editor or Agent route. Preview one local `.md/.markdown` as strict UTF-8 (64 KiB,
BOM/CRLF preserved); render raw text only. Diagnose placeholders without evaluation,
bound the displayed list and disclose omissions. No file/body upload before explicit
name/visibility confirmation; reset that confirmation on changes. Default private,
shared requires current tenant owner/admin. Pin file selection to the trusted thread
scope, reauthorize before create, and read the protected first version back to compare
exact text/SHA before reporting success. Reuse the existing template API, scan and
idempotency key; no overwrite/append on import. Failed readback may follow a committed
write, so retain the same retry key only within this mounted dialog, never claim
cancellation rolls back or that reopening deduplicates. Do not persist source/body,
diagnostics or keys in browser storage. Closing/source/thread changes cancel late UI
callbacks; imported bodies are edited through the existing native file workflow.

```
Frontend (Next.js) ──▶ LangGraph SDK ──▶ LangGraph Backend (lead_agent)
                                              ├── Sub-Agents
                                              └── Tools & Skills
```

The frontend is a stateful chat application. Users create **threads** (conversations), send messages, set thread-scoped `/goal` completion conditions, and receive streamed AI responses. The backend orchestrates agents that can produce **artifacts** (files/code), **todos**, and goal state updates.

### Source Layout (`src/`)

- **`app/`** — Next.js App Router. Routes include `/` (landing), `/showcase/[thread_id]` (allowlisted public read-only demos), `/workspace/chats/[thread_id]` (authenticated chat), `/workspace/agents/[agent_name]` and `/workspace/agents/new` (custom agents), `/artifacts/view` (chrome-free window that renders one markdown artifact with the panel's own renderer), `/blog/…`, the `(auth)/{login,setup,auth/callback}` flow, `/[lang]/docs/…`, and `/api/…` route handlers (e.g. `/api/memory`).
- **`components/`** — React components:
  - `ui/` — Shadcn UI primitives (auto-generated, ESLint-ignored)
  - `ai-elements/` — Vercel AI SDK elements (auto-generated, ESLint-ignored)
  - `workspace/` — Chat page components (messages, artifacts, settings)
  - `landing/` — Landing page sections
  - `docs/` — Docs / MDX rendering components
- **`core/`** — Business logic, the heart of the app. Domains include `threads/` (creation, streaming, state), `api/` (LangGraph client singleton), `agents/` (custom agents), `subagents/` (runtime worker catalog and administrator mutations), `auth/` (authentication), `artifacts/`, `channels/` (IM connections), `integrations/` (managed third-party integration status/install clients such as Lark CLI), `law/` (Matrix Law tenant/matter clients and query hooks, including protected speech task and review APIs), `i18n/` (en-US, zh-CN), `settings/`, `memory/`, `skills/`, `messages/`, `mcp/`, `models/`, `input-polish/` (pre-send draft rewrite API), `voice-input/` (browser speech-recognition helpers), `suggestions/`, `tasks/`, `todos/`, `tools/`, `workspace-changes/` (run-scoped changed-file summaries and diff fetching), `config/`, `notification/`, `blog/`, plus rendering helpers (`rehype/`, `streamdown/`) and `utils/`.
- **`hooks/`** — Shared React hooks
- **`lib/`** — Utilities (`cn()` from clsx + tailwind-merge)
- **`content/`** — MDX content (blog posts, docs) rendered by the app
- **`styles/`** — Global CSS with Tailwind v4 `@import` syntax and CSS variables for theming
- **`typings/`** — Ambient TypeScript declarations
- Root files: `env.js` (env validation), `mdx-components.ts` (MDX component map)

More specific `AGENTS.md` files under `src/` contain the frontend sections split from this file.

## Code Style

- **Imports**: Enforced ordering (builtin → external → internal → parent → sibling), alphabetized, newlines between groups. Use inline type imports: `import { type Foo }`.
- **Unused variables**: Prefix with `_`.
- **Class names**: Use `cn()` from `@/lib/utils` for conditional Tailwind classes.
- **Path alias**: `@/*` maps to `src/*`.
- **Components**: `ui/` and `ai-elements/` are generated from registries (Shadcn, MagicUI, React Bits, Vercel AI SDK) — don't manually edit these.

## Environment

Backend API URLs are optional; an nginx proxy is used by default:

```
NEXT_PUBLIC_BACKEND_BASE_URL=http://localhost:8001
NEXT_PUBLIC_LANGGRAPH_BASE_URL=http://localhost:8001/api
```

Leave these unset for the standard `make dev` / Docker flow, where nginx serves the public `/api/langgraph/*` prefix and rewrites it to Gateway's native `/api/*` routes.

To reach a dev server on anything other than localhost — a LAN address, or a proxied hostname — list the host in `DEER_FLOW_DEV_ALLOWED_ORIGINS` (comma-separated; a full URL is reduced to its host). It feeds Next's `allowedDevOrigins`, which gates `/_next/*`, fonts, and HMR. Without it those requests get a 403 and the page renders server-side but never hydrates, so nothing on it — including the login form — responds. Development only; production builds ignore it.

## Resources

- [LangGraph Documentation](https://langchain-ai.github.io/langgraph/)
- [LangChain Core Concepts](https://js.langchain.com/docs/concepts)
- [TanStack Query Documentation](https://tanstack.com/query/latest)
- [Next.js App Router](https://nextjs.org/docs/app)

## Contributing

When adding features:

1. Follow the established `src/` structure
2. Add TypeScript types and proper error handling
3. Write unit tests under `tests/unit/` (`pnpm test`) and E2E tests under `tests/e2e/` (`pnpm test:e2e`)
4. Run `pnpm check` before committing
5. Update this `AGENTS.md` when architecture, commands, or conventions change

Route asset budgets are enforced with `pnpm perf:check`. The command measures
`/login` from a normal production build, then builds in static-demo mode for the
fixture-backed workspace routes. It starts the production server on temporary local
ports, measures the unique JavaScript and CSS files referenced by representative
routes, writes the detailed result to `.next/performance-results.json`, and compares
totals with `performance-budgets.json`. Fix route ownership or split points when a
budget fails; do not raise a ceiling without documenting and reviewing the measured
regression.

### Matrix Law workspace UI v1 (2026-10-15)

The paired Matrix Law repository's `docs/design/lawyer-workbench-ui-standard-v1.md`
owns the approved layout and slate-blue palette. `styles/law-workspace.css` scopes
shared tokens to the authenticated workbench and its portalled settings/menus.
The permanent activity rail is48px; the adjacent matter tree defaults to216px
and collapses off-canvas independently. Existing numeric tree-width preferences
remain valid. Keep toggle/settings/account controls in the rail and a close
control inside the mobile drawer. Separator coordinates include the rail offset. Keep generated `ui/` primitives unchanged.

The rail groups home/case-tree/search separately from capabilities/administration.
Its folder button only opens the existing case tree; it must not navigate away or
create a conversation. The brand link remains the legal home entry, with an adjacent
workspace dropdown for existing routes/settings. Both management entries use the
existing membership-role visibility rule; backend authorization remains authoritative.

The tree's primary New conversation action uses the existing create-and-bind mutation,
never a generic unbound chat. Without a selected matter, ask for an authorized project.
Key the mutation control by tenant/matter; guard duplicate clicks and discard late UI
navigation after unmount. Header and rail search share a consumed focus request so
reopening a mobile drawer does not replay an old search. The header bell links to
the current matter's existing schedule, without invented unread counts. Show five
bound conversations initially, retaining the active one, with explicit expansion.
Only actual thread metadata can show a running indicator.

Worklet PCM messages carry an additional numeric `endFrame` for W11 performance
acceptance, identifying the exclusive last sampled render frame; delayed flushes
must retain that sampled frame. It is not part of uploaded PCM or a new capture
protocol. The test-only `tests/helpers/speech-preview-timing-probe.ts` observes
time labels and numeric frame metadata without audio/text/network logging. Never
import it into application bundles or treat its local oscillator test as target
ASR/T44 evidence. See the helper README for clock and incomplete-run limits.

`law/SpeechCapturePreview` keeps a bounded scrolling preview and follows new
windows until the reader scrolls upward; explicit “回到最新” resumes following.
Capture changes reset that preference. Never reveal an inert/closed workspace.
The recognized-duration counter sums only revision-merged windows with computed
results (including computed silence), excluding gaps and null results. The
test-only time marker belongs only to computed results; the timing probe requires
full viewport and ancestor-overflow visibility before recording a window.

`law/LegalWorkspaceTabs` and `core/law/workspace-tabs.ts` own functional view state.
The four default functions are proofreading, speech, graph and drafting; memory,
deadlines, authorities and overview open from the add menu. Resource selection is
inside its function, not another top-level tab system. A closed function retains
its mounted work; explicitly closing a dirty resource still asks about saved state.
Scope changes remain the remount/authorization boundary. Do not persist legal tab
IDs, drafts or source bytes as layout preferences.

`ChatBox` retains the mounted legal workspace when another right-panel kind opens.
Its capture-return control remains outside the hidden/inert panel. Speech reports
only capture activity and a stop/cancel action to the shell; it does not move audio
or transcript data into global events. Starting captures must cancel their pending
start from this control. The split speech view retains task-specific drafts in
bounded component memory and keeps protected media, mutations and review/version
guards in the existing speech client/controller.

`WorkspaceAppearance` is the single sunrise/sunset scheduler. Only mode and a
predefined city ID may be stored; it requests no geolocation or service access.
`tests/fixtures/workspace-ui-server.mjs` is a loopback-only read fixture for visual
QA; it has no real authentication, database, model or microphone and refuses writes.
Do not use that fixture as backend, browser-capture or production evidence.

### Route-owned stylesheet and interaction bundles

`styles/theme.css` is the shared token/reset/component-rule source. Root layout
contains providers and redirects, but does not ship all Tailwind utilities to
all routes. Auth, platform admin and workspace layouts import `auth.css`,
`admin.css` and `workbench.css`; other HTML layouts explicitly import the
compatibility `globals.css`. Every rendered page must have an owning layout.
`workbench.css` lists the AI elements reachable from application imports; update
its source list when adding one. `style-ownership.test.ts` checks page coverage,
transitive AI imports and compiled renderer utilities. Do not edit generated UI
primitives to change ownership. The protected Markdown pipeline strips arbitrary
authored utility classes, so workspace uses actual renderer sources rather than
the old broad page safelist; generic standalone routes retain that compatibility
safelist. Keep sanitizer, formula, table and code tests passing.

Keep `import type` for shell-only auth schema types: with verbatim module syntax,
inline type-only specifiers can retain an empty side-effect import and eagerly
load the validator. Login/recovery still use the same schema before applying an
identity. Public optional string settings are inlined directly by Next; full env
validation remains in `env.js` and Next configuration. Never infer authorization
from these URL/build helpers. Only a requested command menu/editor/matter panel
loads its heavy UI. Preserve keyboard listeners, closable loading states, drafts,
expected-version checks and active capture mounts.

Unauthenticated workspace requests do not render protected children. Only
`WorkspaceLoginRedirect` preserves the existing pathname, search and hash in the
browser as the login `next` value. Existing login verification, role routing and
backend ACL behavior remain unchanged.

If reading a saved version's content or source receipt fails, the user may retry
in place; existing authorization and content validation still apply, and review
gating is not bypassed.

`perf:check` retains all numeric ceilings. The disabled generic docs/blog entries
have explicit HTTP307 contracts in `performance-budgets.json`; they must still
redirect to `/workspace/law`. A returned page or another destination fails that
contract. These are redirect checks, never zero-byte page measurements.
