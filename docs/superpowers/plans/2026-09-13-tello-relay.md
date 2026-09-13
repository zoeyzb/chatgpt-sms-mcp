# Tello Relay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a secure single-message remote relay so confirmed MCP send requests can be executed by a helper on the user's Mac through macOS Messages/Tello, with real delivery-state verification.

**Architecture:** The MCP side can enqueue exactly one authenticated relay job to an HTTP relay server. A Mac worker polls for one leased job, invokes the existing `MessagesAdapter`, verifies the resulting outbound Messages database row, then reports `sent`, `failed`, or `unknown` without resending after submission. Existing confirmation, allowlist, normalization, rate limiting, and idempotency remain the gate before enqueueing.

**Tech Stack:** Node.js >=20, TypeScript, Vitest, built-in `http`/`fetch`, SQLite CLI, AppleScript/macOS Messages.

**Spec:** `docs/tello-relay-design.md`

## Global Constraints

- One message per relay job; no batch endpoint.
- No arbitrary command execution through relay jobs.
- Preserve confirmation, allowlist, normalization, idempotency, and hourly rate limit.
- Never commit secrets; relay auth token comes from environment variables.
- Automated tests never send a real SMS.
- Once local submission may have happened, retry status reporting only; never auto-resend.

---

### Task 1: Accurate macOS Messages status and send verification

**Files:**
- Modify: `src/providers/messages.ts`
- Modify: `src/types.ts`
- Test: `test/messages-adapter.test.ts`

**Interfaces:**
- `SendResult.status` becomes `sent | failed | unknown`.
- `MessagesAdapter.send(recipient, body)` submits once, then verifies the newest matching outbound row created after submission.

- [ ] Write failing tests proving filesystem readability alone is insufficient, `is_sent=1` returns `sent`, finished nonzero error returns `failed`, and inconclusive rows return `unknown`.
- [ ] Run CI and verify the new tests fail for the intended missing behavior.
- [ ] Implement a harmless SQLite health probe and bounded post-send polling of the matching outbound message row.
- [ ] Run build/tests and verify green.
- [ ] Commit.

### Task 2: Relay protocol and authenticated queue server

**Files:**
- Create: `src/relay/protocol.ts`
- Create: `src/relay/server.ts`
- Test: `test/relay-server.test.ts`

**Interfaces:**
- `RelayJob`: `{ id, recipient, message, idempotencyKey, createdAt, state }`.
- Auth: `Authorization: Bearer <RELAY_AUTH_TOKEN>` using timing-safe comparison.
- Endpoints: `POST /jobs`, `POST /jobs/:id/lease`, `POST /jobs/:id/result`, `GET /jobs/:id`.

- [ ] Write failing tests for auth rejection, single-job validation, idempotent enqueue, one active lease, and result reporting.
- [ ] Run CI and verify red.
- [ ] Implement the in-memory/file-backed queue with lease expiry and no batch route.
- [ ] Run build/tests and verify green.
- [ ] Commit.

### Task 3: Relay client provider and Mac worker

**Files:**
- Create: `src/providers/telloRelay.ts`
- Create: `src/relay/worker.ts`
- Modify: `src/types.ts`
- Test: `test/tello-relay.test.ts`

**Interfaces:**
- Add provider name `tello_relay`.
- `TelloRelayAdapter.send()` enqueues one already-confirmed message and returns `unknown` with relay job id until the worker reports a final result.
- Worker leases one job, calls `MessagesAdapter.send()` once, reports its result, and never retries submission after the call begins.

- [ ] Write failing provider/worker tests using a fake HTTP server and fake Messages adapter.
- [ ] Run CI and verify red.
- [ ] Implement adapter and worker.
- [ ] Run build/tests and verify green.
- [ ] Commit.

### Task 4: Configuration, app wiring, CLI, and docs

**Files:**
- Modify: `src/config.ts`
- Modify: `src/app.ts`
- Modify: `src/cli.ts`
- Modify: `.env.example`
- Modify: `README.md`
- Test: relevant config/app tests or new `test/config.test.ts`

**Interfaces:**
- `TELLO_RELAY_ENABLED=false` by default.
- `TELLO_RELAY_URL`, `RELAY_AUTH_TOKEN`, `TELLO_RELAY_POLL_MS`, and `TELLO_RELAY_LEASE_MS` configure relay behavior.
- CLI gains a `relay-worker` command for the Mac helper and an optional `relay-server` command for self-hosting.

- [ ] Write failing config/wiring tests.
- [ ] Run CI and verify red.
- [ ] Implement config, provider registration, worker/server CLI entrypoints, and setup documentation.
- [ ] Run full `npm run check` in CI and verify green on macOS and Ubuntu.
- [ ] Commit.

### Task 5: Final verification

**Files:** none unless verification finds a defect.

- [ ] Review diff for secrets, batch-send paths, automatic resend behavior, and confirmation bypasses.
- [ ] Confirm all CI checks pass.
- [ ] Open a PR from `feat-tello-relay` to `main` with setup instructions and known limitation: Tello has no public send-SMS API; the Mac worker is the sender.
- [ ] Do not perform a real SMS send without a fresh explicit test-message approval.
