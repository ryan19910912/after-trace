const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type NewebPayPeriodicConfig = {
  merchantId: string;
  hashKey: string;
  hashIv: string;
  version: string;
  mode: 'TEST' | 'PROD';
  periodTimes: number;
  notifyUrl: string;
  returnUrl: string;
};

export type NewebPayCheckoutForm = {
  action: string;
  fields: { MerchantID_: string; PostData_: string };
  merchantOrderNo: string;
};

export type NewebPayPeriodicResult = {
  status: string;
  message: string | null;
  result: Record<string, unknown>;
};

export function periodicEndpoint(config: Pick<NewebPayPeriodicConfig, 'mode'>): string {
  return config.mode === 'TEST'
    ? 'https://ccore.newebpay.com/MPG/period'
    : 'https://core.newebpay.com/MPG/period';
}

export function alterStatusEndpoint(config: Pick<NewebPayPeriodicConfig, 'mode'>): string {
  return config.mode === 'TEST'
    ? 'https://ccore.newebpay.com/MPG/period/AlterStatus'
    : 'https://core.newebpay.com/MPG/period/AlterStatus';
}

export async function buildPeriodicCheckout(input: {
  config: NewebPayPeriodicConfig;
  merchantOrderNo: string;
  payerEmail: string;
  now?: Date;
}): Promise<NewebPayCheckoutForm> {
  const config = validateConfig(input.config);
  const now = validDate(input.now ?? new Date());
  const merchantOrderNo = orderNo(input.merchantOrderNo);
  const payerEmail = email(input.payerEmail);
  const day = taipeiParts(now).day.toString().padStart(2, '0');
  const inner = new URLSearchParams({
    RespondType: 'JSON',
    TimeStamp: String(Math.floor(now.getTime() / 1000)),
    Version: config.version,
    LangType: 'zh-Tw',
    MerOrderNo: merchantOrderNo,
    ProdDesc: 'AFTERTRACE AI Pro',
    PeriodAmt: '99',
    PeriodType: 'M',
    PeriodPoint: day,
    PeriodStartType: '2',
    PeriodTimes: String(config.periodTimes),
    PayerEmail: payerEmail,
    PaymentInfo: 'Y',
    OrderInfo: 'N',
    EmailModify: '1',
    NotifyURL: config.notifyUrl,
    ReturnURL: config.returnUrl,
  });
  return {
    action: periodicEndpoint(config),
    fields: {
      MerchantID_: config.merchantId,
      PostData_: await aesEncryptHex(inner.toString(), config.hashKey, config.hashIv),
    },
    merchantOrderNo,
  };
}

export async function buildAlterStatusRequest(input: {
  config: NewebPayPeriodicConfig;
  merchantOrderNo: string;
  periodNo: string;
  alterType: 'terminate' | 'suspend' | 'restart';
  now?: Date;
}): Promise<{ action: string; fields: { MerchantID_: string; PostData_: string } }> {
  const config = validateConfig(input.config);
  const now = validDate(input.now ?? new Date());
  const inner = new URLSearchParams({
    RespondType: 'JSON',
    Version: config.version,
    TimeStamp: String(Math.floor(now.getTime() / 1000)),
    MerOrderNo: orderNo(input.merchantOrderNo),
    PeriodNo: periodNoValue(input.periodNo),
    AlterType: input.alterType,
  });
  return {
    action: alterStatusEndpoint(config),
    fields: { MerchantID_: config.merchantId, PostData_: await aesEncryptHex(inner.toString(), config.hashKey, config.hashIv) },
  };
}

/**
 * NewebPay Period callbacks carry an AES-protected payload. Decryption success, strict JSON/query parsing,
 * expected merchant id and bounded Result fields form the adapter authenticity/integrity boundary.
 */
export async function parsePeriodicCallback(input: {
  encryptedPeriod: string;
  config: NewebPayPeriodicConfig;
}): Promise<NewebPayPeriodicResult> {
  const config = validateConfig(input.config);
  const plain = await aesDecryptHex(input.encryptedPeriod, config.hashKey, config.hashIv);
  const parsed = parseProviderPayload(plain);
  const merchantId = stringField(parsed.result, ['MerchantID', 'MerchantId']);
  if (merchantId && merchantId !== config.merchantId) throw new Error('NEWEBPAY_MERCHANT_MISMATCH');
  return parsed;
}

