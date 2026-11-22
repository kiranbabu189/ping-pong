import type { ApiCall } from '../core/types';

/** All leaf paths in a JSON value, arrays collapsed to `[]` (e.g. `items[].name`). */
export function leafPaths(value: unknown, prefix = '', out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    if (value.length === 0) out.add(prefix + '[]');
    for (const v of value) leafPaths(v, prefix + '[]', out);
  } else if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 0 && prefix) out.add(prefix);
    for (const k of keys) leafPaths((value as Record<string, unknown>)[k], prefix ? `${prefix}.${k}` : k, out);
  } else if (prefix) {
    out.add(prefix);
  }
  return out;
}

/**
 * Wrap parsed JSON in a read-tracking Proxy. Reading a primitive marks its path as used.
 * Heuristic: code that walks every key (JSON.stringify, deep-equal, structural sharing)
 * will mark everything as used.
 */
export function trackUsage<T>(data: T, call: ApiCall): T {
  if (!data || typeof data !== 'object') return data;
  const total = [...leafPaths(data)];
  const used = new Set<string>();
  call.fieldUsage = { used: [], total };
  const cache = new WeakMap<object, unknown>();

  const mark = (path: string) => {
    if (!used.has(path)) {
      used.add(path);
      call.fieldUsage!.used.push(path);
    }
  };

  const wrap = (obj: object, path: string): unknown => {
    const cached = cache.get(obj);
    if (cached) return cached;
    const isArr = Array.isArray(obj);
    const proxy = new Proxy(obj, {
      get(target, key, receiver) {
        const val = Reflect.get(target, key, receiver);
        if (typeof key === 'symbol' || !Object.prototype.hasOwnProperty.call(target, key)) return val;
        if (isArr && key === 'length') return val;
        const childPath = isArr ? `${path}[]` : path ? `${path}.${key}` : key;
        if (val && typeof val === 'object') {
          // Respect proxy invariants for frozen / non-configurable props.
          const d = Object.getOwnPropertyDescriptor(target, key);
          if (d && !d.configurable && !d.writable) return val;
          if (Array.isArray(val) && val.length === 0) mark(childPath + '[]');
          return wrap(val, childPath);
        }
        mark(childPath);
        return val;
      },
    });
    cache.set(obj, proxy);
    return proxy;
  };

  return wrap(data as object, '') as T;
}
