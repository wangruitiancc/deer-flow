### Data Flow

Before changing composer helpers, chat dispatch, streaming or message interpretation, read [the detailed flow guide](chat-flow-guidance.md).

The Matrix Law workspace at `/workspace/law` uses `core/law` for authenticated tenant, matter, member, and thread-mapping requests. Creating a matter conversation is deliberately ordered: create an owned empty DeerFlow thread first, bind it through the Matrix Law API with an idempotency key, and only then navigate to the chat. If binding fails, the client best-effort removes only that newly created empty thread. Tenant and matter IDs in page state are navigation selections, never trusted authorization context; the extension rechecks ownership and membership before each run.

`core/law/legal-graph.ts` validates the versioned legal graph payload for native
artifact rendering (`.law-graph.json`, plus saved `knowledge_graph` versions). The lazily
loaded `law/LegalGraphViewer` provides d3-force relationships, precision-preserving timeline,
keyboard lists and protected citation reads. Partial/range previews never enter its parser.
Its shared acceptance fixture lives in the packaged Matrix Law extension
at `matrix_law_extension/contracts/legal_graph_v1.examples.json`. Citation IDs are not proof
of factual correctness or current access; source opens must reauthorize through the existing
legal APIs. Never execute legacy reference strings or treat EXTRACTED as human approval.
`legal-graph-editing.ts` owns validated local graph transactions. The native artifact Edit
action enables node/edge/title forms and non-event drag pinning; the same provider-memory
draft, explicit file Save, SHA conflict guard and project-version promotion remain authoritative.
Do not write on pointer moves or fork a graph save endpoint. Forms reject stale graph baselines,
manual date changes become `origin: user`, and node deletion confirms its cascading edge count.
History passes no edit callback and remains immutable. DOMPoint coordinates are prototype
accessors: copy x/y explicitly into gestures, never spread DOMPoint. Cancelled drags restore
the prior layout. G3 file/version storage, conflicts and membership revocation are covered
by the isolated 2035 real-backend spec. Graph sources show separate archive/hold/purge
and OCR-lineage states, retain authorized immutable quotes, and clear old text before
each reauthorization. The source spec seeds labeled synthetic OCR output, not an OCR
engine; full legal-quality acceptance remains pending.
`LegalGraphSourceMapping` uses existing material/version/citation reads and explicit confirmation,
then only applies `map-source` to the native draft. Re-read the citation before applying; clear
old text/confirmation on changes, abort on close and reject stale graph/scope baselines.
Preserve original source ID and bounded `legacy_origin`; it is unverified client-asserted
provenance, not quote authority or proof of human review. Keep historical versions read-only.
The optional v1 field requires a paired frontend/extension rollout; never silently strip it.
`legal-graph-import.ts` converts persisted desktop CaseGraph data, never LLM extraction
responses. `LegacyGraphImportPreview` previews/downloads local conversions and SHA/ID
reports. `LegalGraphImportHandoff` can explicitly stage the same two Files and static legal
instructions through the existing PromptInputProvider; it never submits, uploads or saves.
Recheck current thread scope and native upload limits, preserve any existing input/attachment,
and reject late responses after close/unmount. Only normal Send owns upload and run creation.
Keep sources unmapped, dates unverified, async reads generation-fenced and object URLs revoked.
Never execute legacy paths or infer project authority from caseId. Original filenames/IDs/content
belong only in the in-memory attachment, not the persisted composer instructions. Default chat
layout keys ChatProviders by thread ID so client-side navigation cannot carry unsent files to
another thread; attachments are deliberately not restored after leaving or refreshing.
All three right panels use the existing Sheet below 1024px; desktop mounts
capture their initial size once so overlay-to-desktop restoration cannot reset drag widths.

`WorkspaceSidebar` renders the Matrix Law project tree. Its user-facing “project”
node is the existing `law_matter`, not a parallel project entity: each node can be a
case or another legal-work kind and lazily loads only its bound threads when expanded.
Opening a thread resolves the trusted thread context, selects its tenant, and expands
its matter. The sidebar may use tenant/matter IDs for navigation state only; it must
not persist legal IDs or legal data in browser storage, and the backend remains the
authorization authority.

