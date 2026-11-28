export const STYLES = /* css */ `
:host { all: initial; }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
.pp {
  --bg: #ffffff; --bg2: #f6f7f9; --bg3: #eceef2; --fg: #1d2129; --fg2: #5b6271; --fg3: #8a909c;
  --line: #e1e4ea; --accent: #4f46e5; --accent-fg: #fff;
  --get: #0f7b4b; --post: #b45309; --put: #1d4ed8; --patch: #7c3aed; --delete: #c0262d; --other: #475569;
  --err: #c0262d; --err-bg: #fdecec; --warn: #a15c00; --warn-bg: #fff4e0; --ok: #0f7b4b; --ok-bg: #e6f6ee;
  --info: #1d4ed8; --info-bg: #e8effd; --shadow: 0 12px 40px rgba(15, 23, 42, .18), 0 2px 8px rgba(15, 23, 42, .08);
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --chevron: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%235b6271' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
  font: 12.5px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--fg);
}
@media (prefers-color-scheme: dark) {
  .pp {
    --bg: #17181c; --bg2: #1e2026; --bg3: #2a2d35; --fg: #e7e9ee; --fg2: #a3a9b6; --fg3: #737a88;
    --line: #2f333c; --accent: #8b85ff; --accent-fg: #0e0e12;
    --get: #4ade80; --post: #fbbf24; --put: #60a5fa; --patch: #c084fc; --delete: #f87171; --other: #94a3b8;
    --err: #f87171; --err-bg: #3a1d20; --warn: #fbbf24; --warn-bg: #3a2e14; --ok: #4ade80; --ok-bg: #16301f;
    --info: #60a5fa; --info-bg: #182a45; --shadow: 0 12px 40px rgba(0,0,0,.55);
    --chevron: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23a3a9b6' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
  }
}
button { font: inherit; color: inherit; cursor: pointer; }
input, select, textarea { font: inherit; color: var(--fg); background: var(--bg); border: 1px solid var(--line); border-radius: 6px; padding: 4px 8px; }
input:focus, select:focus, textarea:focus, button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
select { -webkit-appearance: none; appearance: none; padding-right: 28px; cursor: pointer; background: var(--bg) var(--chevron) no-repeat right 9px center / 12px 12px; }
select:hover { border-color: var(--fg3); }
textarea { font-family: var(--mono); font-size: 12px; width: 100%; min-height: 90px; resize: vertical; }

/* Floating button */
.fab {
  position: fixed; width: 46px; height: 46px; border-radius: 50%; border: none;
  background: var(--accent); color: var(--accent-fg); box-shadow: var(--shadow);
  display: grid; place-items: center; touch-action: none; user-select: none; transition: transform .15s;
}
.fab:hover { transform: scale(1.06); }
.fab svg { width: 22px; height: 22px; }
.fab .badge {
  position: absolute; top: -4px; right: -4px; min-width: 20px; height: 20px; padding: 0 5px; border-radius: 10px;
  background: var(--bg); color: var(--fg); border: 1px solid var(--line); font: 600 11px/18px system-ui, sans-serif; text-align: center;
}
.fab.alert .badge { background: var(--err); color: #fff; border-color: var(--err); }
.fab.paused { filter: grayscale(1); opacity: .75; }

/* Panel */
.panel {
  position: fixed; width: min(640px, calc(100vw - 32px)); height: min(72vh, 720px);
  background: var(--bg); border: 1px solid var(--line); border-radius: 12px; box-shadow: var(--shadow);
  display: flex; flex-direction: column; overflow: hidden;
}
.panel.large { width: min(1100px, calc(100vw - 32px)); height: calc(100vh - 32px); }
.panel[hidden] { display: none; }
@media (max-width: 520px) { .panel { width: calc(100vw - 16px); height: calc(100vh - 80px); } }

.head { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-bottom: 1px solid var(--line); }
.title { font-weight: 650; display: flex; align-items: center; gap: 6px; }
.title svg { width: 16px; height: 16px; color: var(--accent); }
.summary { color: var(--fg2); font-size: 12px; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.icon-btn { display: inline-grid; place-items: center; width: 26px; height: 26px; flex: none; border: 1px solid transparent; background: transparent; border-radius: 7px; padding: 0; color: var(--fg); opacity: .78; }
.icon-btn svg { width: 15px; height: 15px; }
.icon-btn:hover { background: var(--bg3); opacity: 1; }
.icon-btn.on { color: var(--accent); background: var(--bg3); border-color: var(--line); opacity: 1; }

.tabs { display: flex; gap: 2px; padding: 0 8px; border-bottom: 1px solid var(--line); background: var(--bg2); overflow-x: auto; }
.tab { border: none; background: none; padding: 7px 10px; color: var(--fg2); border-bottom: 2px solid transparent; white-space: nowrap; }
.tab:hover { color: var(--fg); }
.tab.active { color: var(--fg); border-bottom-color: var(--accent); font-weight: 600; }
.tab .n { margin-left: 4px; font-size: 11px; padding: 0 5px; border-radius: 8px; background: var(--bg3); }
.tab .n.hot { background: var(--err); color: #fff; }

.toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 7px 10px; border-bottom: 1px solid var(--line); }
.search { position: relative; display: flex; flex: 1 1 180px; min-width: 120px; }
.search input { width: 100%; }
.search .ph { position: absolute; inset: 1px 10px 1px 9px; display: flex; align-items: center; overflow: hidden; white-space: nowrap; color: var(--fg3); pointer-events: none; }
.search .ph-track { display: inline-flex; flex: none; }
.search .ph-track span { padding-right: 40px; }
.search .ph-track span + span { display: none; }
.search.scroll .ph { -webkit-mask-image: linear-gradient(to right, transparent, #000 10px, #000 calc(100% - 14px), transparent); mask-image: linear-gradient(to right, transparent, #000 10px, #000 calc(100% - 14px), transparent); }
.search.scroll .ph-track { animation: pp-marquee var(--ph-dur, 12s) linear infinite; }
.search.scroll .ph-track span + span { display: inline; }
.search:hover .ph-track, .search:focus-within .ph-track { animation-play-state: paused; }
.search.has-value .ph { display: none; }
@keyframes pp-marquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }
.chip { border: 1px solid var(--line); background: var(--bg); border-radius: 999px; padding: 2px 9px; font-size: 12px; color: var(--fg2); }
.chip.on { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); }
.seg { display: inline-flex; border: 1px solid var(--line); border-radius: 6px; overflow: hidden; }
.seg button { border: none; background: var(--bg); padding: 3px 9px; color: var(--fg2); }
.seg button.on { background: var(--bg3); color: var(--fg); font-weight: 600; }

.body { flex: 1; overflow: auto; overscroll-behavior: contain; }
.empty { padding: 32px 16px; text-align: center; color: var(--fg3); }
.empty b { color: var(--fg2); display: block; margin-bottom: 4px; }

/* Tree */
.row { display: flex; align-items: center; gap: 6px; padding: 3px 10px; min-height: 26px; cursor: pointer; white-space: nowrap; }
.row:hover { background: var(--bg2); }
.caret { width: 14px; color: var(--fg3); flex: none; text-align: center; transition: transform .1s; }
.caret.closed { transform: rotate(-90deg); }
.seg-name { font-family: var(--mono); font-weight: 600; }
.ep-label { font-family: var(--mono); overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.grow { flex: 1; min-width: 8px; }
.meta { color: var(--fg3); font-size: 11.5px; font-variant-numeric: tabular-nums; }
.count { font-variant-numeric: tabular-nums; color: var(--fg2); font-size: 12px; min-width: 34px; text-align: right; }
.count b { color: var(--fg); }

.m { font: 700 10.5px/1 var(--mono); padding: 3px 5px; border-radius: 4px; min-width: 44px; text-align: center; flex: none; background: var(--bg3); color: var(--other); }
.m.GET { color: var(--get); } .m.POST { color: var(--post); } .m.PUT { color: var(--put); } .m.PATCH { color: var(--patch); } .m.DELETE { color: var(--delete); }

.flag { font-size: 11px; padding: 1px 6px; border-radius: 4px; white-space: nowrap; font-weight: 600; flex: none; }
.flag.dup { background: var(--warn-bg); color: var(--warn); }
.flag.err { background: var(--err-bg); color: var(--err); }
.flag.slow { background: var(--warn-bg); color: var(--warn); }
.flag.n1 { background: var(--err-bg); color: var(--err); }
.flag.mock { background: var(--info-bg); color: var(--info); }
.flag.ok { background: var(--ok-bg); color: var(--ok); }
.flag.muted { background: var(--bg3); color: var(--fg2); }

/* Detail views */
.crumbs { display: flex; align-items: center; gap: 6px; padding: 8px 10px; border-bottom: 1px solid var(--line); background: var(--bg2); position: sticky; top: 0; z-index: 1; }
.crumbs .ep-label { font-weight: 600; }
.stats { display: grid; grid-template-columns: repeat(auto-fill, minmax(92px, 1fr)); border-bottom: 1px solid var(--line); overflow: hidden; }
.stat { padding: 7px 10px; box-shadow: 1px 1px 0 var(--line); }
.stat .k { color: var(--fg3); font-size: 11px; }
.stat .v { font-weight: 650; font-size: 14px; font-variant-numeric: tabular-nums; }
.stat .v.bad { color: var(--err); } .stat .v.warn { color: var(--warn); }
.actions { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 10px; border-bottom: 1px solid var(--line); }
.btn { border: 1px solid var(--line); background: var(--bg); border-radius: 6px; padding: 4px 10px; }
.btn:hover { background: var(--bg2); }
.btn.primary { background: var(--accent); color: var(--accent-fg); border-color: var(--accent); }
.btn.danger { color: var(--err); }

table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; }
th { text-align: left; font-weight: 600; color: var(--fg3); font-size: 11px; padding: 5px 10px; border-bottom: 1px solid var(--line); position: sticky; top: 0; background: var(--bg); }
td { padding: 4px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
tr.click { cursor: pointer; } tr.click:hover td { background: var(--bg2); }
td.mono, .mono { font-family: var(--mono); font-size: 12px; }
td.num { text-align: right; }
.st-ok { color: var(--ok); } .st-err { color: var(--err); } .st-pend { color: var(--fg3); }
.pos { color: var(--err); } .neg { color: var(--ok); }

details { border-bottom: 1px solid var(--line); }
summary { padding: 7px 10px; cursor: pointer; font-weight: 600; user-select: none; }
summary .meta { font-weight: 400; margin-left: 6px; }
pre { margin: 0; padding: 8px 10px 10px; font: 12px/1.5 var(--mono); white-space: pre-wrap; word-break: break-all; max-height: 420px; overflow: auto; background: var(--bg2); }
.kv { display: grid; grid-template-columns: minmax(110px, max-content) 1fr; gap: 2px 12px; padding: 4px 10px 10px; font: 12px/1.5 var(--mono); }
.kv .k { color: var(--fg2); }
.kv .v { word-break: break-all; }
.url { padding: 8px 10px; font: 12px/1.5 var(--mono); word-break: break-all; border-bottom: 1px solid var(--line); }
.link { color: var(--accent); cursor: pointer; text-decoration: underline; background: none; border: none; padding: 0; }

.insight { display: flex; gap: 10px; padding: 9px 10px; border-bottom: 1px solid var(--line); cursor: pointer; align-items: flex-start; }
.insight:hover { background: var(--bg2); }
.insight .sev { width: 4px; align-self: stretch; border-radius: 2px; flex: none; }
.sev.high { background: var(--err); } .sev.medium { background: var(--warn); } .sev.low { background: var(--fg3); }
.insight .msg { color: var(--fg2); margin-top: 2px; }

.form { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; padding: 10px; border-bottom: 1px solid var(--line); background: var(--bg2); }
.form label { display: flex; flex-direction: column; gap: 3px; font-size: 11.5px; color: var(--fg2); }
.form .full { grid-column: 1 / -1; }
.section { padding: 10px; border-bottom: 1px solid var(--line); }
.section h4 { margin: 0 0 4px; font-size: 13px; }
.section p { margin: 0 0 8px; color: var(--fg2); }
.hint { color: var(--fg3); font-size: 11.5px; }

.toast { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); background: var(--fg); color: var(--bg); padding: 7px 14px; border-radius: 8px; box-shadow: var(--shadow); font-size: 12.5px; pointer-events: none; animation: pp-fade 1.8s forwards; }
@keyframes pp-fade { 0%, 80% { opacity: 1; } 100% { opacity: 0; } }
@media (prefers-reduced-motion: reduce) {
  .fab, .caret { transition: none; } .toast { animation: none; }
  .search.scroll .ph-track { animation: none; }
  .search.scroll .ph-track span + span { display: none; }
  .search .ph-track span { overflow: hidden; text-overflow: ellipsis; padding-right: 0; }
  .search .ph-track { min-width: 0; flex: 1; }
}
`;

export const ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 7h11l-3-3"/><path d="M17 17H6l3 3"/></svg>`;

const svg = (body: string, fill = false) =>
  `<svg viewBox="0 0 24 24" fill="${fill ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  pause: svg('<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>', true),
  play: svg('<path d="M7 5v14l12-7z"/>', true),
  clear: svg('<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 14h10l1-14"/><path d="M10 11v6M14 11v6"/>'),
  maximize: svg('<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>'),
  minimize: svg('<path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/>'),
  close: svg('<path d="M18 6 6 18M6 6l12 12"/>'),
  expandAll: svg('<path d="m7 6 5 5 5-5M7 13l5 5 5-5"/>'),
  collapseAll: svg('<path d="m7 11 5-5 5 5M7 18l5-5 5 5"/>'),
  back: svg('<path d="M19 12H5M12 19l-7-7 7-7"/>'),
};
