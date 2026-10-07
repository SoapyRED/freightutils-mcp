/**
 * Shared HTTP helper for calling the FreightUtils API.
 *
 * Auth model: when FREIGHTUTILS_API_KEY is set in the environment, every
 * outbound call carries it as `Authorization: Bearer <key>`. Unset env var
 * preserves the existing anonymous behaviour (25 requests/day per IP), so
 * users running freely continue to work without code changes.
 *
 * Why centralised in buildHeaders(): callers should never have to remember
 * to forward the key. apiGet / apiPost are the only two outbound surfaces
 * in this package, and both now route through this helper — the stdio
 * key-passthrough bug (Pro customers silently rate-limited because the
 * stdio surface wasn't forwarding the env-var key) is closed end-to-end.
 */

const BASE_URL = process.env.FREIGHTUTILS_API_URL ?? 'https://www.freightutils.com/api';

/**
 * Versioned User-Agent, DERIVED from package.json rather than typed here.
 *
 * WHY THIS EXISTS: the server attributes traffic per distribution surface from
 * this prefix. Without it, a REST call made by this stdio proxy is
 * indistinguishable from any other Node HTTP client, so npm download counts
 * were the only usage signal available — and downloads measure INSTALLS, not
 * calls. This is the header that tells the two apart.
 *
 * NOT THE SAME SURFACE AS THE HOSTED MCP ENDPOINT. This package is a stdio
 * server that proxies OUT to REST; /api/mcp is a separate hosted transport the
 * server already counts as an agent source. Attributing them together would
 * double-count the hosted one and hide this one.
 *
 * Read from package.json so it can never report a version the package is not,
 * resolved once at module load.
 *
 * VIA createRequire, not a JSON import: this package is ESM with
 * `module: Node16`, where import attributes are a compile error, and
 * `rootDir: src` means importing ../package.json would push the emitted output
 * up a directory and break the published layout. createRequire has neither
 * problem and resolves relative to this file at runtime.
 */
import { createRequire } from 'node:module';
import {
  FreightUtilsBadResponseError,
  FreightUtilsHttpError,
  FreightUtilsNetworkError,
  FreightUtilsRateLimitError,
  FreightUtilsServerError,
  FreightUtilsTimeoutError,
} from './errors.js';
const pkg = createRequire(import.meta.url)('../package.json') as { name: string; version: string };
const USER_AGENT = `${pkg.name}/${pkg.version}`;

export function buildHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    'Accept': 'application/json',
    'User-Agent': USER_AGENT,
    ...(extra ?? {}),
  };
  const key = process.env.FREIGHTUTILS_API_KEY;
  if (key) headers['Authorization'] = 'Bearer ' + key;
  return headers;
}

/** Options for the two outbound helpers. `envelope: true` requests the
 *  FreightUtils response envelope, v1.1 since 2.15.0 (`?envelope=1.1`) — used for the
 *  structuredContent channel. `legacySource: true` adds the bridge opt-in
 *  (`&legacy_source=1`): the API appends the flat channel's exact `_source`
 *  block to the envelope so the flat legacy text channel can be reconstructed
 *  from the SAME response — one request per successful call instead of two. */
export interface ApiOpts { envelope?: boolean; legacySource?: boolean }

/** How long one call may take, end to end (connect, headers and body). A stalled connection used
 *  to hang a tool call for ever. Override with FREIGHTUTILS_TIMEOUT_MS. */
export const DEFAULT_TIMEOUT_MS = 30_000;
function timeoutMs(): number {
  const v = Number(process.env.FREIGHTUTILS_TIMEOUT_MS);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_TIMEOUT_MS;
}

/** The host only — never the path, the query (it can hold inputs) or any userinfo. */
function hostOf(url: string): string {
  try { return new URL(url).host; } catch { return 'the configured FREIGHTUTILS_API_URL'; }
}

const isTimeout = (err: unknown) =>
  err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');

/** One call, every failure mapped to its class (errors.ts). Nothing is swallowed: each path
 *  either returns the parsed body or throws a FreightUtilsError with the original as `cause`. */
async function call(url: string, init: RequestInit): Promise<unknown> {
  const host = hostOf(url);
  const ms = timeoutMs();
  let res: Response;
  let text: string;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(ms) });
    text = await res.text();
  } catch (err) {
    throw isTimeout(err) ? new FreightUtilsTimeoutError(host, ms, err) : new FreightUtilsNetworkError(host, err);
  }
  if (!res.ok) {
    if (res.status === 429) throw new FreightUtilsRateLimitError(text, res.headers);
    if (res.status >= 500) throw new FreightUtilsServerError(res.status, text);
    throw new FreightUtilsHttpError(res.status, text);
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new FreightUtilsBadResponseError(host, res.status, err);
  }
}

export async function apiGet(endpoint: string, params: Record<string, unknown>, opts?: ApiOpts): Promise<unknown> {
  const url = new URL(`${BASE_URL}/${endpoint}`);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    url.searchParams.set(k, String(v));
  }
  if (opts?.envelope) url.searchParams.set('envelope', '1.1');
  if (opts?.legacySource) url.searchParams.set('legacy_source', '1');

  return call(url.toString(), { headers: buildHeaders() });
}

export async function apiPost(endpoint: string, body: unknown, opts?: ApiOpts): Promise<unknown> {
  const q = [
    ...(opts?.envelope ? ['envelope=1.1'] : []),
    ...(opts?.legacySource ? ['legacy_source=1'] : []),
  ].join('&');
  const url = `${BASE_URL}/${endpoint}${q ? '?' + q : ''}`;
  return call(url, {
    method: 'POST',
    headers: buildHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
}
