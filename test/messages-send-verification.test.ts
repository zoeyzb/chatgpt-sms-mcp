import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { MessagesAdapter, type CommandRunner } from '../src/providers/messages.js';

class FakeRunner implements CommandRunner {
  calls: Array<{ command: string; args: string[] }> = [];

  constructor(
    private readonly responder: (
      command: string,
      args: string[]
    ) => Promise<{ stdout: string; stderr: string }>
  ) {}

  async run(command: string, args: string[]) {
    this.calls.push({ command, args });
    return this.responder(command, args);
  }
}

async function tempDbPath() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'messages-send-test-'));
  const dbPath = path.join(dir, 'chat.db');
  await fs.writeFile(dbPath, '');
  return dbPath;
}

const accountDiscovery =
  '5CCEB943-86A6-48E3-B263-C008B7D9D6DE\tSMS\tmissing value\n';

describe('MessagesAdapter send verification', () => {
  it('reports sent only when the matching outbound database row has is_sent=1', async () => {
    const dbPath = await tempDbPath();
    let sqliteCalls = 0;

    const runner = new FakeRunner(async (command) => {
      if (command === 'osascript') {
        return { stdout: accountDiscovery, stderr: '' };
      }

      if (command === 'sqlite3') {
        sqliteCalls++;
        if (sqliteCalls === 1) {
          return { stdout: '100\n', stderr: '' };
        }
        return { stdout: '101\u001f1\u001f0\u001f1\u001f0\n', stderr: '' };
      }

      throw new Error(`unexpected command: ${command}`);
    });

    const adapter = new MessagesAdapter(dbPath, undefined, runner);
    const result = await adapter.send('+13125551234', 'hello');

    expect(result.status).toBe('sent');
  });

  it('reports failed when the matching outbound row is finished with a nonzero error', async () => {
    const dbPath = await tempDbPath();
    let sqliteCalls = 0;

    const runner = new FakeRunner(async (command) => {
      if (command === 'osascript') {
        return { stdout: accountDiscovery, stderr: '' };
      }

      if (command === 'sqlite3') {
        sqliteCalls++;
        if (sqliteCalls === 1) {
          return { stdout: '200\n', stderr: '' };
        }
        return { stdout: '201\u001f0\u001f0\u001f1\u001f4\n', stderr: '' };
      }

      throw new Error(`unexpected command: ${command}`);
    });

    const adapter = new MessagesAdapter(dbPath, undefined, runner);
    const result = await adapter.send('+13125551234', 'hello');

    expect(result.status).toBe('failed');
  });

  it('reports unknown when the row is inconclusive', async () => {
    const dbPath = await tempDbPath();
    let sqliteCalls = 0;

    const runner = new FakeRunner(async (command) => {
      if (command === 'osascript') {
        return { stdout: accountDiscovery, stderr: '' };
      }

      if (command === 'sqlite3') {
        sqliteCalls++;
        if (sqliteCalls === 1) {
          return { stdout: '300\n', stderr: '' };
        }
        return { stdout: '301\u001f0\u001f0\u001f1\u001f0\n', stderr: '' };
      }

      throw new Error(`unexpected command: ${command}`);
    });

    const adapter = new MessagesAdapter(dbPath, undefined, runner);
    const result = await adapter.send('+13125551234', 'hello');

    expect(result.status).toBe('unknown');
  });
});
