import type { GraphQLInfo } from '../core/types';
import { safeJsonParse } from '../core/utils';

const OP_RE = /^\s*(query|mutation|subscription)\b\s*([_A-Za-z][_0-9A-Za-z]*)?/m;

/** Detect a GraphQL operation from a request (POST JSON body or GET ?query=). */
export function detectGraphQL(path: string, query: Record<string, string>, body: string | undefined): GraphQLInfo | undefined {
  let payload: unknown = safeJsonParse(body);
  if (Array.isArray(payload)) payload = payload[0]; // batched — label by first op
  let q: string | undefined;
  let opName: string | undefined;
  if (payload && typeof payload === 'object' && typeof (payload as { query?: unknown }).query === 'string') {
    q = (payload as { query: string }).query;
    opName = (payload as { operationName?: string }).operationName ?? undefined;
  } else if (query.query && (/graphql|gql/i.test(path) || OP_RE.test(query.query))) {
    q = query.query;
    opName = query.operationName;
  } else if (
    payload &&
    typeof payload === 'object' &&
    (payload as { extensions?: { persistedQuery?: unknown } }).extensions?.persistedQuery &&
    (payload as { operationName?: string }).operationName
  ) {
    // Automatic persisted queries: no query text, but operationName is present.
    return { operationType: 'query', operationName: (payload as { operationName: string }).operationName };
  }
  if (!q) return undefined;
  const m = OP_RE.exec(stripComments(q));
  const operationType = (m?.[1] as GraphQLInfo['operationType']) ?? 'query'; // shorthand `{ ... }` is a query
  const operationName = opName || m?.[2] || 'anonymous';
  return { operationType, operationName };
}

function stripComments(q: string): string {
  return q.replace(/#[^\n]*/g, '').replace(/fragment\s+\w+\s+on\s+\w+\s*\{[\s\S]*?\}\s*/g, '');
}
