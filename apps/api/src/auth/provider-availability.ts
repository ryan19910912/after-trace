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
 * All login providers require the shared AFTERTRACE auth/session boundary and Web return URL.
 */
export function loginProviderAvailability(
  env: LoginProviderAvailabilityBindings,
): LoginProviderAvailability {
  const sharedReady = validAuthSecret(env.WEB_AUTH_SECRET) && Boolean(text(env.WEB_APP_URL));
  if (!sharedReady) return { google: false, line: false, apple: false };

  return {
    google: Boolean(text(env.GOOGLE_LOGIN_CLIENT_ID) && text(env.GOOGLE_LOGIN_CLIENT_SECRET)),
    line: Boolean(text(env.LINE_LOGIN_CHANNEL_ID) && text(env.LINE_LOGIN_CHANNEL_SECRET)),
    apple: Boolean(
      text(env.APPLE_LOGIN_CLIENT_ID)
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