export async function parseAlterStatusResponse(input: {
  responseText: string;
  config: NewebPayPeriodicConfig;
}): Promise<NewebPayPeriodicResult> {
  const config = validateConfig(input.config);
  const trimmed = input.responseText.trim();
  if (!trimmed) throw new Error('NEWEBPAY_EMPTY_RESPONSE');
  let decoded = trimmed;
  // Some period APIs return encrypted response content while others return outer JSON.
  if (/^[0-9a-f]+$/i.test(trimmed) && trimmed.length % 32 === 0) {
    decoded = await aesDecryptHex(trimmed, config.hashKey, config.hashIv);
  }
  return parseProviderPayload(decoded);
}

export function providerString(result: Record<string, unknown>, ...names: string[]): string | null {
  return stringField(result, names);
}

export function callbackSuccess(value: NewebPayPeriodicResult): boolean {
  const respondCode = providerString(value.result, 'RespondCode', 'respondCode');
  return value.status.toUpperCase() === 'SUCCESS' && (respondCode === null || respondCode === '00');
}

export function parseNewebPayTaipeiDate(value: string | null): Date | null {
  if (!value) return null;
  const normalized = value.trim();
  let match = /^(\d{4})[-/]?(\d{2})[-/]?(\d{2})(?:[ T]?(\d{2}):?(\d{2})?:?(\d{2})?)?$/.exec(normalized);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4] ?? 0);
  const minute = Number(match[5] ?? 0);
  const second = Number(match[6] ?? 0);
  const utc = new Date(Date.UTC(year, month - 1, day, hour - 8, minute, second));
  if (Number.isNaN(utc.getTime())) return null;
  const parts = taipeiParts(utc);
  return parts.year === year && parts.month === month && parts.day === day ? utc : null;
}

export function nextMonthlyPeriod(start: Date): Date {
  const parts = taipeiParts(validDate(start));
  const firstOfNext = new Date(Date.UTC(parts.year, parts.month, 1, -8, 0, 0));
  const nextParts = taipeiParts(firstOfNext);
  const maxDay = new Date(Date.UTC(nextParts.year, nextParts.month, 0)).getUTCDate();
  const day = Math.min(parts.day, maxDay);
  return new Date(Date.UTC(nextParts.year, nextParts.month - 1, day, -8, 0, 0));
}

export function validatePeriodicConfig(input: NewebPayPeriodicConfig): NewebPayPeriodicConfig {
  return validateConfig(input);
}

async function aesEncryptHex(plain: string, hashKey: string, hashIv: string): Promise<string> {
  const key = await aesKey(hashKey, ['encrypt']);
  const encrypted = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-CBC', iv: ivBytes(hashIv) }, key, asArrayBuffer(encoder.encode(plain)),
  ));
  return [...encrypted].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function aesDecryptHex(cipherHex: string, hashKey: string, hashIv: string): Promise<string> {
  const normalized = cipherHex.trim();
  if (!/^[0-9a-f]+$/i.test(normalized) || normalized.length < 32 || normalized.length % 32 !== 0) {
    throw new Error('NEWEBPAY_PERIOD_PAYLOAD_INVALID');
  }
  const bytes = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = Number.parseInt(normalized.slice(i * 2, i * 2 + 2), 16);
  try {
    const key = await aesKey(hashKey, ['decrypt']);
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-CBC', iv: ivBytes(hashIv) }, key, asArrayBuffer(bytes));
    const plain = decoder.decode(decrypted).trim();
    if (!plain || plain.length > 100_000) throw new Error('NEWEBPAY_PERIOD_PAYLOAD_INVALID');
    return plain;
  } catch (error) {
    if (error instanceof Error && error.message === 'NEWEBPAY_PERIOD_PAYLOAD_INVALID') throw error;
    throw new Error('NEWEBPAY_PERIOD_DECRYPT_FAILED');
  }
}

