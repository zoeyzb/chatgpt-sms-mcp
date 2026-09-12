import fs from 'node:fs/promises';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import type { Conversation, Message, MessagingProvider, ProviderStatus, SendResult } from '../types.js';

const execFile = promisify(execFileCallback);

export interface CommandRunner {
  run(command: string, args: string[]): Promise<{ stdout: string; stderr: string }>;
}

const defaultRunner: CommandRunner = {
  async run(command, args) {
    const result = await execFile(command, args, { maxBuffer: 2_000_000 });
    return { stdout: result.stdout, stderr: result.stderr };
  }
};

interface MessagesAccount {
  id: string;
  type: string;
  description: string;
}

function applescriptString(value: string): string {
  return JSON.stringify(value);
}

function appleEpochToIso(raw: number): string {
  const seconds = raw > 1e12 ? raw / 1e9 : raw;
  return new Date((seconds + 978307200) * 1000).toISOString();
}

const ACCOUNT_DISCOVERY_SCRIPT = `
  tell application "Messages"
    set accountList to every account
    set output to ""
    repeat with i from 1 to count of accountList
      set a to item i of accountList
      try
        set aid to id of a as text
      on error
        set aid to "UNKNOWN"
      end try
      try
        set adesc to description of a as text
      on error
        set adesc to "missing value"
      end try
      try
        set atype to service type of a as text
      on error errMsg number errNum
        set atype to "ERROR " & errNum
      end try
      set output to output & aid & tab & atype & tab & adesc & linefeed
    end repeat
    return output
  end tell`;

export class MessagesAdapter implements MessagingProvider {
  readonly name = 'messages' as const;
  constructor(
    private readonly dbPath: string,
    private readonly preferredService?: string,
    private readonly runner: CommandRunner = defaultRunner
  ) {}

