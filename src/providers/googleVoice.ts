import type { Conversation, Message, MessagingProvider, ProviderStatus, SendResult } from '../types.js';

export class GoogleVoiceAdapter implements MessagingProvider {
  readonly name = 'google_voice' as const;
  constructor(private readonly enabled: boolean, private readonly profileDir: string, private readonly headless: boolean) {}

  async status(): Promise<ProviderStatus> {
    if (!this.enabled) return { provider: this.name, available: false, readAvailable: false, sendAvailable: false, details: ['Disabled. Set GOOGLE_VOICE_ENABLED=true to opt in to experimental browser automation.'] };
    try {
      const { chromium } = await import('playwright');
      const browser = await chromium.launchPersistentContext(this.profileDir, { headless: this.headless });
      const page = browser.pages()[0] ?? await browser.newPage();
      await page.goto('https://voice.google.com/u/0/messages', { waitUntil: 'domcontentloaded', timeout: 20_000 });
      const loggedIn = !/accounts\.google\.com/.test(page.url());
      await browser.close();
      return { provider: this.name, available: loggedIn, readAvailable: loggedIn, sendAvailable: loggedIn, details: [loggedIn ? 'Authenticated browser profile detected.' : 'Google login required in the configured Playwright profile.', 'Unofficial UI automation; selectors may break when Google Voice changes.'] };
    } catch (error) {
      return { provider: this.name, available: false, readAvailable: false, sendAvailable: false, details: [(error as Error).message] };
    }
  }

  private async withPage<T>(fn: (page: import('playwright').Page) => Promise<T>): Promise<T> {
    if (!this.enabled) throw new Error('Google Voice adapter is disabled');
    const { chromium } = await import('playwright');
    const browser = await chromium.launchPersistentContext(this.profileDir, { headless: this.headless });
    try {
      const page = browser.pages()[0] ?? await browser.newPage();
      await page.goto('https://voice.google.com/u/0/messages', { waitUntil: 'domcontentloaded', timeout: 20_000 });
      if (/accounts\.google\.com/.test(page.url())) throw new Error('Google Voice login required');
      return await fn(page);
    } finally { await browser.close(); }
  }

  async send(recipient: string, body: string): Promise<SendResult> {
    return this.withPage(async page => {
      const newMessage = page.getByRole('button', { name: /send new message|new message/i }).first();
      await newMessage.click({ timeout: 10_000 });
      const recipientBox = page.getByRole('textbox').first();
      await recipientBox.fill(recipient);
      await page.keyboard.press('Enter');
      const boxes = page.getByRole('textbox');
      const count = await boxes.count();
      const messageBox = boxes.nth(Math.max(0, count - 1));
      await messageBox.fill(body);
      await page.keyboard.press('Enter');
      return { status: 'unknown', detail: 'UI action submitted; Google Voice does not provide a supported API receipt to this adapter.' };
    });
  }

  async readMessages(_options: { contact?: string; limit: number; unreadOnly?: boolean }): Promise<Message[]> {
    throw new Error('Google Voice read parsing is not verified yet; use get_provider_status before enabling this experimental adapter.');
  }
  async listConversations(_limit: number): Promise<Conversation[]> { throw new Error('Google Voice conversation parsing is not verified yet.'); }
  async searchMessages(_query: string, _limit: number): Promise<Message[]> { throw new Error('Google Voice search parsing is not verified yet.'); }
  async getMessage(_id: string): Promise<Message | null> { throw new Error('Google Voice message lookup is not verified yet.'); }
  async replyToMessage(_messageId: string, _body: string): Promise<{ recipient: string; result: SendResult }> { throw new Error('Google Voice reply parsing is not verified yet.'); }
}
