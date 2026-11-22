import type { Recorder } from '../core/recorder';
import type { ApiCall, MockRule, ResolvedOptions } from '../core/types';
import type { SnapshotStore } from '../features/snapshots';
import { diffSnapshots, type Snapshot } from '../features/snapshots';
import {
  buildTree,
  computeEndpoints,
  computeInsights,
  isError,
  type AnalysisOptions,
  type EndpointStats,
  type GroupBy,
  type Insight,
  type TreeNode,
  PAGE_SEP,
} from '../features/analysis';
import { parseImport, toCurl, toFetchSnippet, toHAR, toJSONExport } from '../features/export';
import { toOpenAPI, toTypeScript } from '../features/schema';
import { shortInitiator } from '../features/initiator';
import { newRuleId } from '../features/mocks';
import { formatBytes, formatMs, loadJSON, saveJSON } from '../core/utils';
import { ICON, STYLES } from './styles';

type Tab = 'calls' | 'insights' | 'mocks' | 'compare' | 'export';
type View = { type: 'tree' } | { type: 'endpoint'; key: string } | { type: 'call'; id: number };
type Flag = 'errors' | 'dupes' | 'slow' | 'mocked';

const UI_KEY = 'api-pingpong:ui';
const METHODS = ['ALL', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'WS', 'SSE'];

interface PersistedUI {
  fab?: { x: number; y: number };
  tab?: Tab;
  groupBy?: GroupBy;
  large?: boolean;
  open?: boolean;
}

