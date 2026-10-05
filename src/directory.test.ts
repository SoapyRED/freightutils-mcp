/**
 * Anthropic connector checklist — the 2.20.1 contract, pinned on this package's own tools.
 *
 * WHY. The hosted endpoint at https://www.freightutils.com/api/mcp serves THESE description
 * strings (the website generates its copy from this package), and that endpoint is the
 * FreightUtils connector in Anthropic's directory. The directory's pre-submission checklist
 * (claude.com/docs/connectors/building/review-criteria, read 2026-10-05) rejects a tool
 * description that tells Claude to call a tool the user did not ask for, or that promotes a
 * product or service, and requires a title and readOnlyHint / destructiveHint on every tool
 * and names of 64 characters or fewer.
 *
 * Until 2.20.1 every REST-backed tool ended with "back off and retry, or call
 * get_subscribe_link for higher limits", get_subscribe_link told Claude to call it "after any
 * other tool errors with a 429", and resolve_reference said "call this FIRST and follow the
 * candidate's api_url". Factual limits stay; instructions to call another tool and upsell go.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALL_TOOLS } from './tools.js';

test('every tool declares a title, readOnlyHint true and destructiveHint false; every name is ≤ 64 characters', () => {
  assert.ok(ALL_TOOLS.length >= 25, `expected the full tool set, got ${ALL_TOOLS.length}`);
  for (const t of ALL_TOOLS) {
    assert.ok(t.name.length <= 64, `${t.name}: name longer than 64 characters`);
    assert.ok(typeof t.annotations.title === 'string' && t.annotations.title.trim().length > 0, `${t.name}: no title`);
    assert.equal(t.annotations.readOnlyHint, true, `${t.name}: readOnlyHint must be true`);
    assert.equal(t.annotations.destructiveHint, false, `${t.name}: destructiveHint must be false`);
  }
});

test('no tool description outside its own names get_subscribe_link', () => {
  for (const t of ALL_TOOLS) {
    if (t.name === 'get_subscribe_link') continue;
    assert.equal(t.description.includes('get_subscribe_link'), false, `${t.name}: description sends Claude to get_subscribe_link`);
  }
});

test('no description carries upsell wording or a call-first instruction', () => {
  // The words that carried the instruction or the promotion in ≤ 2.20.0. Kept narrow on
  // purpose: "pricing" and "plans" are allowed in get_subscribe_link's own description,
  // because answering a pricing question is that tool's function.
  const BANNED = [/higher (API )?limits/i, /\bupgrade\b/i, /call this FIRST/i, /\bsubscribe\b/i, /agent front door/i, /agents must NOT/i, /after any other tool/i];
  for (const t of ALL_TOOLS) {
    for (const re of BANNED) {
      assert.equal(re.test(t.description), false, `${t.name}: description matches ${re}`);
    }
  }
});

test('the shared limit sentence is a fact: reset_at, no instruction', () => {
  const restBacked = ALL_TOOLS.filter((t) => !t.localEnvelope);
  assert.ok(restBacked.length >= 24, `expected the REST-backed tools, got ${restBacked.length}`);
  for (const t of restBacked) {
    assert.ok(
      t.description.includes('Rate-limited: a limit error carries reset_at, the UTC time the allowance resets.'),
      `${t.name}: the shared limit sentence is missing or changed`,
    );
  }
});

test('get_subscribe_link is a neutral pricing lookup the user asks for', () => {
  const t = ALL_TOOLS.find((x) => x.name === 'get_subscribe_link');
  assert.ok(t, 'get_subscribe_link is not registered');
  assert.ok(t.description.startsWith('Return the FreightUtils pricing page URL'), 'description should open with what it returns');
  assert.ok(t.description.includes('Use when the user asks about FreightUtils plans, pricing or API limits'), 'invocation must be tied to the user asking');
  assert.equal(/429/.test(t.description), false, 'no trigger on another tool’s error');
  assert.equal(t.annotations.title, 'FreightUtils Plans & Pricing');
});

test('resolve_reference says what it returns, not which tool to call next', () => {
  const t = ALL_TOOLS.find((x) => x.name === 'resolve_reference');
  assert.ok(t, 'resolve_reference is not registered');
  assert.ok(t.description.includes('do not know what kind of identifier it is'), 'when-to-use guidance is tied to the input');
  assert.ok(t.description.includes('api_url and canonical_url'), 'it still says what each candidate carries');
  assert.equal(/follow the candidate/i.test(t.description), false, 'no instruction to follow a URL or call a sibling');
});
