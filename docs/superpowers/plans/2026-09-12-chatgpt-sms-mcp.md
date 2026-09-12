# ChatGPT SMS MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a safe MCP server for macOS Messages/Tello and experimental Google Voice messaging.

**Architecture:** A provider-neutral `MessagingService` exposes normalized operations. Provider adapters implement macOS Messages and Google Voice. Confirmation, rate limiting, allowlisting, and idempotency wrap every send.

**Tech Stack:** Node.js 20+, TypeScript, MCP TypeScript SDK v2, Zod 4, Playwright, Vitest, macOS `osascript`, macOS `sqlite3`.

**Spec:** `docs/superpowers/specs/2026-09-12-chatgpt-sms-mcp-design.md`

## Global Constraints
- Google Voice automation remains experimental and disabled by default.
- No test may send a real message.
- No automatic retry after an uncertain send.
- No credentials, cookies, browser profiles, Messages databases, or real phone numbers committed.

---

### Task 1: Core contracts and safety
Create normalized message/provider types, phone normalization, confirmation store, rate limiter, allowlist, and idempotency ledger. Tests must fail first for invalid phone numbers, expired confirmation tokens, duplicate sends, and exceeded limits.

### Task 2: Provider adapters
Implement macOS Messages read/status/send behavior and Google Voice Playwright status/read/send scaffolding behind the shared provider interface. Unit tests use fake command/browser runners; no live send occurs.

### Task 3: Messaging service
Implement routing, confirmation handshake, duplicate-send protection, and structured errors. Test that first send returns confirmation-required, second matching call invokes exactly one provider send, and repeated idempotency keys do not resend.

### Task 4: MCP surface and CLI
Register the seven MCP tools using `@modelcontextprotocol/server` v2 and `serveStdio`. Add status/dry-run CLI commands. Verify tool schemas in tests without opening a live provider.

### Task 5: Documentation and CI
Document macOS permissions, ChatGPT plan limitations, Secure MCP Tunnel requirement for supported OpenAI products, Google Voice caveats, setup, security, and troubleshooting. Add macOS/Linux CI for build and tests.