  private async discoverAccounts(): Promise<MessagesAccount[]> {
    const { stdout } = await this.runner.run('osascript', ['-e', ACCOUNT_DISCOVERY_SCRIPT]);
    return stdout
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        const [id = '', type = '', description = ''] = line.split('\t');
        return { id: id.trim(), type: type.trim(), description: description.trim() };
      })
      .filter(account => account.id && account.id !== 'UNKNOWN');
  }

  private chooseSmsAccount(accounts: MessagesAccount[]): MessagesAccount | undefined {
    if (this.preferredService) {
      return accounts.find(account =>
        account.id === this.preferredService || account.description === this.preferredService
      );
    }
    return accounts.find(account => account.type === 'SMS');
  }

  async status(): Promise<ProviderStatus> {
    const details: string[] = [];
    let readAvailable = false;
    let sendAvailable = false;
    try { await fs.access(this.dbPath); readAvailable = true; }
    catch { details.push(`Messages DB not readable: ${this.dbPath}`); }

    try {
      const accounts = await this.discoverAccounts();
      const smsAccount = this.chooseSmsAccount(accounts);
      if (smsAccount) {
        sendAvailable = true;
        details.push(`SMS account: ${smsAccount.id}`);
      } else if (this.preferredService) {
        details.push(`Preferred Messages account not found: ${this.preferredService}`);
      } else {
        details.push('No SMS account exposed by macOS Messages.');
      }
      const otherAccounts = accounts.filter(account => account !== smsAccount);
      if (otherAccounts.length) {
        details.push(`Other Messages accounts: ${otherAccounts.map(account => `${account.id} (${account.type || 'unknown'})`).join(', ')}`);
      }
    } catch (error) {
      details.push(`Apple Events unavailable: ${(error as Error).message}`);
    }
    if (this.preferredService) details.push(`Preferred service/account: ${this.preferredService}`);
    return { provider: this.name, available: readAvailable || sendAvailable, readAvailable, sendAvailable, details };
  }

  async send(recipient: string, body: string): Promise<SendResult> {
    const accounts = await this.discoverAccounts();
    const smsAccount = this.chooseSmsAccount(accounts);
    if (!smsAccount) {
      throw new Error(
        this.preferredService
          ? `Configured Messages account not found: ${this.preferredService}`
          : 'No SMS account is exposed by macOS Messages. Confirm iPhone Text Message Forwarding is enabled.'
      );
    }

    const script = `
      tell application "Messages"
        set targetAccount to account id ${applescriptString(smsAccount.id)}
        set targetParticipant to participant ${applescriptString(recipient)} of targetAccount
        send ${applescriptString(body)} to targetParticipant
      end tell`;

    await this.runner.run('osascript', ['-e', script]);
    return { status: 'sent' };
  }

  private async query(sql: string): Promise<string[]> {
    const { stdout } = await this.runner.run('sqlite3', ['-readonly', '-separator', '\\u001f', this.dbPath, sql]);
    return stdout.split('\n').map(v => v.trim()).filter(Boolean);
  }

  async readMessages(options: { contact?: string; limit: number; unreadOnly?: boolean }): Promise<Message[]> {
    const contactFilter = options.contact ? `AND h.id = '${options.contact.replaceAll("'", "''")}'` : '';
    const unreadFilter = options.unreadOnly ? 'AND m.is_read = 0' : '';
    const sql = `SELECT m.ROWID, COALESCE(c.guid,''), COALESCE(h.id,''), COALESCE(m.text,''), m.date, m.is_from_me FROM message m LEFT JOIN handle h ON h.ROWID=m.handle_id LEFT JOIN chat_message_join cmj ON cmj.message_id=m.ROWID LEFT JOIN chat c ON c.ROWID=cmj.chat_id WHERE 1=1 ${contactFilter} ${unreadFilter} ORDER BY m.date DESC LIMIT ${Math.max(1, Math.min(options.limit, 100))};`;
    return (await this.query(sql)).map(row => {
      const [id, threadId, handle, body, rawDate, isFromMe] = row.split('\\u001f');
      const outbound = isFromMe === '1';
      return {
        id,
        provider: this.name,
        threadId: threadId || id,
        sender: outbound ? 'me' : handle,
        recipient: outbound ? handle : 'me',
        body,
        timestamp: appleEpochToIso(Number(rawDate || 0)),
        direction: outbound ? 'outbound' : 'inbound',
        status: outbound ? 'sent' : 'received'
      } satisfies Message;
    });
  }

  async listConversations(limit: number): Promise<Conversation[]> {
    const sql = `SELECT c.ROWID, COALESCE(c.chat_identifier,''), MAX(m.date) FROM chat c LEFT JOIN chat_message_join cmj ON cmj.chat_id=c.ROWID LEFT JOIN message m ON m.ROWID=cmj.message_id GROUP BY c.ROWID ORDER BY MAX(m.date) DESC LIMIT ${Math.max(1, Math.min(limit, 100))};`;
    return (await this.query(sql)).map(row => {
      const [id, participant, rawDate] = row.split('\\u001f');
      return { id, provider: this.name, participants: participant ? [participant] : [], lastMessageAt: rawDate ? appleEpochToIso(Number(rawDate)) : undefined };
    });
  }

  async searchMessages(query: string, limit: number): Promise<Message[]> {
    const escaped = query.replaceAll("'", "''");
    const sql = `SELECT m.ROWID, COALESCE(c.guid,''), COALESCE(h.id,''), COALESCE(m.text,''), m.date, m.is_from_me FROM message m LEFT JOIN handle h ON h.ROWID=m.handle_id LEFT JOIN chat_message_join cmj ON cmj.message_id=m.ROWID LEFT JOIN chat c ON c.ROWID=cmj.chat_id WHERE m.text LIKE '%${escaped}%' ORDER BY m.date DESC LIMIT ${Math.max(1, Math.min(limit, 100))};`;
    const rows = await this.query(sql);
    return rows.map(row => {
      const [id, threadId, handle, body, rawDate, isFromMe] = row.split('\\u001f');
      const outbound = isFromMe === '1';
      return { id, provider: this.name, threadId: threadId || id, sender: outbound ? 'me' : handle, recipient: outbound ? handle : 'me', body, timestamp: appleEpochToIso(Number(rawDate || 0)), direction: outbound ? 'outbound' : 'inbound', status: outbound ? 'sent' : 'received' };
    });
  }

  async getMessage(id: string): Promise<Message | null> {
    if (!/^\d+$/.test(id)) throw new Error('Messages message_id must be numeric');
    const rows = await this.query(`SELECT m.ROWID, COALESCE(c.guid,''), COALESCE(h.id,''), COALESCE(m.text,''), m.date, m.is_from_me FROM message m LEFT JOIN handle h ON h.ROWID=m.handle_id LEFT JOIN chat_message_join cmj ON cmj.message_id=m.ROWID LEFT JOIN chat c ON c.ROWID=cmj.chat_id WHERE m.ROWID=${id} LIMIT 1;`);
    if (!rows[0]) return null;
    const [mid, threadId, handle, body, rawDate, isFromMe] = rows[0].split('\\u001f');
    const outbound = isFromMe === '1';
    return { id: mid, provider: this.name, threadId: threadId || mid, sender: outbound ? 'me' : handle, recipient: outbound ? handle : 'me', body, timestamp: appleEpochToIso(Number(rawDate || 0)), direction: outbound ? 'outbound' : 'inbound', status: outbound ? 'sent' : 'received' };
  }

  async replyToMessage(messageId: string, body: string): Promise<{ recipient: string; result: SendResult }> {
    const message = await this.getMessage(messageId);
    if (!message) throw new Error('Message not found');
    const recipient = message.direction === 'inbound' ? message.sender : message.recipient;
    return { recipient, result: await this.send(recipient, body) };
  }
}
