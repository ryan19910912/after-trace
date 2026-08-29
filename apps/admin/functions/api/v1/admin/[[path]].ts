type PagesEnv = {
  ADMIN_API_ORIGIN: string;
};

type PagesContext = {
  request: Request;
  env: PagesEnv;
  params: { path?: string | string[] };
};

export async function onRequest(context: PagesContext): Promise<Response> {
  const origin = secureOrigin(context.env.ADMIN_API_ORIGIN);
  const incoming = new URL(context.request.url);
  const path = Array.isArray(context.params.path)
    ? context.params.path.join('/')
    : (context.params.path ?? '');
  const target = new URL(`/api/v1/admin/${path}`, origin);
  target.search = incoming.search;

  const headers = new Headers(context.request.headers);
  headers.delete('host');
  headers.delete('cookie');
  headers.delete('cf-connecting-ip');
  headers.delete('x-forwarded-for');

  // Cloudflare Access injects the signed assertion on the protected Pages request.
  // The Worker verifies that JWT again and never trusts a browser-provided admin secret.
  const assertion = context.request.headers.get('cf-access-jwt-assertion');
  if (!assertion) return new Response('Cloudflare Access assertion missing', { status: 401 });
  headers.set('cf-access-jwt-assertion', assertion);

  const response = await fetch(target, {
    method: context.request.method,
    headers,
    body: context.request.method === 'GET' || context.request.method === 'HEAD'
      ? undefined
      : context.request.body,
    redirect: 'manual',
  });

  const responseHeaders = new Headers(response.headers);
  responseHeaders.set('Cache-Control', 'no-store');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
}

function secureOrigin(value: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error('ADMIN_API_ORIGIN is required');
  const url = new URL(normalized);
  if (url.protocol !== 'https:') throw new Error('ADMIN_API_ORIGIN must use https');
  return url.origin;
}
