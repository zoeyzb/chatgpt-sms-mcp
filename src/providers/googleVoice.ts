import type { BrowserContext, Page } from 'playwright';
import type { Conversation, Message, MessagingProvider, ProviderStatus, SendResult } from '../types.js';
import {
  decodeGoogleVoiceMessageId,
  googleVoiceCdpEndpoints,
  GOOGLE_VOICE_SELECTORS as S,
  normalizeGoogleVoiceContact,
  rawMessageToMessage
} from './googleVoiceDom.js';

const VOICE_MESSAGES_URL = 'https://voice.google.com/u/0/messages';
const attachedContexts = new WeakSet<BrowserContext>();
let cachedAttachedContext: BrowserContext | null = null;

interface VoiceConversationRow {
  id: string;
  contact: string;
  snippet: string;
  timestamp: string;
  unread: boolean;
}

async function connectExistingChrome(): Promise<BrowserContext | null> {
  if (cachedAttachedContext?.browser()?.isConnected()) return cachedAttachedContext;
  cachedAttachedContext = null;

  const { chromium } = await import('playwright');
  for (const endpoint of googleVoiceCdpEndpoints()) {
    try {
      const browser = await chromium.connectOverCDP(endpoint, { timeout: 1_500 });
      const context = browser.contexts()[0];
      if (!context) continue;
      attachedContexts.add(context);
      cachedAttachedContext = context;
      return context;
    } catch {
      // Fall through to the next local DevTools endpoint, then to a persistent profile.
    }
  }
  return null;
}

async function launchProfile(profileDir: string, headless: boolean): Promise<BrowserContext> {
  const attached = await connectExistingChrome();
  if (attached) return attached;

  const { chromium } = await import('playwright');
  try {
    return await chromium.launchPersistentContext(profileDir, {
      channel: 'chrome',
      headless,
      viewport: { width: 1280, height: 900 }
    });
  } catch (chromeError) {
    try {
      return await chromium.launchPersistentContext(profileDir, {
        headless,
        viewport: { width: 1280, height: 900 }
      });
    } catch (bundledError) {
      throw new Error(`Could not connect to the existing Google Voice Chrome session or launch the Google Voice browser profile. Chrome: ${(chromeError as Error).message}; Chromium: ${(bundledError as Error).message}`);
    }
  }
}

async function releaseProfile(context: BrowserContext): Promise<void> {
  if (attachedContexts.has(context)) return;
  await context.close();
}

