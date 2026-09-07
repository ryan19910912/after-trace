import { AppleLoginError, type AppleUserSnapshot } from './apple-login';

/**
 * Apple only sends the optional `user` form field on the first authorization grant.
 * Treat it as bounded profile metadata, never as account identity or an account-merge key.
 */
export function parseAppleUserSnapshot(raw: string | null | undefined): AppleUserSnapshot {
  if (!raw?.trim()) return { emailSnapshot: null, displayNameSnapshot: null };
  if (raw.length > 8_192) {
    throw new AppleLoginError('APPLE_USER_PAYLOAD_INVALID', 'Apple user payload is too large');
  }

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new AppleLoginError('APPLE_USER_PAYLOAD_INVALID', 'Apple user payload is not valid JSON');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AppleLoginError('APPLE_USER_PAYLOAD_INVALID', 'Apple user payload is invalid');
  }

  const record = value as Record<string, unknown>;
  const emailSnapshot = optionalSnapshot(record.email, 320);
  const nameValue = record.name;
  let displayNameSnapshot: string | null = null;
  if (nameValue && typeof nameValue === 'object' && !Array.isArray(nameValue)) {
    const name = nameValue as Record<string, unknown>;
    const firstName = optionalSnapshot(name.firstName, 120);
    const lastName = optionalSnapshot(name.lastName, 120);
    displayNameSnapshot = optionalSnapshot(
      [firstName, lastName].filter((item): item is string => Boolean(item)).join(' '),
      255,
    );
  }
  return { emailSnapshot, displayNameSnapshot };
}

function optionalSnapshot(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
  return normalized || null;
}
