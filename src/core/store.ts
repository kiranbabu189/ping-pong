import type { ApiCall } from './types';
import { hashString } from './utils';

type Listener = () => void;

export class CallStore {
  private list: ApiCall[] = [];
  private byId = new Map<number, ApiCall>();
  private listeners = new Set<Listener>();
  private lastSeen = new Map<string, { id: number; time: number }>();
  private nextId = 1;
  private scheduled = false;
  /** Bumped on every change so views can cheaply detect staleness. */
  version = 0;
  onEvict?: (call: ApiCall) => void;

  constructor(
    private maxCalls: number,
    private duplicateWindowMs: number,
  ) {}

  get calls(): readonly ApiCall[] {
    return this.list;
  }

  get(id: number): ApiCall | undefined {
    return this.byId.get(id);
  }

  add(call: Omit<ApiCall, 'id'> & { id?: number }): ApiCall {
    const c = call as ApiCall;
    c.id = this.nextId++;
    if (!c.imported && c.kind !== 'ws' && c.kind !== 'sse') this.markDuplicate(c);
    this.list.push(c);
    this.byId.set(c.id, c);
    while (this.list.length > this.maxCalls) {
      const evicted = this.list.shift()!;
      this.byId.delete(evicted.id);
      this.onEvict?.(evicted);
    }
    this.changed();
    return c;
  }

  /** Re-check duplicate status once a body that was read asynchronously is known. */
  recheckDuplicate(c: ApiCall): void {
    c.duplicateOf = undefined;
    this.markDuplicate(c);
    this.changed();
  }

  private markDuplicate(c: ApiCall): void {
    const key = `${c.method} ${c.url} ${hashString(c.requestBody ?? '')}`;
    const prev = this.lastSeen.get(key);
    if (prev && prev.id !== c.id && c.startTime - prev.time <= this.duplicateWindowMs) {
      c.duplicateOf = prev.id;
    }
    // Keep pointing at the first call of a burst so the whole burst links to it.
    this.lastSeen.set(key, { id: c.duplicateOf ?? c.id, time: c.startTime });
    if (this.lastSeen.size > this.maxCalls * 2) {
      const cutoff = c.startTime - this.duplicateWindowMs;
      for (const [k, v] of this.lastSeen) if (v.time < cutoff) this.lastSeen.delete(k);
    }
  }

  update(_call?: ApiCall): void {
    this.changed();
  }

  clear(): void {
    for (const c of this.list) this.onEvict?.(c);
    this.list = [];
    this.byId.clear();
    this.lastSeen.clear();
    this.changed();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed(): void {
    this.version++;
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      for (const l of this.listeners) {
        try {
          l();
        } catch (e) {
          console.error('[api-pingpong] listener error', e);
        }
      }
    });
  }
}
