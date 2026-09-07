const PUBLIC_ACCOUNT_ID_PREFIX = 'AT-';
const PUBLIC_ACCOUNT_ID_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const PUBLIC_ACCOUNT_ID_LENGTH = 12;

/**
 * Generates a customer-facing AFTERTRACE account id.
 *
 * The id is intentionally opaque and non-sequential. It is not a secret, but it must not
 * leak the internal database id or a provider identity. Database uniqueness is the final
 * collision boundary; provisioning retries with a fresh candidate on a rare conflict.
 */
export function createPublicAccountId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(PUBLIC_ACCOUNT_ID_LENGTH));
  let suffix = '';
  for (const byte of bytes) {
    suffix += PUBLIC_ACCOUNT_ID_ALPHABET[byte % PUBLIC_ACCOUNT_ID_ALPHABET.length];
  }
  return `${PUBLIC_ACCOUNT_ID_PREFIX}${suffix}`;
}

export function isPublicAccountId(value: string): boolean {
  const normalized = value.trim().toUpperCase();
  return /^AT-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{12}$/.test(normalized);
}
