import { describe, expect, test } from 'vitest';
import {
  buildGoogleVoiceMessageId,
  decodeGoogleVoiceMessageId,
  googleVoiceCdpEndpoints,
  GOOGLE_VOICE_SELECTORS,
  normalizeGoogleVoiceContact,
  rawMessageToMessage
} from '../src/providers/googleVoiceDom.js';

describe('Google Voice DOM mapping', () => {
  test('normalizes a phone contact without losing E.164 identity', () => {
    expect(normalizeGoogleVoiceContact('+1 (312) 555-0199')).toBe('+13125550199');
    expect(normalizeGoogleVoiceContact('Alex Smith')).toBe('Alex Smith');
  });

  test('builds deterministic provider message ids that can recover the conversation id', () => {
    const id = buildGoogleVoiceMessageId('t.+13125550199', 'inbound', 'Sep 14, 5:30 PM', 'hello');
    expect(buildGoogleVoiceMessageId('t.+13125550199', 'inbound', 'Sep 14, 5:30 PM', 'hello')).toBe(id);
    expect(decodeGoogleVoiceMessageId(id)?.conversationId).toBe('t.+13125550199');
  });

  test('maps an inbound Google Voice bubble into the shared Message shape', () => {
    const message = rawMessageToMessage({
      conversationId: 't.+13125550199',
      contact: '+1 (312) 555-0199',
      text: 'Are you still open?',
      timestamp: 'Sep 14, 5:30 PM',
      isInbound: true
    });

    expect(message.provider).toBe('google_voice');
    expect(message.direction).toBe('inbound');
    expect(message.sender).toBe('+13125550199');
    expect(message.recipient).toBe('me');
    expect(message.threadId).toBe('t.+13125550199');
    expect(message.body).toBe('Are you still open?');
  });

  test('prefers the IPv6 Chrome DevTools endpoint and allows an explicit override', () => {
    expect(googleVoiceCdpEndpoints({})).toEqual([
      'http://[::1]:9222',
      'http://127.0.0.1:9222'
    ]);
    expect(googleVoiceCdpEndpoints({ GOOGLE_VOICE_CDP_URL: 'http://localhost:9333' })).toEqual([
      'http://localhost:9333'
    ]);
  });

  test('treats the current thread list and compose button as authenticated UI signals', () => {
    expect(GOOGLE_VOICE_SELECTORS.loggedInIndicator).toContain('gv-thread-list-item');
    expect(GOOGLE_VOICE_SELECTORS.loggedInIndicator).toContain('Send new message');
  });
});