function parseProviderPayload(value: string): NewebPayPeriodicResult {
  let outer: Record<string, unknown>;
  if (value.trim().startsWith('{')) {
    try { outer = JSON.parse(value) as Record<string, unknown>; }
    catch { throw new Error('NEWEBPAY_RESPONSE_INVALID'); }
  } else {
    outer = Object.fromEntries(new URLSearchParams(value));
  }
  const status = typeof outer.Status === 'string' ? outer.Status.trim() : typeof outer.status === 'string' ? outer.status.trim() : '';
  if (!status || status.length > 64) throw new Error('NEWEBPAY_RESPONSE_INVALID');
  const message = typeof outer.Message === 'string' ? outer.Message.slice(0, 1000) : null;
  let result: Record<string, unknown> = {};
  const rawResult = outer.Result ?? outer.result;
  if (rawResult && typeof rawResult === 'object' && !Array.isArray(rawResult)) result = rawResult as Record<string, unknown>;
  else if (typeof rawResult === 'string' && rawResult.trim()) {
    try { const candidate = JSON.parse(rawResult); if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) result = candidate as Record<string, unknown>; }
    catch { result = Object.fromEntries(new URLSearchParams(rawResult)); }
  } else {
    result = outer;
  }
  if (JSON.stringify(result).length > 50_000) throw new Error('NEWEBPAY_RESPONSE_TOO_LARGE');
  return { status, message, result };
}

function validateConfig(input: NewebPayPeriodicConfig): NewebPayPeriodicConfig {
  const merchantId = identifier(input.merchantId, 15, 'NEWEBPAY_MERCHANT_ID_INVALID');
  if (encoder.encode(input.hashKey).length !== 32) throw new Error('NEWEBPAY_HASH_KEY_INVALID');
  if (encoder.encode(input.hashIv).length !== 16) throw new Error('NEWEBPAY_HASH_IV_INVALID');
  const version = identifier(input.version, 5, 'NEWEBPAY_VERSION_INVALID');
  if (input.mode !== 'TEST' && input.mode !== 'PROD') throw new Error('NEWEBPAY_MODE_INVALID');
  if (!Number.isSafeInteger(input.periodTimes) || input.periodTimes < 2 || input.periodTimes > 99) throw new Error('NEWEBPAY_PERIOD_TIMES_INVALID');
  return {
    merchantId, hashKey: input.hashKey, hashIv: input.hashIv, version, mode: input.mode,
    periodTimes: input.periodTimes,
    notifyUrl: httpsUrl(input.notifyUrl, 'NEWEBPAY_NOTIFY_URL_INVALID'),
    returnUrl: httpsUrl(input.returnUrl, 'NEWEBPAY_RETURN_URL_INVALID'),
  };
}

async function aesKey(hashKey: string, usages: KeyUsage[]) {
  const bytes = encoder.encode(hashKey);
  if (bytes.length !== 32) throw new Error('NEWEBPAY_HASH_KEY_INVALID');
  return crypto.subtle.importKey('raw', asArrayBuffer(bytes), { name: 'AES-CBC' }, false, usages);
}
function ivBytes(hashIv: string) { const bytes = encoder.encode(hashIv); if (bytes.length !== 16) throw new Error('NEWEBPAY_HASH_IV_INVALID'); return asArrayBuffer(bytes); }
function asArrayBuffer(bytes: Uint8Array): ArrayBuffer { const copy = new Uint8Array(bytes.byteLength); copy.set(bytes); return copy.buffer; }
function orderNo(value: string) { const normalized = value.trim(); if (!/^[A-Za-z0-9_]{1,30}$/.test(normalized)) throw new Error('NEWEBPAY_ORDER_NO_INVALID'); return normalized; }
function periodNoValue(value: string) { const normalized = value.trim(); if (!/^[A-Za-z0-9_-]{1,32}$/.test(normalized)) throw new Error('NEWEBPAY_PERIOD_NO_INVALID'); return normalized; }
function email(value: string) { const normalized = value.trim(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || normalized.length > 254) throw new Error('NEWEBPAY_PAYER_EMAIL_INVALID'); return normalized; }
function identifier(value: string, max: number, error: string) { const normalized = value.trim(); if (!normalized || normalized.length > max || /[\u0000-\u001f\u007f]/.test(normalized)) throw new Error(error); return normalized; }
function httpsUrl(value: string, error: string) { try { const url = new URL(value.trim()); if (url.protocol !== 'https:' || url.username || url.password) throw new Error(error); return url.toString(); } catch { throw new Error(error); } }
function stringField(record: Record<string, unknown>, names: string[]) { for (const name of names) { const value = record[name]; if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 500); if (typeof value === 'number' && Number.isFinite(value)) return String(value); } return null; }
function validDate(value: Date) { if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new Error('NEWEBPAY_DATE_INVALID'); return new Date(value.getTime()); }
function taipeiParts(value: Date) { const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value); const get = (type: string) => Number(parts.find((part) => part.type === type)?.value); return { year: get('year'), month: get('month'), day: get('day') }; }
