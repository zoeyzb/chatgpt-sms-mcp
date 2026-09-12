import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import type { Conversation, Message, MessagingProvider, ProviderStatus, SendResult } from '../src/types.js';
import { ConfirmationStore } from '../src/security/confirmation.js';
import { HourlyRateLimiter } from '../src/security/rateLimit.js';
import { IdempotencyLedger } from '../src/security/idempotency.js';
import { MessagingService } from '../src/services/messaging.js';

class FakeProvider implements MessagingProvider {
  readonly name = 'messages' as const;
  sends = 0;
  async status(): Promise<ProviderStatus> { return { provider: this.name, available: true, readAvailable: true, sendAvailable: true, details: [] }; }
  async send(): Promise<SendResult> { this.sends++; return { status: 'sent' }; }
  async readMessages(): Promise<Message[]> { return []; }
  async listConversations(): Promise<Conversation[]> { return []; }
  async searchMessages(): Promise<Message[]> { return []; }
  async getMessage(): Promise<Message | null> { return null; }
  async replyToMessage(): Promise<{ recipient: string; result: SendResult }> { throw new Error('unused'); }
}

async function makeService() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sms-mcp-test-'));
  const provider = new FakeProvider();
  const service = new MessagingService([provider], new ConfirmationStore(10000), new HourlyRateLimiter(10), new IdempotencyLedger(path.join(dir, 'ledger.json')), []);
  return { service, provider };
}

describe('MessagingService send safety', () => {
  it('requires confirmation before sending', async () => {
    const { service, provider } = await makeService();
    const first = await service.prepareOrSend({ provider: 'messages', recipient: '+13125551234', message: 'hello', idempotencyKey: 'test-key-123' });
    expect(first.status).toBe('confirmation_required');
    expect(provider.sends).toBe(0);
  });

  it('sends exactly once after a valid confirmation', async () => {
    const { service, provider } = await makeService();
    const first = await service.prepareOrSend({ provider: 'messages', recipient: '+13125551234', message: 'hello', idempotencyKey: 'test-key-456' });
    if (first.status !== 'confirmation_required') throw new Error('expected challenge');
    const second = await service.prepareOrSend({ provider: 'messages', recipient: '+13125551234', message: 'hello', idempotencyKey: 'test-key-456', confirmationToken: first.token });
    expect(second.status).toBe('sent');
    expect(provider.sends).toBe(1);
    const third = await service.prepareOrSend({ provider: 'messages', recipient: '+13125551234', message: 'hello', idempotencyKey: 'test-key-456', confirmationToken: first.token });
    expect(third.status).toBe('duplicate');
    expect(provider.sends).toBe(1);
  });
});
