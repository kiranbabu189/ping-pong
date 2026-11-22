import type { ApiCall } from '../core/types';
import { percentile } from '../core/utils';

export interface EndpointStats {
  key: string;
  method: string;
  /** Display label: pattern, or GraphQL "query GetLeads". */
  label: string;
  pattern: string;
  origin: string;
  calls: ApiCall[];
  count: number;
  errors: number;
  duplicates: number;
  mocked: number;
  avg: number;
  p50: number;
  p95: number;
  max: number;
  totalBytes: number;
  slow: number;
  nPlusOne: number;
  lastTime: number;
}

export interface TreeNode {
  name: string;
  id: string;
  children: Map<string, TreeNode>;
  endpoints: EndpointStats[];
  count: number;
  errors: number;
  duplicates: number;
  slow: number;
  nPlusOne: number;
}

export type GroupBy = 'path' | 'page';

/** Separates the page from the endpoint key when grouping by page. */
export const PAGE_SEP = '\u0001';

export interface AnalysisOptions {
  slowThresholdMs: number;
  duplicateWindowMs: number;
  nPlusOneThreshold: number;
  sameOrigin: string;
}

export function endpointKey(c: ApiCall, sameOrigin: string): string {
  const host = c.origin && c.origin !== sameOrigin ? c.origin : '';
  const gql = c.graphql ? ` #${c.graphql.operationType} ${c.graphql.operationName}` : '';
  return `${c.method} ${host}${c.pattern}${gql}`;
}

export function computeEndpoints(calls: readonly ApiCall[], o: AnalysisOptions): Map<string, EndpointStats> {
  const map = new Map<string, EndpointStats>();
  for (const c of calls) {
    const key = endpointKey(c, o.sameOrigin);
    let e = map.get(key);
    if (!e) {
      e = {
        key,
        method: c.method,
        label: c.graphql ? `${c.graphql.operationType} ${c.graphql.operationName}` : c.pattern,
        pattern: c.pattern,
        origin: c.origin,
        calls: [],
        count: 0,
        errors: 0,
        duplicates: 0,
        mocked: 0,
        avg: 0,
        p50: 0,
        p95: 0,
        max: 0,
        totalBytes: 0,
        slow: 0,
        nPlusOne: 0,
        lastTime: 0,
      };
      map.set(key, e);
    }
    e.calls.push(c);
  }
  for (const e of map.values()) finalize(e, o);
  return map;
}

function finalize(e: EndpointStats, o: AnalysisOptions): void {
  const durations: number[] = [];
  for (const c of e.calls) {
    e.count++;
    if (isError(c)) e.errors++;
    if (c.duplicateOf != null) e.duplicates++;
    if (c.mocked) e.mocked++;
    if (c.duration != null && c.kind !== 'ws' && c.kind !== 'sse') {
      durations.push(c.duration);
      if (c.duration >= o.slowThresholdMs) e.slow++;
    }
    e.totalBytes += c.responseSize;
    e.lastTime = Math.max(e.lastTime, c.startTime);
  }
  durations.sort((a, b) => a - b);
  e.avg = durations.length ? durations.reduce((s, d) => s + d, 0) / durations.length : 0;
  e.p50 = percentile(durations, 50);
  e.p95 = percentile(durations, 95);
  e.max = durations[durations.length - 1] ?? 0;
  e.nPlusOne = detectNPlusOne(e.calls, o);
}

export function isError(c: ApiCall): boolean {
  if (c.pending) return false;
  if (c.kind === 'beacon') return c.ok === false;
  if (c.kind === 'ws' || c.kind === 'sse') return !!c.error;
  return !!c.error || c.status === 0 || c.status >= 400;
}

/** Largest burst of distinct concrete URLs for one pattern within the window (0 if below threshold). */
export function detectNPlusOne(calls: ApiCall[], o: Pick<AnalysisOptions, 'duplicateWindowMs' | 'nPlusOneThreshold'>): number {
  if (calls.length < o.nPlusOneThreshold) return 0;
  const sorted = [...calls].sort((a, b) => a.startTime - b.startTime);
  let best = 0;
  let lo = 0;
  const counts = new Map<string, number>();
  for (let hi = 0; hi < sorted.length; hi++) {
    counts.set(sorted[hi].url, (counts.get(sorted[hi].url) ?? 0) + 1);
    while (sorted[hi].startTime - sorted[lo].startTime > o.duplicateWindowMs) {
      const u = sorted[lo].url;
      const n = counts.get(u)! - 1;
      if (n) counts.set(u, n);
      else counts.delete(u);
      lo++;
    }
    best = Math.max(best, counts.size);
  }
  return best >= o.nPlusOneThreshold ? best : 0;
}

