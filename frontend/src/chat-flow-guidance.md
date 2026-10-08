# Composer and runtime message flow

1. Optional composer helpers such as `core/input-polish` can rewrite the local draft before submission, and `core/voice-input` can transcribe browser microphone input into that same local draft; confirmed user input then flows to thread hooks (`core/threads/hooks.ts`) → LangGraph SDK streaming
2. Stream events update thread state (messages, artifacts, todos, goal). The main thread stream uses the LangGraph SDK's `throttle: true` mode so updates received in the same macrotask coalesce before React is notified; do not replace it with a numeric delay without validating the SDK's trailing-debounce behavior on a continuous stream.
   File-tool artifact auto-open work must run in an effect with timer cleanup; never schedule timers while rendering streamed `write_file` or `str_replace` updates.
   `ThreadState.artifacts` remains the authoritative artifact list. The artifacts provider persists only thread-scoped panel UI state (`open`, selected path, and a refresh bootstrap cache) in session storage; an initial empty stream value must not overwrite that restored state before history finishes loading.
   Formal artifact content is refreshed once when the run finishes; transient `write-file:` previews remain message-driven.
   The detail view exposes explicit editing only for an already-opened formal UTF-8 text artifact under `/mnt/user-data/outputs`. Drafts stay in provider memory until Save so switching right-side panels cannot discard them, render in Markdown/HTML preview, and are protected from remote refreshes by the loaded SHA-256 revision. Saving is disabled during an active run; a changed revision preserves the draft and surfaces a conflict instead of overwriting agent output.
   Regular artifact text loads request at most the first 1 MiB through an HTTP
   byte range. A truncated preview must stay lightweight and expose an explicit
   full-file action; do not mount CodeMirror for that artifact until the user
   requests and receives the complete content. The Gateway retains range
   ownership and returns 206/416 through `FileResponse`.