The native `ArtifactFileDetail` toolbar hosts `law/SaveProjectArtifact`, keyed by thread and path so
switching files cannot carry over a draft save target. It uses the trusted thread context, displays the
target project's name, and promotes complete authenticated file bytes through the legal extension API.
Never save range previews or unsaved editor drafts. Active runs and source revision conflicts block promotion.
Retries within the dialog retain the same key for the same source digest, target version and metadata.
Abort reads on unmount; a lost upload response is uncertain, not proof of cancellation. Source provenance is
client-asserted and newly saved versions are unreviewed; do not present saving as legal approval.

`law/SaveCustomTemplate` reuses the native file toolbar/editor. Save only complete persisted Markdown:
strict UTF-8, preserve BOM, verify SHA, bound the stream to 64 KiB; empty templates are allowed.
Reauthorize before/after reading. Pin expected_version across query refresh; changed revisions require
reselection. Identical retries retain their key. Cancel late UI writes without claiming server rollback.
Default private; shared writes require owner/admin. Saving is not Skill installation or legal approval.
0016 is deployed only on isolated 2035; 2030 remains 0015. Use deterministic legal-tree Skeleton widths
for SSR; never edit generated ui/sidebar components.

`law/ProjectArtifactsPanel` wraps only native artifacts, not sidecar/browser panels. Disable for mock/static
threads; real threads can open it without temporary files. Its project tab shows immutable versions through
protected reads, byte-count/SHA verification and native Markdown preview without relative artifact links.
Never persist content/selected versions in browser storage. Unmount aborts reads/downloads and revokes URLs.
Downloads refetch with current authorization, never cached bytes. Reauthorize source-thread navigation;
an unavailable source does not delete its saved snapshot.
Lawyer review receipts are append-only and bind the exact selected version SHA. Show review controls only
for trusted matter roles owner/lead/lawyer; fetch review notes only for those roles. Reuse the idempotency key
for an unchanged retry, and keep every newer artifact version unreviewed until it receives its own review.
Offer DOCX/PDF receipt bundles only for an active, approved version and supported source type. Re-fetch the
selected version through the protected export API; never build the final deliverable from preview text or a
locally edited draft. Display server-resolved case citations separately from client-asserted external sources.

`law/LegalTemplatePicker` stages text through the existing PromptInputProvider; it must never submit.
Read the authenticated deployment catalog, then recheck it plus current
thread mapping, project status and generation role on confirmation. Never overwrite text or attachments;
abort late writes on close/thread change. Persisted composer text must not embed tenant/matter IDs or
private project context. Request the registered deterministic tool directly: the legal product hides the
general Skill management routes, so neither listSkills nor slash activation is an entry prerequisite.
Template output still uses native files, presentation and explicit project saving.

`law/CustomTemplatePicker` shares that dialog: paginated metadata only, explicit historical version,
pinned catalog revision, confirmation-time reauthorization, no draft/attachment replacement.
IDs/revisions belong only in the temporary native selection File, never persisted composer text;
names/body stay out of its fixed prompt. Normal Send owns upload/run creation; tools reauthorize.
Cancel late writes on close/source/thread change; reuse native upload limits. No auto-run or Skill install.
Draft values stay in the File, without guessed dates. Fixed header/footer, scrolling body.
`CustomTemplateImport` uses the same dialog; import/privacy rules are in `frontend/AGENTS.md`.

The evidence workbench keeps evidence, immutable versions, OCR runs, pages, blocks,
and citations in TanStack Query server state. Uploads compute a browser SHA-256 for
transport integrity, but only the server's size/digest/scan checks are authoritative.
Protected evidence is fetched through the authenticated content endpoint into a
short-lived object URL; close or version change aborts the request and revokes the
URL. Citation create requests carry only server-resolvable block anchors and
offsets—never client-authored quote text—and the viewer uses the citation's frozen
physical page plus OCR result while clearly labeling superseded results.
Published-proofreading citations follow the same rule: select text
only from a fetched immutable publication page, convert DOM UTF-16 selection offsets
to Unicode code-point offsets, send publication/page/range without quote text, and
render publication current/superseded state separately from OCR lineage. They share
the existing citation list/read and graph-source mapping paths; do not create a second
graph source kind or trust draft text as published evidence. Do not persist tenant,
matter, evidence, OCR, citation, document bytes, or object URLs in browser storage.
Inner evidence/OCR columns intentionally wait until the `2xl`
breakpoint because `/workspace/law` already owns a desktop matter/detail split.

