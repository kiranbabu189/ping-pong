import type { MockRule } from '../core/types';
import { loadJSON, saveJSON, wildcardToRegExp } from '../core/utils';

const KEY = 'api-pingpong:mocks';

export interface MatchTarget {
  method: string;
  url: string;
  path: string;
  pattern: string;
}

export class MockStore {
  rules: MockRule[];
  private listeners = new Set<() => void>();

  constructor(private persist: boolean) {
    this.rules = persist ? loadJSON<MockRule[]>(KEY, []) : [];
  }

  find(t: MatchTarget): MockRule | undefined {
    return this.rules.find((r) => r.enabled && ruleMatches(r, t));
  }

  upsert(rule: MockRule): void {
    const i = this.rules.findIndex((r) => r.id === rule.id);
    if (i >= 0) this.rules[i] = rule;
    else this.rules.push(rule);
    this.save();
  }

  remove(id: string): void {
    this.rules = this.rules.filter((r) => r.id !== id);
    this.save();
  }

  toggle(id: string): void {
    const r = this.rules.find((x) => x.id === id);
    if (r) r.enabled = !r.enabled;
    this.save();
  }

  get activeCount(): number {
    return this.rules.filter((r) => r.enabled).length;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private save(): void {
    if (this.persist) saveJSON(KEY, this.rules);
    this.listeners.forEach((l) => l());
  }
}

export function ruleMatches(r: MockRule, t: MatchTarget): boolean {
  if (r.method !== '*' && r.method.toUpperCase() !== t.method.toUpperCase()) return false;
  const m = r.match.trim();
  if (!m) return false;
  if (m === t.pattern || m === t.path || m === t.url) return true;
  if (m.includes('*')) {
    const re = wildcardToRegExp(m);
    return re.test(t.pattern) || re.test(t.path) || re.test(t.url);
  }
  // A rule written with params (/api/lead/:id) matches concrete paths with the same shape.
  if (m.includes(':')) {
    const re = new RegExp('^' + m.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/:[A-Za-z_]+/g, '[^/]+') + '$');
    return re.test(t.path);
  }
  return false;
}

export function newRuleId(): string {
  return Math.random().toString(36).slice(2, 10);
}
