/**
 * Tests for the API key passthrough added in v2.3.0.
 *
 * Runs under node's built-in test runner (no jest / vitest dependency added —
 * the repo had no test infrastructure before this, so we use what ships with
 * Node 18+). The compiled output runs via:
 *   node --test --import tsx dist/api.test.js
 * but for source-level safety we also test the compiled artefact in CI via
 * `npm test`.
 *
 * Strategy: spy on globalThis.fetch, invoke apiGet / apiPost / buildHeaders,
 * assert the outgoing Authorization header (or its absence). Restore fetch
 * + env after every test so tests are order-independent.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { apiGet, apiPost, buildHeaders } from './api.js';

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_KEY = process.env.FREIGHTUTILS_API_KEY;

interface CapturedCall {
  url: string;
  init?: RequestInit;
}

function installFetchSpy(responseBody: unknown = { ok: true }): CapturedCall[] {
  const calls: CapturedCall[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : String(input);
    calls.push({ url, init });
    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  return calls;
}

function restore() {
  globalThis.fetch = ORIGINAL_FETCH;
  if (ORIGINAL_KEY === undefined) delete process.env.FREIGHTUTILS_API_KEY;
  else process.env.FREIGHTUTILS_API_KEY = ORIGINAL_KEY;
}

function headersAsObject(init: RequestInit | undefined): Record<string, string> {
  const h = init?.headers;
  if (!h) return {};
  if (h instanceof Headers) {
    const out: Record<string, string> = {};
    h.forEach((v, k) => { out[k] = v; });
    return out;
  }
  if (Array.isArray(h)) return Object.fromEntries(h);
  return h as Record<string, string>;
}

describe('buildHeaders', () => {
  beforeEach(() => { delete process.env.FREIGHTUTILS_API_KEY; });
  afterEach(restore);

  it('omits Authorization when FREIGHTUTILS_API_KEY is unset', () => {
    const h = buildHeaders();
    assert.equal(h['Accept'], 'application/json');
    assert.equal(h['Authorization'], undefined);
  });

  it('adds Bearer Authorization when FREIGHTUTILS_API_KEY is set', () => {
    process.env.FREIGHTUTILS_API_KEY = 'fu_test_abc123';
    const h = buildHeaders();
    assert.equal(h['Authorization'], 'Bearer fu_test_abc123');
    assert.equal(h['Accept'], 'application/json');
  });

  it('merges extra headers and still adds Authorization', () => {
    process.env.FREIGHTUTILS_API_KEY = 'fu_test_xyz';
    const h = buildHeaders({ 'Content-Type': 'application/json' });
    assert.equal(h['Content-Type'], 'application/json');
    assert.equal(h['Accept'], 'application/json');
    assert.equal(h['Authorization'], 'Bearer fu_test_xyz');
  });

  it('treats empty string env var as unset (no Authorization header)', () => {
    process.env.FREIGHTUTILS_API_KEY = '';
    const h = buildHeaders();
    assert.equal(h['Authorization'], undefined);
  });
});

describe('apiGet', () => {
  let calls: CapturedCall[];
  beforeEach(() => { delete process.env.FREIGHTUTILS_API_KEY; });
  afterEach(restore);

  it('sends Authorization when env var is set', async () => {
    process.env.FREIGHTUTILS_API_KEY = 'fu_get_key';
    calls = installFetchSpy();
    await apiGet('cbm', { length_cm: 100 });
    assert.equal(calls.length, 1);
    const headers = headersAsObject(calls[0].init);
    assert.equal(headers['Authorization'], 'Bearer fu_get_key');
    assert.equal(headers['Accept'], 'application/json');
  });

  it('omits Authorization when env var is unset', async () => {
    calls = installFetchSpy();
    await apiGet('cbm', { length_cm: 100 });
    assert.equal(calls.length, 1);
    const headers = headersAsObject(calls[0].init);
    assert.equal(headers['Authorization'], undefined);
    assert.equal(headers['Accept'], 'application/json');
  });
});

describe('apiPost', () => {
  let calls: CapturedCall[];
  beforeEach(() => { delete process.env.FREIGHTUTILS_API_KEY; });
  afterEach(restore);

  it('sends Authorization when env var is set', async () => {
    process.env.FREIGHTUTILS_API_KEY = 'fu_post_key';
    calls = installFetchSpy();
    await apiPost('shipment', { items: [] });
    assert.equal(calls.length, 1);
    const headers = headersAsObject(calls[0].init);
    assert.equal(headers['Authorization'], 'Bearer fu_post_key');
    assert.equal(headers['Content-Type'], 'application/json');
    assert.equal(headers['Accept'], 'application/json');
  });

  it('omits Authorization when env var is unset, still sends Content-Type', async () => {
    calls = installFetchSpy();
    await apiPost('shipment', { items: [] });
    assert.equal(calls.length, 1);
    const headers = headersAsObject(calls[0].init);
    assert.equal(headers['Authorization'], undefined);
    assert.equal(headers['Content-Type'], 'application/json');
    assert.equal(headers['Accept'], 'application/json');
  });
});
