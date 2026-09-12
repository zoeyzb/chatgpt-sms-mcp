import { describe, expect, it } from 'vitest';
import { normalizePhone } from '../src/security/phone.js';

describe('normalizePhone', () => {
  it('normalizes a 10-digit US number', () => expect(normalizePhone('(312) 555-1234')).toBe('+13125551234'));
  it('preserves international E.164', () => expect(normalizePhone('+92 300 1234567')).toBe('+923001234567'));
  it('rejects ambiguous non-US numbers without plus', () => expect(() => normalizePhone('923001234567')).toThrow(/E\.164/));
  it('rejects too-short numbers', () => expect(() => normalizePhone('123')).toThrow(/valid international/));
});
