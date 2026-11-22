import type { EndpointStats } from './analysis';
import { loadJSON, saveJSON } from '../core/utils';

const KEY = 'api-pingpong:snapshots';
const MAX = 20;

export interface SnapshotEntry {
  method: string;
  label: string;
  count: number;
  duplicates: number;
  errors: number;
  avg: number;
  bytes: number;
}

export interface Snapshot {
  id: string;
  name: string;
  createdAt: number;
  totalCalls: number;
  endpoints: Record<string, SnapshotEntry>;
}

export interface DiffRow {
  key: string;
  method: string;
  label: string;
  before?: SnapshotEntry;
  after?: SnapshotEntry;
  deltaCount: number;
  status: 'added' | 'removed' | 'changed' | 'same';
}

export class SnapshotStore {
  list: Snapshot[];
  constructor(private persist: boolean) {
    this.list = persist ? loadJSON<Snapshot[]>(KEY, []) : [];
  }

  take(name: string, endpoints: Iterable<EndpointStats>): Snapshot {
    const snap: Snapshot = { id: Math.random().toString(36).slice(2, 10), name, createdAt: Date.now(), totalCalls: 0, endpoints: {} };
    for (const e of endpoints) {
      snap.totalCalls += e.count;
      snap.endpoints[e.key] = { method: e.method, label: e.label, count: e.count, duplicates: e.duplicates, errors: e.errors, avg: Math.round(e.avg), bytes: e.totalBytes };
    }
    this.list.unshift(snap);
    this.list = this.list.slice(0, MAX);
    this.save();
    return snap;
  }

  remove(id: string): void {
    this.list = this.list.filter((s) => s.id !== id);
    this.save();
  }

  get(id: string): Snapshot | undefined {
    return this.list.find((s) => s.id === id);
  }

  private save(): void {
    if (this.persist) saveJSON(KEY, this.list);
  }
}

export function diffSnapshots(before: Snapshot, after: Snapshot): DiffRow[] {
  const keys = new Set([...Object.keys(before.endpoints), ...Object.keys(after.endpoints)]);
  const rows: DiffRow[] = [];
  for (const key of keys) {
    const b = before.endpoints[key];
    const a = after.endpoints[key];
    const ref = (a ?? b)!;
    const deltaCount = (a?.count ?? 0) - (b?.count ?? 0);
    const status = !b ? 'added' : !a ? 'removed' : deltaCount || a.duplicates !== b.duplicates || a.errors !== b.errors ? 'changed' : 'same';
    rows.push({ key, method: ref.method, label: ref.label, before: b, after: a, deltaCount, status });
  }
  const order = { added: 1, removed: 1, changed: 0, same: 2 };
  return rows.sort((x, y) => order[x.status] - order[y.status] || Math.abs(y.deltaCount) - Math.abs(x.deltaCount));
}
