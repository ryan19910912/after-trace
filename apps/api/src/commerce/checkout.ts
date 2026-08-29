import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { resolveCommerceCatalog, type CommerceCatalogEnv } from './catalog';

export type CommerceProductCode = 'SUBSCRIPTION_V1' | 'PAID_SMALL' | 'PAID_MEDIUM' | 'PAID_LARGE';

export type CheckoutEnv = CommerceCatalogEnv & {
  COMMERCE_CHECKOUT_CREATE_URL?: string;
  COMMERCE_ADAPTER_SECRET?: string;
  COMMERCE_RETURN_URL?: string;
};

export type CheckoutResult =
  | {
      status: 'READY' | 'ALREADY_READY';
      checkoutUrl: string;
      provider: string;
      providerCheckoutId: string;
      expiresAt: string | null;
    }
  | { status: 'USER_NOT_FOUND' | 'PRODUCT_NOT_CONFIGURED' | 'CHECKOUT_NOT_CONFIGURED' }
  | { status: 'REFERENCE_CONFLICT' | 'PROVIDER_UNAVAILABLE' };

type IntentState = {
  id: number;
  userId: number;
  state: string;
  provider: string | null;
  providerCheckoutId: string | null;
};

type BeginIntentResult =
  | { status: 'READY'; intent: IntentState }
  | { status: 'USER_NOT_FOUND' | 'REFERENCE_CONFLICT' };

export class DrizzleCheckoutIntentRepository {
  constructor(private readonly db: Database) {}

  async begin(input: {
    lineUserId: string;
    requestKey: string;
    productCode: CommerceProductCode;
    at: Date;
  }): Promise<BeginIntentResult> {
    const result = await this.db.execute(sql`
      WITH target_user AS (
        SELECT id FROM line_users WHERE line_user_id = ${input.lineUserId} LIMIT 1
      ), existing AS MATERIALIZED (
        SELECT intent.*
        FROM user_checkout_intents intent
        JOIN target_user u ON u.id = intent.user_id
        WHERE intent.request_key = ${input.requestKey}
        LIMIT 1
      ), inserted AS (
        INSERT INTO user_checkout_intents (
          user_id, request_key, product_code, status, created_at, updated_at
        )
        SELECT id, ${input.requestKey}, ${input.productCode}, 'PENDING_PROVIDER', ${input.at}, ${input.at}
        FROM target_user
        WHERE NOT EXISTS (SELECT 1 FROM existing)
        ON CONFLICT DO NOTHING
        RETURNING *
      ), selected AS (
        SELECT * FROM existing
        UNION ALL
        SELECT * FROM inserted
      )
      SELECT
        CASE
          WHEN NOT EXISTS (SELECT 1 FROM target_user) THEN 'USER_NOT_FOUND'
          WHEN EXISTS (SELECT 1 FROM existing WHERE product_code <> ${input.productCode}) THEN 'REFERENCE_CONFLICT'
          ELSE 'OK'
        END AS result_status,
        selected.id::text AS id,
        selected.user_id::text AS user_id,
        selected.status AS intent_status,
        selected.provider,
        selected.provider_checkout_id
      FROM selected
      RIGHT JOIN (SELECT 1) AS one ON TRUE
      LIMIT 1
    `);
    const row = result.rows[0] as {
      result_status?: string;
      id?: string | null;
      user_id?: string | null;
      intent_status?: string | null;
      provider?: string | null;
      provider_checkout_id?: string | null;
    } | undefined;
    if (row?.result_status === 'USER_NOT_FOUND') return { status: 'USER_NOT_FOUND' };
    if (row?.result_status === 'REFERENCE_CONFLICT') return { status: 'REFERENCE_CONFLICT' };
    if (!row?.id || !row.user_id || !row.intent_status) {
      throw new Error('checkout intent persistence returned no intent');
    }
    return {
      status: 'READY',
      intent: {
        id: Number(row.id),
        userId: Number(row.user_id),
        state: row.intent_status,
        provider: row.provider ?? null,
        providerCheckoutId: row.provider_checkout_id ?? null,
      },
    };
  }

