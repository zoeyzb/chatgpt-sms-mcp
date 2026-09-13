# Tello relay design

Purpose: support a single user-confirmed personal SMS request from the existing MCP by handing it to a helper running on the user's own Mac. This is not a bulk sender and does not use an unsupported Tello API.

Flow: MCP confirmation -> authenticated one-message relay job -> Mac helper -> existing MessagesAdapter -> local Messages database verification -> result returned as sent, failed, or unknown.

Safety constraints: preserve the existing confirmation gate, allowlist, phone normalization, idempotency and hourly limit; accept only one message per job; no batch endpoint; no arbitrary remote commands; no secrets in GitHub.

The Mac helper polls an authenticated queue, leases one job, sends it once, then reports status. If status reporting fails after local submission, it retries only the report and never resends the message.

The current MessagesAdapter must stop treating a successful AppleScript call as proof that an SMS was sent. Verification should inspect the matching outbound row created after submission. `is_sent=1` maps to sent; an explicit finished error maps to failed; anything inconclusive before timeout maps to unknown. The provider health check should also execute a harmless SQLite query instead of relying only on filesystem access.

Expected files: `src/relay/protocol.ts`, `src/relay/client.ts`, `src/relay/server.ts`, `src/relay/worker.ts`, tests for relay behavior, plus small updates to `src/config.ts`, `src/providers/messages.ts`, `.env.example`, and README.

Implementation will use test-driven development. Automated tests will never send a real SMS. Final end-to-end validation will use one explicitly approved test message only.
