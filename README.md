# chatgpt-sms-mcp

Local MCP server for safe message access through **macOS Messages** (including SMS relayed from an iPhone/Tello line) plus an **experimental Google Voice browser adapter**.

## Important limitation: ChatGPT plan support

This server can expose write tools, but ChatGPT account support is separate. As of September 2026, OpenAI documents full MCP write/modify support for Business and Enterprise/Edu. Pro can connect MCPs with read/fetch permissions in developer mode; local MCP servers cannot be attached directly and supported products use Secure MCP Tunnel. Check current OpenAI documentation before expecting `send_message` to execute from ChatGPT.

## What is implemented

- `send_message` — two-step confirmation before send
- `read_messages`
- `reply_to_message` — two-step confirmation before send
- `list_conversations`
- `search_messages`
- `get_message`
- `get_provider_status`
- duplicate-send protection via a persistent idempotency ledger
- optional recipient allowlist
- hourly send cap
- no automatic retry after uncertain delivery

## Tello / Apple Messages architecture

There is no Tello API in this project. The route is:

`MCP -> macOS Messages -> iPhone Text Message Forwarding -> carrier/Tello`

Sending uses Apple Events (`osascript`). Reading uses the local Messages database in read-only mode via macOS `sqlite3`.

### macOS permissions

For read access, the terminal/process launching this server may need **Full Disk Access** so it can read `~/Library/Messages/chat.db`.

For send access, macOS may ask for **Automation** permission to control Messages. Grant only the specific process you use to launch this server. Accessibility is not intentionally required.

### Multiple lines / services

Apple does not reliably expose carrier branding such as `Tello` to the scripting layer. If your Mac has several Messages services or phone lines, run:

```bash
npm run status
```

Then set `MESSAGES_SERVICE_NAME` to the exact service/account you intend to use. Do not send until provider status matches the expected service.

## Setup

```bash
cp .env.example .env
npm install
npm run build
npm test
npm run status
```

The server runs over stdio:

```bash
npm run dev
```

The current MCP TypeScript SDK v2 uses `serveStdio` and implements the 2026-07-28 MCP protocol revision.

## Safe dry run

```bash
npm run dry-run
```

This does **not** send. It only creates a confirmation challenge.

## Real send flow

Call `send_message` once without `confirmationToken`. It returns `confirmation_required` plus a short-lived token. Only a second call with the same provider, recipient, body, idempotency key, and confirmation token may send.

If a provider call fails after the send has been claimed, the ledger records `unknown` and the server refuses to retry that idempotency key automatically.

## Google Voice

Google Voice is disabled by default because this project does not pretend a supported SMS API exists.

To experiment:

```env
GOOGLE_VOICE_ENABLED=true
GOOGLE_VOICE_PROFILE_DIR=~/.chatgpt-sms-mcp/google-voice-profile
GOOGLE_VOICE_HEADLESS=false
```

Then install Playwright's browser if needed and run `npm run status`. Authenticate interactively in the persistent browser profile. Never put your Google password, cookies, or profile directory in Git.

The current Google Voice adapter only verifies browser login and implements an experimental send interaction. Read/search/reply parsing is deliberately reported as unverified rather than faked.

## ChatGPT connection

ChatGPT does not connect directly to `localhost`. For supported OpenAI plans/products, use the current ChatGPT Developer Mode / custom MCP app flow and Secure MCP Tunnel for a server running on your Mac. Do not expose this stdio process directly to the public internet.

Because OpenAI changes availability and UI over time, follow the current official developer-mode documentation rather than stale screenshots or copied setup guides.

## Security

- `.env`, browser profiles, cookies, logs, Messages DBs, and `.data/` are ignored by Git.
- Secrets are never required in source code.
- Google Voice reuses a local authenticated browser profile instead of storing a password.
- Write actions require confirmation by default.
- Optional `RECIPIENT_ALLOWLIST` accepts comma-separated E.164 numbers.
- Default hourly send cap is 30 and can be lowered with `MESSAGE_RATE_LIMIT_PER_HOUR`.
- This project is not for bulk unsolicited messaging or bypassing platform/carrier abuse controls.

## Troubleshooting

**`Messages DB not readable`**: grant Full Disk Access to the terminal/runtime launching the MCP, then restart it.

**`No SMS service is exposed`**: make sure the iPhone is signed into the same Apple Account, Text Message Forwarding is enabled to the Mac, and inspect `npm run status`. Set `MESSAGES_SERVICE_NAME` if necessary.

**Google Voice says login required**: run non-headless and authenticate in the configured persistent profile.

**ChatGPT can read but not send**: this may be an account/plan capability rather than a server bug. Full write-capable custom MCP support is not available to every ChatGPT plan.
