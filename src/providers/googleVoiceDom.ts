import crypto from 'node:crypto';
import type { Message } from '../types.js';

export interface RawGoogleVoiceMessage {
  conversationId: string;
  contact: string;
  text: string;
  timestamp: string;
  isInbound: boolean;
}

export const GOOGLE_VOICE_SELECTORS = {
  loggedInIndicator: '[gv-test-id="sidenav-messages"], [aria-label="Send new message"], gv-thread-list-item',
  conversationItem: 'gv-thread-list-item',
  conversationClickable: '.container',
  conversationContact: 'gv-annotation.participants',
  conversationSnippet: 'gv-annotation.preview',
  conversationTimestamp: '.timestamp',
  conversationReadClass: 'read',
  messageBubble: 'gv-text-message-item',
  messageText: '.subject-content-container.bubble',
  messageTimestamp: '.sender-timestamp .timestamp',
  messageIncoming: '.incoming',
  composeInput: 'textarea[placeholder="Type a message"], input[placeholder="Type a message"]',
  sendButton: 'button[aria-label="Send message"]',
  newConversationButton: '[aria-label="Send new message"]',
  recipientInput: 'input[placeholder="Type a name or phone number"]',
  sendToLabel: '.send-to-label'
} as const;

export function googleVoiceCdpEndpoints(env: Record<string, string | undefined> = process.env): string[] {
  const configured = env.GOOGLE_VOICE_CDP_URL?.trim();
  if (configured) return [configured];
  return ['http://[::1]:9222', 'http://127.0.0.1:9222'];
}

export function normalizeGoogleVoiceContact(value: string): string {
  const trimmed = value.replace(/\s+/g, ' ').trim();
  const phoneLike = trimmed.match(/\+?\d[\d\s().-]{6,}\d/);
  if (!phoneLike) return trimmed;

  const raw = phoneLike[0];
  const digits = raw.replace(/\D/g, '');
  if (!digits) return trimmed;
  if (raw.trim().startsWith('+')) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return digits;
}

export function buildGoogleVoiceMessageId(
  conversationId: string,
  direction: 'inbound' | 'outbound',
  timestamp: string,
  text: string
): string {
  const encodedConversation = Buffer.from(conversationId, 'utf8').toString('base64url');
  const digest = crypto
    .createHash('sha256')
    .update([conversationId, direction, timestamp, text].join('\u001f'))
    .digest('hex')
    .slice(0, 20);
  return `gv:${encodedConversation}:${digest}`;
}

export function decodeGoogleVoiceMessageId(id: string): { conversationId: string } | null {
  const match = /^gv:([^:]+):[a-f0-9]{20}$/.exec(id);
  if (!match) return null;
  try {
    return { conversationId: Buffer.from(match[1], 'base64url').toString('utf8') };
  } catch {
    return null;
  }
}

export function rawMessageToMessage(raw: RawGoogleVoiceMessage): Message {
  const contact = normalizeGoogleVoiceContact(raw.contact) || raw.contact.trim() || 'unknown';
  const direction = raw.isInbound ? 'inbound' : 'outbound';
  return {
    id: buildGoogleVoiceMessageId(raw.conversationId, direction, raw.timestamp, raw.text),
    provider: 'google_voice',
    threadId: raw.conversationId,
    sender: raw.isInbound ? contact : 'me',
    recipient: raw.isInbound ? 'me' : contact,
    body: raw.text.trim(),
    timestamp: raw.timestamp.trim(),
    direction,
    status: raw.isInbound ? 'received' : 'sent'
  };
}
