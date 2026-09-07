export type LoginProviderAvailability = {
  google: boolean;
  line: boolean;
  apple: boolean;
};

export const LOGIN_PROVIDER_FALLBACK: LoginProviderAvailability = {
  google: true,
  line: true,
  apple: false,
};

export async function fetchLoginProviderAvailability(
  apiBaseUrl: string,
  fetchFn: typeof fetch = fetch,
): Promise<LoginProviderAvailability> {
  const response = await fetchFn(`${apiBaseUrl.replace(/\/$/, '')}/api/v1/auth/providers`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`LOGIN_PROVIDER_AVAILABILITY_FAILED (${response.status})`);

  const body = await response.json() as { providers?: unknown };
  if (!body.providers || typeof body.providers !== 'object' || Array.isArray(body.providers)) {
    throw new Error('LOGIN_PROVIDER_AVAILABILITY_INVALID');
  }
  const providers = body.providers as Record<string, unknown>;
  return {
    google: providers.google === true,
    line: providers.line === true,
    apple: providers.apple === true,
  };
}
