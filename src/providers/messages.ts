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

function applescriptString(value: string): string {
  return JSON.stringify(value);
}

function appleEpochToIso(raw: number): string {
  const seconds = raw > 1e12 ? raw / 1e9 : raw;
  return new Date((seconds + 978307200) * 1000).toISOString();
}

export class MessagesAdapter implements MessagingProvider {
  readonly name = 'messages' as const;
  constructor(
    private readonly dbPath: string,
    private readonly preferredService?: string,
    private readonly runner: CommandRunner = defaultRunner
  ) {}

  async status(): Promise<ProviderStatus> {
    const details: string[] = [];
    let readAvailable = false;
    let sendAvailable = false;
    try { await fs.access(this.dbPath); readAvailable = true; }
    catch { details.push(`Messages DB not readable: ${this.dbPath}`); }

    try {
      const { stdout } = await this.runner.run('osascript', ['-e', 'tell application "Messages" to get name of every service']);
      sendAvailable = true;
      details.push(`Messages services: ${stdout.trim() || 'available'}`);
    } catch (error) {
      details.push(`Apple Events unavailable: ${(error as Error).message}`);
    }
    if (this.preferredService) details.push(`Preferred service: ${this.preferredService}`);
    return { provider: this.name, available: readAvailable || sendAvailable, readAvailable, sendAvailable, details };
  }

  async send(recipient: string, body: string): Promise<SendResult> {
    const serviceSelector = this.preferredService
      ? `first service whose name is ${applescriptString(this.preferredService)}`
      : 'first service whose service type is SMS';
    const script = `
      tell application "Messages"
        set targetService to ${serviceSelector}
        set targetBuddy to buddy ${applescriptString(recipient)} of targetService
        send ${applescriptString(body)} to targetBuddy
      end tell`;
    try {
      await this.runner.run('osascript', ['-e', script]);
      return { status: 'sent' };
    } catch (error) {
      const message = (error as Error).message;
      if (!this.preferredService && /service type is SMS|Can't get service/i.test(message)) {
        throw new Error('No SMS service is exposed by macOS Messages. Configure MESSAGES_SERVICE_NAME after checking get_provider_status.');
      }
      throw error;
    }
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
