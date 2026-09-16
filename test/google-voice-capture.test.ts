import fs from 'node:fs';
import { describe, expect, test } from 'vitest';

describe('Google Voice conversation id capture', () => {
  test('does not inject a tsx-transformed page.evaluate callback into Google Voice', () => {
    const source = fs.readFileSync(new URL('../src/providers/googleVoice.ts', import.meta.url), 'utf8');
    const start = source.indexOf('private async captureConversationId');
    const end = source.indexOf('private async conversationRows', start);
    const capture = source.slice(start, end);

    expect(capture).not.toContain('page.evaluate');
    expect(capture).toContain('waitForURL');
  });
});
