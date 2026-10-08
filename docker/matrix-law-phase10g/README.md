# Matrix Law Phase 10G external-write idempotency verifier

This disposable two-container test closes the synthetic commit/response
uncertainty case left open by Phase 10F:

1. the Agent invokes a `keyed` external-write tool;
2. the provider commits one durable delivery row and deliberately closes the
   TCP connection before returning a response;
3. the runtime records an error receipt;
4. the same checkpoint tool call is retried with the same key;
5. the provider returns the stored response without a second delivery commit;
6. the provider is restarted and another same-key replay still leaves one
   delivery commit;
7. the same key with a different payload is rejected, while eight concurrent
   same-key requests converge on one durable delivery and one response.

The provider is synthetic, uses opaque non-production references, and never
sends a real document or calls a third party. This proves the reference
contract over a real HTTP connection and persistent SQLite volume; it does
not certify any future court, e-signature, messaging, or vendor API.
