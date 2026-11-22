import type { ApiCall } from '../core/types';
import type { EndpointStats } from './analysis';
import { safeJsonParse } from '../core/utils';
import { REDACTED } from '../core/redact';

/** Minimal JSON Schema subset inferred from observed values. */
export interface Schema {
  type?: 'string' | 'number' | 'integer' | 'boolean' | 'null' | 'object' | 'array';
  nullable?: boolean;
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  anyOf?: Schema[];
  format?: string;
  example?: unknown;
}

export function inferSchema(v: unknown): Schema {
  if (v === null) return { type: 'null' };
  if (Array.isArray(v)) {
    let items: Schema | undefined;
    for (const x of v.slice(0, 50)) items = items ? mergeSchemas(items, inferSchema(x)) : inferSchema(x);
    return { type: 'array', items: items ?? {} };
  }
  switch (typeof v) {
    case 'string': {
      const s: Schema = { type: 'string' };
      if (/^\d{4}-\d{2}-\d{2}T/.test(v)) s.format = 'date-time';
      else if (/^\d{4}-\d{2}-\d{2}$/.test(v)) s.format = 'date';
      else if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(v)) s.format = 'uuid';
      else if (/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(v)) s.format = 'email';
      else if (/^https?:\/\//.test(v)) s.format = 'uri';
      if (v !== REDACTED && v.length <= 80) s.example = v;
      return s;
    }
    case 'number':
      return { type: Number.isInteger(v) ? 'integer' : 'number', example: v };
    case 'boolean':
      return { type: 'boolean' };
    case 'object': {
      const properties: Record<string, Schema> = {};
      for (const [k, val] of Object.entries(v as object)) properties[k] = inferSchema(val);
      return { type: 'object', properties, required: Object.keys(properties) };
    }
    default:
      return {};
  }
}

export function mergeSchemas(a: Schema, b: Schema): Schema {
  if (a.type === 'null' && b.type !== 'null') return { ...b, nullable: true };
  if (b.type === 'null' && a.type !== 'null') return { ...a, nullable: true };
  if ((a.type === 'integer' && b.type === 'number') || (a.type === 'number' && b.type === 'integer')) return { ...a, type: 'number' };
  if (a.anyOf) return { ...a, anyOf: addVariant(a.anyOf, b) };
  if (a.type !== b.type) return { anyOf: [a, b] };
  const nullable = a.nullable || b.nullable || undefined;
  if (a.type === 'object') {
    const props: Record<string, Schema> = { ...(a.properties ?? {}) };
    for (const [k, s] of Object.entries(b.properties ?? {})) props[k] = props[k] ? mergeSchemas(props[k], s) : s;
    const req = (a.required ?? []).filter((k) => (b.required ?? []).includes(k));
    return { type: 'object', properties: props, required: req, nullable };
  }
  if (a.type === 'array') return { type: 'array', items: a.items && b.items ? mergeSchemas(a.items, b.items) : (a.items ?? b.items), nullable };
  return { ...a, format: a.format === b.format ? a.format : undefined, nullable };
}

function addVariant(list: Schema[], s: Schema): Schema[] {
  const i = list.findIndex((x) => x.type === s.type);
  if (i < 0) return [...list, s];
  const copy = [...list];
  copy[i] = mergeSchemas(copy[i], s);
  return copy;
}

function schemaFromBodies(bodies: Array<string | undefined>): Schema | undefined {
  let s: Schema | undefined;
  for (const b of bodies) {
    const v = safeJsonParse(b);
    if (v === undefined) continue;
    const inferred = inferSchema(v);
    s = s ? mergeSchemas(s, inferred) : inferred;
  }
  return s;
}

// ---------------- OpenAPI ----------------

export function toOpenAPI(endpoints: EndpointStats[], title = 'Observed API'): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  const servers = new Set<string>();
  for (const e of endpoints) {
    const sample = e.calls[0];
    if (!sample || ['ws', 'sse', 'beacon'].includes(sample.kind)) continue;
    if (sample.origin) servers.add(sample.origin);
    const { path: oaPath, params } = toOpenApiPath(e.pattern);
    const method = e.method.toLowerCase();
    const item = (paths[oaPath] ??= {});
    if (item[method] && !sample.graphql) continue;

    const parameters: unknown[] = params.map((name) => ({ name, in: 'path', required: true, schema: { type: 'string' } }));
    const queryKeys = new Map<string, number>();
    e.calls.forEach((c) => Object.keys(c.query).forEach((k) => queryKeys.set(k, (queryKeys.get(k) ?? 0) + 1)));
    for (const [k, n] of queryKeys) {
      if (sample.graphql && k === 'query') continue;
      parameters.push({ name: k, in: 'query', required: n === e.calls.length, schema: { type: 'string' }, example: e.calls.find((c) => c.query[k])?.query[k] });
    }

    const op: Record<string, unknown> = {
      operationId: operationId(e),
      summary: sample.graphql ? `GraphQL ${sample.graphql.operationType} ${sample.graphql.operationName}` : undefined,
      parameters: parameters.length ? parameters : undefined,
      responses: {},
      'x-observed-calls': e.count,
    };
    const reqSchema = schemaFromBodies(e.calls.map((c) => c.requestBody));
    if (reqSchema) op.requestBody = { content: { 'application/json': { schema: reqSchema } } };

    const byStatus = new Map<number, ApiCall[]>();
    e.calls.forEach((c) => {
      if (c.pending || c.status === 0) return;
      byStatus.set(c.status, [...(byStatus.get(c.status) ?? []), c]);
    });
    const responses = op.responses as Record<string, unknown>;
    for (const [status, calls] of byStatus) {
      const s = schemaFromBodies(calls.map((c) => c.responseBody));
      const ct = (calls[0].contentType ?? 'application/json').split(';')[0];
      responses[String(status)] = { description: calls[0].statusText || String(status), ...(s ? { content: { [ct]: { schema: s } } } : {}) };
    }
    if (!Object.keys(responses).length) responses.default = { description: 'No completed responses observed' };

    if (sample.graphql) {
      // Several operations share POST /graphql — keep each as an x- extension on one op.
      const existing = item[method] as Record<string, unknown> | undefined;
      if (existing) {
        ((existing['x-graphql-operations'] as unknown[]) ??= []).push(op);
        continue;
      }
      op['x-graphql-operations'] = [{ ...op }];
    }
    item[method] = JSON.parse(JSON.stringify(op)); // strip undefined
  }
  return {
    openapi: '3.0.3',
    info: { title, version: '0.0.0-observed', description: 'Generated by api-pingpong from observed traffic. Review before use.' },
    servers: [...servers].map((url) => ({ url })),
    paths,
  };
}

