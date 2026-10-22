// Test helper only: replaces global.fetch; restore with jest.restoreAllMocks().
export function mockFetch(
  routes: Record<string, { status?: number; body?: unknown; raw?: Buffer; contentType?: string } | 'network-error'>,
) {
  const calls: { method: string; url: URL; headers: Record<string, string>; body?: any }[] = [];
  jest.spyOn(global, 'fetch').mockImplementation(async (input: any, init: any = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? 'GET';
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
    calls.push({ method, url, headers: { ...init.headers }, body });
    const route = routes[`${method} ${url.pathname}`];
    if (route === 'network-error') throw new TypeError('fetch failed');
    if (!route) return new Response(null, { status: 404 });
    if (route.raw) return new Response(route.raw as unknown as BodyInit, { status: route.status ?? 200, headers: { 'Content-Type': route.contentType ?? 'application/octet-stream' } });
    return new Response(route.body === undefined ? null : JSON.stringify(route.body), {
      status: route.status ?? 200,
    });
  });
  return { calls };
}
