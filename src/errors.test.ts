/**
 * The API wrapper's error classes (errors.ts) — one test per class, then what an MCP client sees.
 *
 * Every failure keeps its class and HTTP status end to end: network failure, timeout, a 4xx
 * refusal with its body, 429 with reset_at, 5xx, and a 2xx that is not JSON. Nothing is
 * swallowed, the 4xx text is byte-identical to earlier releases, and no message carries the API
 * key, a stack trace or a 5xx page's internals. fetch is replaced per test; nothing leaves the
 * machine.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { apiGet, apiPost } from './api.js';
import { createServer } from './server.js';
import {
  FreightUtilsBadResponseError,
  FreightUtilsError,
  FreightUtilsHttpError,
  FreightUtilsNetworkError,
  FreightUtilsRateLimitError,
  FreightUtilsServerError,
  FreightUtilsTimeoutError,
  causeCode,
} from './errors.js';

const REAL_FETCH = globalThis.fetch;
const KEY = 'fu_test_key_must_never_appear_0123456789';
const HOST = 'www.freightutils.com';

afterEach(() => {
  globalThis.fetch = REAL_FETCH;
  delete process.env.FREIGHTUTILS_API_KEY;
  delete process.env.FREIGHTUTILS_TIMEOUT_MS;
});

let calls = 0;
function mockFetch(fn: (url: string, init?: RequestInit) => Promise<Response>) {
  calls = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls++;
    return fn(typeof input === 'string' ? input : String(input), init);
  }) as typeof fetch;
}
const respond = (status: number, body: string, headers: Record<string, string> = {}) =>
  async () => new Response(body, { status, headers });

/** No message, property or JSON form of the error carries the key. */
function assertNoKey(err: unknown) {
  const e = err as Error;
  const all = [e.message, e.stack ?? '', JSON.stringify(e), JSON.stringify(Object.entries(e))].join('\n');
  assert.ok(!all.includes(KEY), 'the API key leaked into the error');
}

async function caught(p: Promise<unknown>): Promise<FreightUtilsError> {
  try { await p; } catch (err) { return err as FreightUtilsError; }
  assert.fail('expected the call to throw');
}

test('network failure → FreightUtilsNetworkError: class, code, host; the cause kept, its text not shown', async () => {
  process.env.FREIGHTUTILS_API_KEY = KEY;
  const cause = Object.assign(new Error('connect ECONNREFUSED 10.1.2.3:443'), { code: 'ECONNREFUSED' });
  mockFetch(async () => { throw new TypeError('fetch failed', { cause }); });
  const err = await caught(apiGet('adr', { un: '1203' }));
  assert.ok(err instanceof FreightUtilsNetworkError);
  assert.equal(err.kind, 'network');
  assert.equal((err as FreightUtilsNetworkError).code, 'ECONNREFUSED');
  assert.equal((err as FreightUtilsNetworkError).host, HOST);
  assert.match(err.message, /^Could not reach the FreightUtils API at www\.freightutils\.com \(ECONNREFUSED\)/);
  assert.ok(!err.message.includes('10.1.2.3'), 'an internal address leaked into the message');
  assert.ok(err.cause instanceof TypeError, 'the original error is kept as cause');
  assertNoKey(err);
});

test('causeCode reads an AggregateError and ignores free text', () => {
  const agg = Object.assign(new AggregateError([Object.assign(new Error('x'), { code: 'ENOTFOUND' })], 'all failed'), {});
  assert.equal(causeCode(new TypeError('fetch failed', { cause: agg })), 'ENOTFOUND');
  assert.equal(causeCode(Object.assign(new Error('x'), { code: 'not a code' })), undefined);
  assert.equal(causeCode('string'), undefined);
});