The chat header's context-window control is intentionally persistent: while `context_usage` is unavailable, `ContextUsageBadge` renders a gauge placeholder rather than unmounting; once data arrives, the same position shows the percentage. `useThreadTokenUsage` retains placeholder data only when the response `thread_id` still matches the active route, so same-thread refetches do not flicker and cross-thread navigation never displays the previous chat's usage.

Settings skill uploads reject archives larger than 100 MiB before starting the
request and disable the hidden file input while an install is pending. The API
client preserves structured SkillScan findings on `SkillRequestError`, and the
settings page renders a compact file/rule/line summary so security rejections
remain actionable; a proxy-generated 413 is mapped to the localized size error.

Run duration is run-scoped UI metadata even though the compatibility field `additional_kwargs.turn_duration` is repeated on historical AI messages. `core/messages/run-duration.ts` folds those copies into one display anchored after the run's last visible message group. `MessageList` owns the temporary client-side duration for a just-completed live turn until authoritative history arrives. The duration is total run wall-clock time, not per-message reasoning time; reasoning disclosure and run activity/duration are rendered separately.

The workspace-change card follows the same rule: it is resolved from `(threadId, runId)` alone, so every AI message of a run would render an identical copy. A run ends in more than one terminal assistant bubble whenever the model emits answer text that never gains a tool call, so `core/messages/workspace-change-anchor.ts` picks the run's last assistant bubble and `MessageListItem` renders the badge only for that anchor (#4555). Any future run-scoped display belongs in the same place — do not hang one off every message. The two anchor helpers deliberately differ in which group types they accept as a run's last position, because an anchor is only useful where the display is actually rendered: run duration is emitted by `MessageList` around every group, so it accepts any type, while the workspace-change card comes from `MessageListItem` and so restricts to `assistant`. Keep a new helper's candidate set matched to its own render site rather than unifying them.

Composer drafts are tab-scoped browser state. `core/threads/composer-draft.ts` stores only text plus the selected slash-skill name in `sessionStorage`, keyed by user, agent, and logical conversation scope. New-chat pages pass the stable scope `"new"` because their runtime `threadId` is a fresh UUID on every reload; established conversations use their real thread ID. `InputBox` waits for enabled skills before restoring a skill chip, degrades a missing/disabled skill back to editable slash text, and clears the stored draft through `SendMessageOptions.onSent` only after the send passes the in-flight guard. Attachments, sidecar quotes, voice state, and polish undo state are not persisted.

Auth UI note: the login page's "keep me signed in" option submits only `remember_me` to the Gateway and may persist only the email address through `core/auth/remember-login.ts`. Passwords and tokens must never be stored in frontend storage; the `HttpOnly access_token` and readable `csrf_token` cookies remain Gateway-owned. Password recovery checks the Gateway's public `password-reset/status`; its reset page reads the signed token from the URL fragment, immediately removes the fragment from browser history, and submits it only in the JSON body through `core/auth/password-reset.ts`. Never put reset tokens in query strings, navigation destinations, analytics, or browser storage. Local administrator MFA uses only the short-lived HttpOnly challenge cookie; the login page may hold one-time TOTP setup material in component memory long enough for the administrator to save it, but must never persist it in browser storage, analytics, URLs, or logs. See `backend/docs/ADMIN_MFA.md` for coverage and recovery limits.

`/goal` and `/compact` are built-in composer commands, not skill activations. `src/components/workspace/input-box.tsx` intercepts `/goal`, `/goal clear`, and `/goal <condition>` before normal chat submission, calling Gateway `GET/PUT/DELETE /api/threads/{thread_id}/goal`. Setting `/goal <condition>` also submits the condition text as the next user task so the agent starts running immediately; status and clear do not start a run. Goal and compact requests are tied to the current `threadId` with an `AbortController`, so switching threads or unmounting the composer aborts in-flight requests and stale responses cannot update the new thread's composer state. The chat pages render `GoalStatus` above the composer from `AgentThreadState.goal`, with local optimistic state until an incremental goal update or final state reload arrives. `/compact` calls `POST /api/threads/{thread_id}/compact` to summarize older active context while leaving the full visible chat history intact; it is skipped on new/empty threads and blocked server-side while a run is in flight. Thread rename uses the same serialized state-write route; the rename dialog stays open and surfaces the server error when an active run returns 409.

