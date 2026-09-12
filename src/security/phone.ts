export function normalizePhone(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error('Recipient is required');
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) throw new Error('Recipient must be a valid international phone number');
  if (!hasPlus) {
    if (digits.length === 10) return `+1${digits}`;
    throw new Error('Use E.164 format, for example +13125551234');
  }
  return `+${digits}`;
}
