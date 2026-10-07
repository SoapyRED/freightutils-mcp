/**
 * The errors the FreightUtils API wrapper (api.ts) throws — one class per way a call can fail.
 *
 * WHY (2.21.1). Every failure used to be a bare `Error("FreightUtils API error <status>: <body>")`,
 * and a network fault arrived as undici's `TypeError: fetch failed`. server.ts told the two
 * apart by matching the message prefix, nothing carried the HTTP status or the rate-limit reset
 * as data, a 5xx platform error page went to the client verbatim, and a stalled connection
 * could hang a tool call for ever (no timeout). The classes below keep the class and the status
 * end to end, so the server decides retries by type and a caller reads `.status`, `.body` or
 * `.resetAt` without parsing text.
 *
 * WHAT A CLIENT SEES (server.ts prefixes "Error: "):
 *  - 4xx, including 429: the API's own refusal, byte-identical to every earlier release —
 *    `FreightUtils API error <status>: <body>`. That body IS the answer to the call (a
 *    validation error naming the field, a rate-limit notice with reset_at and the upgrade link);
 *    hiding it would hide the reason.
 *  - 5xx: the status and a fixed sentence. The body stays on the error (`.body`) but is not
 *    shown — a platform error page can carry request ids and internal host names.
 *  - network failure, timeout, a 2xx that is not JSON: a fixed sentence naming the API host and
 *    the system error code. Never a stack trace, a request header or the API key.
 */

export type FreightUtilsErrorKind = 'network' | 'timeout' | 'http' | 'rate_limited' | 'server' | 'bad_response';

export class FreightUtilsError extends Error {
  readonly kind: FreightUtilsErrorKind;
  constructor(kind: FreightUtilsErrorKind, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
    this.kind = kind;
  }
}

/** A system error code such as ECONNREFUSED or ENOTFOUND from undici's `fetch failed` cause
 *  (an Error or an AggregateError). Only an UPPER_SNAKE code is taken — never free text. */
export function causeCode(err: unknown): string | undefined {
  const seen = new Set<unknown>();
  let cur: unknown = err;
  while (cur && typeof cur === 'object' && !seen.has(cur)) {
    seen.add(cur);
    const code = (cur as { code?: unknown }).code;
    if (typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,40}$/.test(code)) return code;
    const inner = (cur as { errors?: unknown[] }).errors;
    if (Array.isArray(inner) && inner.length) {
      const c = causeCode(inner[0]);
      if (c) return c;
    }
    cur = (cur as { cause?: unknown }).cause;
  }
  return undefined;
}

/** fetch could not complete: DNS, connection refused or reset, TLS, a proxy in the way. */
export class FreightUtilsNetworkError extends FreightUtilsError {
  readonly host: string;
  readonly code: string | undefined;
  constructor(host: string, cause: unknown) {
    const code = causeCode(cause);
    super('network', `Could not reach the FreightUtils API at ${host}${code ? ` (${code})` : ''} — check the network connection, any proxy, or FREIGHTUTILS_API_URL.`, { cause });
    this.host = host;
    this.code = code;
  }
}

/** No complete answer within the timeout (FREIGHTUTILS_TIMEOUT_MS, default 30 s). */
export class FreightUtilsTimeoutError extends FreightUtilsError {
  readonly host: string;
  readonly timeoutMs: number;
  constructor(host: string, timeoutMs: number, cause?: unknown) {
    const s = timeoutMs >= 1000 ? `${Math.round(timeoutMs / 100) / 10} s` : `${timeoutMs} ms`;
    super('timeout', `The FreightUtils API at ${host} did not answer within ${s} — try again, or raise FREIGHTUTILS_TIMEOUT_MS.`, { cause });
    this.host = host;
    this.timeoutMs = timeoutMs;
  }
}

/** A non-2xx answer. 4xx keeps the API's own body in the message (it is the answer); the
 *  subclasses below cover 429 and 5xx. */
export class FreightUtilsHttpError extends FreightUtilsError {
  readonly status: number;
  /** The response body as text, exactly as received. */
  readonly body: string;
  constructor(status: number, body: string, message?: string, kind: FreightUtilsErrorKind = 'http') {
    super(kind, message ?? `FreightUtils API error ${status}: ${body}`);
    this.status = status;
    this.body = body;
  }
  /** The body parsed as JSON, or undefined when it is not JSON. */
  get json(): unknown {
    try { return JSON.parse(this.body); } catch { return undefined; }
  }
}

/** 429. `resetAt` (ISO 8601) comes from the body's `reset_at`, else from X-RateLimit-Reset;
 *  `retryAfterSeconds` from Retry-After. The message is the API's own, unchanged. */
export class FreightUtilsRateLimitError extends FreightUtilsHttpError {
  readonly resetAt: string | undefined;
  readonly retryAfterSeconds: number | undefined;
  constructor(body: string, headers?: Headers) {
    super(429, body, undefined, 'rate_limited');
    const parsed = this.json as { reset_at?: unknown } | undefined;
    let resetAt = typeof parsed?.reset_at === 'string' && !Number.isNaN(Date.parse(parsed.reset_at)) ? parsed.reset_at : undefined;
    const resetUnix = Number(headers?.get('X-RateLimit-Reset'));
    if (!resetAt && Number.isFinite(resetUnix) && resetUnix > 0) resetAt = new Date(resetUnix * 1000).toISOString();
    const retry = Number(headers?.get('Retry-After'));
    this.resetAt = resetAt;
    this.retryAfterSeconds = Number.isFinite(retry) && retry >= 0 && headers?.get('Retry-After') ? retry : undefined;
  }
}

/** 5xx. The body is kept on `.body` but never shown. */
export class FreightUtilsServerError extends FreightUtilsHttpError {
  constructor(status: number, body: string) {
    super(status, body, `FreightUtils API error ${status}: the service could not answer this call — try again shortly; https://www.freightutils.com/status shows any incident.`, 'server');
  }
}

/** A 2xx whose body is not JSON (a proxy page, a truncated answer). */
export class FreightUtilsBadResponseError extends FreightUtilsError {
  readonly status: number;
  constructor(host: string, status: number, cause?: unknown) {
    super('bad_response', `The FreightUtils API at ${host} answered HTTP ${status} with a body that is not JSON — try again shortly.`, { cause });
    this.status = status;
  }
}

/** A definite upstream answer (any non-2xx) as opposed to a transient failure worth a retry. */
export const isHttpError = (err: unknown): err is FreightUtilsHttpError => err instanceof FreightUtilsHttpError;
