import { createPublicAccountId } from './public-account-id';

export type WorklogAuthProvider = 'GOOGLE' | 'LINE' | 'APPLE';

export type AccountProfile = {
  userId: number;
  displayName: string | null;
  publicAccountId: string;
};

export type ProvisionAccountIdentityInput = {
  provider: WorklogAuthProvider;
  subject: string;
  emailSnapshot?: string | null;
  displayNameSnapshot?: string | null;
  at?: Date;
};

export type AccountIdentityRepository = {
  provision(input: ProvisionAccountIdentityInput & { publicAccountId: string; at: Date }): Promise<AccountProfile>;
  profile(userId: number): Promise<AccountProfile | null>;
};

export class AccountIdentityService {
  constructor(
    private readonly repository: AccountIdentityRepository,
    private readonly publicAccountIdFactory: () => string = createPublicAccountId,
  ) {}

  async provision(input: ProvisionAccountIdentityInput): Promise<AccountProfile> {
    const at = input.at ?? new Date();
    let lastCollision: unknown = null;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        return await this.repository.provision({
          ...input,
          at,
          publicAccountId: this.publicAccountIdFactory(),
        });
      } catch (error) {
        if (!isPublicAccountIdCollision(error)) throw error;
        lastCollision = error;
      }
    }
    throw new Error('PUBLIC_ACCOUNT_ID_GENERATION_EXHAUSTED', { cause: lastCollision });
  }

  profile(userId: number): Promise<AccountProfile | null> {
    return this.repository.profile(userId);
  }
}

function isPublicAccountIdCollision(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth += 1) {
    const value = current as { code?: unknown; constraint?: unknown; message?: unknown; cause?: unknown };
    if (
      value.code === '23505'
      && (
        value.constraint === 'worklog_user_public_account_id_uq'
        || (typeof value.message === 'string' && value.message.includes('worklog_user_public_account_id_uq'))
      )
    ) {
      return true;
    }
    current = value.cause;
  }
  return false;
}