function newNode(name: string, id: string): TreeNode {
  return { name, id, children: new Map(), endpoints: [], count: 0, errors: 0, duplicates: 0, slow: 0, nPlusOne: 0 };
}

export function buildTree(endpoints: Iterable<EndpointStats>, groupBy: GroupBy, o: AnalysisOptions): TreeNode {
  const root = newNode('', 'root');
  for (const e of endpoints) {
    const groups = groupBy === 'page' ? splitByPage(e, o) : [{ prefix: [] as string[], stats: e }];
    for (const { prefix, stats } of groups) {
      const segs: string[] = [...prefix];
      if (stats.origin && stats.origin !== o.sameOrigin) segs.push('🌐 ' + stats.origin.replace(/^https?:\/\//, ''));
      segs.push(...stats.pattern.split('/').filter(Boolean));
      let node = root;
      const path: TreeNode[] = [root];
      for (const s of segs) {
        let child = node.children.get(s);
        if (!child) {
          child = newNode(s, `${node.id}/${s}`);
          node.children.set(s, child);
        }
        node = child;
        path.push(node);
      }
      node.endpoints.push(stats);
      for (const n of path) {
        n.count += stats.count;
        n.errors += stats.errors;
        n.duplicates += stats.duplicates;
        n.slow += stats.slow;
        if (stats.nPlusOne) n.nPlusOne++;
      }
    }
  }
  return root;
}

function splitByPage(e: EndpointStats, o: AnalysisOptions): Array<{ prefix: string[]; stats: EndpointStats }> {
  const byPage = new Map<string, ApiCall[]>();
  for (const c of e.calls) {
    const list = byPage.get(c.page) ?? [];
    list.push(c);
    byPage.set(c.page, list);
  }
  const out: Array<{ prefix: string[]; stats: EndpointStats }> = [];
  for (const [page, calls] of byPage) {
    const sub: EndpointStats = { ...e, key: `${page}${PAGE_SEP}${e.key}`, calls, count: 0, errors: 0, duplicates: 0, mocked: 0, slow: 0, totalBytes: 0, lastTime: 0 };
    finalize(sub, o);
    out.push({ prefix: [`📄 ${page}`], stats: sub });
  }
  return out;
}

export interface Insight {
  kind: 'duplicate' | 'n+1' | 'slow' | 'error' | 'overfetch';
  severity: 'high' | 'medium' | 'low';
  endpoint: EndpointStats;
  message: string;
}

export function computeInsights(endpoints: Iterable<EndpointStats>, o: AnalysisOptions): Insight[] {
  const out: Insight[] = [];
  for (const e of endpoints) {
    if (e.duplicates) {
      out.push({
        kind: 'duplicate',
        severity: e.duplicates >= 3 ? 'high' : 'medium',
        endpoint: e,
        message: `${e.duplicates} of ${e.count} calls repeated an identical request within ${o.duplicateWindowMs} ms`,
      });
    }
    if (e.nPlusOne) {
      out.push({
        kind: 'n+1',
        severity: 'high',
        endpoint: e,
        message: `${e.nPlusOne} different ${e.pattern} URLs fetched within ${o.duplicateWindowMs} ms — likely an N+1 loop; consider a batch endpoint`,
      });
    }
    if (e.slow) {
      out.push({
        kind: 'slow',
        severity: e.p95 >= o.slowThresholdMs * 3 ? 'high' : 'medium',
        endpoint: e,
        message: `${e.slow} call(s) ≥ ${o.slowThresholdMs} ms (p95 ${Math.round(e.p95)} ms, max ${Math.round(e.max)} ms)`,
      });
    }
    if (e.errors) {
      out.push({
        kind: 'error',
        severity: e.errors / e.count > 0.5 ? 'high' : 'medium',
        endpoint: e,
        message: `${e.errors} of ${e.count} calls failed`,
      });
    }
    const fu = overFetch(e);
    if (fu) out.push({ kind: 'overfetch', severity: fu.ratio < 0.2 ? 'medium' : 'low', endpoint: e, message: fu.message });
  }
  const rank = { high: 0, medium: 1, low: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity] || b.endpoint.count - a.endpoint.count);
}

function overFetch(e: EndpointStats): { ratio: number; message: string } | undefined {
  const used = new Set<string>();
  const total = new Set<string>();
  for (const c of e.calls) {
    if (!c.fieldUsage) continue;
    c.fieldUsage.used.forEach((p) => used.add(p));
    c.fieldUsage.total.forEach((p) => total.add(p));
  }
  if (total.size < 8 || used.size === 0) return undefined;
  const ratio = used.size / total.size;
  if (ratio > 0.5) return undefined;
  return { ratio, message: `UI read ${used.size} of ${total.size} response fields (${Math.round(ratio * 100)}%) — response may be over-fetching` };
}
