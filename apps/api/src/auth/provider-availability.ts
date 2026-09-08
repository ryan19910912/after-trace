export type LoginProviderAvailabilityBindings = {
  WEB_AUTH_SECRET?: string;
  WEB_APP_URL?: string;
  LINE_LOGIN_CHANNEL_ID?: string;
  LINE_LOGIN_CHANNEL_SECRET?: string;
  GOOGLE_LOGIN_CLIENT_ID?: string;
  GOOGLE_LOGIN_CLIENT_SECRET?: string;
  APPLE_LOGIN_CLIENT_ID?: string;
  APPLE_LOGIN_TEAM_ID?: string;
  APPLE_LOGIN_KEY_ID?: string;
  APPLE_LOGIN_PRIVATE_KEY_P8_BASE64?: string;
};

export type LoginProviderAvailability = {
  google: boolean;
  line: boolean;
  apple: boolean;
};

/**
 * Customer-safe availability only. Never return provider ids/secrets/config values.
 * All login providers require the shared AFTERTRACE auth/session boundary and a valid
 * absolute Web return URL. Apple additionally requires HTTPS because its callback flow
 * cannot use an insecure redirect URI.
 */
export function loginProviderAvailability(
  env: LoginProviderAvailabilityBindings,
): LoginProviderAvailability {
  const webAppUrl = absoluteWebUrl(env.WEB_APP_URL);
  const sharedReady = validAuthSecret(env.WEB_AUTH_SECRET) && Boolean(webAppUrl);
  if (!sharedReady) return { google: false, line: false, apple: false };

  return {
    google: Boolean(text(env.GOOGLE_LOGIN_CLIENT_ID) && text(env.GOOGLE_LOGIN_CLIENT_SECRET)),
    line: Boolean(text(env.LINE_LOGIN_CHANNEL_ID) && text(env.LINE_LOGIN_CHANNEL_SECRET)),
    apple: Boolean(
      webAppUrl?.protocol === 'https:'
      && text(env.APPLE_LOGIN_CLIENT_ID)
      && text(env.APPLE_LOGIN_TEAM_ID)
      && text(env.APPLE_LOGIN_KEY_ID)
      && text(env.APPLE_LOGIN_PRIVATE_KEY_P8_BASE64),
    ),
  };
}

function validAuthSecret(value: string | undefined): boolean {
  return Boolean(value?.trim() && value.trim().length >= 32);
}

function text(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized || null;
}

function absoluteWebUrl(value: string | undefined): URL | null {
  const normalized = text(value);
  if (!normalized) return null;
  try {
    const url = new URL(normalized);
    if (!['http:', 'https:'].includes(url.protocol) || !url.host || url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}
