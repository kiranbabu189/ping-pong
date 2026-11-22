# api-pingpong

A framework-agnostic floating devtool that records every API call your app makes, groups them into a **path tree** (`/api → /lead → /:id`), and flags **duplicate**, **N+1**, **slow**, **failing** and **over-fetching** calls.

Works with React, Vue, Angular, Svelte, Solid or plain JS, and with any HTTP client: `fetch`, axios (XHR), ky, SWR, React Query, Apollo and others. WebSocket, EventSource and `sendBeacon` are recorded too.

```
▾ /api                          dup 6  N+1  ✕1      23
  ▾ /lead                       dup 6  N+1          16
      GET  /api/lead            dup ×6     avg 144 ms  ×7
      POST /api/lead                       avg  67 ms  ×1
    ▾ /:id                      N+1                  8
        GET /api/lead/:id       N+1 ×8     avg 134 ms  ×8
▾ /graphql                                           2
    POST mutation SaveLead                            ×1
    POST query GetLeads                               ×1
```

## Install

```sh
npm i -D api-pingpong
```

## Use

Add one line. It must run **before** your app makes requests, so put it first in your entry file.

```js
// Dev only: the dynamic import is dropped from production bundles.
if (import.meta.env.DEV) import('api-pingpong/auto');
```

Or with options:

```js
import { init } from 'api-pingpong';

init({
  enabled: process.env.NODE_ENV !== 'production',
  position: 'bottom-right',
  trackFieldUsage: true,
});
```

Without a bundler, add a script tag as the first script in `<head>`:

```html
<script src="https://unpkg.com/api-pingpong/dist/api-pingpong.auto.global.js" data-position="bottom-left"></script>
```

Toggle the panel with the floating button or **Alt+Shift+A**. The button can be dragged, and its position is remembered. On SSR (Next.js, Nuxt) `init()` is a no-op on the server.

## Features

| | |
|---|---|
| **Path tree** | Calls are grouped by normalized path. Numeric IDs, UUIDs, Mongo ObjectIds, ULIDs, hashes, dates, emails and long tokens collapse to `:id`, `:uuid` and similar. Third-party hosts get their own branch. Switch to **group by page** to see which route triggered which calls. |
| **Duplicate detection** | The same method, URL and body within `duplicateWindowMs` (2 s by default) is flagged, and every call in the burst links to the original. Catches effects that run twice, several components fetching the same data, and aggressive polling. |
| **N+1 detection** | Many *different* URLs for one pattern in a short burst (for example `/lead/1…/lead/8` right after `/lead`). |
| **Timing** | avg / p50 / p95 / max per endpoint, with slow calls highlighted. |
| **Initiator** | The app stack frame that started each call (`LeadList.tsx:42`). Library and `node_modules` frames are skipped. |
| **Call detail** | URL, query, headers, request and response bodies (pretty JSON), and WebSocket/SSE messages. |
| **Copy as cURL / fetch** | Secrets stay redacted by default. **Copy cURL + auth** includes the real `Authorization` and cookie headers (memory only, never exported). |
| **Replay** | Re-sends a call with its original headers and body. The replay is recorded and linked to the original. |
| **Mocks** | Override status and body, simulate a **network error** (`status: 0`), or add **latency** to a real response. Rules match a pattern (`/api/lead/:id`), a concrete path, a full URL or a `*` wildcard. Works for fetch and XHR, and persists across reloads. |
| **GraphQL** | Calls are grouped by operation (`query GetLeads`) instead of one big `/graphql` bucket. Automatic persisted queries (APQ) are supported. |
| **Compare** | Take a snapshot, change your code, then diff call counts, duplicates and latency. Snapshots survive reloads. |
| **Export / import** | JSON or HAR. Attach a recording to a bug report and a teammate can import it. HAR files from Chrome DevTools import too. |
| **OpenAPI and TS types** | An OpenAPI 3 spec or TypeScript types inferred from observed traffic: path params, query params, request bodies, and responses by status. |
| **Over-fetch hints** | Opt-in (`trackFieldUsage: true`). Shows which response fields the UI actually read. |
| **Isolation** | The UI lives in Shadow DOM, so your CSS can't break it and it can't break yours. It works on mobile and in webviews. |