function toOpenApiPath(pattern: string): { path: string; params: string[] } {
  const params: string[] = [];
  const counts = new Map<string, number>();
  const path = pattern
    .split('/')
    .map((seg, i, all) => {
      if (!seg.startsWith(':')) return seg;
      const base = seg.slice(1);
      const prev = all[i - 1] && !all[i - 1].startsWith(':') ? singular(all[i - 1]) : '';
      let name = prev ? `${camel(prev)}${base[0].toUpperCase()}${base.slice(1)}` : base;
      const n = counts.get(name) ?? 0;
      counts.set(name, n + 1);
      if (n) name += n + 1;
      params.push(name);
      return `{${name}}`;
    })
    .join('/');
  return { path, params };
}

function singular(s: string): string {
  return s.replace(/ies$/, 'y').replace(/s$/, '');
}

function camel(s: string): string {
  return s.replace(/[-_.]+(\w)/g, (_, c: string) => c.toUpperCase()).replace(/[^A-Za-z0-9]/g, '');
}

function operationId(e: EndpointStats): string {
  if (e.calls[0]?.graphql) return camel(e.calls[0].graphql.operationName);
  const words = e.pattern
    .split('/')
    .filter(Boolean)
    .map((s) => (s.startsWith(':') ? 'By' + s[1].toUpperCase() + s.slice(2) : s));
  return camel([e.method.toLowerCase(), ...words].join('-')) || e.method.toLowerCase();
}

// ---------------- TypeScript ----------------

export function toTypeScript(endpoints: EndpointStats[]): string {
  const out: string[] = ['// Generated by api-pingpong from observed traffic. Review before use.', ''];
  const used = new Set<string>();
  for (const e of endpoints) {
    const sample = e.calls[0];
    if (!sample || ['ws', 'sse', 'beacon'].includes(sample.kind)) continue;
    let base = pascal(operationId(e));
    while (used.has(base)) base += '_';
    used.add(base);
    const req = schemaFromBodies(e.calls.map((c) => c.requestBody));
    const ok = schemaFromBodies(e.calls.filter((c) => c.status >= 200 && c.status < 300).map((c) => c.responseBody));
    out.push(`/** ${e.method} ${e.label} — ${e.count} observed call(s) */`);
    if (req) out.push(`export type ${base}Request = ${tsType(req, 0)};`);
    if (ok) out.push(`export type ${base}Response = ${tsType(ok, 0)};`);
    if (!req && !ok) out.push(`// (no JSON bodies observed)`);
    out.push('');
  }
  return out.join('\n');
}

function pascal(s: string): string {
  const c = camel(s);
  return c ? c[0].toUpperCase() + c.slice(1) : 'Endpoint';
}

export function tsType(s: Schema, depth: number): string {
  const ind = '  '.repeat(depth + 1);
  const close = '  '.repeat(depth);
  let t: string;
  if (s.anyOf) t = s.anyOf.map((x) => tsType(x, depth)).join(' | ');
  else
    switch (s.type) {
      case 'string':
        t = 'string';
        break;
      case 'number':
      case 'integer':
        t = 'number';
        break;
      case 'boolean':
        t = 'boolean';
        break;
      case 'null':
        t = 'null';
        break;
      case 'array': {
        const inner = s.items ? tsType(s.items, depth) : 'unknown';
        t = /[|&{]/.test(inner) && !inner.startsWith('{') ? `Array<${inner}>` : `${inner}[]`;
        break;
      }
      case 'object': {
        const props = Object.entries(s.properties ?? {});
        if (!props.length) {
          t = 'Record<string, unknown>';
          break;
        }
        const req = new Set(s.required ?? []);
        const lines = props.map(([k, v]) => `${ind}${/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k)}${req.has(k) ? '' : '?'}: ${tsType(v, depth + 1)};`);
        t = `{\n${lines.join('\n')}\n${close}}`;
        break;
      }
      default:
        t = 'unknown';
    }
  return s.nullable && !t.includes('null') ? `${t} | null` : t;
}
