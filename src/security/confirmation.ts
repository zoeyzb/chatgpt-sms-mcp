import crypto from 'node:crypto';

interface ConfirmationRecord {
  fingerprint: string;
  expiresAt: number;
}

export class ConfirmationStore {
  private readonly records = new Map<string, ConfirmationRecord>();
  constructor(private readonly ttlMs: number, private readonly now = () => Date.now()) {}

  issue(fingerprint: string): { token: string; expiresAt: string } {
    const token = crypto.randomUUID();
    const expiresAt = this.now() + this.ttlMs;
    this.records.set(token, { fingerprint, expiresAt });
    return { token, expiresAt: new Date(expiresAt).toISOString() };
  }

  consume(token: string, fingerprint: string): boolean {
    const record = this.records.get(token);
    if (!record) return false;
    this.records.delete(token);
    return record.expiresAt >= this.now() && record.fingerprint === fingerprint;
  }
}
