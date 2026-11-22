export type CallKind = 'fetch' | 'xhr' | 'beacon' | 'ws' | 'sse';

export interface StreamMessage {
  dir: 'in' | 'out';
  time: number;
  data: string;
  size: number;
}

export interface GraphQLInfo {
  operationType: 'query' | 'mutation' | 'subscription';
  operationName: string;
}

export interface ApiCall {
  id: number;
  kind: CallKind;
  method: string;
  /** Absolute URL as requested. */
  url: string;
  origin: string;
  /** Concrete path, e.g. /api/lead/123 */
  path: string;
  /** Normalized path, e.g. /api/lead/:id */
  pattern: string;
  query: Record<string, string>;
  /** App route (location) at the moment the call was made. */
  page: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  /** 0 = network error / pending / opaque. */
  status: number;
  statusText?: string;
  ok?: boolean;
  error?: string;
  pending: boolean;
  requestHeaders: Record<string, string>;
  responseHeaders: Record<string, string>;
  requestBody?: string;
  responseBody?: string;
  responseBodyTruncated?: boolean;
  requestSize: number;
  responseSize: number;
  contentType?: string;
  initiator: string[];
  graphql?: GraphQLInfo;
  /** Set when this call matched another identical call inside the duplicate window. */
  duplicateOf?: number;
  mocked?: boolean;
  replayOf?: number;
  imported?: boolean;
  messages?: StreamMessage[];
  /** Field usage (opt-in, fetch().json() only). */
  fieldUsage?: { used: string[]; total: string[] };
}

export interface MockRule {
  id: string;
  enabled: boolean;
  /** '*' or an HTTP method. */
  method: string;
  /** Matches against normalized pattern, concrete path, or full URL. Supports * wildcards. */
  match: string;
  /** Leave undefined to pass through (latency-only rule). */
  status?: number;
  body?: string;
  headers?: Record<string, string>;
  delay?: number;
}

export interface NormalizeRule {
  /** Regex tested against a single path segment. */
  test: RegExp;
  replace: string;
}

export type Position = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';

export interface PingPongOptions {
  /** Default true. Pass e.g. import.meta.env.DEV. */
  enabled?: boolean;
  position?: Position;
  /** Ring buffer size. Default 2000. */
  maxCalls?: number;
  /** Two identical calls (method+url+body) within this many ms are duplicates. Default 2000. */
  duplicateWindowMs?: number;
  /** N+1: this many distinct URLs for one pattern within duplicateWindowMs. Default 5. */
  nPlusOneThreshold?: number;
  /** Calls slower than this are flagged. Default 1000. */
  slowThresholdMs?: number;
  captureBodies?: boolean;
  /** Max captured characters per body. Default 100_000. */
  maxBodySize?: number;
  /** Redact sensitive headers / JSON keys. Default true. */
  redact?: boolean;
  redactHeaders?: string[];
  redactBodyKeys?: string[];
  /** Extra segment rules applied before the built-ins. */
  normalizeRules?: NormalizeRule[];
  /** URLs matching any of these are not recorded (string = substring). */
  ignore?: Array<string | RegExp>;
  intercept?: { fetch?: boolean; xhr?: boolean; beacon?: boolean; websocket?: boolean; eventSource?: boolean };
  /** Opt-in over-fetch detection: wraps fetch().json() results in a Proxy. Default false. */
  trackFieldUsage?: boolean;
  /** e.g. 'alt+shift+a' (default). false disables. */
  hotkey?: string | false;
  /** Start with panel open. */
  open?: boolean;
  /** Persist mocks / snapshots / UI state in localStorage. Default true. */
  persist?: boolean;
  zIndex?: number;
}

export type ResolvedOptions = Required<Omit<PingPongOptions, 'intercept' | 'hotkey'>> & {
  intercept: Required<NonNullable<PingPongOptions['intercept']>>;
  hotkey: string | false;
};