  async attach(input: {
    intentId: number;
    provider: string;
    providerCheckoutId: string;
    at: Date;
  }): Promise<'ATTACHED' | 'ALREADY_ATTACHED' | 'REFERENCE_CONFLICT'> {
    const result = await this.db.execute(sql`
      WITH locked AS MATERIALIZED (
        SELECT * FROM user_checkout_intents WHERE id = ${input.intentId} FOR UPDATE
      ), updated AS (
        UPDATE user_checkout_intents intent
        SET provider = ${input.provider},
            provider_checkout_id = ${input.providerCheckoutId},
            status = 'READY',
            updated_at = ${input.at}
        FROM locked
        WHERE intent.id = locked.id
          AND locked.provider IS NULL
          AND locked.provider_checkout_id IS NULL
        RETURNING intent.id
      )
      SELECT CASE
        WHEN EXISTS (SELECT 1 FROM updated) THEN 'ATTACHED'
        WHEN EXISTS (
          SELECT 1 FROM locked
          WHERE provider = ${input.provider}
            AND provider_checkout_id = ${input.providerCheckoutId}
            AND status = 'READY'
        ) THEN 'ALREADY_ATTACHED'
        ELSE 'REFERENCE_CONFLICT'
      END AS status
    `);
    return String((result.rows[0] as { status?: string } | undefined)?.status ?? 'REFERENCE_CONFLICT') as
      | 'ATTACHED'
      | 'ALREADY_ATTACHED'
      | 'REFERENCE_CONFLICT';
  }
}

export type ProviderCheckoutSession = {
  providerCheckoutId: string;
  checkoutUrl: string;
  expiresAt: string | null;
};

export interface CommerceCheckoutProvider {
  readonly provider: string;
  create(input: {
    requestKey: string;
    lineUserId: string;
    productCode: CommerceProductCode;
    returnUrl: string;
  }): Promise<ProviderCheckoutSession>;
}

export class HttpCommerceCheckoutProvider implements CommerceCheckoutProvider {
  readonly provider: string;
  private readonly endpoint: string;
  private readonly secret: string;

  constructor(input: { provider: string; endpoint: string; secret: string }) {
    this.provider = required(input.provider, 'COMMERCE_PROVIDER', 32);
    this.endpoint = absoluteHttpsUrl(input.endpoint, 'COMMERCE_CHECKOUT_CREATE_URL');
    this.secret = required(input.secret, 'COMMERCE_ADAPTER_SECRET', 512);
  }

  async create(input: {
    requestKey: string;
    lineUserId: string;
    productCode: CommerceProductCode;
    returnUrl: string;
  }): Promise<ProviderCheckoutSession> {
    let response: Response;
    try {
      response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-aftertrace-adapter-secret': this.secret,
        },
        body: JSON.stringify({
          requestKey: input.requestKey,
          lineUserId: input.lineUserId,
          productCode: input.productCode,
          returnUrl: input.returnUrl,
        }),
      });
    } catch {
      throw new Error('COMMERCE_PROVIDER_UNAVAILABLE');
    }
    if (!response.ok) throw new Error(`COMMERCE_PROVIDER_HTTP_${response.status}`);
    const body = await response.json() as Record<string, unknown>;
    const providerCheckoutId = requiredString(body.providerCheckoutId, 'providerCheckoutId', 160);
    const checkoutUrl = absoluteHttpsUrl(requiredString(body.checkoutUrl, 'checkoutUrl', 2048), 'checkoutUrl');
    const expiresAt = body.expiresAt == null ? null : requiredString(body.expiresAt, 'expiresAt', 64);
    if (expiresAt !== null && Number.isNaN(new Date(expiresAt).getTime())) {
      throw new Error('provider expiresAt must be a valid date');
    }
    return { providerCheckoutId, checkoutUrl, expiresAt };
  }
}

