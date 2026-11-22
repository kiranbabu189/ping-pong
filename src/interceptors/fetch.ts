import type { Recorder } from '../core/recorder';
import { isBinaryOrStream, serializeBody } from '../core/recorder';
import type { MockRule } from '../core/types';
import { headersToObject } from '../core/utils';
import { trackUsage } from '../features/fieldUsage';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function patchFetch(rec: Recorder): () => void {
  const g = globalThis as typeof globalThis & { fetch?: typeof fetch };
  const original = g.fetch;
  if (typeof original !== 'function') return () => {};
  rec.originalFetch = original.bind(g);

  const patched = async function (this: unknown, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const isRequest = typeof Request !== 'undefined' && input instanceof Request;
    const url = isRequest ? (input as Request).url : String(input instanceof URL ? input.href : input);
    if (rec.shouldIgnore(url)) return original.call(g, input, init);

    const method = (init?.method ?? (isRequest ? (input as Request).method : 'GET')).toUpperCase();
    const headers = {
      ...(isRequest ? headersToObject((input as Request).headers) : {}),
      ...headersToObject(init?.headers as Headers | Record<string, string> | undefined),
    };
    const body = serializeBody(init?.body);

    let call;
    try {
      call = rec.begin({ kind: 'fetch', method, url, requestHeaders: headers, requestBody: body.text, requestSize: body.size });
    } catch (e) {
      console.warn('[api-pingpong] failed to record fetch', e);
      return original.call(g, input, init);
    }

    if (isRequest && init?.body == null && !['GET', 'HEAD'].includes(method)) {
      try {
        (input as Request)
          .clone()
          .text()
          .then((t) => rec.setRequestBody(call, t), () => {});
      } catch {
        /* body already used */
      }
    }

    const rule = rec.findMock(method, url);
    try {
      if (rule?.delay) await sleep(rule.delay);
      let res: Response;
      if (rule && rule.status != null) {
        call.mocked = true;
        res = buildMockResponse(rule);
      } else {
        res = await original.call(g, input, init);
      }
      captureResponse(rec, call, res);
      if (rec.opts.trackFieldUsage && !call.mocked) wrapJson(res, call);
      return res;
    } catch (err) {
      rec.finish(call, { status: 0, error: errorMessage(err) });
      throw err;
    }
  };

  // Preserve function identity-ish properties some libs check.
  Object.defineProperty(patched, 'name', { value: 'fetch' });
  g.fetch = patched as typeof fetch;
  return () => {
    if (g.fetch === (patched as unknown)) g.fetch = original;
  };
}

function captureResponse(rec: Recorder, call: ReturnType<Recorder['begin']>, res: Response): void {
  const headers = headersToObject(res.headers);
  const ct = headers['content-type'];
  const base = { status: res.status, statusText: res.statusText, responseHeaders: headers };
  if (res.type === 'opaque' || !rec.opts.captureBodies || isBinaryOrStream(ct) || res.body == null) {
    rec.finish(call, base);
    return;
  }
  let clone: Response;
  try {
    clone = res.clone();
  } catch {
    rec.finish(call, base);
    return;
  }
  clone.text().then(
    (text) => rec.finish(call, { ...base, responseBody: text }),
    (err) => rec.finish(call, { ...base, error: errorMessage(err) }),
  );
}

function wrapJson(res: Response, call: ReturnType<Recorder['begin']>): void {
  const original = res.json.bind(res);
  try {
    Object.defineProperty(res, 'json', {
      configurable: true,
      value: async () => trackUsage(await original(), call),
    });
  } catch {
    /* non-extensible */
  }
}

export function buildMockResponse(rule: MockRule): Response {
  const status = rule.status ?? 200;
  if (status === 0) throw new TypeError('Failed to fetch (mocked network error)');
  const noBody = status === 204 || status === 205 || status === 304;
  const body = rule.body ?? '';
  const headers = new Headers(rule.headers ?? {});
  if (!headers.has('content-type') && /^\s*[[{]/.test(body)) headers.set('content-type', 'application/json');
  headers.set('x-api-pingpong-mock', '1');
  return new Response(noBody ? null : body, { status: Math.min(Math.max(status, 200), 599), statusText: 'Mocked', headers });
}

function errorMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'name' in err && (err as Error).name === 'AbortError') return 'Aborted';
  return err instanceof Error ? err.message : String(err);
}
