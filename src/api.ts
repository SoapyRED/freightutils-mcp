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

export function buildHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { 'Accept': 'application/json', ...(extra ?? {}) };
  const key = process.env.FREIGHTUTILS_API_KEY;
  if (key) headers['Authorization'] = 'Bearer ' + key;
  return headers;
}

export async function apiGet(endpoint: string, params: Record<string, unknown>): Promise<unknown> {
  const url = new URL(`${BASE_URL}/${endpoint}`);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    url.searchParams.set(k, String(v));
  }

  const res = await fetch(url.toString(), {
    headers: buildHeaders(),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`FreightUtils API error ${res.status}: ${body}`);
  }

  return res.json();
}

export async function apiPost(endpoint: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${BASE_URL}/${endpoint}`, {
    method: 'POST',
    headers: buildHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`FreightUtils API error ${res.status}: ${text}`);
  }

  return res.json();
}
