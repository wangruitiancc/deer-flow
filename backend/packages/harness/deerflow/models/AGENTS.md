### Model Factory (`packages/harness/deerflow/models/factory.py`)

- `create_chat_model(name, thinking_enabled)` instantiates LLM from config via reflection
- Supports `thinking_enabled` flag with per-model `when_thinking_enabled` overrides
- Supports vLLM-style thinking toggles via `when_thinking_enabled.extra_body.chat_template_kwargs.enable_thinking` for Qwen reasoning models, while normalizing legacy `thinking` configs for backward compatibility
- Supports `supports_vision` flag for image understanding models
- Config values starting with `$` resolved as environment variables
- Missing provider modules surface actionable install hints from reflection resolvers (for example `uv add langchain-google-genai`)

### Task-Scoped Controlled Model Runtime (`packages/harness/deerflow/models/controlled.py`)

- `ControlledModelRuntime` and `ControlledModelRuntimeBinding` are public, host-independent extension contracts. A vertical extension may install one only after its `TaskAdmissionContributor` has completed trusted admission for that lead task or subtask.
- `controlled_model_runtime_scope()` always overwrites the ContextVar, including with `None`. A fresh subtask store therefore cannot inherit a parent signer when admission did not bind one. The binding must stay out of Runnable config, prompts, checkpoints, observer payloads, and Pydantic serialization.
- When a binding is active, `create_chat_model(..., purpose=...)` uses `ControlledGatewayChatModel` rather than the profile's ordinary provider. The configured profile supplies safe generation settings, while the concrete model name and every outbound attempt are authorized by the extension-owned runtime. A denied or missing controlled model must fail; do not add a provider fallback.
- Purpose is fixed by the host caller (`agent`, `subagent`, `title`, `summarization`, `goal`, `memory`, `oneshot`, or `security_scan`), never supplied by model input. The adapter creates a fresh call id and a fresh signed attempt assertion for every HTTP attempt; closing an async stream releases the task scope.
- This mechanism is opt-in and has no authority by itself. Embedded `DeerFlowClient`, TUI/CLI, and other entry points are not controlled unless their own trusted task admission installs a binding.

### vLLM Provider (`packages/harness/deerflow/models/vllm_provider.py`)

- `VllmChatModel` subclasses `langchain_openai:ChatOpenAI` for vLLM 0.19.0 OpenAI-compatible endpoints
- Preserves vLLM's non-standard assistant `reasoning` field on full responses, streaming deltas, and follow-up tool-call turns
- Designed for configs that enable thinking through `extra_body.chat_template_kwargs.enable_thinking` on vLLM 0.19.0 Qwen reasoning models, while accepting the older `thinking` alias
- `cumulative_stream_usage` is an opt-in model setting (default `false`) for endpoints that repeat cumulative token totals on each streaming chunk. The provider converts snapshots to deltas only when a stable completion id is present, isolates interleaved streams by id, and leaves the original usage untouched otherwise. Per-model tracking is lock-protected and cleared on the trailing empty-`choices` frame whether or not that frame carries usage. A soft cap of 1024 ids evicts only entries idle for at least one hour; active streams may temporarily exceed the cap so eviction cannot corrupt their deltas. Regression coverage lives in `tests/test_vllm_provider.py`.
