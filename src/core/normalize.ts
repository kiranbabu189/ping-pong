import type { NormalizeRule } from './types';

const BUILTIN_RULES: NormalizeRule[] = [
  { test: /^\d+$/, replace: ':id' },
  { test: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, replace: ':uuid' },
  { test: /^[0-9a-f]{24}$/i, replace: ':id' }, // Mongo ObjectId
  { test: /^[0-9A-HJKMNP-TV-Z]{26}$/, replace: ':id' }, // ULID
  { test: /^[0-9a-f]{32,}$/i, replace: ':hash' },
  { test: /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/, replace: ':date' },
  { test: /^[^@/]+@[^@/]+\.[a-z]{2,}$/i, replace: ':email' },
  // Long mixed alphanumeric tokens that contain at least one digit (slugs like "my-post" stay intact).
  { test: /^(?=.*\d)(?=.*[a-z])[A-Za-z0-9_-]{16,}$/i, replace: ':token' },
];

export function normalizeSegment(seg: string, extra: NormalizeRule[] = []): string {
  if (!seg) return seg;
  let decoded = seg;
  try {
    decoded = decodeURIComponent(seg);
  } catch {
    /* keep raw */
  }
  for (const rule of extra) if (rule.test.test(decoded)) return rule.replace;
  for (const rule of BUILTIN_RULES) if (rule.test.test(decoded)) return rule.replace;
  return seg;
}

export function normalizePath(path: string, extra: NormalizeRule[] = []): string {
  const parts = path.split('/').map((s) => normalizeSegment(s, extra));
  let out = parts.join('/');
  if (out.length > 1 && out.endsWith('/')) out = out.slice(0, -1);
  return out || '/';
}

export interface ParsedUrl {
  url: string;
  origin: string;
  path: string;
  query: Record<string, string>;
}

export function parseUrl(input: string, base = typeof location !== 'undefined' ? location.href : 'http://localhost/'): ParsedUrl {
  try {
    const u = new URL(input, base);
    const query: Record<string, string> = {};
    u.searchParams.forEach((v, k) => (query[k] = v));
    return { url: u.href, origin: u.origin, path: u.pathname || '/', query };
  } catch {
    return { url: input, origin: '', path: input, query: {} };
  }
}

export function currentPage(): string {
  if (typeof location === 'undefined') return '/';
  const hashRoute = location.hash.startsWith('#/') ? location.hash : '';
  return normalizePath(location.pathname) + hashRoute;
}
