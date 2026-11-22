import type { ApiCall } from '../core/types';
import { normalizePath, parseUrl } from '../core/normalize';

const FORMAT = 'api-pingpong';

export function toJSONExport(calls: readonly ApiCall[]): string {
  return JSON.stringify({ format: FORMAT, version: 1, exportedAt: new Date().toISOString(), page: typeof location !== 'undefined' ? location.href : '', calls }, null, 2);
}

export function toHAR(calls: readonly ApiCall[]): string {
  const entries = calls
    .filter((c) => c.kind !== 'ws' && c.kind !== 'sse')
    .map((c) => {
      const reqCt = c.requestHeaders['content-type'];
      return {
        startedDateTime: new Date(c.startTime).toISOString(),
        time: c.duration ?? 0,
        request: {
          method: c.method,
          url: c.url,
          httpVersion: 'HTTP/1.1',
          cookies: [],
          headers: Object.entries(c.requestHeaders).map(([name, value]) => ({ name, value })),
          queryString: Object.entries(c.query).map(([name, value]) => ({ name, value })),
          ...(c.requestBody != null ? { postData: { mimeType: reqCt ?? 'text/plain', text: c.requestBody } } : {}),
          headersSize: -1,
          bodySize: c.requestSize,
        },
        response: {
          status: c.status,
          statusText: c.statusText ?? '',
          httpVersion: 'HTTP/1.1',
          cookies: [],
          headers: Object.entries(c.responseHeaders).map(([name, value]) => ({ name, value })),
          content: { size: c.responseSize, mimeType: c.contentType ?? '', ...(c.responseBody != null ? { text: c.responseBody } : {}) },
          redirectURL: '',
          headersSize: -1,
          bodySize: c.responseSize,
          ...(c.error ? { _error: c.error } : {}),
        },
        cache: {},
        timings: { send: 0, wait: c.duration ?? 0, receive: 0 },
        _initiator: c.initiator.join('\n'),
        _page: c.page,
        ...(c.duplicateOf != null ? { _duplicateOf: c.duplicateOf } : {}),
        ...(c.mocked ? { _mocked: true } : {}),
      };
    });
  return JSON.stringify({ log: { version: '1.2', creator: { name: FORMAT, version: '0.1.0' }, pages: [], entries } }, null, 2);
}

/** Parse an api-pingpong JSON export or a HAR file. Returned calls lack ids; the store assigns them. */
export function parseImport(text: string): Array<Omit<ApiCall, 'id'>> {
  const data = JSON.parse(text) as { format?: string; calls?: ApiCall[]; log?: { entries?: HarEntry[] } };
  if (data.format === FORMAT && Array.isArray(data.calls)) {
    return data.calls.map(({ id: _id, duplicateOf: _d, replayOf: _r, ...c }) => ({ ...c, imported: true, pending: false }));
  }
  if (data.log?.entries) return data.log.entries.map(fromHarEntry);
  throw new Error('Unrecognised file: expected an api-pingpong export or a .har file');
}

interface HarEntry {
  startedDateTime: string;
  time: number;
  request: { method: string; url: string; headers?: Array<{ name: string; value: string }>; postData?: { text?: string }; bodySize?: number };
  response: {
    status: number;
    statusText?: string;
    headers?: Array<{ name: string; value: string }>;
    content?: { size?: number; mimeType?: string; text?: string; encoding?: string };
    _error?: string;
  };
  _initiator?: string | { type?: string; stack?: unknown };
  _page?: string;
  _resourceType?: string;
}

function fromHarEntry(e: HarEntry): Omit<ApiCall, 'id'> {
  const p = parseUrl(e.request.url);
  const start = Date.parse(e.startedDateTime) || Date.now();
  const hdr = (list?: Array<{ name: string; value: string }>) => Object.fromEntries((list ?? []).map((h) => [h.name.toLowerCase(), h.value]));
  const body = e.response.content?.encoding === 'base64' ? undefined : e.response.content?.text;
  return {
    kind: e._resourceType === 'xhr' ? 'xhr' : 'fetch',
    method: e.request.method.toUpperCase(),
    url: p.url,
    origin: p.origin,
    path: p.path,
    pattern: normalizePath(p.path),
    query: p.query,
    page: e._page ?? '(imported)',
    startTime: start,
    endTime: start + (e.time || 0),
    duration: e.time || 0,
    status: e.response.status,
    statusText: e.response.statusText,
    ok: e.response.status >= 200 && e.response.status < 400,
    error: e.response._error,
    pending: false,
    requestHeaders: hdr(e.request.headers),
    responseHeaders: hdr(e.response.headers),
    requestBody: e.request.postData?.text,
    responseBody: body,
    requestSize: Math.max(0, e.request.bodySize ?? 0),
    responseSize: Math.max(0, e.response.content?.size ?? 0),
    contentType: e.response.content?.mimeType,
    initiator: typeof e._initiator === 'string' ? e._initiator.split('\n') : [],
    imported: true,
  };
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Bodies recorded as descriptions (FormData, Blob, binary, stream) rather than real text. */
export function isPlaceholderBody(body: string): boolean {
  return /^\[(FormData|Blob|binary|stream)/.test(body);
}

const SKIP_HEADERS =new Set(['content-length', 'host', 'connection', 'accept-encoding']);

export function toCurl(c: Pick<ApiCall, 'method' | 'url' | 'requestHeaders' | 'requestBody'>, headers = c.requestHeaders, body = c.requestBody): string {
  const lines = [`curl ${shellQuote(c.url)}`];
  const hasBody = !!body && !['GET', 'HEAD'].includes(c.method);
  if (c.method !== 'GET' || hasBody) lines.push(`-X ${c.method}`);
  for (const [k, v] of Object.entries(headers)) if (!SKIP_HEADERS.has(k)) lines.push(`-H ${shellQuote(`${k}: ${v}`)}`);
  if (hasBody) {
    if (isPlaceholderBody(body!)) lines.push(`# body not reproducible: ${body!.split('\n')[0]}`);
    else lines.push(`--data-raw ${shellQuote(body!)}`);
  }
  return lines.join(' \\\n  ');
}

export function toFetchSnippet(c: Pick<ApiCall, 'method' | 'url' | 'requestHeaders' | 'requestBody'>, headers = c.requestHeaders, body = c.requestBody): string {
  const h = Object.fromEntries(Object.entries(headers).filter(([k]) => !SKIP_HEADERS.has(k)));
  const init: Record<string, unknown> = { method: c.method };
  if (Object.keys(h).length) init.headers = h;
  let bodyLine = '';
  if (body && !['GET', 'HEAD'].includes(c.method)) {
    try {
      JSON.parse(body);
      bodyLine = `,\n  body: JSON.stringify(${body})`;
    } catch {
      init.body = body;
    }
  }
  const initStr = JSON.stringify(init, null, 2).replace(/\n}$/, `${bodyLine}\n}`);
  return `await fetch(${JSON.stringify(c.url)}, ${initStr});`;
}
