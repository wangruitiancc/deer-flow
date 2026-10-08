# Matrix Law Phase 10I run-capacity verifier

This disposable verifier uses four independent `RunManager` instances and a
real PostgreSQL database to simulate admission from four Gateway processes.
It proves that the transaction-scoped advisory lock keeps global and per-user
pending/running limits from multiplying across workers, while preserving
idempotent retry and same-thread interrupt replacement.

The workload is synthetic and contains no customer data. It is a concurrency
correctness test, not a production capacity benchmark or tenant quota policy.
