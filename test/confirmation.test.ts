import { describe, expect, it } from 'vitest';
import { ConfirmationStore } from '../src/security/confirmation.js';

describe('ConfirmationStore', () => {
  it('consumes a matching token once', () => {
    const store = new ConfirmationStore(1000, () => 100);
    const { token } = store.issue('abc');
    expect(store.consume(token, 'abc')).toBe(true);
    expect(store.consume(token, 'abc')).toBe(false);
  });
  it('rejects expired tokens', () => {
    let now = 100;
    const store = new ConfirmationStore(10, () => now);
    const { token } = store.issue('abc');
    now = 111;
    expect(store.consume(token, 'abc')).toBe(false);
  });
});
