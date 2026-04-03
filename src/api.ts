/**
 * Shared HTTP helper for calling the FreightUtils API.
 */

const BASE_URL = process.env.FREIGHTUTILS_API_URL ?? 'https://www.freightutils.com/api';

export async function apiGet(endpoint: string, params: Record<string, unknown>): Promise<unknown> {
  const url = new URL(`${BASE_URL}/${endpoint}`);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    url.searchParams.set(k, String(v));
  }

  const res = await fetch(url.toString(), {
    headers: { 'Accept': 'application/json' },
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
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`FreightUtils API error ${res.status}: ${text}`);
  }

  return res.json();
}
