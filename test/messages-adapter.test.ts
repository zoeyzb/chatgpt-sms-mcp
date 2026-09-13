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
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'messages-adapter-test-'));
  const dbPath = path.join(dir, 'chat.db');
  await fs.writeFile(dbPath, '');
  return dbPath;
}

describe('MessagesAdapter account discovery', () => {
  it('marks sending available when one account is SMS even if other accounts fail service type lookup', async () => {
    const dbPath = await tempDbPath();

    const runner = new FakeRunner(async (command) => {
      if (command === 'sqlite3') {
        return { stdout: '1\n', stderr: '' };
      }

      if (command === 'osascript') {
        return {
          stdout: [
            '5CCEB943-86A6-48E3-B263-C008B7D9D6DE\tSMS\tmissing value',
            '3376A84B-E911-485C-8EA4-4F1CEF98D7E2\tERROR -10000\tmissing value',
            '8F02A54C-2CBA-4A4E-B461-DFEB3AE3696C\tERROR -10000\tE:zainabhassnain@icloud.com',
            'F174FED1-C33F-435C-B852-64D45CC6480F\tiMessage\tE:zainabhassnain@icloud.com',
            '4011ADF8-87C3-48A3-9195-4CFAD2BC5C02\tRCS\tmissing value'
          ].join('\n'),
          stderr: ''
        };
      }

      throw new Error(`unexpected command: ${command}`);
    });

    const adapter = new MessagesAdapter(dbPath, undefined, runner);
    const status = await adapter.status();

    expect(status.readAvailable).toBe(true);
    expect(status.sendAvailable).toBe(true);
    expect(status.details.join('\n')).toContain(
      'SMS account: 5CCEB943-86A6-48E3-B263-C008B7D9D6DE'
    );
  });

  it('sends through the discovered SMS account using participant syntax', async () => {
    const dbPath = await tempDbPath();
    let osascriptCalls = 0;
    let sqliteCalls = 0;

    const runner = new FakeRunner(async (command, args) => {
      if (command === 'sqlite3') {
        sqliteCalls++;

        if (sqliteCalls === 1) {
          return { stdout: '100\n', stderr: '' };
        }

        return {
          stdout: '101\u001f1\u001f0\u001f1\u001f0\n',
          stderr: ''
        };
      }

      if (command !== 'osascript') {
        throw new Error(`unexpected command: ${command}`);
      }

      osascriptCalls++;

      if (osascriptCalls === 1) {
        return {
          stdout:
            '5CCEB943-86A6-48E3-B263-C008B7D9D6DE\tSMS\tmissing value\n',
          stderr: ''
        };
      }

      const script = args.at(-1) ?? '';

      expect(script).toContain(
        'account id "5CCEB943-86A6-48E3-B263-C008B7D9D6DE"'
      );
      expect(script).toContain(
        'participant "+13125551234" of targetAccount'
      );
      expect(script).toContain(
        'send "hello" to targetParticipant'
      );

      return { stdout: '', stderr: '' };
    });

    const adapter = new MessagesAdapter(dbPath, undefined, runner);
    const result = await adapter.send('+13125551234', 'hello');

    expect(result.status).toBe('sent');
  });
});
