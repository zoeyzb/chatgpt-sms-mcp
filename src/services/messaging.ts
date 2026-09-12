import crypto from 'node:crypto';
import type { MessagingProvider, ProviderName } from '../types.js';
import { normalizePhone } from '../security/phone.js';
import { ConfirmationStore } from '../security/confirmation.js';
import { HourlyRateLimiter } from '../security/rateLimit.js';
import { IdempotencyLedger } from '../security/idempotency.js';

function fingerprint(parts: string[]): string {
  return crypto.createHash('sha256').update(parts.join('\u001f')).digest('hex');
}

export class MessagingService {
  private readonly providers = new Map<ProviderName, MessagingProvider>();
  constructor(
    providers: MessagingProvider[],
    private readonly confirmations: ConfirmationStore,
    private readonly limiter: HourlyRateLimiter,
    private readonly ledger: IdempotencyLedger,
    private readonly allowlist: string[]
  ) { providers.forEach(p => this.providers.set(p.name, p)); }

  private provider(name: ProviderName): MessagingProvider {
    const p = this.providers.get(name);
    if (!p) throw new Error(`Provider not configured: ${name}`);
    return p;
  }

  private assertAllowed(recipient: string): void {
    if (this.allowlist.length && !this.allowlist.includes(recipient)) throw new Error('Recipient is not in RECIPIENT_ALLOWLIST');
  }

  async prepareOrSend(input: { provider: ProviderName; recipient: string; message: string; confirmationToken?: string; idempotencyKey?: string }) {
    const recipient = normalizePhone(input.recipient);
    this.assertAllowed(recipient);
    const key = input.idempotencyKey ?? fingerprint([input.provider, recipient, input.message]);
    const sendFingerprint = fingerprint([input.provider, recipient, input.message, key]);
    const existing = await this.ledger.get(key);
    if (existing) return { status: 'duplicate' as const, deliveryState: existing, idempotencyKey: key };

    if (!input.confirmationToken || !this.confirmations.consume(input.confirmationToken, sendFingerprint)) {
      const challenge = this.confirmations.issue(sendFingerprint);
      return { status: 'confirmation_required' as const, ...challenge, idempotencyKey: key, provider: input.provider, recipient, message: input.message };
    }

    this.limiter.assertCanSend();
    await this.ledger.set(key, 'claimed');
    try {
      const result = await this.provider(input.provider).send(recipient, input.message);
      await this.ledger.set(key, result.status === 'sent' ? 'sent' : 'unknown');
      this.limiter.commitSend();
      return { status: result.status, idempotencyKey: key, detail: result.detail };
    } catch (error) {
      await this.ledger.set(key, 'unknown');
      throw new Error(`Send failed after claim; not retried automatically. Delivery state is unknown. ${(error as Error).message}`);
    }
  }

  async readMessages(provider: ProviderName, contact: string | undefined, limit: number, unreadOnly: boolean) {
    return this.provider(provider).readMessages({ contact, limit, unreadOnly });
  }
  async listConversations(provider: ProviderName, limit: number) { return this.provider(provider).listConversations(limit); }
  async searchMessages(provider: ProviderName, query: string, limit: number) { return this.provider(provider).searchMessages(query, limit); }
  async getMessage(provider: ProviderName, id: string) { return this.provider(provider).getMessage(id); }
  async statuses() { return Promise.all([...this.providers.values()].map(p => p.status())); }

  async prepareOrReply(input: { provider: ProviderName; messageId: string; message: string; confirmationToken?: string; idempotencyKey?: string }) {
    const original = await this.provider(input.provider).getMessage(input.messageId);
    if (!original) throw new Error('Message not found');
    const recipient = original.direction === 'inbound' ? original.sender : original.recipient;
    return this.prepareOrSend({ provider: input.provider, recipient, message: input.message, confirmationToken: input.confirmationToken, idempotencyKey: input.idempotencyKey });
  }
}
