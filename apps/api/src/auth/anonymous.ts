import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/client';
import { users } from '../db/schema';

const ANONYMOUS_AUTH_PROVIDER = 'ANONYMOUS';
const TOKEN_PREFIX = 'atr_anon_v1_';
const TOKEN_PATTERN = /^atr_anon_v1_[A-Za-z0-9_-]{40,80}$/;

export type AnonymousIdentity = {
  userId: number;
  token: string;
};

export function parseBearerToken(value: string | undefined | null): string | null {
  if (!value) return null;
  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  if (!match) return null;
  const token = match[1]?.trim() ?? '';
  return token.length > 0 ? token : null;
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function createToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `${TOKEN_PREFIX}${encodeBase64Url(bytes)}`;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export class AnonymousIdentityService {
  constructor(private readonly database: Database) {}

  async issue(): Promise<AnonymousIdentity> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const token = createToken();
      const authSubject = await sha256Hex(token);
      const [created] = await this.database
        .insert(users)
        .values({ authProvider: ANONYMOUS_AUTH_PROVIDER, authSubject })
        .onConflictDoNothing({ target: [users.authProvider, users.authSubject] })
        .returning({ id: users.id });
      if (created) return { userId: created.id, token };
    }
    throw new Error('Unable to allocate anonymous identity');
  }

  async resolve(token: string): Promise<number | null> {
    if (!TOKEN_PATTERN.test(token)) return null;
    const authSubject = await sha256Hex(token);
    const [user] = await this.database
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.authProvider, ANONYMOUS_AUTH_PROVIDER), eq(users.authSubject, authSubject)))
      .limit(1);
    return user?.id ?? null;
  }
}
