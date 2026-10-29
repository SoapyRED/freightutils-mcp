import { z } from 'zod';

/**
 * FreightUtils response envelope v1.1 — output-schema side. Accepts version '1' too
 * (a transitional response can carry either), and the additive v1.2 status fields.
 *
 * Mirrors the hosted contract (freightutils.com schemas/response-envelope.v1.1.json
 * and the /api/mcp ENVELOPE_OUTPUT_SHAPE) field-for-field. The envelope itself is
 * ALWAYS built by the REST API (`?envelope=1`) — this package never constructs
 * envelopes for REST-backed tools, so the contract cannot fork. The only locally
 * built envelope is get_subscribe_link's static one (no REST endpoint), which
 * replicates the hosted /api/mcp envelope for that tool verbatim.
 *
 * Omit-when-empty rules (enforced upstream by the API's buildEnvelope):
 * warnings / blocking_errors omitted when empty; normalized_input / validity
 * omitted when absent; confidence.score present ONLY for basis=match_quality;
 * ok=false exactly when blocking_errors are present.
 */
export function envelopeShape(result: z.ZodTypeAny): z.ZodRawShape {
  return {
    envelope_version: z.enum(['1', '1.1', '1.2']),
    ok: z.boolean(),
    // v1.2 (freightutils.com, 2026-10-28; REST ?envelope=1.2): status fields beside ok, all optional
    // here so a 1 / 1.1 envelope still validates. This package still requests ?envelope=1.1 — accepting
    // the shape now means switching the request later is a one-line change, not a schema release.
    status: z.enum(['ok', 'partial', 'not_found', 'unsupported', 'ambiguous']).optional(),
    missing_inputs: z.array(z.string()).optional(),
    edition: z.object({
      name: z.string(),
      applies_from: z.string().nullable(),
      may_apply_until: z.string().nullable(),
    }).nullable().optional(),
    as_of: z.string().optional(),
    // _meta.identify (2026-10-28): present only on an anonymous answer; informational.
    _meta: z.object({ identify: z.string().optional() }).passthrough().optional(),
    result,
    confidence: z.object({
      level: z.enum(['high', 'medium', 'low']),
      basis: z.enum(['deterministic', 'provenance', 'match_quality', 'freshness']),
      score: z.number().min(0).max(1).optional(),
    }),
    normalized_input: z.record(z.string(), z.unknown()).optional(),
    warnings: z.array(z.object({
      code: z.string(),
      message: z.string(),
      details: z.record(z.string(), z.unknown()).optional(),
    })).optional(),
    blocking_errors: z.array(z.object({
      code: z.string(),
      message: z.string(),
      recovery: z.object({
        action: z.string(),
        tool: z.string().optional(),
        params: z.record(z.string(), z.unknown()).optional(),
      }),
    })).optional(),
    validity: z.object({
      effective_from: z.string().optional(),
      effective_to: z.string().nullable().optional(),
      as_of: z.string(),
    }).optional(),
    _source: z.object({
      name: z.string(),
      checked: z.string(),
      provenance_status: z.enum(['verified', 'pending-verification', 'computed', 'live']),
      source_url: z.string().optional(),
      // v1.1 freshness fields — editioned datasets only; continuous datasets
      // legitimately omit all three. EDITION_LAG (warnings[].code) fires when
      // dataset_edition trails authority_current_edition.
      dataset_edition: z.string().optional(),
      authority_current_edition: z.string().optional(),
      checked_at: z.string().optional(),
    }),
    citation: z.object({ text: z.string(), qualifier: z.string().optional() }),
  };
}

/**
 * Envelope `result` payloads are documented per tool but every field is
 * tolerant (nullish) and unknown keys pass through: error envelopes carry
 * `result: {}`, several endpoints emit explicit nulls, and the upstream API
 * may add fields between package releases. This helper keeps that rule in
 * one place — the declared fields document the shape without ever making a
 * live response fail output-schema validation.
 */
export function resultShape(fields: z.ZodRawShape): z.ZodTypeAny {
  const tolerant: Record<string, z.ZodTypeAny> = {};
  for (const [k, v] of Object.entries(fields)) tolerant[k] = (v as z.ZodTypeAny).nullish();
  // The typed branch documents the shape; the record branch is a safety net so
  // a type variance in a live response (the API evolves independently of the
  // package) can never fail output-schema validation and break the tool.
  return z.object(tolerant).passthrough().or(z.record(z.string(), z.unknown()));
}

/** Same tolerance rule for nested record objects (array items, sub-objects). */
export function loose(fields: z.ZodRawShape): z.ZodTypeAny {
  const tolerant: Record<string, z.ZodTypeAny> = {};
  for (const [k, v] of Object.entries(fields)) tolerant[k] = (v as z.ZodTypeAny).nullish();
  return z.object(tolerant).passthrough();
}
