import { normalizePath } from '../src/core/normalize';
import type { ApiCall } from '../src/core/types';

export function mkCall(p: Partial<ApiCall> = {}): Omit<ApiCall, 'id'> {
  const path = p.path ?? '/api/lead';
  return {
    kind: 'fetch', method: 'GET', url: `http://app.test${path}`, origin: 'http://app.test', path,
    pattern: normalizePath(path), query: {}, page: '/', startTime: 1000, status: 200, ok: true, pending: false,
    requestHeaders: {}, responseHeaders: {}, requestSize: 0, responseSize: 10, initiator: [], duration: 50, ...p,
  };
}