const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export class PingPongUI {
  private host: HTMLElement;
  private root: ShadowRoot;
  private wrap!: HTMLElement;
  private fab!: HTMLButtonElement;
  private panel!: HTMLElement;
  private bodyEl!: HTMLElement;
  private toolbarEl!: HTMLElement;
  private tabsEl!: HTMLElement;
  private summaryEl!: HTMLElement;

  private open = false;
  private tab: Tab = 'calls';
  private views: View[] = [{ type: 'tree' }];
  private groupBy: GroupBy = 'path';
  private q = '';
  private method = 'ALL';
  private flags = new Set<Flag>();
  private collapsed = new Set<string>();
  private large = false;
  private fabPos = { x: 0, y: 0 };
  private editingRule: MockRule | null = null;
  private compareA = '';
  private compareB = 'current';
  private renderTimer: ReturnType<typeof setTimeout> | null = null;
  private lastRender = 0;
  private cleanups: Array<() => void> = [];
  private lastTreeIds: string[] = [];

  constructor(
    private rec: Recorder,
    private snapshots: SnapshotStore,
    private opts: ResolvedOptions,
  ) {
    const saved = opts.persist ? loadJSON<PersistedUI>(UI_KEY, {}) : {};
    this.tab = saved.tab ?? 'calls';
    this.groupBy = saved.groupBy ?? 'path';
    this.large = saved.large ?? false;
    this.open = opts.open || !!saved.open;

    this.host = document.createElement('api-pingpong');
    this.host.setAttribute('data-api-pingpong', '');
    this.host.style.cssText = `position:fixed;top:0;left:0;width:0;height:0;z-index:${opts.zIndex};`;
    this.root = this.host.attachShadow({ mode: 'open' });
    this.build();
    this.fabPos = this.clampFab(saved.fab ?? this.defaultFabPos());
    this.placeFab();
    (document.body ?? document.documentElement).appendChild(this.host);

    this.cleanups.push(rec.store.subscribe(() => this.onData()));
    this.cleanups.push(rec.mocks.subscribe(() => this.onData()));
    this.listen(window, 'resize', () => {
      this.fabPos = this.clampFab(this.fabPos);
      this.placeFab();
      this.placePanel();
    });
    if (opts.hotkey) this.listen(window, 'keydown', (e) => this.onKey(e as KeyboardEvent), true);
    this.updateFab();
    if (this.open) this.setOpen(true);
  }

  destroy(): void {
    this.cleanups.forEach((c) => c());
    if (this.renderTimer) clearTimeout(this.renderTimer);
    this.host.remove();
  }

  toggle(force?: boolean): void {
    this.setOpen(force ?? !this.open);
  }

  // ------------------------------------------------------------------ setup

  private build(): void {
    const style = document.createElement('style');
    style.textContent = STYLES;
    this.wrap = document.createElement('div');
    this.wrap.className = 'pp';
    this.wrap.innerHTML = `
      <button class="fab" part="fab" aria-label="Open api-pingpong (API calls)" title="api-pingpong${this.opts.hotkey ? ` (${esc(this.opts.hotkey)})` : ''}">${ICON}<span class="badge">0</span></button>
      <section class="panel" role="dialog" aria-label="api-pingpong" hidden>
        <div class="head">
          <span class="title">${ICON}api-pingpong</span>
          <span class="summary"></span>
          <button class="icon-btn" data-act="pause" title="Pause / resume recording">⏸</button>
          <button class="icon-btn" data-act="clear" title="Clear recorded calls">⌫</button>
          <button class="icon-btn" data-act="large" title="Toggle size">⤢</button>
          <button class="icon-btn" data-act="close" title="Close" aria-label="Close">✕</button>
        </div>
        <nav class="tabs" role="tablist"></nav>
        <div class="toolbar"></div>
        <div class="body"></div>
      </section>`;
    this.root.append(style, this.wrap);
    this.fab = this.wrap.querySelector('.fab')!;
    this.panel = this.wrap.querySelector('.panel')!;
    this.bodyEl = this.wrap.querySelector('.body')!;
    this.toolbarEl = this.wrap.querySelector('.toolbar')!;
    this.tabsEl = this.wrap.querySelector('.tabs')!;
    this.summaryEl = this.wrap.querySelector('.summary')!;

    this.setupDrag();
    this.root.addEventListener('click', (e) => this.onClick(e as MouseEvent));
    this.root.addEventListener('input', (e) => this.onInput(e));
    this.root.addEventListener('change', (e) => this.onChange(e));
    // Keep keystrokes inside the panel from triggering host-app shortcuts.
    this.panel.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (this.views.length > 1) this.back();
        else this.setOpen(false);
      }
      e.stopPropagation();
    });
  }

  private listen(t: EventTarget, type: string, fn: (e: Event) => void, capture = false): void {
    t.addEventListener(type, fn, capture);
    this.cleanups.push(() => t.removeEventListener(type, fn, capture));
  }

  private defaultFabPos(): { x: number; y: number } {
    const m = 20;
    const s = 46;
    const right = window.innerWidth - s - m;
    const bottom = window.innerHeight - s - m;
    switch (this.opts.position) {
      case 'bottom-left':
        return { x: m, y: bottom };
      case 'top-right':
        return { x: right, y: m };
      case 'top-left':
        return { x: m, y: m };
      default:
        return { x: right, y: bottom };
    }
  }

  private clampFab(p: { x: number; y: number }): { x: number; y: number } {
    return { x: Math.max(4, Math.min(window.innerWidth - 50, p.x)), y: Math.max(4, Math.min(window.innerHeight - 50, p.y)) };
  }

  private placeFab(): void {
    this.fab.style.left = `${this.fabPos.x}px`;
    this.fab.style.top = `${this.fabPos.y}px`;
  }

  private placePanel(): void {
    const s = this.panel.style;
    s.left = s.right = s.top = s.bottom = '';
    if (window.innerWidth <= 520) {
      // Phones: pin to the top so the floating button stays reachable below.
      s.transform = '';
      s.left = '8px';
      s.top = '8px';
      return;
    }
    if (this.large) {
      s.left = '50%';
      s.top = '50%';
      s.transform = 'translate(-50%, -50%)';
      return;
    }
    s.transform = '';
    const { x, y } = this.fabPos;
    if (x + 23 > window.innerWidth / 2) s.right = `${Math.max(8, window.innerWidth - x - 46)}px`;
    else s.left = `${Math.max(8, x)}px`;
    if (y + 23 > window.innerHeight / 2) s.bottom = `${Math.max(8, window.innerHeight - y + 8)}px`;
    else s.top = `${y + 54}px`;
  }

  private setupDrag(): void {
    let start: { px: number; py: number; x: number; y: number } | null = null;
    let dragged = false;
    this.fab.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      start = { px: e.clientX, py: e.clientY, x: this.fabPos.x, y: this.fabPos.y };
      dragged = false;
      this.fab.setPointerCapture(e.pointerId);
    });
    this.fab.addEventListener('pointermove', (e) => {
      if (!start) return;
      const dx = e.clientX - start.px;
      const dy = e.clientY - start.py;
      if (!dragged && Math.hypot(dx, dy) < 5) return;
      dragged = true;
      this.fabPos = this.clampFab({ x: start.x + dx, y: start.y + dy });
      this.placeFab();
      if (this.open) this.placePanel();
    });
    const end = () => {
      if (!start) return;
      start = null;
      if (dragged) this.persist();
    };
    this.fab.addEventListener('pointerup', end);
    this.fab.addEventListener('pointercancel', end);
    this.fab.addEventListener('click', (e) => {
      e.stopPropagation();
      if (dragged) {
        dragged = false;
        return;
      }
      this.toggle();
    });
  }

  private persist(): void {
    if (!this.opts.persist) return;
    saveJSON(UI_KEY, { fab: this.fabPos, tab: this.tab, groupBy: this.groupBy, large: this.large, open: this.open } satisfies PersistedUI);
  }

  private onKey(e: KeyboardEvent): void {
    const hk = this.opts.hotkey;
    if (!hk) return;
    const parts = hk.toLowerCase().split('+');
    const key = parts[parts.length - 1];
    const want = (m: string) => parts.includes(m);
    if (want('alt') !== e.altKey || want('shift') !== e.shiftKey || want('ctrl') !== e.ctrlKey || (want('meta') || want('cmd')) !== e.metaKey) return;
    const code = e.code.toLowerCase();
    if (code === `key${key}` || code === `digit${key}` || e.key.toLowerCase() === key) {
      e.preventDefault();
      this.toggle();
    }
  }

  private setOpen(open: boolean): void {
    this.open = open;
    this.panel.hidden = !open;
    this.fab.setAttribute('aria-expanded', String(open));
    this.persist();
    if (open) {
      this.panel.classList.toggle('large', this.large);
      this.placePanel();
      this.renderAll();
    }
  }

  // ------------------------------------------------------------------ data

  private analysisOpts(): AnalysisOptions {
    return {
      slowThresholdMs: this.opts.slowThresholdMs,
      duplicateWindowMs: this.opts.duplicateWindowMs,
      nPlusOneThreshold: this.opts.nPlusOneThreshold,
      sameOrigin: location.origin,
    };
  }

  private filteredCalls(): ApiCall[] {
    const q = this.q.trim().toLowerCase();
    const slow = this.opts.slowThresholdMs;
    return this.rec.store.calls.filter((c) => {
      if (this.method !== 'ALL' && c.method !== this.method) return false;
      if (this.flags.has('errors') && !isError(c)) return false;
      if (this.flags.has('dupes') && c.duplicateOf == null) return false;
      if (this.flags.has('slow') && !((c.duration ?? 0) >= slow && c.kind !== 'ws' && c.kind !== 'sse')) return false;
      if (this.flags.has('mocked') && !c.mocked) return false;
      if (!q) return true;
      return (
        c.url.toLowerCase().includes(q) ||
        c.pattern.toLowerCase().includes(q) ||
        String(c.status) === q ||
        c.page.toLowerCase().includes(q) ||
        (c.graphql?.operationName.toLowerCase().includes(q) ?? false)
      );
    });
  }

  private endpointByKey(key: string): EndpointStats | undefined {
    const [page, base] = key.includes(PAGE_SEP) ? key.split(PAGE_SEP) : [undefined, key];
    const calls = page ? this.rec.store.calls.filter((c) => c.page === page) : this.rec.store.calls;
    return computeEndpoints(calls, this.analysisOpts()).get(base);
  }

  private onData(): void {
    this.updateFab();
    if (!this.open) return;
    this.updateHeader();
    const v = this.currentView();
    const live =
      (this.tab === 'calls' && (v.type !== 'call' || this.isLiveCall(v.id))) || this.tab === 'insights';
    if (live) this.scheduleRender();
    else this.renderTabs();
  }

  private isLiveCall(id: number): boolean {
    const c = this.rec.store.get(id);
    return !!c && (c.pending || c.kind === 'ws' || c.kind === 'sse');
  }

  private scheduleRender(): void {
    if (this.renderTimer) return;
    const wait = Math.max(0, 150 - (Date.now() - this.lastRender));
    this.renderTimer = setTimeout(() => {
      this.renderTimer = null;
      requestAnimationFrame(() => this.renderBody());
    }, wait);
  }

  private updateFab(): void {
    const calls = this.rec.store.calls;
    let alert = false;
    for (let i = calls.length - 1; i >= 0 && i >= calls.length - 500; i--) {
      if (calls[i].duplicateOf != null || isError(calls[i])) {
        alert = true;
        break;
      }
    }
    const badge = this.fab.querySelector('.badge')!;
    badge.textContent = calls.length > 999 ? '999+' : String(calls.length);
    this.fab.classList.toggle('alert', alert);
    this.fab.classList.toggle('paused', this.rec.paused);
  }

  private updateHeader(): void {
    const calls = this.rec.store.calls;
    let errors = 0;
    let dupes = 0;
    const eps = new Set<string>();
    for (const c of calls) {
      if (isError(c)) errors++;
      if (c.duplicateOf != null) dupes++;
      eps.add(`${c.method} ${c.origin}${c.pattern}`);
    }
    const n = (k: number, word: string) => `${k} ${word}${k === 1 ? '' : 's'}`;
    const parts = [n(calls.length, 'call'), n(eps.size, 'endpoint')];
    if (dupes) parts.push(n(dupes, 'dupe'));
    if (errors) parts.push(n(errors, 'error'));
    if (this.rec.mocks.activeCount) parts.push(`${this.rec.mocks.activeCount} mocks on`);
    if (this.rec.paused) parts.push('paused');
    this.summaryEl.textContent = parts.join(' · ');
    const pauseBtn = this.wrap.querySelector('[data-act="pause"]')!;
    pauseBtn.textContent = this.rec.paused ? '▶' : '⏸';
    pauseBtn.classList.toggle('on', this.rec.paused);
  }

  // ------------------------------------------------------------------ render

  private renderAll(): void {
    this.updateHeader();
    this.renderTabs();
    this.renderToolbar();
    this.renderBody();
  }

  private renderTabs(): void {
    const insights = computeInsights(computeEndpoints(this.rec.store.calls, this.analysisOpts()).values(), this.analysisOpts());
    const high = insights.some((i) => i.severity === 'high');
    const tabs: Array<[Tab, string, string]> = [
      ['calls', 'Calls', String(this.rec.store.calls.length)],
      ['insights', 'Insights', insights.length ? String(insights.length) : ''],
      ['mocks', 'Mocks', this.rec.mocks.activeCount ? String(this.rec.mocks.activeCount) : ''],
      ['compare', 'Compare', ''],
      ['export', 'Export', ''],
    ];
    this.tabsEl.innerHTML = tabs
      .map(
        ([id, label, n]) =>
          `<button class="tab ${this.tab === id ? 'active' : ''}" role="tab" aria-selected="${this.tab === id}" data-act="tab" data-tab="${id}">${label}${
            n ? `<span class="n ${id === 'insights' && high ? 'hot' : ''}">${n}</span>` : ''
          }</button>`,
      )
      .join('');
  }

  private renderToolbar(): void {
    const show = this.tab === 'calls' && this.currentView().type === 'tree';
    this.toolbarEl.hidden = !show;
    if (!show) return;
    const chip = (f: Flag, label: string) => `<button class="chip ${this.flags.has(f) ? 'on' : ''}" data-act="flag" data-flag="${f}">${label}</button>`;
    this.toolbarEl.innerHTML = `
      <input type="search" placeholder="Filter by path, status, page, GraphQL op…" value="${esc(this.q)}" data-input="q" aria-label="Filter calls">
      <select data-change="method" aria-label="Method">${METHODS.map((m) => `<option ${m === this.method ? 'selected' : ''}>${m}</option>`).join('')}</select>
      ${chip('errors', 'Errors')}${chip('dupes', 'Dupes')}${chip('slow', 'Slow')}${chip('mocked', 'Mocked')}
      <span class="seg" role="group" aria-label="Group by">
        <button class="${this.groupBy === 'path' ? 'on' : ''}" data-act="group" data-group="path">Path</button>
        <button class="${this.groupBy === 'page' ? 'on' : ''}" data-act="group" data-group="page">Page</button>
      </span>
      <button class="icon-btn" data-act="expand-all" title="Expand all">⊞</button>
      <button class="icon-btn" data-act="collapse-all" title="Collapse all">⊟</button>`;
  }

  private renderBody(): void {
    this.lastRender = Date.now();
    const top = this.bodyEl.scrollTop;
    let html = '';
    switch (this.tab) {
      case 'calls': {
        const v = this.currentView();
        html = v.type === 'tree' ? this.renderTree() : v.type === 'endpoint' ? this.renderEndpoint(v.key) : this.renderCall(v.id);
        break;
      }
      case 'insights':
        html = this.renderInsights();
        break;
      case 'mocks':
        html = this.renderMocks();
        break;
      case 'compare':
        html = this.renderCompare();
        break;
      case 'export':
        html = this.renderExport();
        break;
    }
    this.bodyEl.innerHTML = html;
    this.bodyEl.scrollTop = top;
  }

  private renderTree(): string {
    const all = this.rec.store.calls;
    if (!all.length) {
      return `<div class="empty"><b>No API calls yet</b>fetch, XHR (axios), WebSocket, EventSource and sendBeacon calls will appear here as your app makes them.${
        this.rec.paused ? '<br><br>Recording is <b style="display:inline">paused</b> — press ▶ to resume.' : ''
      }</div>`;
    }
    const calls = this.filteredCalls();
    if (!calls.length) return `<div class="empty"><b>No calls match the filters</b>${all.length} calls recorded.</div>`;
    const ao = this.analysisOpts();
    const tree = buildTree(computeEndpoints(calls, ao).values(), this.groupBy, ao);
    this.lastTreeIds = [];
    return this.renderNode(tree, 0);
  }

  private renderNode(node: TreeNode, depth: number): string {
    let html = '';
    const pad = (d: number) => `style="padding-left:${10 + d * 16}px"`;
    const eps = [...node.endpoints].sort((a, b) => a.label.localeCompare(b.label) || a.method.localeCompare(b.method));
    for (const e of eps) html += this.endpointRow(e, pad(depth));
    const kids = [...node.children.values()].sort((a, b) => {
      // pages / hosts first in their own order, then path segments: static before params
      const ap = a.name.startsWith(':') ? 1 : 0;
      const bp = b.name.startsWith(':') ? 1 : 0;
      return ap - bp || a.name.localeCompare(b.name);
    });
    for (const child of kids) {
      this.lastTreeIds.push(child.id);
      const isOpen = !this.collapsed.has(child.id);
      const label = /^(📄|🌐)/.test(child.name) ? esc(child.name) : `/${esc(child.name)}`;
      html += `<div class="row" data-act="toggle" data-id="${esc(child.id)}" ${pad(depth)} role="treeitem" aria-expanded="${isOpen}">
        <span class="caret ${isOpen ? '' : 'closed'}">▾</span><span class="seg-name">${label}</span>
        ${this.nodeFlags(child)}<span class="grow"></span><span class="count"><b>${child.count}</b></span></div>`;
      if (isOpen) html += this.renderNode(child, depth + 1);
    }
    return html;
  }

  private nodeFlags(n: TreeNode): string {
    let s = '';
    if (n.duplicates) s += `<span class="flag dup" title="Duplicate calls">dup ${n.duplicates}</span>`;
    if (n.nPlusOne) s += `<span class="flag n1" title="N+1 pattern below">N+1</span>`;
    if (n.errors) s += `<span class="flag err" title="Failed calls">✕ ${n.errors}</span>`;
    if (n.slow) s += `<span class="flag slow" title="Slow calls">slow ${n.slow}</span>`;
    return s;
  }

  private endpointRow(e: EndpointStats, pad: string): string {
    return `<div class="row" data-act="endpoint" data-key="${esc(e.key)}" ${pad}>
      <span class="caret"></span><span class="m ${esc(e.method)}">${esc(e.method)}</span>
      <span class="ep-label" title="${esc(e.label)}">${esc(e.label)}</span>${this.endpointFlags(e)}
      <span class="grow"></span><span class="meta">${e.avg ? `avg ${formatMs(e.avg)}` : ''}</span>
      <span class="count">×<b>${e.count}</b></span></div>`;
  }

  private endpointFlags(e: EndpointStats): string {
    let s = '';
    if (e.duplicates) s += `<span class="flag dup" title="Identical request repeated within ${this.opts.duplicateWindowMs} ms">dup ×${e.duplicates}</span>`;
    if (e.nPlusOne) s += `<span class="flag n1" title="${e.nPlusOne} distinct URLs in one burst">N+1 ×${e.nPlusOne}</span>`;
    if (e.errors) s += `<span class="flag err">✕ ${e.errors}</span>`;
    if (e.slow) s += `<span class="flag slow">slow ${e.slow}</span>`;
    if (e.mocked) s += `<span class="flag mock">mocked</span>`;
    return s;
  }

  private crumbs(method: string, label: string, extra = ''): string {
    return `<div class="crumbs"><button class="icon-btn" data-act="back" aria-label="Back">←</button>
      <span class="m ${esc(method)}">${esc(method)}</span><span class="ep-label" title="${esc(label)}">${esc(label)}</span>${extra}</div>`;
  }

  private stat(k: string, v: string, cls = ''): string {
    return `<div class="stat"><div class="k">${k}</div><div class="v ${cls}">${v}</div></div>`;
  }

  private renderEndpoint(key: string): string {
    const e = this.endpointByKey(key);
    if (!e) return `${this.crumbs('', 'Endpoint')}<div class="empty"><b>No calls left for this endpoint</b>They may have been cleared.</div>`;
    const page = key.includes(PAGE_SEP) ? key.split(PAGE_SEP)[0] : '';
    const rows = [...e.calls]
      .reverse()
      .map((c) => {
        const flags = [
          c.duplicateOf != null ? `<span class="flag dup">dup of #${c.duplicateOf}</span>` : '',
          c.mocked ? `<span class="flag mock">mock</span>` : '',
          c.replayOf != null ? `<span class="flag muted">replay</span>` : '',
          c.imported ? `<span class="flag muted">imported</span>` : '',
          (c.duration ?? 0) >= this.opts.slowThresholdMs && c.kind !== 'ws' && c.kind !== 'sse' ? `<span class="flag slow">slow</span>` : '',
        ].join('');
        return `<tr class="click" data-act="call" data-id="${c.id}">
          <td class="mono">#${c.id}</td><td>${new Date(c.startTime).toLocaleTimeString()}</td>
          <td>${this.statusCell(c)}</td><td class="num">${formatMs(c.duration)}</td><td class="num">${formatBytes(c.responseSize)}</td>
          <td class="mono" title="${esc(c.url)}">${esc(c.path === c.pattern ? '' : c.path)}${Object.keys(c.query).length ? '?…' : ''}</td>
          <td>${flags}</td><td class="mono" title="${esc(c.initiator.join('\n'))}">${esc(shortInitiator(c.initiator))}</td></tr>`;
      })
      .join('');
    return `${this.crumbs(e.method, e.label, page ? `<span class="flag muted">on ${esc(page)}</span>` : '')}
      <div class="stats">
        ${this.stat('Calls', String(e.count))}
        ${this.stat('Duplicates', String(e.duplicates), e.duplicates ? 'warn' : '')}
        ${this.stat('Errors', String(e.errors), e.errors ? 'bad' : '')}
        ${this.stat('Avg', formatMs(e.avg))}${this.stat('p50', formatMs(e.p50))}
        ${this.stat('p95', formatMs(e.p95), e.p95 >= this.opts.slowThresholdMs ? 'warn' : '')}${this.stat('Max', formatMs(e.max))}
        ${this.stat('Transferred', formatBytes(e.totalBytes))}
        ${e.nPlusOne ? this.stat('N+1 burst', `${e.nPlusOne} URLs`, 'bad') : ''}
      </div>
      <div class="actions">
        <button class="btn" data-act="mock-endpoint" data-key="${esc(key)}">Mock this endpoint</button>
        <button class="btn" data-act="replay" data-id="${e.calls[e.calls.length - 1].id}">Replay latest</button>
        <button class="btn" data-act="copy-text" data-text="${esc(e.pattern)}">Copy path</button>
      </div>
      <table><thead><tr><th>#</th><th>Time</th><th>Status</th><th>Duration</th><th>Size</th><th>Path</th><th>Flags</th><th>Initiator</th></tr></thead>
      <tbody>${rows}</tbody></table>`;
  }

  private statusCell(c: ApiCall): string {
    if (c.pending) return `<span class="st-pend">pending</span>`;
    if (c.kind === 'beacon') return `<span class="${c.ok ? 'st-ok' : 'st-err'}">${esc(c.statusText)}</span>`;
    if (c.status === 0) return `<span class="st-err">${esc(c.error ?? 'failed')}</span>`;
    return `<span class="${isError(c) ? 'st-err' : 'st-ok'}">${c.status}</span>`;
  }

  private renderCall(id: number): string {
    const c = this.rec.store.get(id);
    if (!c) return `${this.crumbs('', 'Call')}<div class="empty"><b>Call #${id} is gone</b>It was cleared or evicted.</div>`;
    const secrets = this.rec.secretsFor(c.id);
    const hasHiddenAuth = !!secrets && JSON.stringify(secrets.headers) !== JSON.stringify(c.requestHeaders);
    const kv = (o: Record<string, string>) => {
      const keys = Object.keys(o);
      return keys.length ? `<div class="kv">${keys.map((k) => `<div class="k">${esc(k)}</div><div class="v">${esc(o[k])}</div>`).join('')}</div>` : `<div class="kv hint">none</div>`;
    };
    const section = (title: string, content: string, open = false, meta = '') => `<details ${open ? 'open' : ''}><summary>${title}${meta ? `<span class="meta">${meta}</span>` : ''}</summary>${content}</details>`;
    const isStream = c.kind === 'ws' || c.kind === 'sse';
    const fu = c.fieldUsage;
    const unused = fu ? fu.total.filter((p) => !fu.used.includes(p)) : [];

    return `${this.crumbs(c.method, c.graphql ? `${c.graphql.operationType} ${c.graphql.operationName}` : c.pattern, `<span class="meta">#${c.id}</span>`)}
      <div class="url">${esc(c.url)}</div>
      <div class="stats">
        ${this.stat('Status', this.statusCell(c))}
        ${this.stat('Duration', formatMs(c.duration), (c.duration ?? 0) >= this.opts.slowThresholdMs && !isStream ? 'warn' : '')}
        ${this.stat('Request', formatBytes(c.requestSize))}${this.stat('Response', formatBytes(c.responseSize))}
        ${this.stat('Started', new Date(c.startTime).toLocaleTimeString())}${this.stat('Via', c.kind)}
        ${this.stat('Page', esc(c.page))}
      </div>
      <div class="actions">
        ${!isStream ? `<button class="btn" data-act="copy-curl" data-id="${c.id}">Copy cURL</button>` : ''}
        ${!isStream && hasHiddenAuth ? `<button class="btn" data-act="copy-curl-auth" data-id="${c.id}" title="Includes real Authorization / Cookie headers">Copy cURL + auth</button>` : ''}
        ${!isStream ? `<button class="btn" data-act="copy-fetch" data-id="${c.id}">Copy fetch</button>` : ''}
        ${!isStream && c.kind !== 'beacon' ? `<button class="btn" data-act="replay" data-id="${c.id}">Replay</button>` : ''}
        ${!isStream ? `<button class="btn" data-act="mock-call" data-id="${c.id}">Mock with this response</button>` : ''}
        ${c.duplicateOf != null ? `<button class="btn" data-act="call" data-id="${c.duplicateOf}">Go to original #${c.duplicateOf}</button>` : ''}
        ${c.replayOf != null ? `<button class="btn" data-act="call" data-id="${c.replayOf}">Replayed from #${c.replayOf}</button>` : ''}
      </div>
      ${c.error ? `<div class="section"><span class="flag err">${esc(c.error)}</span></div>` : ''}
      ${c.duplicateOf != null ? `<div class="section hint">Identical ${esc(c.method)} to the same URL and body as call #${c.duplicateOf} within ${this.opts.duplicateWindowMs} ms. Common causes: effect running twice, several components fetching the same data, or missing request caching.</div>` : ''}
      ${section('Initiator', c.initiator.length ? `<pre>${esc(c.initiator.join('\n'))}</pre>` : `<div class="kv hint">not captured</div>`, true)}
      ${Object.keys(c.query).length ? section('Query params', kv(c.query), true) : ''}
      ${c.graphql ? section('GraphQL', kv({ operation: c.graphql.operationType, name: c.graphql.operationName }), true) : ''}
      ${section('Request headers', kv(c.requestHeaders), false, this.opts.redact ? 'sensitive values redacted' : '')}
      ${c.requestBody != null ? section('Request body', `<pre>${esc(pretty(c.requestBody))}</pre>`, true, formatBytes(c.requestSize)) : ''}
      ${section('Response headers', kv(c.responseHeaders))}
      ${c.responseBody != null ? section('Response body', `<pre>${esc(pretty(c.responseBody))}</pre>`, true, `${formatBytes(c.responseSize)}${c.responseBodyTruncated ? ' · truncated' : ''}`) : ''}
      ${fu ? section('Field usage', `<div class="section"><p>The UI read <b>${fu.used.length}</b> of <b>${fu.total.length}</b> fields so far.</p>${unused.length ? `<div class="hint">Never read:</div><pre>${esc(unused.slice(0, 300).join('\n'))}</pre>` : ''}</div>`, true) : ''}
      ${c.messages ? section('Messages', this.renderMessages(c), true, `${c.messages.length}`) : ''}`;
  }

  private renderMessages(c: ApiCall): string {
    const rows = [...(c.messages ?? [])]
      .reverse()
      .map((m) => `<tr><td>${m.dir === 'in' ? '↓' : '↑'}</td><td>${new Date(m.time).toLocaleTimeString()}</td><td class="num">${formatBytes(m.size)}</td><td class="mono">${esc(m.data)}</td></tr>`)
      .join('');
    return rows ? `<table><thead><tr><th></th><th>Time</th><th>Size</th><th>Data</th></tr></thead><tbody>${rows}</tbody></table>` : `<div class="kv hint">no messages yet</div>`;
  }

  private renderInsights(): string {
    const ao = this.analysisOpts();
    const insights = computeInsights(computeEndpoints(this.rec.store.calls, ao).values(), ao);
    if (!insights.length) {
      return `<div class="empty"><b>No issues found</b>Duplicate requests, N+1 bursts, slow calls (≥ ${this.opts.slowThresholdMs} ms), failures${
        this.opts.trackFieldUsage ? ' and over-fetching' : ''
      } show up here.</div>`;
    }
    const label: Record<Insight['kind'], string> = { duplicate: 'Duplicate calls', 'n+1': 'N+1 pattern', slow: 'Slow', error: 'Failing', overfetch: 'Over-fetching' };
    return insights
      .map(
        (i) => `<div class="insight" data-act="endpoint" data-key="${esc(i.endpoint.key)}">
          <span class="sev ${i.severity}"></span>
          <div><div><b>${label[i.kind]}</b> · <span class="m ${esc(i.endpoint.method)}">${esc(i.endpoint.method)}</span> <span class="mono">${esc(i.endpoint.label)}</span></div>
          <div class="msg">${esc(i.message)}</div></div></div>`,
      )
      .join('');
  }

  private renderMocks(): string {
    const r = this.editingRule;
    const form = r
      ? `<div class="form">
          <label>Method<select data-field="method">${['*', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => `<option ${m === r.method ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
          <label>Match (path, :param pattern, full URL or * wildcard)<input data-field="match" value="${esc(r.match)}" placeholder="/api/lead/:id"></label>
          <label>Status (empty = pass through, 0 = network error)<input data-field="status" type="number" min="0" max="599" value="${r.status ?? ''}"></label>
          <label>Delay (ms)<input data-field="delay" type="number" min="0" value="${r.delay ?? ''}"></label>
          <label class="full">Response body<textarea data-field="body" spellcheck="false">${esc(r.body ?? '')}</textarea></label>
          <div class="full actions" style="padding:0;border:none">
            <span class="hint">Presets:</span>
            <button class="chip" data-act="preset" data-preset="500">500 error</button>
            <button class="chip" data-act="preset" data-preset="404">404</button>
            <button class="chip" data-act="preset" data-preset="0">Network error</button>
            <button class="chip" data-act="preset" data-preset="slow">Slow 3s (real response)</button>
            <button class="chip" data-act="preset" data-preset="empty">Empty list</button>
          </div>
          <div class="full actions" style="padding:0;border:none;justify-content:flex-end">
            <button class="btn" data-act="rule-cancel">Cancel</button>
            <button class="btn primary" data-act="rule-save">Save rule</button>
          </div></div>`
      : `<div class="actions"><button class="btn primary" data-act="rule-new">+ New mock rule</button>
          <span class="hint" style="align-self:center">Override responses, simulate failures or add latency, with no backend changes.</span></div>`;
    const rules = this.rec.mocks.rules;
    const list = rules.length
      ? `<table><thead><tr><th>On</th><th>Method</th><th>Match</th><th>Status</th><th>Delay</th><th></th></tr></thead><tbody>${rules
          .map(
            (m) => `<tr><td><input type="checkbox" ${m.enabled ? 'checked' : ''} data-change="rule-toggle" data-id="${m.id}" aria-label="Enable rule"></td>
            <td><span class="m ${esc(m.method)}">${esc(m.method)}</span></td><td class="mono">${esc(m.match)}</td>
            <td>${m.status == null ? '<span class="hint">pass-through</span>' : m.status === 0 ? 'network error' : m.status}</td>
            <td>${m.delay ? `${m.delay} ms` : '—'}</td>
            <td style="white-space:nowrap"><button class="link" data-act="rule-edit" data-id="${m.id}">edit</button> · <button class="link" data-act="rule-delete" data-id="${m.id}">delete</button></td></tr>`,
          )
          .join('')}</tbody></table>`
      : `<div class="empty"><b>No mock rules</b>Open any endpoint or call and choose “Mock”, or create a rule here.</div>`;
    return form + list;
  }

  private renderCompare(): string {
    const snaps = this.snapshots.list;
    const opt = (s: Snapshot, sel: string) => `<option value="${s.id}" ${s.id === sel ? 'selected' : ''}>${esc(s.name)} (${s.totalCalls} calls, ${new Date(s.createdAt).toLocaleString()})</option>`;
    if (!this.compareA && snaps[0]) this.compareA = snaps[0].id;
    let diff = '';
    const a = this.snapshots.get(this.compareA);
    const b = this.compareB === 'current' ? this.currentSnapshot() : this.snapshots.get(this.compareB);
    if (a && b) {
      const rows = diffSnapshots(a, b);
      diff = `<table><thead><tr><th></th><th>Endpoint</th><th class="num">Before</th><th class="num">After</th><th class="num">Δ calls</th><th class="num">Dupes</th><th class="num">Avg</th></tr></thead><tbody>${rows
        .map((r) => {
          const tag = r.status === 'added' ? '<span class="flag mock">new</span>' : r.status === 'removed' ? '<span class="flag muted">gone</span>' : '';
          const d = r.deltaCount;
          return `<tr><td>${tag}</td><td><span class="m ${esc(r.method)}">${esc(r.method)}</span> <span class="mono">${esc(r.label)}</span></td>
            <td class="num">${r.before?.count ?? '—'}</td><td class="num">${r.after?.count ?? '—'}</td>
            <td class="num ${d > 0 ? 'pos' : d < 0 ? 'neg' : ''}">${d > 0 ? '+' : ''}${d || ''}</td>
            <td class="num">${r.before?.duplicates ?? 0} → ${r.after?.duplicates ?? 0}</td>
            <td class="num">${r.before ? formatMs(r.before.avg) : '—'} → ${r.after ? formatMs(r.after.avg) : '—'}</td></tr>`;
        })
        .join('')}</tbody></table>
        <div class="section hint">Total calls: ${a.totalCalls} → ${b.totalCalls} (${b.totalCalls - a.totalCalls >= 0 ? '+' : ''}${b.totalCalls - a.totalCalls})</div>`;
    }
    return `<div class="section"><h4>Snapshots</h4>
        <p>Take a snapshot, change your code (or reload), then compare to see whether a fix reduced calls, duplicates or latency. Snapshots survive reloads.</p>
        <div class="actions" style="padding:0;border:none">
          <input data-input="snapname" placeholder="Snapshot name (e.g. before fix)" style="flex:1">
          <button class="btn primary" data-act="snap-take">Take snapshot</button>
          <button class="btn" data-act="clear" title="Clear recorded calls so the next run starts fresh">Clear calls</button>
        </div></div>
      ${
        snaps.length
          ? `<div class="section"><div class="actions" style="padding:0;border:none;align-items:center">
            <label class="hint">Before <select data-change="cmpA">${snaps.map((s) => opt(s, this.compareA)).join('')}</select></label>
            <label class="hint">After <select data-change="cmpB"><option value="current" ${this.compareB === 'current' ? 'selected' : ''}>Current calls (live)</option>${snaps.map((s) => opt(s, this.compareB)).join('')}</select></label>
            <button class="btn danger" data-act="snap-delete" data-id="${esc(this.compareA)}">Delete “before” snapshot</button>
          </div></div>${diff}`
          : `<div class="empty"><b>No snapshots yet</b></div>`
      }`;
  }

  private currentSnapshot(): Snapshot {
    const eps = computeEndpoints(this.rec.store.calls, this.analysisOpts()).values();
    const s: Snapshot = { id: 'current', name: 'Current', createdAt: Date.now(), totalCalls: 0, endpoints: {} };
    for (const e of eps) {
      s.totalCalls += e.count;
      s.endpoints[e.key] = { method: e.method, label: e.label, count: e.count, duplicates: e.duplicates, errors: e.errors, avg: Math.round(e.avg), bytes: e.totalBytes };
    }
    return s;
  }

  private renderExport(): string {
    const n = this.rec.store.calls.length;
    return `<div class="section"><h4>Share a recording</h4>
        <p>Attach to a bug report; a teammate can import it here. Sensitive headers and body keys are ${this.opts.redact ? 'redacted' : '<b>NOT redacted</b> (redact: false)'}.</p>
        <div class="actions" style="padding:0;border:none">
          <button class="btn" data-act="dl-json" ${n ? '' : 'disabled'}>Download JSON</button>
          <button class="btn" data-act="dl-har" ${n ? '' : 'disabled'}>Download HAR</button>
          <label class="btn">Import JSON / HAR…<input type="file" accept=".json,.har,application/json" data-change="import" hidden></label>
        </div></div>
      <div class="section"><h4>Generate API docs and types</h4>
        <p>Infer an OpenAPI 3 spec or TypeScript types from the requests and responses observed so far. Needs captured bodies.</p>
        <div class="actions" style="padding:0;border:none">
          <button class="btn" data-act="dl-openapi" ${n ? '' : 'disabled'}>Download OpenAPI</button>
          <button class="btn" data-act="dl-ts" ${n ? '' : 'disabled'}>Download .ts types</button>
          <button class="btn" data-act="copy-ts" ${n ? '' : 'disabled'}>Copy TS types</button>
        </div></div>`;
  }

  // ------------------------------------------------------------------ events

  private currentView(): View {
    return this.views[this.views.length - 1];
  }

  private push(v: View): void {
    this.tab = 'calls';
    this.views.push(v);
    this.renderAll();
    this.bodyEl.scrollTop = 0;
  }

  private back(): void {
    if (this.views.length > 1) this.views.pop();
    this.renderAll();
  }

  private onClick(e: MouseEvent): void {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!el) return;
    const act = el.dataset.act!;
    const id = el.dataset.id;
    const callById = () => this.rec.store.get(Number(id));
    switch (act) {
      case 'close':
        return this.setOpen(false);
      case 'large':
        this.large = !this.large;
        this.panel.classList.toggle('large', this.large);
        this.placePanel();
        return this.persist();
      case 'pause':
        this.rec.paused = !this.rec.paused;
        this.updateFab();
        this.updateHeader();
        return this.toast(this.rec.paused ? 'Recording paused' : 'Recording resumed');
      case 'clear':
        this.rec.store.clear();
        this.views = [{ type: 'tree' }];
        return this.renderAll();
      case 'tab':
        this.tab = el.dataset.tab as Tab;
        if (this.tab === 'calls') this.views = [{ type: 'tree' }];
        this.persist();
        this.renderAll();
        this.bodyEl.scrollTop = 0;
        return;
      case 'flag': {
        const f = el.dataset.flag as Flag;
        if (this.flags.has(f)) this.flags.delete(f);
        else this.flags.add(f);
        this.renderToolbar();
        return this.renderBody();
      }
      case 'group':
        this.groupBy = el.dataset.group as GroupBy;
        this.persist();
        this.renderToolbar();
        return this.renderBody();
      case 'expand-all':
        this.collapsed.clear();
        return this.renderBody();
      case 'collapse-all':
        this.lastTreeIds.forEach((i) => this.collapsed.add(i));
        return this.renderBody();
      case 'toggle':
        if (this.collapsed.has(id!)) this.collapsed.delete(id!);
        else this.collapsed.add(id!);
        return this.renderBody();
      case 'endpoint':
        return this.push({ type: 'endpoint', key: el.dataset.key! });
      case 'call':
        return this.push({ type: 'call', id: Number(id) });
      case 'back':
        return this.back();
      case 'copy-text':
        return this.copy(el.dataset.text ?? '', 'Copied');
      case 'copy-curl': {
        const c = callById();
        return c && this.copy(toCurl(c), 'cURL copied (secrets redacted)');
      }
      case 'copy-curl-auth': {
        const c = callById();
        const s = c && this.rec.secretsFor(c.id);
        return c && this.copy(toCurl(c, s?.headers, s?.body ?? c.requestBody), 'cURL copied with auth headers');
      }
      case 'copy-fetch': {
        const c = callById();
        return c && this.copy(toFetchSnippet(c), 'fetch() snippet copied');
      }
      case 'replay': {
        const c = callById();
        if (!c) return;
        this.toast(`Replaying ${c.method} ${c.pattern}…`);
        void this.rec.replay(c);
        return;
      }
      case 'mock-call': {
        const c = callById();
        if (!c) return;
        return this.editMock({ id: newRuleId(), enabled: true, method: c.method, match: c.pattern, status: c.status || 200, body: c.responseBody ?? '' });
      }
      case 'mock-endpoint': {
        const ep = this.endpointByKey(el.dataset.key!);
        if (!ep) return;
        const last = [...ep.calls].reverse().find((c) => c.responseBody != null);
        return this.editMock({ id: newRuleId(), enabled: true, method: ep.method, match: ep.pattern, status: last?.status || 200, body: last?.responseBody ?? '' });
      }
      case 'rule-new':
        return this.editMock({ id: newRuleId(), enabled: true, method: '*', match: '', status: 200, body: '' });
      case 'rule-edit': {
        const r = this.rec.mocks.rules.find((x) => x.id === id);
        return r && this.editMock({ ...r });
      }
      case 'rule-delete':
        this.rec.mocks.remove(id!);
        return this.renderAll();
      case 'rule-cancel':
        this.editingRule = null;
        return this.renderBody();
      case 'preset':
        return this.applyPreset(el.dataset.preset!);
      case 'rule-save':
        return this.saveRule();
      case 'snap-take': {
        const input = this.root.querySelector<HTMLInputElement>('[data-input="snapname"]');
        const name = input?.value.trim() || `Snapshot ${this.snapshots.list.length + 1}`;
        const s = this.snapshots.take(name, computeEndpoints(this.rec.store.calls, this.analysisOpts()).values());
        this.compareA = s.id;
        this.compareB = 'current';
        this.toast(`Saved “${name}”`);
        return this.renderBody();
      }
      case 'snap-delete':
        this.snapshots.remove(id!);
        this.compareA = this.snapshots.list[0]?.id ?? '';
        if (this.compareB === id) this.compareB = 'current';
        return this.renderBody();
      case 'dl-json':
        return this.download(`api-pingpong-${stamp()}.json`, toJSONExport(this.rec.store.calls), 'application/json');
      case 'dl-har':
        return this.download(`api-pingpong-${stamp()}.har`, toHAR(this.rec.store.calls), 'application/json');
      case 'dl-openapi': {
        const eps = [...computeEndpoints(this.rec.store.calls, this.analysisOpts()).values()];
        return this.download(`openapi-${stamp()}.json`, JSON.stringify(toOpenAPI(eps, `${location.host} (observed)`), null, 2), 'application/json');
      }
      case 'dl-ts':
      case 'copy-ts': {
        const ts = toTypeScript([...computeEndpoints(this.rec.store.calls, this.analysisOpts()).values()]);
        return act === 'dl-ts' ? this.download(`api-types-${stamp()}.ts`, ts, 'text/plain') : this.copy(ts, 'TypeScript types copied');
      }
    }
  }

  private onInput(e: Event): void {
    const t = e.target as HTMLInputElement;
    if (t.dataset.input === 'q') {
      this.q = t.value;
      this.renderBody();
    } else if (t.dataset.field && this.editingRule) {
      this.readRuleField(t);
    }
  }

  private onChange(e: Event): void {
    const t = e.target as HTMLInputElement & HTMLSelectElement;
    const ch = t.dataset.change;
    if (t.dataset.field && this.editingRule) return this.readRuleField(t);
    switch (ch) {
      case 'method':
        this.method = t.value;
        return this.renderBody();
      case 'rule-toggle':
        this.rec.mocks.toggle(t.dataset.id!);
        return this.renderTabs();
      case 'cmpA':
        this.compareA = t.value;
        return this.renderBody();
      case 'cmpB':
        this.compareB = t.value;
        return this.renderBody();
      case 'import': {
        const file = t.files?.[0];
        if (!file) return;
        file.text().then(
          (text) => {
            try {
              const calls = parseImport(text);
              calls.forEach((c) => this.rec.store.add(c));
              this.toast(`Imported ${calls.length} calls`);
              this.tab = 'calls';
              this.views = [{ type: 'tree' }];
              this.renderAll();
            } catch (err) {
              this.toast(`Import failed: ${(err as Error).message}`);
            }
          },
          () => this.toast('Could not read file'),
        );
        t.value = '';
        return;
      }
    }
  }

  private readRuleField(t: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): void {
    const r = this.editingRule!;
    const v = t.value;
    switch (t.dataset.field) {
      case 'method':
        r.method = v;
        break;
      case 'match':
        r.match = v;
        break;
      case 'status':
        r.status = v === '' ? undefined : Number(v);
        break;
      case 'delay':
        r.delay = v === '' ? undefined : Number(v);
        break;
      case 'body':
        r.body = v;
        break;
    }
  }

  private editMock(rule: MockRule): void {
    this.editingRule = rule;
    this.tab = 'mocks';
    this.renderAll();
    this.bodyEl.scrollTop = 0;
    this.root.querySelector<HTMLInputElement>('[data-field="match"]')?.focus();
  }

  private applyPreset(p: string): void {
    const r = this.editingRule;
    if (!r) return;
    if (p === '500') Object.assign(r, { status: 500, body: '{"error":"Internal Server Error (mocked)"}' });
    else if (p === '404') Object.assign(r, { status: 404, body: '{"error":"Not Found (mocked)"}' });
    else if (p === '0') Object.assign(r, { status: 0, body: '' });
    else if (p === 'slow') Object.assign(r, { status: undefined, body: '', delay: 3000 });
    else if (p === 'empty') Object.assign(r, { status: 200, body: '[]' });
    this.renderBody();
  }

  private saveRule(): void {
    const r = this.editingRule;
    if (!r) return;
    if (!r.match.trim()) return this.toast('Match is required');
    if (r.status == null && !r.delay) return this.toast('Set a status, or a delay for a pass-through rule');
    if (r.status != null && (r.status < 0 || r.status > 599 || (r.status > 0 && r.status < 100))) return this.toast('Status must be 0 or 100–599');
    this.rec.mocks.upsert({ ...r, match: r.match.trim() });
    this.editingRule = null;
    this.toast('Mock rule saved');
    this.renderAll();
  }

  // ------------------------------------------------------------------ helpers

  private toast(msg: string): void {
    this.wrap.querySelectorAll('.toast').forEach((t) => t.remove());
    const t = document.createElement('div');
    t.className = 'toast';
    t.setAttribute('role', 'status');
    t.textContent = msg;
    this.wrap.appendChild(t);
    setTimeout(() => t.remove(), 1900);
  }

  private copy(text: string, msg: string): void {
    const fallback = () => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0';
      this.wrap.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        this.toast(msg);
      } catch {
        this.toast('Copy failed');
      }
      ta.remove();
    };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(() => this.toast(msg), fallback);
    else fallback();
  }

  private download(name: string, text: string, type: string): void {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    this.wrap.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    this.toast(`Downloaded ${name}`);
  }
}

function pretty(s: string): string {
  const t = s.trimStart();
  if (t[0] === '{' || t[0] === '[') {
    try {
      return JSON.stringify(JSON.parse(s), null, 2).slice(0, 200_000);
    } catch {
      /* not JSON */
    }
  }
  return s.slice(0, 200_000);
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}
