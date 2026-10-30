/**
 * The 2.26.0-pending mirror of freightutils.com Run R7 — check receipts need an API key. Without one,
 * a check's answer carries `_meta.receipt` (stored false, the receipt hash and the hashed fields) and no
 * check_id. Pinned with a RECORDED anonymous answer of GET /api/adr-calculator (the website's own route,
 * test-fixtures/r7-anonymous-adr-calculator.json) over the SDK's in-memory transport and validating client.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from './server.js';

const RECORDED = JSON.parse(readFileSync(new URL('../test-fixtures/r7-anonymous-adr-calculator.json', import.meta.url), 'utf8')) as { hash_header: string; body: Record<string, unknown> & { _meta: { receipt: Record<string, unknown> } } };

async function connect() {
  const server = createServer({});
  const client = new Client({ name: 'mirror-r7-test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, close: async () => { await client.close(); await server.close(); } };
}

async function withApi<T>(body: unknown, fn: () => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;
  try { return await fn(); } finally { globalThis.fetch = real; }
}

/** The published rule (/api-docs#receipts-without-a-key): sha256 over the canonical JSON of the hashed fields. */
const canonical = (v: unknown): string => (Array.isArray(v) ? `[${v.map(canonical).join(',')}]`
  : v && typeof v === 'object' ? `{${Object.keys(v).sort().filter((k) => (v as Record<string, unknown>)[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}`
    : JSON.stringify(v ?? null));
function recompute(env: Record<string, unknown> & { _meta: Record<string, unknown> & { receipt: Record<string, unknown> } }): string {
  const rc = env._meta.receipt;
  return `sha256:${createHash('sha256').update(canonical({ created_at: rc.created_at, tool: rc.tool, inputs: rc.inputs, edition: env.edition, as_of: env.as_of, edition_basis: env._meta.edition_basis, dataset_version: rc.dataset_version, engine_version: rc.engine_version, result: rc.result })).digest('hex')}`;
}

test('R7: the recorded anonymous answer recomputes its own receipt_hash (and equals the header)', () => {
  assert.equal(recompute(RECORDED.body), RECORDED.body._meta.receipt.receipt_hash);
  assert.equal(RECORDED.hash_header, RECORDED.body._meta.receipt.receipt_hash);
  assert.equal(RECORDED.body._meta.receipt.stored, false);
  assert.ok(!('check_id' in RECORDED.body._meta));
});

test('R7: an anonymous check answer with _meta.receipt validates in a validating client, passed through unchanged', async () => {
  await withApi(RECORDED.body, async () => {
    const { client, close } = await connect();
    const r = await client.callTool({ name: 'adr_exemption_calculator', arguments: { un_number: '1203', quantity: 300, unit: 'L' } });
    assert.ok(!r.isError, JSON.stringify(r).slice(0, 400));
    const sc = r.structuredContent as Record<string, unknown> & { _meta: Record<string, unknown> & { receipt: Record<string, unknown> } };
    assert.equal(sc._meta.receipt.stored, false);
    assert.equal(sc._meta.receipt.reason, 'key_required');
    assert.ok(!('check_id' in sc._meta));
    assert.equal(recompute(sc), RECORDED.body._meta.receipt.receipt_hash, 'the hash still recomputes from structuredContent');
    await close();
  });
});

test('R7: _meta.receipt is typed — a receipt claiming stored: true is refused by the client', async () => {
  const bad = { ...RECORDED.body, _meta: { ...RECORDED.body._meta, receipt: { ...RECORDED.body._meta.receipt, stored: true } } };
  await withApi(bad, async () => {
    const { client, close } = await connect();
    // A schema refusal surfaces as a rejection or (newer SDKs) an isError result — never as a valid answer.
    const r = await client.callTool({ name: 'adr_exemption_calculator', arguments: { un_number: '1203', quantity: 300, unit: 'L' } }).catch((e: unknown) => ({ rejected: e }));
    const sc = (r as { structuredContent?: { _meta?: { receipt?: { stored?: unknown } } } }).structuredContent;
    assert.ok('rejected' in r || (r as { isError?: boolean }).isError === true, `accepted: ${JSON.stringify(r).slice(0, 300)}`);
    assert.notEqual(sc?._meta?.receipt?.stored, true);
    await close();
  });
});
