import type { ApiCall, CallKind, MockRule, ResolvedOptions } from './types';
import type { CallStore } from './store';
import type { MockStore } from '../features/mocks';
import { currentPage, normalizePath, parseUrl } from './normalize';
import { redactBody, redactHeaders } from './redact';
import { byteLength, truncate } from './utils';
import { captureInitiator } from '../features/initiator';
import { detectGraphQL } from '../features/graphql';

export interface BeginInput {
  kind: CallKind;
  method: string;
  url: string;
  requestHeaders?: Record<string, string>;
  requestBody?: string;
  requestSize?: number;
}

export interface FinishInput {
  status: number;
  statusText?: string;
  responseHeaders?: Record<string, string>;
  responseBody?: string;
  responseSize?: number;
  error?: string;
}

interface Secrets {
  headers: Record<string, string>;
  body?: string;
}

/** Shared glue between interceptors, the store, mocks and options. */
export class Recorder {
  /** Unredacted request data, memory-only, used for replay and "cURL + auth". */
  private secrets = new Map<number, Secrets>();
  private pendingReplayOf: number | undefined;
  originalFetch: typeof fetch | undefined;
  /** When true, nothing new is recorded (requests still go through untouched). */
  paused = false;

  constructor(
    public opts: ResolvedOptions,
    public store: CallStore,
    public mocks: MockStore,
  ) {
    store.onEvict = (c) => this.secrets.delete(c.id);
  }

  shouldIgnore(url: string): boolean {
    if (this.paused) return true;
    return this.opts.ignore.some((p) => (typeof p === 'string' ? url.includes(p) : p.test(url)));
  }

  findMock(method: string, url: string): MockRule | undefined {
    if (!this.mocks.rules.length) return undefined;
    const p = parseUrl(url);
    return this.mocks.find({ method, url: p.url, path: p.path, pattern: normalizePath(p.path, this.opts.normalizeRules) });
  }

  begin(input: BeginInput): ApiCall {
    const p = parseUrl(input.url);
    const rawHeaders = input.requestHeaders ?? {};
    const { opts } = this;
    const rawBody = input.requestBody;
    const bodyForStore = opts.captureBodies ? clip(rawBody, opts.maxBodySize).text : undefined;

    const call = this.store.add({
      kind: input.kind,
      method: input.method.toUpperCase(),
      url: p.url,
      origin: p.origin,
      path: p.path,
      pattern: normalizePath(p.path, opts.normalizeRules),
      query: p.query,
      page: currentPage(),
      startTime: Date.now(),
      status: 0,
      pending: true,
      requestHeaders: opts.redact ? redactHeaders(rawHeaders, opts.redactHeaders) : rawHeaders,
      responseHeaders: {},
      requestBody: opts.redact ? redactBody(bodyForStore, opts.redactBodyKeys) : bodyForStore,
      requestSize: input.requestSize ?? byteLength(rawBody),
      responseSize: 0,
      initiator: captureInitiator(),
      graphql: detectGraphQL(p.path, p.query, rawBody),
      replayOf: this.consumeReplay(),
    });
    this.secrets.set(call.id, { headers: rawHeaders, body: rawBody });
    return call;
  }

  /** Attach a request body that could only be read asynchronously (fetch(Request)). */
  setRequestBody(call: ApiCall, body: string | undefined): void {
    if (body == null) return;
    const s = this.secrets.get(call.id);
    if (s) s.body = body;
    const clipped = this.opts.captureBodies ? clip(body, this.opts.maxBodySize).text : undefined;
    call.requestBody = this.opts.redact ? redactBody(clipped, this.opts.redactBodyKeys) : clipped;
    call.requestSize = byteLength(body);
    call.graphql = detectGraphQL(call.path, call.query, body);
    this.store.recheckDuplicate(call);
  }

  finish(call: ApiCall, out: FinishInput): void {
    const { opts } = this;
    call.endTime = Date.now();
    call.duration = call.endTime - call.startTime;
    call.status = out.status;
    call.statusText = out.statusText;
    call.ok = out.status >= 200 && out.status < 400;
    call.error = out.error;
    call.pending = false;
    const rh = out.responseHeaders ?? {};
    call.responseHeaders = opts.redact ? redactHeaders(rh, opts.redactHeaders) : rh;
    call.contentType = rh['content-type'];
    if (out.responseBody != null && opts.captureBodies) {
      const t = clip(out.responseBody, opts.maxBodySize);
      call.responseBody = opts.redact && !t.truncated ? redactBody(t.text, opts.redactBodyKeys) : t.text;
      call.responseBodyTruncated = t.truncated;
    }
    call.responseSize = out.responseSize ?? (Number(rh['content-length']) || byteLength(out.responseBody));
    this.store.update(call);
  }

  secretsFor(id: number): Secrets | undefined {
    return this.secrets.get(id);
  }

  /** Re-issue a recorded call through the (patched) fetch so the replay is recorded too. */
  async replay(call: ApiCall): Promise<void> {
    const s = this.secrets.get(call.id);
    const headers = { ...(s?.headers ?? call.requestHeaders) };
    delete headers['content-length'];
    const body = s?.body ?? call.requestBody;
    const hasBody = body != null && !['GET', 'HEAD'].includes(call.method);
    this.pendingReplayOf = call.id;
    try {
      await fetch(call.url, {
        method: call.method,
        headers,
        body: hasBody ? body : undefined,
        credentials: call.origin === location.origin ? 'same-origin' : 'include',
      });
    } catch {
      /* failure is recorded on the replayed call */
    } finally {
      this.pendingReplayOf = undefined;
    }
  }

  private consumeReplay(): number | undefined {
    const id = this.pendingReplayOf;
    this.pendingReplayOf = undefined;
    return id;
  }
}

function clip(s: string | undefined, max: number): { text: string | undefined; truncated: boolean } {
  if (s == null) return { text: undefined, truncated: false };
  return truncate(s, max);
}

export function serializeBody(body: unknown): { text?: string; size: number } {
  if (body == null) return { size: 0 };
  if (typeof body === 'string') return { text: body, size: new Blob([body]).size };
  if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
    const t = body.toString();
    return { text: t, size: t.length };
  }
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    const parts: string[] = [];
    let size = 0;
    body.forEach((v, k) => {
      if (typeof v === 'string') {
        parts.push(`${k}=${v}`);
        size += v.length;
      } else {
        parts.push(`${k}=[File ${(v as File).name} ${(v as File).size}B]`);
        size += (v as File).size;
      }
    });
    return { text: `[FormData]\n${parts.join('\n')}`, size };
  }
  if (typeof Blob !== 'undefined' && body instanceof Blob) return { text: `[Blob ${body.type || 'binary'} ${body.size}B]`, size: body.size };
  if (body instanceof ArrayBuffer) return { text: `[binary ${body.byteLength}B]`, size: body.byteLength };
  if (ArrayBuffer.isView(body)) return { text: `[binary ${body.byteLength}B]`, size: body.byteLength };
  if (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream) return { text: '[stream]', size: 0 };
  if (typeof Document !== 'undefined' && body instanceof Document) {
    const t = new XMLSerializer().serializeToString(body);
    return { text: t, size: t.length };
  }
  const t = String(body);
  return { text: t, size: t.length };
}

/** Content types whose bodies are not worth reading as text. */
export function isBinaryOrStream(ct: string | undefined): boolean {
  if (!ct) return false;
  return /^(image|video|audio|font)\/|octet-stream|application\/(pdf|zip|wasm)|text\/event-stream|multipart\//i.test(ct);
}
