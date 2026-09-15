import { describe, expect, it } from 'vitest';
import { buildAlterStatusRequest, buildPeriodicCheckout } from './newebpay-periodic';

const config = {
  merchantId: 'TESTMERCHANT',
  hashKey: '12345678901234567890123456789012',
  hashIv: '1234567890123456',
  version: '1.5',
  mode: 'TEST' as const,
  periodTimes: 12,
  notifyUrl: 'https://example.com/notify',
  returnUrl: 'https://example.com/subscription',
};

describe('NewebPay periodic API version contracts', () => {
  it('uses configured version and plan-driven amount for periodic checkout', async () => {
    const request = await buildPeriodicCheckout({
      config,
      merchantOrderNo: 'ORDER_20260908',
      payerEmail: 'payer@example.com',
      productDescription: 'AFTERTRACE AI Pro Plus',
      amountTwd: 199,
      now: new Date('2026-09-08T00:00:00.000Z'),
    });
    const params = new URLSearchParams(await decryptHex(request.fields.PostData_, config.hashKey, config.hashIv));
    expect(params.get('Version')).toBe('1.5');
    expect(params.get('PeriodAmt')).toBe('199');
    expect(params.get('ProdDesc')).toBe('AFTERTRACE AI Pro Plus');
  });

  it('uses AlterStatus API version 1.0 independently from checkout version', async () => {
    const request = await buildAlterStatusRequest({
      config,
      merchantOrderNo: 'ORDER_20260908',
      periodNo: 'PERIOD123',
      alterType: 'terminate',
      now: new Date('2026-09-08T00:00:00.000Z'),
    });
    const params = new URLSearchParams(await decryptHex(request.fields.PostData_, config.hashKey, config.hashIv));
    expect(params.get('Version')).toBe('1.0');
    expect(params.get('AlterType')).toBe('terminate');
  });
});

async function decryptHex(cipherHex: string, hashKey: string, hashIv: string): Promise<string> {
  const encoder = new TextEncoder();
  const bytes = new Uint8Array(cipherHex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(cipherHex.slice(index * 2, index * 2 + 2), 16);
  }
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(hashKey),
    { name: 'AES-CBC' },
    false,
    ['decrypt'],
  );
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-CBC', iv: encoder.encode(hashIv) },
    key,
    bytes,
  );
  return new TextDecoder().decode(plain);
}