The `/` skill list stays reachable after a skill is selected: typing `/` in the editable text beside the chip reopens it, and picking an entry swaps the chip rather than adding a second one, because the wire format carries exactly one leading `/skill`. That list offers skills only while a chip is selected — a builtin command owns the whole composer line, so `/goal` behind a selected skill would submit as chat text instead of running the command. The trigger itself is unchanged: a slash only opens the list at the start of the input (`getLeadingSlashSkillQuery`), pinned by `tests/e2e/chat.spec.ts`.

Human input requests are a structured message protocol layered on normal chat history. The backend writes request payloads to `ToolMessage.artifact.human_input`, `src/core/messages/human-input.ts` owns the runtime validators/types, and `src/components/workspace/messages/human-input-card.tsx` renders the reusable card. The protocol is versioned on the request side only: v1 covers `free_text` / `choice_with_other`, and v2 adds `form` (typed fields — text/textarea/number/select/multi_select/checkbox/date — with required-field validation in the card). Replies deliberately stay on the v1 response protocol: the form card submits a `response_kind: "text"` reply whose value is the human-readable summary plus one JSON block keyed by stable field names (`buildHumanInputFormSubmissionValue` — the readable part alone is ambiguous because labels/values may contain the separators), so the model can reconstruct the submitted mapping without a structured response kind. The validators reject unknown versions/modes (and field names colliding with JS `Object.prototype` members) so future protocol bumps degrade to the plain-text ToolMessage fallback rather than rendering a broken card. Form values are read through own-property access only (`readHumanInputFormValue`); select fields stay controlled from their empty-string placeholder state through selection; checkbox fields are native `<input type="checkbox">` controls seeded to an explicit `false` (`buildInitialHumanInputFormValues`) so an untouched checkbox submits as "no" while a `required` checkbox keeps must-agree semantics (no HTML `required` attribute — native constraint validation would intercept the custom submit path), and form controls carry label/`htmlFor`, `aria-required` plus a visually-hidden localized "required" marker, and `aria-invalid`/error associations whose error node stays mounted while any field is still invalid. Composer-bypass closure: `deriveHumanInputThreadState` treats a visible plain human message as answering the latest unanswered request opened before it (only the latest — nothing guarantees a single outstanding request across runs, and closing all would silently swallow older decisions; an older request left open simply becomes the active card again). This lets current users bypass a structured form through the normal composer and preserves compatibility with old v1-only frontends that degrade a v2 request to plain text. `MessageList` owns answered/latest/pending state for visible cards, but derives answered responses from raw `thread.messages` because replies are hidden; pending cards clear when the hidden reply appears, when dispatch is dropped, or when a new `thread.error` reports an async stream failure. Page-level card submit callbacks must send a normal human message and put `hide_from_ui: true` plus the response payload in the fourth `sendMessage(..., options)` argument as `options.additionalKwargs`; the third argument remains run context such as `{ agent_name }`. Composer entry points remain enabled while a human-input request is open; a normal visible message intentionally bypasses the card and starts the next run without structured response metadata.