## Options

| Option | Default | |
|---|---|---|
| `enabled` | `true` | Set `false` to skip everything. |
| `position` | `'bottom-right'` | Initial button corner. |
| `open` | `false` | Start with the panel open. |
| `hotkey` | `'alt+shift+a'` | Use `false` to disable. Modifiers: `ctrl`, `alt`, `shift`, `meta`. |
| `maxCalls` | `2000` | Ring buffer size. |
| `duplicateWindowMs` | `2000` | Window for duplicate and N+1 detection. |
| `nPlusOneThreshold` | `5` | Distinct URLs in one burst that count as N+1. |
| `slowThresholdMs` | `1000` | |
| `captureBodies` | `true` | Request and response bodies (text/JSON only; binary and streams are skipped). |
| `maxBodySize` | `100000` | Characters per body. |
| `redact` | `true` | Redact sensitive headers and JSON keys in the UI and in exports. |
| `redactHeaders` / `redactBodyKeys` | | Added to the built-in lists (`authorization`, `cookie`, `x-api-key`… / `password`, `token`, `secret`…). |
| `normalizeRules` | `[]` | `[{ test: /^acme$/, replace: ':org' }]`, tested per path segment before the built-ins. |
| `ignore` | `[]` | Strings (substring) or RegExps. Matching URLs are not recorded. |
| `intercept` | all `true` | `{ fetch, xhr, beacon, websocket, eventSource }` |
| `trackFieldUsage` | `false` | See below. |
| `persist` | `true` | Store mocks, snapshots and UI state in `localStorage`. |
| `zIndex` | `2147483000` | |

## Programmatic API

```ts
const pp = init();
pp.getCalls();                       // readonly ApiCall[]
pp.subscribe(() => …);               // returns unsubscribe
pp.addMock({ method: 'GET', match: '/api/lead/:id', status: 500, body: '{"error":"x"}' });
pp.pause(); pp.resume(); pp.clear();
pp.exportHAR(); pp.exportJSON();
pp.open(); pp.close(); pp.toggle();
pp.destroy();                        // restores fetch/XHR/WebSocket/EventSource/sendBeacon
```

Pure helpers are exported too: `normalizePath`, `toCurl`, `toFetchSnippet`, `toHAR`, `parseImport`, `toOpenAPI`, `toTypeScript`, `computeEndpoints`, `computeInsights`, `buildTree`.

## Browser extension (zero code)

`extension/` is a Manifest V3 extension built on the same code. Enable it per site from its popup. It injects before the page's own scripts, so it works on staging or production sites you don't control.

```sh
npm run build    # also copies the bundle into extension/
```

Then open `chrome://extensions`, turn on Developer mode, choose **Load unpacked**, and select the `extension/` folder.

## Demo

```sh
npm run demo     # http://localhost:4747
```

A zero-dependency demo server with scenario buttons: duplicates, N+1, failures, slow calls, XHR, GraphQL, SSE, beacon, a third-party call, and over-fetching.

## Limitations and notes

- **Import early.** Calls made before `init()` runs aren't seen. The script-tag and extension builds patch before anything else runs.
- **Service workers.** Requests a service worker makes on its own aren't visible. Page requests that a service worker answers are.
- **Field usage is a heuristic.** It covers `fetch().json()` only, because axios parses XHR text itself. Code that walks every key (`JSON.stringify`, deep-equal, React Query structural sharing) marks everything as used.
- **Initiator frames point at bundled code** when there are no source maps. Vite and webpack dev servers usually give readable paths.
- Recording keeps request and response bodies in memory. It's a dev tool, so keep it out of production builds.

## Development

```sh
npm test         # vitest: unit tests plus a happy-dom integration suite
npm run typecheck
npm run build    # ESM + CJS + .d.ts + minified IIFE builds (~27 KB gzipped)
```

## License

MIT
