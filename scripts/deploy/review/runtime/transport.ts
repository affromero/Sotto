import { readResponseBytes } from 'thesidedoor-core/runtime/stream';

const origin = 'https://demo.sotto.fm';

interface ReviewTransportOptions {
  endpoint: string;
  signal: AbortSignal;
  fetch?: typeof globalThis.fetch;
  fail: () => never;
  admitResource: (path: string, method: string) => boolean;
}

/** Keep the logical review origin and its cookies on one admitted loopback candidate. */
export function createReviewTransport(options: ReviewTransportOptions) {
  const endpoint = new URL(options.endpoint);
  if (
    endpoint.protocol !== 'http:' ||
    !['127.0.0.1', '[::1]'].includes(endpoint.hostname) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.pathname !== '/' ||
    endpoint.search ||
    endpoint.hash ||
    !endpoint.port
  )
    options.fail();
  const jar = new Map<string, string>();
  let selectedProfileId: string | null = null;
  const transport: typeof fetch = async (resource, init) => {
    options.signal.throwIfAborted();
    if (
      typeof resource !== 'string' ||
      !resource.startsWith('/api/v1/') ||
      resource.includes('#') ||
      resource.includes('\\') ||
      !options.admitResource(resource, (init?.method ?? 'GET').toUpperCase())
    )
      options.fail();
    const destination = new URL(resource, endpoint);
    if (
      destination.origin !== endpoint.origin ||
      destination.pathname + destination.search !== resource
    )
      options.fail();
    const headers = new Headers(init?.headers);
    if (headers.has('Host')) options.fail();
    headers.set('Origin', origin);
    headers.set('X-Sidedoor-Origin', origin);
    if (selectedProfileId && !resource.startsWith('/api/v1/access/'))
      headers.set('X-Sotto-Expected-Profile-Id', selectedProfileId);
    if (jar.size)
      headers.set('Cookie', [...jar].map(([name, token]) => `${name}=${token}`).join('; '));
    const signal = AbortSignal.any([options.signal, AbortSignal.timeout(60_000)]);
    const response = await (options.fetch ?? globalThis.fetch)(destination, {
      ...init,
      headers,
      redirect: 'error',
      cache: 'no-store',
      signal,
    });
    if (response.redirected || (response.url && response.url !== destination.href)) options.fail();
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(';', 1)[0];
      const offset = pair.indexOf('=');
      if (offset < 1 || pair.length > 8192 || jar.size > 16) options.fail();
      const name = pair.slice(0, offset);
      if (!/^[a-zA-Z0-9_-]+$/.test(name) || /[\r\n]/.test(pair)) options.fail();
      jar.set(name, pair.slice(offset + 1));
      if (jar.size > 16) options.fail();
    }
    const bytes = await readResponseBytes(response, { signal, maxBytes: 1024 * 1024 });
    return new Response(Uint8Array.from(bytes).buffer, {
      status: response.status,
      headers: response.headers,
    });
  };
  const request = async (
    path: string,
    body?: unknown,
    method = body === undefined ? 'GET' : 'POST'
  ): Promise<unknown> => {
    const response = await transport(path, {
      method,
      headers: { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) options.fail();
    return response.json() as Promise<unknown>;
  };
  return {
    fetch: transport,
    request,
    selectProfile: (id: string | null) => {
      selectedProfileId = id;
    },
  };
}
