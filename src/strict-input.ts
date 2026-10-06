import { z } from 'zod';

/**
 * An input object that REFUSES a key it does not read (2.21.0).
 *
 * WHY. Every tool here declared `.strict()`, but server.ts registered `schema.shape`, so the
 * SDK rebuilt each schema as a plain z.object that STRIPS unknown keys — the `.strict()` was
 * inert. A declaration sent under any other name vanished before the handler ran, the
 * API's own response names included. Reproduced on production through 2.20.1 (2026-10-06):
 * adr_exemption_calculator with `{ un_number: "1203", quantity: 300, quantity_basis: "gross" }`
 * on an item read "exempt" at 900 points, where `basis: "gross"` withholds; `un: "1051"`
 * beside items[] vanished and a category 0 load read "exempt"; adr_lq_eq_check with
 * `inner_packagings: 20` checked one inner packaging and read "qualifies" under E2; and a
 * shipment_summary line with `un: "1051"` was not a dangerous-goods line at all.
 *
 * The tools built with this helper are registered with the schema itself (ToolDef.strictKeys),
 * so the SDK answers a tool error whose text names the key, suggests the accepted name it
 * most likely meant and lists the accepted ones — and tools/list publishes
 * `additionalProperties: false`.
 *
 * The words are the website's (lib/calculations/request-keys.ts unknownKeysMessage, which
 * the hosted endpoint uses for the same three tools): keep the two in step. The fixture in
 * src/unknown-keys.test.ts and the website's lint:adr-variants (10a) pin the same sentence.
 */

export interface KeyRule {
  /** Normalised key (see normaliseKey) → the name to suggest for it. */
  hints?: Readonly<Record<string, string>>;
  /** Text before the accepted list, e.g. "Accepted on each item". */
  acceptedLabel: string;
  /** One sentence appended to the refusal. */
  note?: string;
}

const MAX_KEY_ECHO = 40;
const MAX_KEYS_NAMED = 10;

/** Case- and separator-blind form of a key: "UN_NUMBER", "unNumber", "un-number" → "unnumber". */
export function normaliseKey(k: string): string {
  return k.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const show = (k: string) => JSON.stringify(k.length > MAX_KEY_ECHO ? `${k.slice(0, MAX_KEY_ECHO)}…` : k);

function joinAnd(parts: string[]): string {
  return parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** The accepted name a refused key most likely meant — never a key the caller also sent. */
export function suggestKey(key: string, accepted: readonly string[], rule: KeyRule, sent: ReadonlySet<string>): string | null {
  const n = normaliseKey(key);
  if (!n) return null;
  const pick = (s: string | undefined) => (s && !sent.has(s) ? s : null);
  const hint = rule.hints?.[n];
  if (hint) return pick(hint);
  const exact = accepted.find((a) => normaliseKey(a) === n);
  if (exact) return pick(exact);
  const singular = n.endsWith('s') ? n.slice(0, -1) : null;
  return singular ? pick(accepted.find((a) => normaliseKey(a) === singular)) : null;
}

/** [] → "in the arguments", ["items", 0] → "on items[0]", ["origin"] → "in origin". */
export function keyPathWhere(path: readonly (string | number)[]): string {
  if (path.length === 0) return 'in the arguments';
  const p = path.map((s, i) => (typeof s === 'number' ? `[${s}]` : `${i === 0 ? '' : '.'}${s}`)).join('');
  return typeof path[path.length - 1] === 'number' ? `on ${p}` : `in ${p}`;
}

/** The refusal text — keys echoed (capped), values never: an unknown field may hold a secret. */
export function unknownKeysMessage(keys: readonly string[], sentKeys: Iterable<string>, accepted: readonly string[], rule: KeyRule, where: string): string {
  const sent = new Set(sentKeys);
  const named = keys.slice(0, MAX_KEYS_NAMED).map(show);
  const more = keys.length > MAX_KEYS_NAMED ? [`${keys.length - MAX_KEYS_NAMED} more`] : [];
  const one = keys.length === 1;
  const suggestions = keys
    .map((k) => [k, suggestKey(k, accepted, rule, sent)] as const)
    .filter((p): p is readonly [string, string] => p[1] !== null);
  const didYouMean = suggestions.length === 0
    ? ''
    : one
      ? ` Did you mean ${show(suggestions[0][1])}?`
      : ` Did you mean ${joinAnd(suggestions.map(([k, s]) => `${show(s)} for ${show(k)}`))}?`;
  const apiKeyNote = keys.some((k) => /key|token/i.test(k)) ? ' An API key goes in the X-API-Key header.' : '';
  return (
    `Unknown field${one ? '' : 's'} ${joinAnd([...named, ...more])} ${where} — refused, not ignored: ` +
    'a field this tool does not read could carry a declaration that changes the answer, so no answer is given.' +
    didYouMean +
    ` ${rule.acceptedLabel}: ${accepted.join(', ')}.` +
    (rule.note ? ` ${rule.note}` : '') +
    apiKeyNote
  );
}

/** z.object(shape).strict(), refusing an unknown key with the message above. */
export function strictInput<T extends z.ZodRawShape>(shape: T, rule: KeyRule) {
  const accepted = Object.keys(shape);
  return z.object(shape, {
    errorMap: (issue, ctx) => {
      if (issue.code !== z.ZodIssueCode.unrecognized_keys) return { message: ctx.defaultError };
      const sent = typeof ctx.data === 'object' && ctx.data !== null ? Object.keys(ctx.data as object) : [];
      return { message: unknownKeysMessage(issue.keys, sent, accepted, rule, keyPathWhere(issue.path)) };
    },
  }).strict();
}
