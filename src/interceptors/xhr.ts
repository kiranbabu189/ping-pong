import type { Recorder } from '../core/recorder';
import { serializeBody } from '../core/recorder';
import type { ApiCall, MockRule } from '../core/types';
import { parseRawHeaders } from '../core/utils';

interface XhrMeta {
  method: string;
  url: string;
  headers: Record<string, string>;
  call?: ApiCall;
}

const META = new WeakMap<XMLHttpRequest, XhrMeta>();

export function patchXHR(rec: Recorder): () => void {
  const X = (globalThis as { XMLHttpRequest?: typeof XMLHttpRequest }).XMLHttpRequest;
  if (!X) return () => {};
  const proto = X.prototype;
  const origOpen = proto.open;
  const origSend = proto.send;
  const origSetHeader = proto.setRequestHeader;

  proto.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
    META.set(this, { method: String(method).toUpperCase(), url: String(url instanceof URL ? url.href : url), headers: {} });
    return (origOpen as (...a: unknown[]) => void).call(this, method, url, ...rest);
  } as typeof proto.open;

  proto.setRequestHeader = function (this: XMLHttpRequest, name: string, value: string) {
    const m = META.get(this);
    if (m) {
      const k = name.toLowerCase();
      m.headers[k] = m.headers[k] ? `${m.headers[k]}, ${value}` : value;
    }
    return origSetHeader.call(this, name, value);
  };

  proto.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
    const m = META.get(this);
    if (!m || rec.shouldIgnore(absolute(m.url))) return origSend.call(this, body);

    const ser = serializeBody(body);
    let call: ApiCall;
    try {
      call = rec.begin({ kind: 'xhr', method: m.method, url: absolute(m.url), requestHeaders: m.headers, requestBody: ser.text, requestSize: ser.size });
    } catch (e) {
      console.warn('[api-pingpong] failed to record xhr', e);
      return origSend.call(this, body);
    }
    m.call = call;

    const xhr = this;
    let finished = false;
    const done = (error?: string) => {
      if (finished) return;
      finished = true;
      if (call.mocked) return; // the mock completes the call itself
      rec.finish(call, {
        status: xhr.status,
        statusText: xhr.statusText,
        responseHeaders: parseRawHeaders(xhr.getAllResponseHeaders() || ''),
        responseBody: readBody(xhr),
        error: error ?? (xhr.status === 0 ? 'Network error' : undefined),
      });
    };
    this.addEventListener('load', () => done());
    this.addEventListener('error', () => done('Network error'));
    this.addEventListener('abort', () => done('Aborted'));
    this.addEventListener('timeout', () => done('Timeout'));

    const rule = rec.findMock(m.method, call.url);
    if (rule && rule.status != null) {
      call.mocked = true;
      setTimeout(() => fakeResponse(rec, xhr, call, rule), rule.delay ?? 0);
      return;
    }
    if (rule?.delay) {
      setTimeout(() => origSend.call(xhr, body), rule.delay);
      return;
    }
    return origSend.call(this, body);
  };

  return () => {
    proto.open = origOpen;
    proto.send = origSend;
    proto.setRequestHeader = origSetHeader;
  };
}

function absolute(url: string): string {
  try {
    return new URL(url, location.href).href;
  } catch {
    return url;
  }
}

function readBody(xhr: XMLHttpRequest): string | undefined {
  try {
    const t = xhr.responseType;
    if (t === '' || t === 'text') return xhr.responseText;
    if (t === 'json') return xhr.response == null ? undefined : JSON.stringify(xhr.response);
    if (t === 'document') return xhr.responseXML ? new XMLSerializer().serializeToString(xhr.responseXML) : undefined;
  } catch {
    /* ignore */
  }
  return undefined;
}

/** Complete an XHR with a mocked response without touching the network. */
function fakeResponse(rec: Recorder, xhr: XMLHttpRequest, call: ApiCall, rule: MockRule): void {
  const status = rule.status ?? 200;
  const body = rule.body ?? '';
  const headers: Record<string, string> = { 'x-api-pingpong-mock': '1', ...(rule.headers ?? {}) };
  if (!Object.keys(headers).some((k) => k.toLowerCase() === 'content-type') && /^\s*[[{]/.test(body)) headers['content-type'] = 'application/json';
  const rawHeaders = Object.entries(headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\r\n');
  let parsedResponse: unknown = body;
  if (xhr.responseType === 'json') {
    try {
      parsedResponse = JSON.parse(body);
    } catch {
      parsedResponse = null;
    }
  }
  const def = (k: string, v: unknown) => Object.defineProperty(xhr, k, { configurable: true, get: () => v });
  def('readyState', 4);
  def('status', status);
  def('statusText', status === 0 ? '' : 'Mocked');
  def('responseURL', call.url);
  def('responseText', status === 0 ? '' : body);
  def('response', status === 0 ? null : parsedResponse);
  Object.defineProperty(xhr, 'getAllResponseHeaders', { configurable: true, value: () => (status === 0 ? '' : rawHeaders) });
  Object.defineProperty(xhr, 'getResponseHeader', {
    configurable: true,
    value: (n: string) => {
      const k = Object.keys(headers).find((h) => h.toLowerCase() === n.toLowerCase());
      return k && status !== 0 ? headers[k] : null;
    },
  });

  rec.finish(call, {
    status,
    statusText: status === 0 ? '' : 'Mocked',
    responseHeaders: status === 0 ? {} : Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])),
    responseBody: status === 0 ? undefined : body,
    error: status === 0 ? 'Mocked network error' : undefined,
  });

  const fire = (type: string) => {
    const ev = typeof ProgressEvent !== 'undefined' ? new ProgressEvent(type) : new Event(type);
    xhr.dispatchEvent(ev);
  };
  fire('readystatechange');
  fire(status === 0 ? 'error' : 'load');
  fire('loadend');
}
