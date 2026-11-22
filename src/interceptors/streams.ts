import type { Recorder } from '../core/recorder';
import type { ApiCall, StreamMessage } from '../core/types';
import { byteLength } from '../core/utils';

const MAX_MESSAGES = 300;
const MAX_MESSAGE_CHARS = 4000;

function describe(data: unknown): string {
  if (typeof data === 'string') return data.length > MAX_MESSAGE_CHARS ? data.slice(0, MAX_MESSAGE_CHARS) + '…' : data;
  if (data instanceof ArrayBuffer) return `[binary ${data.byteLength}B]`;
  if (ArrayBuffer.isView(data)) return `[binary ${data.byteLength}B]`;
  if (typeof Blob !== 'undefined' && data instanceof Blob) return `[Blob ${data.size}B]`;
  return String(data);
}

function sizeOf(data: unknown): number {
  if (typeof data === 'string') return byteLength(data);
  if (data instanceof ArrayBuffer) return data.byteLength;
  if (ArrayBuffer.isView(data)) return data.byteLength;
  if (typeof Blob !== 'undefined' && data instanceof Blob) return data.size;
  return 0;
}

function push(rec: Recorder, call: ApiCall, dir: 'in' | 'out', data: unknown): void {
  const msgs = (call.messages ??= []);
  const m: StreamMessage = { dir, time: Date.now(), data: describe(data), size: sizeOf(data) };
  msgs.push(m);
  if (msgs.length > MAX_MESSAGES) msgs.shift();
  if (dir === 'in') call.responseSize += m.size;
  else call.requestSize += m.size;
  rec.store.update(call);
}

export function patchWebSocket(rec: Recorder): () => void {
  const g = globalThis as { WebSocket?: typeof WebSocket };
  const Orig = g.WebSocket;
  if (!Orig) return () => {};

  class PingPongWebSocket extends Orig {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      const href = String(url instanceof URL ? url.href : url);
      if (rec.shouldIgnore(href)) return;
      const call = rec.begin({ kind: 'ws', method: 'WS', url: href });
      (this as unknown as { __pp: ApiCall }).__pp = call;
      this.addEventListener('open', () => {
        call.status = 101;
        call.statusText = 'Switching Protocols';
        call.ok = true;
        rec.store.update(call);
      });
      this.addEventListener('message', (e) => push(rec, call, 'in', (e as MessageEvent).data));
      this.addEventListener('error', () => {
        call.error = 'WebSocket error';
        rec.store.update(call);
      });
      this.addEventListener('close', (e) => {
        const ce = e as CloseEvent;
        call.pending = false;
        call.endTime = Date.now();
        call.duration = call.endTime - call.startTime;
        call.statusText = `Closed ${ce.code}${ce.reason ? ` ${ce.reason}` : ''}`;
        rec.store.update(call);
      });
    }
    send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
      const call = (this as unknown as { __pp?: ApiCall }).__pp;
      if (call) push(rec, call, 'out', data);
      super.send(data);
    }
  }
  Object.defineProperty(PingPongWebSocket, 'name', { value: 'WebSocket' });
  g.WebSocket = PingPongWebSocket as typeof WebSocket;
  return () => {
    if (g.WebSocket === PingPongWebSocket) g.WebSocket = Orig;
  };
}

export function patchEventSource(rec: Recorder): () => void {
  const g = globalThis as { EventSource?: typeof EventSource };
  const Orig = g.EventSource;
  if (!Orig) return () => {};
  const CLOSED = Orig.CLOSED;

  class PingPongEventSource extends Orig {
    private __pp?: ApiCall;
    private __seen = new Set<string>();
    constructor(url: string | URL, init?: EventSourceInit) {
      super(url, init);
      const href = String(url instanceof URL ? url.href : url);
      if (rec.shouldIgnore(href)) return;
      const call = rec.begin({ kind: 'sse', method: 'SSE', url: href });
      this.__pp = call;
      super.addEventListener('open', () => {
        call.status = 200;
        call.ok = true;
        rec.store.update(call);
      });
      super.addEventListener('error', () => {
        if (this.readyState === CLOSED) {
          call.pending = false;
          call.endTime = Date.now();
          call.duration = call.endTime - call.startTime;
          call.statusText = 'Closed';
        } else if (!call.ok) {
          call.error = 'EventSource connection failed';
        } else {
          // Server ended the stream; the browser will reconnect. That's normal SSE behaviour.
          call.statusText = 'Reconnecting';
        }
        rec.store.update(call);
      });
      this.track('message');
    }
    private track(type: string): void {
      if (!this.__pp || this.__seen.has(type)) return;
      this.__seen.add(type);
      const call = this.__pp;
      super.addEventListener(type, (e: Event) => {
        const data = (e as MessageEvent).data;
        push(rec, call, 'in', type === 'message' ? data : `[${type}] ${data}`);
      });
    }
    // Named events only fire for listeners registered by type, so record those as they appear.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    addEventListener(type: string, listener: any, options?: boolean | AddEventListenerOptions): void {
      if (!['open', 'error'].includes(type)) this.track(type);
      super.addEventListener(type, listener, options);
    }
    close(): void {
      if (this.__pp && this.__pp.pending) {
        this.__pp.pending = false;
        this.__pp.endTime = Date.now();
        this.__pp.duration = this.__pp.endTime - this.__pp.startTime;
        this.__pp.statusText = 'Closed by client';
        rec.store.update(this.__pp);
      }
      super.close();
    }
  }
  Object.defineProperty(PingPongEventSource, 'name', { value: 'EventSource' });
  g.EventSource = PingPongEventSource as unknown as typeof EventSource;
  return () => {
    if (g.EventSource === (PingPongEventSource as unknown)) g.EventSource = Orig;
  };
}

export function patchBeacon(rec: Recorder): () => void {
  const nav = (globalThis as { navigator?: Navigator }).navigator;
  if (!nav || typeof nav.sendBeacon !== 'function') return () => {};
  const orig = nav.sendBeacon;
  const patched = function (this: Navigator, url: string | URL, data?: BodyInit | null) {
    const href = String(url instanceof URL ? url.href : url);
    const queued = orig.call(nav, url, data);
    if (!rec.shouldIgnore(href)) {
      const ser = typeof data === 'string' ? { text: data, size: byteLength(data) } : { text: data == null ? undefined : '[binary]', size: 0 };
      const call = rec.begin({ kind: 'beacon', method: 'POST', url: href, requestBody: ser.text, requestSize: ser.size });
      rec.finish(call, { status: 0, statusText: queued ? 'Beacon queued' : 'Beacon rejected', error: queued ? undefined : 'Beacon rejected by browser' });
      call.ok = queued;
    }
    return queued;
  };
  try {
    nav.sendBeacon = patched;
  } catch {
    return () => {};
  }
  return () => {
    if (nav.sendBeacon === patched) nav.sendBeacon = orig;
  };
}
