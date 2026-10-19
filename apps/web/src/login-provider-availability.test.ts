import { describe, expect, it, vi } from 'vitest';
import {
  fetchLoginProviderAvailability,
  LOGIN_PROVIDER_FALLBACK,
} from './login-provider-availability';

describe('Web login provider availability', () => {
  it('keeps optional Apple hidden in the network fallback', () => {
    expect(LOGIN_PROVIDER_FALLBACK).toEqual({ google: true, line: true, apple: false });
  });

  it('maps only explicit true values from the API response', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      providers: { google: true, line: true, apple: false },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    await expect(fetchLoginProviderAvailability('https://api.example.test/', fetchFn)).resolves.toEqual({
      google: true,
      line: true,
      apple: false,
    });
    expect(fetchFn).toHaveBeenCalledWith('https://api.example.test/api/v1/auth/providers', expect.objectContaining({
      method: 'GET',
    }));
  });

  it('rejects malformed provider responses rather than exposing optional providers', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify({ providers: null }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    await expect(fetchLoginProviderAvailability('https://api.example.test', fetchFn)).rejects.toThrow(
      'LOGIN_PROVIDER_AVAILABILITY_INVALID',
    );
  });
});