export class CommerceCheckoutService {
  constructor(
    private readonly repository: DrizzleCheckoutIntentRepository,
    private readonly provider: CommerceCheckoutProvider,
    private readonly returnUrl: string,
    private readonly catalogEnv: CommerceCatalogEnv,
  ) {}

  async create(input: {
    lineUserId: string;
    requestKey: string;
    productCode: CommerceProductCode;
    at?: Date;
  }): Promise<CheckoutResult> {
    const at = input.at ?? new Date();
    const lineUserId = required(input.lineUserId, 'lineUserId', 64);
    const requestKey = required(input.requestKey, 'requestKey', 128);
    const productCode = input.productCode;
    if (!productConfigured(resolveCommerceCatalog(this.catalogEnv), productCode)) {
      return { status: 'PRODUCT_NOT_CONFIGURED' };
    }

    const begun = await this.repository.begin({ lineUserId, requestKey, productCode, at });
    if (begun.status !== 'READY') return begun;
    const intent = begun.intent;

    // Provider adapters must use requestKey as their own idempotency key. If AFTERTRACE
    // retries after an uncertain network response, the adapter must return the same checkout.
    let session: ProviderCheckoutSession;
    try {
      session = await this.provider.create({
        requestKey,
        lineUserId,
        productCode,
        returnUrl: this.returnUrl,
      });
    } catch {
      return { status: 'PROVIDER_UNAVAILABLE' };
    }

    const attached = await this.repository.attach({
      intentId: intent.id,
      provider: this.provider.provider,
      providerCheckoutId: session.providerCheckoutId,
      at: new Date(),
    });
    if (attached === 'REFERENCE_CONFLICT') return { status: 'REFERENCE_CONFLICT' };
    return {
      status: attached === 'ATTACHED' ? 'READY' : 'ALREADY_READY',
      checkoutUrl: session.checkoutUrl,
      provider: this.provider.provider,
      providerCheckoutId: session.providerCheckoutId,
      expiresAt: session.expiresAt,
    };
  }
}

export function createCheckoutService(database: Database, env: CheckoutEnv): CommerceCheckoutService | null {
  const provider = env.COMMERCE_PROVIDER?.trim();
  const endpoint = env.COMMERCE_CHECKOUT_CREATE_URL?.trim();
  const secret = env.COMMERCE_ADAPTER_SECRET?.trim();
  const returnUrl = env.COMMERCE_RETURN_URL?.trim();
  if (!provider || !endpoint || !secret || !returnUrl) return null;
  return new CommerceCheckoutService(
    new DrizzleCheckoutIntentRepository(database),
    new HttpCommerceCheckoutProvider({ provider, endpoint, secret }),
    absoluteHttpsUrl(returnUrl, 'COMMERCE_RETURN_URL'),
    env,
  );
}

export function checkoutConfigured(env: CheckoutEnv): boolean {
  return Boolean(
    env.COMMERCE_PROVIDER?.trim()
      && env.COMMERCE_CHECKOUT_CREATE_URL?.trim()
      && env.COMMERCE_ADAPTER_SECRET?.trim()
      && env.COMMERCE_RETURN_URL?.trim(),
  );
}

function productConfigured(catalog: ReturnType<typeof resolveCommerceCatalog>, code: CommerceProductCode): boolean {
  if (code === 'SUBSCRIPTION_V1') {
    return catalog.subscription !== null && catalog.subscription.priceTwd !== null;
  }
  const pack = code.replace('PAID_', '') as 'SMALL' | 'MEDIUM' | 'LARGE';
  const item = catalog.paidPacks.find((candidate) => candidate.code === pack);
  return Boolean(item?.priceTwd);
}

function required(value: string, field: string, maxLength: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new Error(`${field} must contain 1-${maxLength} characters`);
  }
  return normalized;
}

function requiredString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string') throw new Error(`${field} must be a string`);
  return required(value, field, maxLength);
}

function absoluteHttpsUrl(value: string, field: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${field} must be an absolute URL`);
  }
  if (url.protocol !== 'https:') throw new Error(`${field} must use https`);
  return url.toString();
}
