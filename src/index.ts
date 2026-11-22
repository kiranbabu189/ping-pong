import type { ApiCall, MockRule, PingPongOptions, ResolvedOptions } from './core/types';
import { CallStore } from './core/store';
import { Recorder } from './core/recorder';
import { DEFAULT_REDACT_BODY_KEYS, DEFAULT_REDACT_HEADERS } from './core/redact';
import { MockStore, newRuleId } from './features/mocks';
import { SnapshotStore } from './features/snapshots';
import { toHAR, toJSONExport } from './features/export';
import { patchFetch } from './interceptors/fetch';
import { patchXHR } from './interceptors/xhr';
import { patchBeacon, patchEventSource, patchWebSocket } from './interceptors/streams';
import { PingPongUI } from './ui/panel';

export type { ApiCall, MockRule, PingPongOptions, NormalizeRule, Position, CallKind, StreamMessage, GraphQLInfo } from './core/types';
export { normalizePath } from './core/normalize';
export { toCurl, toFetchSnippet, toHAR, toJSONExport, parseImport } from './features/export';
export { toOpenAPI, toTypeScript, inferSchema } from './features/schema';
export { computeEndpoints, computeInsights, buildTree } from './features/analysis';

export interface PingPongInstance {
  open(): void;
  close(): void;
  toggle(): void;
  /** Recorded calls (live, read-only view). */
  getCalls(): readonly ApiCall[];
  clear(): void;
  pause(): void;
  resume(): void;
  addMock(rule: Omit<MockRule, 'id' | 'enabled'> & Partial<Pick<MockRule, 'id' | 'enabled'>>): MockRule;
  removeMock(id: string): void;
  exportJSON(): string;
  exportHAR(): string;
  /** Subscribe to recording changes. Returns an unsubscribe function. */
  subscribe(fn: () => void): () => void;
  destroy(): void;
}

const GLOBAL_KEY = '__API_PINGPONG__';

export function resolveOptions(o: PingPongOptions = {}): ResolvedOptions {
  return {
    enabled: o.enabled ?? true,
    position: o.position ?? 'bottom-right',
    maxCalls: o.maxCalls ?? 2000,
    duplicateWindowMs: o.duplicateWindowMs ?? 2000,
    nPlusOneThreshold: o.nPlusOneThreshold ?? 5,
    slowThresholdMs: o.slowThresholdMs ?? 1000,
    captureBodies: o.captureBodies ?? true,
    maxBodySize: o.maxBodySize ?? 100_000,
    redact: o.redact ?? true,
    redactHeaders: [...DEFAULT_REDACT_HEADERS, ...(o.redactHeaders ?? [])],
    redactBodyKeys: [...DEFAULT_REDACT_BODY_KEYS, ...(o.redactBodyKeys ?? [])],
    normalizeRules: o.normalizeRules ?? [],
    ignore: o.ignore ?? [],
    intercept: { fetch: true, xhr: true, beacon: true, websocket: true, eventSource: true, ...(o.intercept ?? {}) },
    trackFieldUsage: o.trackFieldUsage ?? false,
    hotkey: o.hotkey === undefined ? 'alt+shift+a' : o.hotkey,
    open: o.open ?? false,
    persist: o.persist ?? true,
    zIndex: o.zIndex ?? 2147483000,
  };
}

/**
 * Start recording API calls and mount the floating button.
 * Safe to call more than once (returns the existing instance) and safe during SSR (returns null).
 */
export function init(options: PingPongOptions = {}): PingPongInstance | null {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;
  const g = window as unknown as Record<string, PingPongInstance | undefined>;
  if (g[GLOBAL_KEY]) return g[GLOBAL_KEY]!;
  const opts = resolveOptions(options);
  if (!opts.enabled) return null;

  const store = new CallStore(opts.maxCalls, opts.duplicateWindowMs);
  const mocks = new MockStore(opts.persist);
  const snapshots = new SnapshotStore(opts.persist);
  const rec = new Recorder(opts, store, mocks);

  // Patch immediately so calls made before the DOM is ready are captured.
  const unpatch: Array<() => void> = [];
  if (opts.intercept.fetch) unpatch.push(patchFetch(rec));
  if (opts.intercept.xhr) unpatch.push(patchXHR(rec));
  if (opts.intercept.beacon) unpatch.push(patchBeacon(rec));
  if (opts.intercept.websocket) unpatch.push(patchWebSocket(rec));
  if (opts.intercept.eventSource) unpatch.push(patchEventSource(rec));

  let ui: PingPongUI | null = null;
  const mount = () => {
    if (!ui && g[GLOBAL_KEY] === instance) ui = new PingPongUI(rec, snapshots, opts);
  };

  const instance: PingPongInstance = {
    open: () => ui?.toggle(true),
    close: () => ui?.toggle(false),
    toggle: () => ui?.toggle(),
    getCalls: () => store.calls,
    clear: () => store.clear(),
    pause: () => {
      rec.paused = true;
      store.update();
    },
    resume: () => {
      rec.paused = false;
      store.update();
    },
    addMock: (rule) => {
      const full: MockRule = { enabled: true, id: newRuleId(), ...rule };
      mocks.upsert(full);
      return full;
    },
    removeMock: (id) => mocks.remove(id),
    exportJSON: () => toJSONExport(store.calls),
    exportHAR: () => toHAR(store.calls),
    subscribe: (fn) => store.subscribe(fn),
    destroy: () => {
      unpatch.reverse().forEach((u) => u());
      ui?.destroy();
      ui = null;
      if (g[GLOBAL_KEY] === instance) delete g[GLOBAL_KEY];
    },
  };
  g[GLOBAL_KEY] = instance;

  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount, { once: true });
  return instance;
}

/** The running instance, if any. */
export function getInstance(): PingPongInstance | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as Record<string, PingPongInstance | undefined>)[GLOBAL_KEY] ?? null;
}

export function destroy(): void {
  getInstance()?.destroy();
}