async function voicePage(context: BrowserContext): Promise<Page> {
  return context.pages().find(page => /^https:\/\/voice\.google\.com\//.test(page.url())) ?? await context.newPage();
}

async function gotoMessages(page: Page): Promise<void> {
  await page.goto(VOICE_MESSAGES_URL, { waitUntil: 'domcontentloaded', timeout: 20_000 });
  if (/accounts\.google\.com/.test(page.url())) throw new Error('Google Voice login required. Run npm run google-voice-login first.');
}

async function loggedIn(page: Page): Promise<boolean> {
  if (!/^https:\/\/voice\.google\.com\//.test(page.url())) return false;
  if (/accounts\.google\.com/.test(page.url())) return false;
  return page.locator(S.loggedInIndicator).count().then(count => count > 0).catch(() => false);
}

export async function interactiveGoogleVoiceLogin(profileDir: string): Promise<void> {
  const context = await launchProfile(profileDir, false);
  try {
    const page = await voicePage(context);
    await page.goto(VOICE_MESSAGES_URL, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    if (await loggedIn(page)) return;
    process.stderr.write('Google Voice login window opened. Sign in to the Google account that owns the Voice number; this command will finish automatically when Messages is available.\n');
    await page.waitForSelector(S.loggedInIndicator, { timeout: 0 });
  } finally {
    await releaseProfile(context);
  }
}

export class GoogleVoiceAdapter implements MessagingProvider {
  readonly name = 'google_voice' as const;
  constructor(private readonly enabled: boolean, private readonly profileDir: string, private readonly headless: boolean) {}

  async status(): Promise<ProviderStatus> {
    if (!this.enabled) {
      return {
        provider: this.name,
        available: false,
        readAvailable: false,
        sendAvailable: false,
        details: ['Disabled. Set GOOGLE_VOICE_ENABLED=true, then run npm run google-voice-login.']
      };
    }

    try {
      const context = await launchProfile(this.profileDir, this.headless);
      try {
        const page = await voicePage(context);
        await page.goto(VOICE_MESSAGES_URL, { waitUntil: 'domcontentloaded', timeout: 20_000 });
        const authenticated = await loggedIn(page);
        return {
          provider: this.name,
          available: authenticated,
          readAvailable: authenticated,
          sendAvailable: authenticated,
          details: authenticated
            ? ['Authenticated Google Voice browser session detected.', 'Read, search, conversation listing, lookup, reply resolution, and send automation are enabled.', 'Unofficial UI automation: Google Voice DOM changes can require selector maintenance.']
            : ['Google Voice login is not complete. Open Chrome with remote debugging or run npm run google-voice-login.', 'No password or Google cookies are stored in this repository.']
        };
      } finally {
        await releaseProfile(context);
      }
    } catch (error) {
      return { provider: this.name, available: false, readAvailable: false, sendAvailable: false, details: [(error as Error).message] };
    }
  }

  private async withPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
    if (!this.enabled) throw new Error('Google Voice adapter is disabled. Set GOOGLE_VOICE_ENABLED=true.');
    const context = await launchProfile(this.profileDir, this.headless);
    try {
      const page = await voicePage(context);
      await gotoMessages(page);
      if (!(await loggedIn(page))) throw new Error('Google Voice login required. Open the authenticated Chrome debugging session or run npm run google-voice-login first.');
      return await fn(page);
    } finally {
      await releaseProfile(context);
    }
  }

  private async waitForConversationList(page: Page): Promise<void> {
    await page.waitForSelector(S.conversationItem, { timeout: 10_000 });
  }

  private async loadConversationRows(page: Page, desired: number): Promise<void> {
    await this.waitForConversationList(page);
    let previous = -1;
    for (let attempt = 0; attempt < 12; attempt++) {
      const items = page.locator(S.conversationItem);
      const count = await items.count();
      if (count >= desired || count === previous) break;
      previous = count;
      await items.nth(Math.max(0, count - 1)).scrollIntoViewIfNeeded().catch(() => undefined);
      await page.waitForTimeout(350);
    }
  }

  private async captureConversationId(page: Page, index: number): Promise<string> {
    const item = page.locator(S.conversationItem).nth(index);
    const href = await item.locator('a[href*="itemId="]').first().getAttribute('href').catch(() => null);
    if (href) {
      const match = href.match(/[?&]itemId=([^&]+)/);
      if (match) return decodeURIComponent(match[1]);
    }

    return page.evaluate(({ index: itemIndex, itemSelector, clickableSelector }) => {
      return new Promise<string>(resolve => {
        let settled = false;
        const originalPush = history.pushState;
        const originalReplace = history.replaceState;
        const finish = (value: string) => {
          if (settled) return;
          settled = true;
          history.pushState = originalPush;
          history.replaceState = originalReplace;
          resolve(value);
        };
        const extract = (url: string | URL | null | undefined) => {
          const value = url?.toString() ?? '';
          const match = value.match(/[?&]itemId=([^&]+)/);
          return match ? decodeURIComponent(match[1]) : '';
        };

        history.pushState = function(_data: unknown, _unused: string, url?: string | URL | null) {
          finish(extract(url));
        };
        history.replaceState = function(_data: unknown, _unused: string, url?: string | URL | null) {
          finish(extract(url));
        };

        const rows = document.querySelectorAll(itemSelector);
        const target = rows[itemIndex]?.querySelector(clickableSelector) as HTMLElement | null;
        if (!target) {
          finish('');
          return;
        }
        target.click();
        window.setTimeout(() => finish(''), 2500);
      });
    }, { index, itemSelector: S.conversationItem, clickableSelector: S.conversationClickable });
  }

  private async conversationRows(page: Page, limit: number, unreadOnly = false): Promise<VoiceConversationRow[]> {
    await gotoMessages(page);
    await this.loadConversationRows(page, Math.min(Math.max(limit, 1), 100));

    const raw = await page.$$eval(S.conversationItem, (elements, selectors) => elements.map((element, index) => {
      const clickable = element.querySelector(selectors.clickable);
      return {
        index,
        contact: element.querySelector(selectors.contact)?.textContent?.trim() ?? '',
        snippet: element.querySelector(selectors.snippet)?.textContent?.trim() ?? '',
        timestamp: element.querySelector(selectors.timestamp)?.textContent?.trim() ?? '',
        unread: !clickable?.classList.contains(selectors.readClass)
      };
    }), {
      clickable: S.conversationClickable,
      contact: S.conversationContact,
      snippet: S.conversationSnippet,
      timestamp: S.conversationTimestamp,
      readClass: S.conversationReadClass
    });

    const selected = raw.filter(row => !unreadOnly || row.unread).slice(0, limit);
    const rows: VoiceConversationRow[] = [];
    for (const row of selected) {
      const id = await this.captureConversationId(page, row.index);
      if (!id) continue;
      rows.push({ id, contact: row.contact, snippet: row.snippet, timestamp: row.timestamp, unread: row.unread });
      await gotoMessages(page);
      await this.loadConversationRows(page, Math.min(raw.length, 100));
    }
    return rows;
  }

  private async readConversation(page: Page, conversation: VoiceConversationRow, limit: number): Promise<Message[]> {
    const url = `${VOICE_MESSAGES_URL}?itemId=${encodeURIComponent(conversation.id)}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await page.waitForSelector(S.messageBubble, { timeout: 10_000 });

    const raw = await page.$$eval(S.messageBubble, (elements, selectors) => elements.map(element => ({
      text: element.querySelector(selectors.text)?.textContent?.trim() ?? '',
      timestamp: element.querySelector(selectors.timestamp)?.textContent?.trim() ?? '',
      isInbound: element.matches(selectors.incoming) || Boolean(element.querySelector(selectors.incoming))
    })), { text: S.messageText, timestamp: S.messageTimestamp, incoming: S.messageIncoming });

    return raw
      .filter(item => item.text.length > 0)
      .slice(-limit)
      .map(item => rawMessageToMessage({
        conversationId: conversation.id,
        contact: conversation.contact,
        text: item.text,
        timestamp: item.timestamp,
        isInbound: item.isInbound
      }));
  }

  private contactMatches(row: VoiceConversationRow, requested?: string): boolean {
    if (!requested) return true;
    const normalizedRequested = normalizeGoogleVoiceContact(requested).toLowerCase();
    const normalizedRow = normalizeGoogleVoiceContact(row.contact).toLowerCase();
    return normalizedRow === normalizedRequested || normalizedRow.includes(normalizedRequested) || row.contact.toLowerCase().includes(requested.toLowerCase());
  }

  async send(recipient: string, body: string): Promise<SendResult> {
    return this.withPage(async page => {
      const compose = page.locator(S.newConversationButton).first();
      await compose.click({ timeout: 10_000 });

      const recipientInput = page.locator(S.recipientInput).first();
      await recipientInput.waitFor({ state: 'visible', timeout: 8_000 });
      await recipientInput.fill(recipient);

      const sendTo = page.locator(S.sendToLabel).first();
      if (await sendTo.isVisible({ timeout: 5_000 }).catch(() => false)) await sendTo.click();
      else await recipientInput.press('Enter');

      await page.keyboard.press('Escape').catch(() => undefined);
      const messageBox = page.locator(S.composeInput).first();
      await messageBox.waitFor({ state: 'visible', timeout: 8_000 });
      await messageBox.fill(body);

      const sendButton = page.locator(S.sendButton).first();
      await sendButton.click({ timeout: 8_000 });
      await page.waitForTimeout(800);

      return {
        status: 'unknown',
        detail: 'Google Voice UI accepted the send action. The consumer Google Voice web app does not expose a supported delivery receipt API, so final carrier delivery remains unverified.'
      };
    });
  }

  async readMessages(options: { contact?: string; limit: number; unreadOnly?: boolean }): Promise<Message[]> {
    return this.withPage(async page => {
      const conversations = (await this.conversationRows(page, Math.min(100, Math.max(options.limit, 20)), Boolean(options.unreadOnly)))
        .filter(row => this.contactMatches(row, options.contact));
      const messages: Message[] = [];

      for (const conversation of conversations) {
        const remaining = options.limit - messages.length;
        if (remaining <= 0) break;
        const thread = await this.readConversation(page, conversation, remaining);
        messages.push(...thread.slice(-remaining));
      }
      return messages.slice(0, options.limit);
    });
  }

  async listConversations(limit: number): Promise<Conversation[]> {
    return this.withPage(async page => {
      const rows = await this.conversationRows(page, limit);
      return rows.map(row => ({
        id: row.id,
        provider: this.name,
        participants: [normalizeGoogleVoiceContact(row.contact) || row.contact],
        lastMessageAt: row.timestamp || undefined
      }));
    });
  }

  async searchMessages(query: string, limit: number): Promise<Message[]> {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    return this.withPage(async page => {
      const conversations = await this.conversationRows(page, 100);
      const matches: Message[] = [];
      for (const conversation of conversations) {
        if (matches.length >= limit) break;
        const messages = await this.readConversation(page, conversation, 100);
        for (const message of messages) {
          if (message.body.toLowerCase().includes(needle) || message.sender.toLowerCase().includes(needle) || message.recipient.toLowerCase().includes(needle)) {
            matches.push(message);
            if (matches.length >= limit) break;
          }
        }
      }
      return matches;
    });
  }

  async getMessage(id: string): Promise<Message | null> {
    const decoded = decodeGoogleVoiceMessageId(id);
    if (!decoded) return null;
    return this.withPage(async page => {
      const conversations = await this.conversationRows(page, 100);
      const conversation = conversations.find(row => row.id === decoded.conversationId)
        ?? { id: decoded.conversationId, contact: decoded.conversationId.replace(/^t\./, ''), snippet: '', timestamp: '', unread: false };
      const messages = await this.readConversation(page, conversation, 100);
      return messages.find(message => message.id === id) ?? null;
    });
  }

  async replyToMessage(messageId: string, body: string): Promise<{ recipient: string; result: SendResult }> {
    const original = await this.getMessage(messageId);
    if (!original) throw new Error('Google Voice message not found');
    const recipient = original.direction === 'inbound' ? original.sender : original.recipient;
    const result = await this.withPage(async page => {
      const decoded = decodeGoogleVoiceMessageId(messageId);
      if (!decoded) throw new Error('Invalid Google Voice message id');
      await page.goto(`${VOICE_MESSAGES_URL}?itemId=${encodeURIComponent(decoded.conversationId)}`, { waitUntil: 'domcontentloaded', timeout: 20_000 });
      const messageBox = page.locator(S.composeInput).first();
      await messageBox.waitFor({ state: 'visible', timeout: 8_000 });
      await messageBox.fill(body);
      await page.locator(S.sendButton).first().click({ timeout: 8_000 });
      return { status: 'unknown' as const, detail: 'Reply submitted through the existing Google Voice conversation; final carrier delivery is not exposed by a supported API.' };
    });
    return { recipient, result };
  }
}
