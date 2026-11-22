// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { init, type PingPongInstance } from '../src/index';

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
let pp: PingPongInstance;
let realFetch: typeof fetch;
let served: string[];

beforeEach(() => {
  localStorage.clear();
  served = [];
  realFetch = globalThis.fetch;
  // Fake backend underneath the interceptor.
  globalThis.fetch = (async (input: RequestInfo | URL, initArg?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    served.push(`${initArg?.method ?? 'GET'} ${url}`);
    if (url.includes('/fail')) return new Response('{"error":"x"}', { status: 500, headers: { 'content-type': 'application/json' } });
    return new Response(JSON.stringify({ id: 1, name: 'Lead', owner: { email: 'a@b.co', phone: '1' }, secret: 's' }), { headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  pp = init({ hotkey: false, trackFieldUsage: true })!;
});

afterEach(() => {
  pp.destroy();
  globalThis.fetch = realFetch;
});

const shadow = () => document.querySelector('api-pingpong')!.shadowRoot!;

describe('integration', () => {
  it('records fetch calls with status, body, redaction, initiator and duplicates', async () => {
    await fetch('/api/lead', { headers: { Authorization: 'Bearer secret' } });
    await fetch('/api/lead', { headers: { Authorization: 'Bearer secret' } });
    await fetch('/api/fail', { method: 'POST', body: JSON.stringify({ password: 'hunter2', n: 1 }) });
    await tick(10);
    const calls = pp.getCalls();
    expect(calls).toHaveLength(3);
    expect(calls[0]).toMatchObject({ method: 'GET', pattern: '/api/lead', status: 200, pending: false });
    expect(calls[0].requestHeaders.authorization).toBe('[redacted]');
    expect(calls[0].responseBody).toContain('"name":"Lead"');
    expect(calls[1].duplicateOf).toBe(calls[0].id);
    expect(calls[2]).toMatchObject({ status: 500, ok: false });
    expect(calls[2].requestBody).toBe('{"password":"[redacted]","n":1}');
    expect(calls[0].initiator.length).toBeGreaterThan(0);
  });

  it('tracks field usage from res.json()', async () => {
    const data = await (await fetch('/api/lead/7')).json();
    expect(data.owner.email).toBe('a@b.co');
    await tick(10);
    expect(pp.getCalls()[0].fieldUsage!.used).toEqual(['owner.email']);
  });

  it('serves fetch mocks, network-error mocks and latency', async () => {
    pp.addMock({ method: 'GET', match: '/api/lead/:id', status: 418, body: '{"mocked":true}' });
    const res = await fetch('/api/lead/99');
    expect(res.status).toBe(418);
    expect(await res.json()).toEqual({ mocked: true });
    pp.addMock({ method: '*', match: '/api/down', status: 0 });
    await expect(fetch('/api/down')).rejects.toThrow(/mocked network error/);
    pp.addMock({ method: 'GET', match: '/api/slow', delay: 60 });
    const t0 = Date.now();
    await fetch('/api/slow');
    expect(Date.now() - t0).toBeGreaterThanOrEqual(55);
    await tick(10);
    const calls = pp.getCalls();
    expect(calls[0].mocked).toBe(true);
    expect(calls[1]).toMatchObject({ mocked: true, status: 0, error: expect.stringMatching(/mocked/) });
    expect(served).toEqual(['GET /api/slow']);
  });

  it('mocks XHR (axios path) end-to-end', async () => {
    pp.addMock({ method: 'GET', match: '/api/xhr', status: 201, body: '{"ok":1}' });
    const result = await new Promise<{ status: number; body: unknown; ct: string | null }>((resolve) => {
      const x = new XMLHttpRequest();
      x.open('GET', '/api/xhr');
      x.responseType = 'json';
      x.onreadystatechange = () => {
        if (x.readyState === 4) resolve({ status: x.status, body: x.response, ct: x.getResponseHeader('Content-Type') });
      };
      x.send();
    });
    expect(result).toEqual({ status: 201, body: { ok: 1 }, ct: 'application/json' });
    expect(pp.getCalls()[0]).toMatchObject({ kind: 'xhr', status: 201, mocked: true });
  });

  it('renders the floating button and nested path tree in shadow DOM', async () => {
    await fetch('/api/lead');
    await fetch('/api/lead/1');
    await fetch('/api/user/me');
    await tick(10);
    const root = shadow();
    expect(root.querySelector('.fab .badge')!.textContent).toBe('3');
    (root.querySelector('.fab') as HTMLButtonElement).click();
    await tick(10);
    const rows = [...root.querySelectorAll('.body .row')].map((r) => r.textContent!.replace(/\s+/g, ' ').trim());
    expect(rows[0]).toMatch(/^▾ ?\/api 3$/);
    expect(rows).toEqual(expect.arrayContaining([expect.stringMatching(/^▾ ?\/lead 2$/), expect.stringMatching(/GET \/api\/lead .*×1/), expect.stringMatching(/^▾ ?\/:id 1$/)]));
    // drill into an endpoint, then a call
    (root.querySelector('[data-act="endpoint"]') as HTMLElement).click();
    expect(root.querySelector('.crumbs')!.textContent).toContain('/api/lead');
    (root.querySelector('tr[data-act="call"]') as HTMLElement).click();
    expect(root.querySelector('.url')!.textContent).toBe('http://localhost:3000/api/lead');
    expect(root.textContent).toContain('Copy cURL');
  });

  it('replays a call and links it to the original', async () => {
    await fetch('/api/lead', { method: 'POST', body: '{"a":1}' });
    await tick(10);
    const first = pp.getCalls()[0];
    const ui = shadow();
    (ui.querySelector('.fab') as HTMLButtonElement).click();
    await tick(10);
    // go straight to the call view via the endpoint list
    (ui.querySelector('[data-act="endpoint"]') as HTMLElement).click();
    (ui.querySelector('tr[data-act="call"]') as HTMLElement).click();
    (ui.querySelector('[data-act="replay"]') as HTMLElement).click();
    await tick(20);
    const calls = pp.getCalls();
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({ replayOf: first.id, method: 'POST', requestBody: '{"a":1}' });
  });

  it('restores originals on destroy', () => {
    const patched = globalThis.fetch;
    pp.destroy();
    expect(globalThis.fetch).not.toBe(patched);
    expect(document.querySelector('api-pingpong')).toBeNull();
    pp = init({ hotkey: false })!; // afterEach destroys again
  });
});
