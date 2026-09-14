import { describe, expect, test } from 'vitest';
import {
  buildGoogleVoiceMessageId,
  decodeGoogleVoiceMessageId,
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
});