Tool-calling AI messages can contain user-visible text as well as `tool_calls`. `core/messages/utils.ts` keeps these turns in an `assistant:processing` group, and `components/workspace/messages/message-group.tsx` must render the visible text as a processing step instead of treating the message as only tool metadata. This preserves provider text such as error explanations or "trying another approach" notes during tool-heavy runs.
While the current turn is still loading, a content-only AI message after the latest visible human input also stays in that processing group until the turn settles: a provider may append tool-call chunks to the same message later, and classifying it as a final assistant bubble too early makes the text jump into the steps panel. `MessageGroup` therefore renders processing text even before the first tool call arrives.
The same rule applies after an earlier tool call: a later content-only AI message remains visible after the current last tool-call step while streaming, because that message may itself gain another tool call before the turn settles.
Because the same message is rendered by two different components over its lifetime, reasoning must sit above the answer text in both. `MessageListItem` paints the settled bubble's `<Reasoning>` disclosure above its content, so `MessageGroup` puts the trailing reasoning disclosure above the assistant text that follows it and `convertToSteps` emits a message's reasoning step before its content step — otherwise the two swap places the instant the turn settles (#4576). Assistant text emitted _before_ that reasoning keeps its earlier position; only the answer the reasoning produced moves below it.

Edit-and-rerun is deliberately latest-turn-only. `core/messages/utils.ts::getLatestEditableTurn()` exposes a human turn only when the transcript is idle and the most recent visible turn ends in a terminal assistant message. `core/threads/hooks.ts::editAndRegenerateMessage()` calls `POST /api/threads/{id}/runs/edit-regenerate/prepare`, submits the returned replacement message/checkpoint/metadata through the same LangGraph stream path as regenerate, optimistically hides the superseded message ids, and clears the optimistic replacement once the persisted replacement arrives.

`MessageGroup` builds its tool-result and browser-preview lookups once per processing group before converting messages to steps. The lookup preserves the first non-empty result and first screenshot-bearing browser view for each tool-call ID, matching the streamed-message display semantics without repeatedly scanning the full group for every tool call.
`getMessageGroups` indexes visible tool invocations as groups form. Late persisted
results return to their matching invocation group, including across newer human
turns; known unequal run IDs do not match. Do not append a matched tool result to
the terminal answer or change authoritative history seq to hide late arrival.

### Key Patterns

- **Server Components by default**, `"use client"` only for interactive components
- **Static root boundary** — `src/app/layout.tsx` must not read cookies or import
  chat-only KaTeX/Streamdown styles. Auth and workspace layouts own the cookie-derived
  locale provider; docs derive locale from their route, and blog owns its preference
  cookie. Public server routes load one dictionary at a time through
  `core/i18n/translations.ts`; the interactive auth/workspace client provider owns both
  formatter-bearing dictionaries because functions cannot cross the RSC boundary.
  Keep public `/` static and keep rich-content CSS on the routes that render it.
- **Thread hooks** (`useThreadStream`, `useSubmitThread`, `useThreads`) are the primary API interface
- **Thread routes** — construct Web UI chat paths through `core/threads/utils.ts::pathOfThread()`, which percent-encodes both custom agent names and thread IDs before inserting them into route segments
- **LangGraph client** is a singleton obtained via `getAPIClient()` in `core/api/`
- **Run stream options** are sanitized by `core/api/stream-mode.ts`: the Gateway-supported set is `values`, `messages-tuple`, `updates`, `debug`, `tasks`, `checkpoints`, and `custom`; any request containing an unsupported mode throws before HTTP instead of being partially forwarded or silently defaulting to `values`. `streamResumable` is retained by thread hooks only for SDK-side reconnect bookkeeping but stripped before the HTTP request because the Gateway does not accept that request option; actual replay uses the SSE `Last-Event-ID` cursor. The main chat client's initial and rejoined streams are forced to incremental `messages-tuple`, `updates`, and `custom` modes so SDK lazy tracking cannot add repeated full-state `values` snapshots; explicitly requested non-snapshot modes such as `debug`, `tasks`, and `checkpoints` are preserved. `values` remains supported outside this chat wrapper for explicit state inspection and by the replay-gap durable-state reload below. The backend file-tool chunk batcher is keyed to `messages-tuple`, not `values`, so omitting snapshots must not regress `write_file` / `str_replace` streaming into one SSE frame per model token. `core/threads/stream-state.ts` folds the user-visible non-message fields from `updates` with the matching DeerFlow reducer semantics and rejects irrelevant frames before calling the SDK mutator, while the SDK's `messages-tuple` manager remains the sole owner of live message chunk assembly and deduplication. Keep this boundary aligned with the backend request schema; `messages` and `events` are not supported and must not be forwarded.
- **SSE replay gaps and server-interruption recovery** are handled in `core/api/api-client.ts`, which wraps both initial and joined run streams because the upstream SDK ignores unknown event names. An id-less backend `gap` control frame clears stale reconnect metadata, emits an internal `stream_replay_gap` custom event, reloads durable thread values, and resumes after the server-provided retained tail when one exists (or rejoins without a cursor if the buffer is empty), with up to five recovery rejoins after the original stream (six total stream calls on an all-gap exhaustion path). The wrapper remains a lazy async iterable because the SDK consumes it with `for await`. Lease recovery uses `error/orphan_recovered`; graceful process shutdown uses `interrupted/gateway_shutdown`. Both streams carry `run_recovery_required`, and a reload preflight of either durable pair synthesizes the same custom payload before short-circuiting the drained join. An ordinary user-cancelled `interrupted` run still short-circuits silently. `core/threads/hooks.ts` clears optimistic/pending/subtask state, invalidates durable caches, and shows a localized request-to-resend warning. It never automatically replays an Agent turn because already-committed tool side effects may not be idempotent. Never let a replay gap fall through as a normal stream finish or cancel the still-running backend run, and never describe server recovery as continuation of the crashed computation.
- **Streaming Markdown rendering** is owned by `core/streamdown`: Streamdown's `animated` / `isAnimating` API handles incremental word animation, while the shared `streamdownRenderingPlugins` config registers the named code-highlighting and Mermaid plugins required by Streamdown 2.5. Keep wrappers and derived configs wired to that shared object; do not reintroduce a rehype plugin that wraps every word, because reparsing a growing block remounts old words and replays their animation.
- Citation links in message and artifact Markdown must derive their `citation:` label from the full `ReactNode` children tree, since Streamdown may provide element or array children during streaming rather than a plain string.
- **Environment validation** uses `@t3-oss/env-nextjs` with Zod schemas (`src/env.js`). Skip with `SKIP_ENV_VALIDATION=1`
- **Subtask step history and runtime metadata** (`core/tasks/`) — the subtask card shows a subagent's full step timeline (#3779): its assistant reasoning turns interleaved with the tools it ran. The task tool's model-visible `description` is an optional progress label; `MessageList` uses the required `prompt` (then the localized generic subtask label) when a provider omits it, so a valid task call never renders a blank card title. `Subtask.steps[]` is accumulated live from `task_running` events (appended via `mergeSteps`, not overwritten) and backfilled on expand for historical runs by `fetchSubtaskSteps`, which pages the events endpoint scoped to one task (GET `/runs/{runId}/events?event_types=subagent.step&task_id=…&after_seq=…`) until a short page, so the run-wide limit can't truncate the timeline. `task_started` carries the effective `model_name`; `task_running` carries a cumulative usage snapshot after each completed LLM call. `core/tasks/lifecycle.ts` normalizes these additive events, and `computeNextSubtask` keeps the largest cumulative total so replayed or late SSE frames cannot double-count or roll the folded card backward. Terminal ToolMessage metadata (`subagent_model_name` / `subagent_token_usage`) restores the same values from normal history after reload; no per-card event fetch is needed. `core/tasks/steps.ts` is the pure step model: `messageToStep` (live), `eventsToSteps` (reload), `mergeSteps` (dedup by `message_index`), and `stepsForDisplay` (what the card renders — keeps tool steps + AI steps with text, drops the trailing final-answer AI step when completed since it's shown as `result`). `core/tasks/context.tsx`'s `useUpdateSubtask` applies updates against a `tasksRef` mirroring the latest state (not a closure snapshot), so a late-resolving `fetchSubtaskSteps` backfill merges into current state instead of clobbering SSE steps or sibling subtasks that arrived meanwhile. The owning `run_id` is carried onto history content messages in `buildVisibleHistoryMessages` so the card can resolve the events endpoint.

