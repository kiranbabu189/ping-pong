import { describe, expect, it } from 'vitest';
import { normalizePath } from '../src/core/normalize';
import { redactBody, redactHeaders } from '../src/core/redact';
import { CallStore } from '../src/core/store';
import { detectGraphQL } from '../src/features/graphql';
import { ruleMatches } from '../src/features/mocks';
import { shortInitiator } from '../src/features/initiator';
import { leafPaths, trackUsage } from '../src/features/fieldUsage';
import type { ApiCall } from '../src/core/types';
import { mkCall } from './helpers';

describe('normalizePath', () => {
  it.each([
    ['/api/lead/123', '/api/lead/:id'],
    ['/api/lead/550e8400-e29b-41d4-a716-446655440000/notes', '/api/lead/:uuid/notes'],
    ['/api/users/507f1f77bcf86cd799439011', '/api/users/:id'],
    ['/api/posts/my-first-post', '/api/posts/my-first-post'],
    ['/api/day/2024-05-01', '/api/day/:date'],
    ['/api/v2/lead/', '/api/v2/lead'],
    ['/api/files/a1b2c3d4e5f6a7b8c9d0', '/api/files/:token'],
    ['/', '/'],
  ])('%s → %s', (a, b) => expect(normalizePath(a)).toBe(b));

  it('applies custom rules first', () => {
    expect(normalizePath('/api/org/acme/lead', [{ test: /^acme$/, replace: ':org' }])).toBe('/api/org/:org/lead');
  });
});

describe('redaction', () => {
  it('redacts sensitive headers case-insensitively', () => {
    expect(redactHeaders({ authorization: 'Bearer x', accept: '*/*' }, ['Authorization'])).toEqual({ authorization: '[redacted]', accept: '*/*' });
  });
  it('redacts nested JSON keys and leaves non-JSON alone', () => {
    const out = JSON.parse(redactBody('{"user":{"password":"p","name":"n"},"items":[{"token":"t"}]}', ['password', 'token'])!);
    expect(out).toEqual({ user: { password: '[redacted]', name: 'n' }, items: [{ token: '[redacted]' }] });
    expect(redactBody('password=abc', ['password'])).toBe('password=abc');
  });
});

describe('duplicate detection', () => {
  it('flags identical method+url+body within the window, links to first of burst', () => {
    const s = new CallStore(100, 2000);
    const a = s.add(mkCall({ startTime: 0 }));
    const b = s.add(mkCall({ startTime: 500 }));
    const c = s.add(mkCall({ startTime: 1500 }));
    const d = s.add(mkCall({ startTime: 9000 }));
    const e = s.add(mkCall({ startTime: 9100, method: 'POST', requestBody: '{"a":1}' }));
    const f = s.add(mkCall({ startTime: 9200, method: 'POST', requestBody: '{"a":2}' }));
    expect([a, b, c, d, e, f].map((x) => x.duplicateOf)).toEqual([undefined, a.id, a.id, undefined, undefined, undefined]);
  });
  it('evicts oldest beyond maxCalls', () => {
    const s = new CallStore(3, 0);
    for (let i = 0; i < 5; i++) s.add(mkCall({ startTime: i * 10_000 }));
    expect(s.calls.map((c) => c.id)).toEqual([3, 4, 5]);
    expect(s.get(1)).toBeUndefined();
  });
});

describe('GraphQL detection', () => {
  it('reads operationName / type from body', () => {
    expect(detectGraphQL('/graphql', {}, JSON.stringify({ query: 'mutation SaveLead($id: ID!) { save(id: $id) }' }))).toEqual({ operationType: 'mutation', operationName: 'SaveLead' });
    expect(detectGraphQL('/graphql', {}, JSON.stringify({ query: '{ me { id } }' }))).toEqual({ operationType: 'query', operationName: 'anonymous' });
    expect(detectGraphQL('/gql', { query: 'query Me { me { id } }' }, undefined)).toEqual({ operationType: 'query', operationName: 'Me' });
    expect(detectGraphQL('/api/lead', {}, '{"name":"x"}')).toBeUndefined();
  });
});

describe('mock rule matching', () => {
  const t = { method: 'GET', url: 'http://app.test/api/lead/42?x=1', path: '/api/lead/42', pattern: '/api/lead/:id' };
  const r = (match: string, method = '*') => ({ id: '1', enabled: true, method, match });
  it('matches pattern, concrete path, :param shapes and wildcards', () => {
    expect(ruleMatches(r('/api/lead/:id'), t)).toBe(true);
    expect(ruleMatches(r('/api/lead/:leadId'), t)).toBe(true);
    expect(ruleMatches(r('/api/lead/42'), t)).toBe(true);
    expect(ruleMatches(r('/api/*'), t)).toBe(true);
    expect(ruleMatches(r('/api/lead'), t)).toBe(false);
    expect(ruleMatches(r('/api/lead/:id', 'POST'), t)).toBe(false);
  });
});

describe('initiator', () => {
  it('extracts file:line', () => {
    expect(shortInitiator(['LeadList (/src/LeadList.tsx:42:10)'])).toBe('LeadList.tsx:42');
  });
});

describe('field usage', () => {
  it('computes leaf paths with collapsed arrays', () => {
    expect([...leafPaths({ a: 1, b: { c: 'x' }, items: [{ id: 1, n: 'a' }, { id: 2, extra: true }] })].sort()).toEqual(['a', 'b.c', 'items[].extra', 'items[].id', 'items[].n']);
  });
  it('tracks reads through a proxy without breaking values', () => {
    const call = mkCall() as ApiCall;
    const data = trackUsage({ id: 1, name: 'x', tags: ['a'], owner: { email: 'e', phone: 'p' }, frozen: Object.freeze({ k: 1 }) }, call);
    expect(data.name).toBe('x');
    expect(data.owner.email).toBe('e');
    expect(data.tags.map((t: string) => t.toUpperCase())).toEqual(['A']);
    expect(data.frozen.k).toBe(1);
    expect(call.fieldUsage!.used.sort()).toEqual(['frozen.k', 'name', 'owner.email', 'tags[]']);
    expect(call.fieldUsage!.total.length).toBe(6);
  });
});
