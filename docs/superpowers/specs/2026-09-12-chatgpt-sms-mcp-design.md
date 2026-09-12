# ChatGPT SMS MCP Design

## Goal
Expose a local MCP server with safe tools for reading, searching, drafting, and explicitly-confirmed sending through macOS Messages (for a Tello-backed iPhone bridge) plus an experimental Google Voice browser adapter.

## Constraints
- No direct Tello SMS API exists in this project; Tello is reached through macOS Messages/iPhone text forwarding.
- Google Voice has no supported public SMS API for this use case; browser automation is isolated and disabled by default.
- A send must require a two-step confirmation unless the operator deliberately changes policy.
- Never retry an uncertain send automatically.
- Never run bulk-marketing or anti-abuse-evasion behavior.
- ChatGPT plan availability is external to this server. The README must distinguish server capability from ChatGPT account eligibility.

## Architecture
`MessagingService` routes normalized operations to provider adapters. `MessagesAdapter` uses Apple Events (`osascript`) for sending and read-only `sqlite3` access to `~/Library/Messages/chat.db` for retrieval. `GoogleVoiceAdapter` uses Playwright with a persistent local browser profile and no stored password in the repository.

Safety is enforced by phone normalization, optional recipient allowlist, in-memory expiring confirmations, hourly send limits, and a persistent idempotency ledger stored under `.data/`. The MCP layer never talks directly to platform-specific code.

## MCP tools
- `send_message`
- `read_messages`
- `reply_to_message`
- `list_conversations`
- `search_messages`
- `get_message`
- `get_provider_status`

Write tools return a confirmation challenge on the first call and only send when the caller supplies the matching confirmation token on a second call.

## Error model
Provider failures surface as structured tool errors. A send that may have reached the provider but cannot be confirmed is marked `unknown` in the idempotency ledger and is never retried automatically.

## Verification
Unit tests cover phone normalization, confirmation expiry/consumption, idempotency, routing, and send confirmation. CI installs dependencies, typechecks, and runs tests on macOS and Linux; platform-specific live tests remain manual and non-sending by default.
