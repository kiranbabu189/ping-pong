export const DEFAULT_REDACT_HEADERS = [
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'x-csrf-token',
  'x-xsrf-token',
];

export const DEFAULT_REDACT_BODY_KEYS = [
  'password',
  'passwd',
  'secret',
  'token',
  'accessToken',
  'access_token',
  'refreshToken',
  'refresh_token',
  'apiKey',
  'api_key',
  'clientSecret',
  'client_secret',
  'creditCard',
  'cardNumber',
  'cvv',
  'ssn',
];

export const REDACTED = '[redacted]';

export function redactHeaders(h: Record<string, string>, names: string[]): Record<string, string> {
  const set = new Set(names.map((n) => n.toLowerCase()));
  const out: Record<string, string> = {};
  for (const k of Object.keys(h)) out[k] = set.has(k.toLowerCase()) ? REDACTED : h[k];
  return out;
}

export function redactBody(body: string | undefined, keys: string[]): string | undefined {
  if (!body || keys.length === 0) return body;
  const first = body.trimStart()[0];
  if (first !== '{' && first !== '[') return body;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return body;
  }
  const set = new Set(keys.map((k) => k.toLowerCase()));
  let changed = false;
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const o: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v)) {
        if (set.has(k.toLowerCase()) && val != null && typeof val !== 'object') {
          o[k] = REDACTED;
          changed = true;
        } else o[k] = walk(val);
      }
      return o;
    }
    return v;
  };
  const result = walk(parsed);
  return changed ? JSON.stringify(result) : body;
}
