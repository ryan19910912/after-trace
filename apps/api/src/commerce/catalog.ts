import { resolveProductConfig, type ProductConfigEnv } from '../config/product';

export type CommerceCatalogEnv = ProductConfigEnv & {
  SUBSCRIPTION_PRICE_TWD?: string;
  PAID_PACK_SMALL_PRICE_TWD?: string;
  PAID_PACK_MEDIUM_PRICE_TWD?: string;
  PAID_PACK_LARGE_PRICE_TWD?: string;
  COMMERCE_PROVIDER?: string;
};

export type CommerceCatalog = {
  provider: string | null;
  checkoutEnabled: boolean;
  subscription: null | {
    code: 'SUBSCRIPTION_V1';
    energyUnits: string;
    priceTwd: string | null;
  };
  paidPacks: Array<{
    code: 'SMALL' | 'MEDIUM' | 'LARGE';
    energyUnits: string;
    priceTwd: string | null;
  }>;
};

function optionalPrice(value: string | undefined): string | null {
  const normalized = value?.trim();
  if (!normalized) return null;
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized) || Number(normalized) <= 0) {
    throw new Error('configured TWD product price must be a positive decimal with at most 2 decimals');
  }
  return normalized;
}

/**
 * Checkout intentionally remains disabled until a concrete payment adapter is implemented.
 * Merely setting COMMERCE_PROVIDER must never create a fake/unsafe payment button.
 */
export function resolveCommerceCatalog(env: CommerceCatalogEnv): CommerceCatalog {
  const product = resolveProductConfig(env);
  const provider = env.COMMERCE_PROVIDER?.trim() || null;
  const subscription = product.energy.subscriptionCycleUnits === null
    ? null
    : {
        code: 'SUBSCRIPTION_V1' as const,
        energyUnits: product.energy.subscriptionCycleUnits.toString(),
        priceTwd: optionalPrice(env.SUBSCRIPTION_PRICE_TWD),
      };
  const prices = {
    SMALL: optionalPrice(env.PAID_PACK_SMALL_PRICE_TWD),
    MEDIUM: optionalPrice(env.PAID_PACK_MEDIUM_PRICE_TWD),
    LARGE: optionalPrice(env.PAID_PACK_LARGE_PRICE_TWD),
  };
  const paidPacks = (['SMALL', 'MEDIUM', 'LARGE'] as const).flatMap((code) => {
    const units = product.energy.paidPacks[code];
    return units === null ? [] : [{ code, energyUnits: units.toString(), priceTwd: prices[code] }];
  });
  return {
    provider,
    checkoutEnabled: false,
    subscription,
    paidPacks,
  };
}
