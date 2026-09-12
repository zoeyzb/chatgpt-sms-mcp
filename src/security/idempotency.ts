import fs from 'node:fs/promises';
import path from 'node:path';

export type DeliveryState = 'claimed' | 'sent' | 'unknown';
interface LedgerRecord { state: DeliveryState; updatedAt: string; }

export class IdempotencyLedger {
  private loaded = false;
  private data: Record<string, LedgerRecord> = {};
  constructor(private readonly filePath: string) {}

  private async load(): Promise<void> {
    if (this.loaded) return;
    try { this.data = JSON.parse(await fs.readFile(this.filePath, 'utf8')) as Record<string, LedgerRecord>; }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') throw error;
    }
    this.loaded = true;
  }

  async get(key: string): Promise<DeliveryState | undefined> {
    await this.load();
    return this.data[key]?.state;
  }

  async set(key: string, state: DeliveryState): Promise<void> {
    await this.load();
    this.data[key] = { state, updatedAt: new Date().toISOString() };
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.tmp`;
    await fs.writeFile(temp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    await fs.rename(temp, this.filePath);
  }
}
