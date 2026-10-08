# Matrix Law Phase 10F tool replay-policy verifier

This disposable verifier runs inside the final Gateway runtime image. It
checks the application-layer contract for tool calls that may be revisited
from an existing LangGraph checkpoint:

- undeclared and explicit `forbid` tools execute when fresh but are blocked
  before their handler on checkpoint replay;
- `read_only` + `safe` tools may execute again;
- `keyed` tools require a canonical, bounded idempotency-key argument on both
  first execution and replay;
- receipts expose only a short SHA-256 fingerprint, never the raw key;
- externally supplied message metadata cannot forge the server-owned policy
  evidence key;
- configured policy participates in the release-policy fingerprint.

This verifier does not prove exactly-once delivery in an external provider.
For that, each `keyed` tool and its downstream provider must durably honor the
same key across the external commit/response crash window.
