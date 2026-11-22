import { describe, expect, it } from 'vitest';
import { buildTree, computeEndpoints, computeInsights, detectNPlusOne } from '../src/features/analysis';
import { parseImport, toCurl, toFetchSnippet, toHAR, toJSONExport } from '../src/features/export';
import { inferSchema, mergeSchemas, toOpenAPI, toTypeScript, tsType } from '../src/features/schema';
import { diffSnapshots, SnapshotStore } from '../src/features/snapshots';
import { CallStore } from '../src/core/store';
import { mkCall } from './helpers';
import type { ApiCall } from '../src/core/types';

const AO = { slowThresholdMs: 1000, duplicateWindowMs: 2000, nPlusOneThreshold: 5, sameOrigin: 'http://app.test' };

function fill(): CallStore {
  const s = new CallStore(1000, 2000);
  s.add(mkCall({ path: '/api/lead', startTime: 0 }));
  s.add(mkCall({ path: '/api/lead', startTime: 100 })); // dup
  s.add(mkCall({ path: '/api/lead', method: 'POST', status: 500, ok: false, startTime: 200, requestBody: '{"name":"a"}' }));
  for (let i = 1; i <= 6; i++) s.add(mkCall({ path: `/api/lead/${i}`, startTime: 300 + i, responseBody: JSON.stringify({ id: i, name: 'n', score: i % 2 ? 1 : 1.5 }) }));
  s.add(mkCall({ path: '/api/user/me', startTime: 400, duration: 2500, page: '/dashboard' }));
  s.add(mkCall({ path: '/v1/track', origin: 'https://analytics.x.com', url: 'https://analytics.x.com/v1/track', method: 'POST', startTime: 500 }));
  return s;
}

describe('analysis', () => {
  it('builds a nested /api → /lead tree with rolled-up counts', () => {
    const tree = buildTree(computeEndpoints(fill().calls, AO).values(), 'path', AO);
    const api = tree.children.get('api')!;
    expect(api.count).toBe(10);
    const lead = api.children.get('lead')!;
    expect(lead.count).toBe(9);
    expect(lead.endpoints.map((e) => `${e.method} ${e.label} ×${e.count}`).sort()).toEqual(['GET /api/lead ×2', 'POST /api/lead ×1']);
    expect(lead.children.get(':id')!.endpoints[0].count).toBe(6);
    expect(lead.duplicates).toBe(1);
    expect(lead.errors).toBe(1);
    expect(tree.children.has('🌐 analytics.x.com')).toBe(true);
  });

  it('groups by page', () => {
    const tree = buildTree(computeEndpoints(fill().calls, AO).values(), 'page', AO);
    expect([...tree.children.keys()].sort()).toEqual(['📄 /', '📄 /dashboard']);
  });

  it('detects N+1 bursts', () => {
    const calls = Array.from({ length: 6 }, (_, i) => ({ ...mkCall({ path: `/a/${i}`, startTime: i * 10 }), id: i }) as ApiCall);
    expect(detectNPlusOne(calls, AO)).toBe(6);
    const spread = calls.map((c, i) => ({ ...c, startTime: i * 5000 }));
    expect(detectNPlusOne(spread, AO)).toBe(0);
  });

  it('produces ranked insights', () => {
    const kinds = computeInsights(computeEndpoints(fill().calls, AO).values(), AO).map((i) => `${i.kind}:${i.endpoint.label}`);
    expect(kinds).toEqual(expect.arrayContaining(['duplicate:/api/lead', 'n+1:/api/lead/:id', 'error:/api/lead', 'slow:/api/user/me']));
  });
});

describe('export', () => {
  it('cURL escapes quotes and skips GET bodies', () => {
    const c = { method: 'POST', url: 'http://x/a', requestHeaders: { 'content-type': 'application/json', 'content-length': '9' }, requestBody: `{"n":"o'k"}` };
    expect(toCurl(c)).toBe(`curl 'http://x/a' \\\n  -X POST \\\n  -H 'content-type: application/json' \\\n  --data-raw '{"n":"o'\\''k"}'`);
    expect(toCurl({ method: 'GET', url: 'http://x/a', requestHeaders: {} })).toBe(`curl 'http://x/a'`);
    expect(toCurl({ ...c, requestBody: '[FormData]\na=1' })).toContain('# body not reproducible');
    expect(toCurl({ ...c, requestBody: '[1,2]' })).toContain(`--data-raw '[1,2]'`);
  });
  it('fetch snippet', () => {
    expect(toFetchSnippet({ method: 'POST', url: 'http://x/a', requestHeaders: {}, requestBody: '{"a":1}' })).toContain('body: JSON.stringify({"a":1})');
  });
  it('round-trips JSON and HAR', () => {
    const calls = fill().calls;
    const fromJson = parseImport(toJSONExport(calls));
    expect(fromJson).toHaveLength(calls.length);
    expect(fromJson.every((c) => c.imported)).toBe(true);
    const fromHar = parseImport(toHAR(calls));
    expect(fromHar[3].pattern).toBe('/api/lead/:id');
    expect(fromHar[2].status).toBe(500);
    expect(() => parseImport('{"x":1}')).toThrow(/Unrecognised/);
  });
});

describe('schema / OpenAPI / TS', () => {
  it('merges optional and nullable fields', () => {
    const s = mergeSchemas(inferSchema({ a: 1, b: 'x', c: null }), inferSchema({ a: 2.5, c: 'y' }));
    expect(s.required).toEqual(['a', 'c']);
    expect(s.properties!.a.type).toBe('number');
    expect(s.properties!.c).toMatchObject({ type: 'string', nullable: true });
    expect(tsType(s, 0)).toBe('{\n  a: number;\n  b?: string;\n  c: string | null;\n}');
  });
  it('generates OpenAPI with path params and TS types', () => {
    const eps = [...computeEndpoints(fill().calls, AO).values()];
    const spec = toOpenAPI(eps) as { paths: Record<string, Record<string, { parameters?: Array<{ name: string }>; responses: Record<string, unknown> }>> };
    expect(Object.keys(spec.paths)).toEqual(expect.arrayContaining(['/api/lead', '/api/lead/{leadId}', '/api/user/me']));
    expect(spec.paths['/api/lead/{leadId}'].get.parameters![0].name).toBe('leadId');
    expect(spec.paths['/api/lead'].post.responses['500']).toBeDefined();
    const ts = toTypeScript(eps);
    expect(ts).toContain('export type GetApiLeadByIdResponse = {');
    expect(ts).toContain('score: number;');
    expect(ts).toContain('export type PostApiLeadRequest = {');
  });
});

describe('snapshots', () => {
  it('diffs before/after', () => {
    const snaps = new SnapshotStore(false);
    const before = snaps.take('before', computeEndpoints(fill().calls, AO).values());
    const s2 = new CallStore(100, 2000);
    s2.add(mkCall({ path: '/api/lead' }));
    s2.add(mkCall({ path: '/api/new' }));
    const after = snaps.take('after', computeEndpoints(s2.calls, AO).values());
    const rows = diffSnapshots(before, after);
    const lead = rows.find((r) => r.label === '/api/lead' && r.method === 'GET')!;
    expect(lead.deltaCount).toBe(-1);
    expect(lead.after!.duplicates).toBe(0);
    expect(rows.find((r) => r.label === '/api/new')!.status).toBe('added');
    expect(rows.find((r) => r.label === '/api/user/me')!.status).toBe('removed');
  });
});