### Interaction Ownership

- `src/app/workspace/chats/[thread_id]/page.tsx` owns composer busy-state wiring.
- `src/app/workspace/chats/[thread_id]/page.tsx` owns branch-from-turn submission and navigation; sidecar `MessageList` instances do not receive the branch action.
- `core/threads/thread-branch-tree.ts` projects only loaded, same-pin branch lineage into Recent chats. Missing, malformed, cross-pin, self, or cyclic parents stay top-level; unpinned groups follow their freshest descendant while pinned root order stays stable. `recent-chat-list.tsx` caps visual indentation without changing the recursive order.
- `src/app/workspace/chats/[thread_id]/page.tsx` and `src/app/workspace/agents/[agent_name]/chats/[thread_id]/page.tsx` own edit-and-rerun submission wiring because the page must preserve normal/custom-agent run context; `MessageList` only detects the latest editable user turn and renders the inline editor.
- `src/app/workspace/chats/[thread_id]/page.tsx` gates the Workspace Browser trigger and browser right panel on `/api/features -> browser_control.enabled`; `src/app/workspace/agents/[agent_name]/chats/[thread_id]/page.tsx` applies the same capability gate and additionally requires the Custom Agent's tool groups to be unrestricted or include `browser`. Default/failed feature discovery hides the browser control so optional backend installs do not show a dead Live socket.
- `src/app/workspace/chats/[thread_id]/page.tsx` and `src/app/workspace/agents/[agent_name]/chats/[thread_id]/page.tsx` own active-goal display state for their composer overlays.
- `src/components/workspace/messages/message-list.tsx` owns human-input card answered/latest/pending gating; entry pages only translate a submitted card response into `sendMessage` calls.
- `src/components/workspace/browser-view/browser-view-panel.tsx` forwards each physical pointer click as one `click` input; do not also emit `down`/`up` for the same gesture because the remote Playwright click would run twice.
- `src/components/workspace/browser-view/use-browser-stream.ts` requests binary JPEG
  frames with `frame_format=binary`; status, URL, tabs, and navigation rejection
  messages remain JSON. `LatestBrowserFrameBuffer` keeps only the newest pending
  frame, publishes through `useSyncExternalStore` at most once per animation
  frame, and owns object-URL revocation. Keep the Gateway's legacy JSON/base64
  frame path for older clients.