test('timeout → FreightUtilsTimeoutError after FREIGHTUTILS_TIMEOUT_MS, never a hang', async () => {
  process.env.FREIGHTUTILS_TIMEOUT_MS = '40';
  mockFetch((_url, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
  }));
  const err = await caught(apiPost('adr-calculator', { items: [] }));
  assert.ok(err instanceof FreightUtilsTimeoutError);
  assert.equal(err.kind, 'timeout');
  assert.equal((err as FreightUtilsTimeoutError).timeoutMs, 40);
  assert.match(err.message, /did not answer within 40 ms/);
});

test('4xx refusal → FreightUtilsHttpError: status and body kept, message byte-identical to earlier releases', async () => {
  process.env.FREIGHTUTILS_API_KEY = KEY;
  const body = JSON.stringify({ error: 'Unknown parameter "Unit" in the query string — refused, not ignored.' });
  mockFetch(respond(400, body, { 'Content-Type': 'application/json' }));
  const err = await caught(apiGet('adr-calculator', { un: '1203', qty: 300 }));
  assert.ok(err instanceof FreightUtilsHttpError);
  assert.ok(!(err instanceof FreightUtilsRateLimitError) && !(err instanceof FreightUtilsServerError));
  assert.equal(err.kind, 'http');
  assert.equal((err as FreightUtilsHttpError).status, 400);
  assert.equal((err as FreightUtilsHttpError).body, body);
  assert.equal(err.message, `FreightUtils API error 400: ${body}`);
  assert.deepEqual((err as FreightUtilsHttpError).json, JSON.parse(body));
  assertNoKey(err);
});

test('429 → FreightUtilsRateLimitError with reset_at from the body and Retry-After; message unchanged', async () => {
  const body = JSON.stringify({ error: 'rate_limited', tier: 'anonymous', limit: 25, window: 'day', reset_at: '2026-10-08T00:00:00.000Z', upgrade_url: 'https://www.freightutils.com/pricing' });
  mockFetch(respond(429, body, { 'Content-Type': 'application/json', 'Retry-After': '3600', 'X-RateLimit-Reset': '1791417600' }));
  const err = await caught(apiGet('cbm', { length_cm: 120 }));
  assert.ok(err instanceof FreightUtilsRateLimitError);
  assert.ok(err instanceof FreightUtilsHttpError, 'a 429 is still an HTTP answer');
  assert.equal(err.kind, 'rate_limited');
  const rl = err as FreightUtilsRateLimitError;
  assert.equal(rl.status, 429);
  assert.equal(rl.resetAt, '2026-10-08T00:00:00.000Z');
  assert.equal(rl.retryAfterSeconds, 3600);
  assert.equal(err.message, `FreightUtils API error 429: ${body}`);
});

test('429 without a JSON body → resetAt from X-RateLimit-Reset', async () => {
  mockFetch(respond(429, 'Too Many Requests', { 'X-RateLimit-Reset': '1791417600' }));
  const err = await caught(apiGet('cbm', {})) as FreightUtilsRateLimitError;
  assert.ok(err instanceof FreightUtilsRateLimitError);
  assert.equal(err.resetAt, new Date(1791417600 * 1000).toISOString());
  assert.equal(err.retryAfterSeconds, undefined);
});

test('5xx → FreightUtilsServerError: status kept, the page (request ids, hosts) kept on .body but never shown', async () => {
  process.env.FREIGHTUTILS_API_KEY = KEY;
  const page = '<!DOCTYPE html><html><body>An error occurred with your deployment\nFUNCTION_INVOCATION_FAILED\nlhr1::iad1::8x2kq-1791410000000-abcdef</body></html>';
  mockFetch(respond(502, page, { 'Content-Type': 'text/html' }));
  const err = await caught(apiGet('hs', { code: '0901' }));
  assert.ok(err instanceof FreightUtilsServerError);
  assert.ok(err instanceof FreightUtilsHttpError);
  assert.equal(err.kind, 'server');
  assert.equal((err as FreightUtilsServerError).status, 502);
  assert.equal((err as FreightUtilsServerError).body, page);
  assert.match(err.message, /^FreightUtils API error 502: the service could not answer this call/);
  for (const leak of ['lhr1::', 'FUNCTION_INVOCATION_FAILED', '<html', 'DOCTYPE']) assert.ok(!err.message.includes(leak), `${leak} leaked`);
  assertNoKey(err);
});

