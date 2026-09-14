# chatgpt-sms-mcp

Local MCP server for safe message access through **macOS Messages** (including SMS relayed from an iPhone/Tello line) plus a **Google Voice browser adapter**.

## Important limitation: ChatGPT plan support

This server can expose write tools, but ChatGPT account support is separate. OpenAI changes custom MCP availability over time, so check current OpenAI documentation before expecting `send_message` to execute from ChatGPT. Local MCP servers cannot be attached directly to every ChatGPT plan/product.

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
- Google Voice persistent-browser login, conversation reading, searching, lookup, reply resolution, and sending

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

Requires Node.js 20.6 or newer.

```bash
cp .env.example .env
npm install
npx playwright install chromium
npm run build
npm test
npm run status
```

Runtime scripts load `.env` automatically using Node's `--env-file` support.

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

Google Voice consumer accounts do not expose a supported general-purpose SMS API. This project therefore uses the normal Google Voice web interface in a dedicated persistent browser profile. It does not store your Google password in source code or `.env`.

Enable it in `.env`:

```env
GOOGLE_VOICE_ENABLED=true
GOOGLE_VOICE_PROFILE_DIR=~/.chatgpt-sms-mcp/google-voice-profile
GOOGLE_VOICE_HEADLESS=false
```

Then run:

```bash
npm run google-voice-login
```

A dedicated Chrome window opens. Sign in to the **Google account that owns the Google Voice number** and complete any Google verification/2FA yourself. The command exits after the Google Voice Messages UI is detected, and the login session remains in the local profile directory.

After login:

```bash
npm run status
```

A healthy provider reports Google Voice as available for read and send.

### Google Voice capabilities

The adapter supports:

- listing recent conversations
- reading incoming and outgoing text messages
- filtering recent messages by contact
- unread-conversation filtering before opening the thread
- searching message text and participants across loaded recent conversations
- resolving an MCP message ID back to its Google Voice conversation
- replying to a message through the existing confirmation/send flow
- sending a new text through the Google Voice compose UI

The adapter first tries installed Google Chrome with the dedicated profile and falls back to Playwright Chromium. UI selectors are isolated in `src/providers/googleVoiceDom.ts` so Google Voice layout changes are easier to repair.

### Google Voice limitations

- This is UI automation, not an official Google Voice SMS API.
- Google can change the Voice DOM and selectors without notice.
- Search/read operate on conversations the web UI can load; this should not be treated as a permanent archival API.
- A successful click on the Voice send button is returned as `unknown` delivery state because the web app does not provide this adapter with a supported carrier delivery receipt.
- Do not use this project to bypass Google Voice limits, spam controls, carrier restrictions, or consent requirements.

## ChatGPT connection

ChatGPT does not connect directly to `localhost`. For supported OpenAI plans/products, use the current ChatGPT Developer Mode / custom MCP app flow and the supported secure tunnel/remote MCP approach for a server running on your Mac. Do not expose this stdio process directly to the public internet.

Because OpenAI changes availability and UI over time, follow current official developer-mode documentation rather than stale screenshots or copied setup guides.

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

**Google Voice says login required**: make sure `GOOGLE_VOICE_ENABLED=true`, then run `npm run google-voice-login`. Sign in to the Google account that owns the Voice number.

**Chrome cannot launch**: install Google Chrome, or run `npx playwright install chromium` so the fallback browser is available.

**Google Voice reads stop working after a UI change**: inspect `src/providers/googleVoiceDom.ts`; Google Voice selectors are intentionally isolated there.

**ChatGPT can read but not send**: this may be an account/product capability rather than a server bug. Write-capable custom MCP support is not available in every ChatGPT plan/product.
