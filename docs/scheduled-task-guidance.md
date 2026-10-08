# Scheduled task runtime invariants

Scheduled-task note:
- The scheduled-task MVP adds a workspace page at `/workspace/scheduled-tasks` plus a background scheduler service gated by `config.yaml -> scheduler.enabled`.
- Scheduled background runs are intentionally non-interactive: they execute through the normal run lifecycle, but the lead-agent toolset excludes `ask_clarification` when `context.non_interactive=true`. The key is honored only for internally-authenticated callers (the scheduler launch path); client-supplied `context.non_interactive` is dropped.
- Busy scheduled occurrences are persisted as `queued`; `launching` is a short lease-fenced claim, `running` remains the normal Gateway run lifecycle, and `scheduler.queue_timeout_seconds` bounds the durable wait. Do not reintroduce skip-on-overlap or count waiting rows against `max_concurrent_runs`.
- Scheduled launches use `scheduler.recursion_limit` (default 1000, matching the web UI's `recursion_limit: 1000`, clamped by `max_recursion_limit`). The value is read at dispatch, so a YAML edit applies to the next scheduled run without a Gateway restart.