test('2xx that is not JSON → FreightUtilsBadResponseError, the body not echoed', async () => {
  mockFetch(respond(200, '<html>captive portal login</html>', { 'Content-Type': 'text/html' }));
  const err = await caught(apiGet('unlocode', { code: 'NLRTM' }));
  assert.ok(err instanceof FreightUtilsBadResponseError);
  assert.equal(err.kind, 'bad_response');
  assert.equal((err as FreightUtilsBadResponseError).status, 200);
  assert.ok(!err.message.includes('captive portal'));
  assert.ok(err.cause instanceof SyntaxError);
});

// ─── what an MCP client sees ──────────────────────────────────────────────────

async function callTool(name: string, args: Record<string, unknown>) {
  const server = createServer();
  const client = new Client({ name: 'errors-test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  try {
    const r = await client.callTool({ name, arguments: args });
    const text = ((r.content as Array<{ text?: string }>) ?? []).map((c) => c.text ?? '').join('\n');
    return { isError: r.isError === true, text };
  } finally {
    await client.close();
    await server.close();
  }
}

test('MCP: a network failure is retried once, then reported by class — no stack, no key', async () => {
  process.env.FREIGHTUTILS_API_KEY = KEY;
  mockFetch(async () => { throw new TypeError('fetch failed', { cause: Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }) }); });
  const r = await callTool('adr_lookup', { un_number: '1203' });
  assert.equal(r.isError, true);
  assert.equal(calls, 2, 'one call and exactly one retry');
  assert.equal(r.text, `Error: Could not reach the FreightUtils API at ${HOST} (ENOTFOUND) — check the network connection, any proxy, or FREIGHTUTILS_API_URL.`);
  assert.ok(!r.text.includes(KEY) && !r.text.includes('    at '));
});

test('MCP: a transient failure followed by success answers normally', async () => {
  let n = 0;
  mockFetch(async () => {
    n++;
    if (n === 1) throw new TypeError('fetch failed', { cause: Object.assign(new Error('reset'), { code: 'ECONNRESET' }) });
    return new Response(JSON.stringify({ ok: true, result: { count: 0, results: [] }, legacy_source: { source: 'x' } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  const r = await callTool('adr_lookup', { un_number: '1203' });
  assert.equal(calls, 2, 'the retry was made');
  // The retry's answer is what the tool worked from: the first failure is gone. (The mock body
  // is a minimal envelope, so the SDK may still refuse it as output — that is not this test.)
  assert.ok(!r.text.includes('Could not reach'), `the recovered failure was still reported: ${r.text.slice(0, 200)}`);
});

test('MCP: a 429 keeps the API\'s own text, reset_at included (the flat fallback call is the one shown)', async () => {
  const body = JSON.stringify({ error: 'rate_limited', limit: 25, window: 'day', reset_at: '2026-10-08T00:00:00.000Z' });
  mockFetch(respond(429, body, { 'Content-Type': 'application/json', 'Retry-After': '60' }));
  const r = await callTool('adr_lookup', { un_number: '1203' });
  assert.equal(r.isError, true);
  assert.equal(calls, 2, 'the envelope call and the flat fallback — never a retry of a definite answer');
  assert.equal(r.text, `Error: FreightUtils API error 429: ${body}`);
});

test('MCP: a 5xx page is reported by status and a fixed sentence, never its contents', async () => {
  mockFetch(respond(504, 'An error occurred with your deployment\n\nFUNCTION_INVOCATION_TIMEOUT\n\nlhr1::xyz-123', { 'Content-Type': 'text/plain' }));
  const r = await callTool('adr_lookup', { un_number: '1203' });
  assert.equal(r.isError, true);
  assert.match(r.text, /^Error: FreightUtils API error 504: the service could not answer this call/);
  assert.ok(!r.text.includes('lhr1::') && !r.text.includes('FUNCTION_INVOCATION'));
});