- `src/core/threads/hooks.ts` owns pre-submit upload state and thread submission.
- `src/components/workspace/chats/chat-box.tsx` owns the desktop right-panel layout, and **all three** right panels (artifacts, sidecar, browser) share one `ResizablePanelGroup` — do not fork a non-resizable branch per panel kind, which is how the artifacts divider silently lost its drag handle (#4465). Open/close is `collapse()` / `resize()` on the side panel's imperative handle, not conditional rendering, so the width can animate. Three constraints hold that together: the size transition is applied from the group as `[&>[data-panel]]:transition-[flex-grow]` because the sized flex item is the library's own `[data-panel]` element rather than the child `className` lands on; it is applied only while an open/close is in flight, so a drag is not interpolated frame by frame; and during the animation the panel content is held at its final width in `cqw` and clipped, because a reflowing message list re-runs its scroll-to-bottom (pinned by `tests/e2e/sidecar-chat.spec.ts`'s no-animated-scroll test) and a re-wrapping composer changes which responsive labels it shows. Because the panel is `collapsible`, the library can also collapse it to `0%` on its own when a drag crosses `minSize`, without going through the state that owns it. `onResize` records the last positive size while the pointer moves, but the owning `sidecar` / `browserView` / `artifactsOpen` state must only mirror a final `0%` layout from `onLayoutChanged`, after pointer release; closing on the first `0%` resize frame breaks a continuous drag that reaches the edge and then reverses before release.


Matrix Law right workspace (2026-10-03): `law/ProjectArtifactsPanel` owns the overview and document tabs. Keep opened file/evidence components mounted while hidden so switching tabs, expanding and returning do not recreate editors. `ChatBox` uses the same mounted desktop tree for the mobile fullscreen view; closed workspaces are inert. Native artifact drafts remain in `ArtifactsProvider`; an explicit dirty close preserves the provider draft, and evidence close asks the user to confirm save state. Scope changes remount the document workspace. Structured human upload metadata is an attachment display only, not proof the model used it or a project evidence binding. Project material opened here is labeled as opened, not used. Do not infer mappings from filenames or parsed document text.

`workspace-resize-provider.tsx` owns the left splitter, keyboard increments and a bounded width preference; the native right splitter owns the chat/document ratio. Store only numeric widths as layout preferences. Selecting an artifact no longer collapses the project sidebar. Both dividers must remain draggable, and expanded/mobile views must restore the same thread/editor DOM and keep keyboard focus within the modal workspace.

The route utility entries in `styles/` share `theme.css`. Keep all source-owned
layouts explicit when adding a page; do not restore a global all-route utility
import in root layout. Add newly imported AI elements to `workbench.css` and run
`tests/unit/scripts/style-ownership.test.ts`. Auth shell type-only schema imports
must be erased completely (`import type`); validation itself remains mandatory
when processing login/recovery responses. Heavy overview/editor/command dialogs
load on actual use without moving native state or authorization into another store.