3. `useThreadHistory` loads persisted conversation pages from `GET /api/threads/{id}/messages/page`, preserving the backend's thread-global event `seq`; rendering overlays checkpoint/live copies at their matching canonical identities (a summarized checkpoint may contain a protected early input plus a recent tail). Context-compaction rescue diffs every retained visible identity rather than slicing at the first anchor, and keeps a run-scoped ledger of committed visible messages so replacement updates and repeated rolling checkpoint windows cannot erase an already displayed step. A checkpoint/transient prefix whose canonical position is still behind an unloaded cursor page is woven in before the first shared anchor, not discarded: both the checkpoint and seq-sorted history place it earlier, so that position is known even when the pages between are not. It must never be appended to the tail (#4065) — the tail is provably wrong — but suppressing it entirely is how a user's own question vanished from a long thread once the first 50-row history page no longer reached back to it (#4666). A collapsed unloaded gap is recoverable by paging; a dropped message is not. Weaving alone restores the message but not its exact position — after compaction the live window carries too few anchors — so both sides now carry the backend's thread-global `additional_kwargs.deerflow_seq`: `buildVisibleHistoryMessages` copies each row's `seq`, and the Gateway stamps it onto `values` frame messages it has already persisted. A live message whose seq is below the loaded window's lower bound is placed ahead of everything on screen instead of before the nearest anchor, which is what puts a compaction-rescued first user turn back at the head rather than mid-transcript. That split happens _before_ the anchor walk, not inside it: a compacted checkpoint can share no identity at all with the loaded page — it keeps only the current run's recent tail, while the page on screen was fetched turns earlier — and the anchor walk then never runs at all, which is precisely when a rescued turn most needs its seq. Doing the split inside the walk left that case appending the message after the whole window (#4666), the one arrangement #4065 proved wrong. A message without a seq (still streaming, so not in the feed yet) keeps the weaving path — the tail is already its correct position. Optimistic messages are then added without timestamp re-sorting. History invalidation preserves already-loaded pages so their established ordering positions are not discarded. Dynamic context re-keys the submitted user message from `X` to `X__user`; UI identity matching normalizes that reserved suffix only for human messages so the submitted frame and checkpoint replacement remain one visible turn. A locally submitted turn also records its pre-submit identity baseline: if `messages-tuple` publishes new AI/tool steps before canonical history (or replay-gap recovery) publishes that turn's human message, render ordering moves only those non-baseline visible steps behind the new human while leaving history, hidden controls, and reconnected runs untouched. Keep that local order anchor through finish, stop, and stream error because the SDK's settled frame can retain transient event order; replace it on the next local submit and clear it on thread switch or replay-gap recovery.
4. Stop actions call the LangGraph SDK stream stop path; `core/threads/hooks.ts` invalidates current-thread, thread-history, token-usage, and sidebar/search caches immediately and schedules one follow-up refetch because SDK stop may finish via abort + fire-and-forget cancel before backend title finalization commits
5. TanStack Query manages server state; localStorage stores user settings. The
   Settings > Tools MCP switch calls the targeted `PATCH /api/mcp/config`
   mutation, disables switches until that mutation's success refetch completes,
   displays the backend error `detail` through a toast, and invalidates
   `["mcpConfig"]` only after success.
   Server management uses targeted `POST /api/mcp/config/servers`,
   `PUT /api/mcp/config/server`, and bodyless
   `DELETE /api/mcp/config/servers/{server_name}` mutations. Delete names are
   percent-encoded, including legacy empty and slash-containing names; every
   successful mutation invalidates `["mcpConfig"]` only after the response.
   Current-chat MCP background tasks use `core/background-tasks`: the header
   trigger is hidden for new/mock/static-demo threads and unless `/api/features`
   reports the startup-scoped `mcp_tasks` capability; the list query is disabled
   while that capability is unavailable, so default-disabled and memory-backend
   deployments never poll an endpoint that cannot serve tasks. It lists at most
   20 local task records, refreshes every 3 seconds while any task is active
   (15 seconds otherwise), fetches bounded task details only while a user expands
   a card, and cancels through the thread-scoped local-ID endpoint. The expanded view
   shows result/preview, artifact metadata, input requests, and the latest poll,
   notification-delivery, or cancellation error without exposing the persisted remote handle. A
   persisted cancel request remains "Cancelling…" only while the task status is
   still active; if remote cancellation keeps failing, the active card remains
   expandable and shows the attempt count plus the latest bounded error while
   the backend continues retrying. Notification delivery failures expose their
   bounded error and attempt count; retryable failures use backend backoff,
   while a permanent rejection or exhausted five-attempt budget is shown as
   stopped rather than implying that retries will continue.
   Explicit durable native-subagent batches use `core/subagent-batches` and
   `ThreadSubagentBatches`. `/api/features` reports SQL-repository availability
   separately from the startup worker. A running worker exposes the trigger on
   both default and Custom Agent chat pages; a stopped worker keeps threads with
   durable history visible in read-only mode for inspection and JSONL export,
   while deployments with neither a worker nor history keep the trigger hidden.
   The panel renders bounded progress and incrementally paged item previews, controls pause/resume/cancel,
   retries failed items, and exports JSONL. Worker-dependent mutations stay
   disabled in read-only history mode, and persisted progress is normalized to
   a bounded percentage before reaching the UI primitive. Item pagination uses a
   fixed page size and an explicit load-more control; full results remain available
   only through JSONL export. The panel must not infer batch mode from prompt text
   or inject the complete result set into chat state.
   Settings > Integrations uses a local generation only to suppress stale React
   callbacks; server-issued Lark flow generations must be passed through every
   config/auth completion and across switch-or-register to authorization chains
   so backend cross-tab ordering remains authoritative.
   Settings > Subagents reads one catalog for built-in, config, and managed
   definitions. Only administrators see managed-definition mutation controls;
   Custom Agent settings consume the same query and preserve stale selected names
   as removable "missing" entries instead of silently widening the allowlist.
6. Components subscribe to thread state and render updates
