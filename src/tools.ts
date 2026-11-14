import { z } from 'zod';
import { apiGet, apiPost, type ApiOpts } from './api.js';
import { FU_ID_FIELDS, loose, resultShape } from './envelope.js';
import { normaliseKey, strictInput } from './strict-input.js';

// ─────────────────────────────────────────────────────────────
//  Tool type
// ─────────────────────────────────────────────────────────────

export interface ToolAnnotationShape {
  title: string;
  readOnlyHint: true;
  destructiveHint: false;
  idempotentHint: true;
  openWorldHint: false;
}

export interface ToolDef {
  name: string;
  description: string;
  // Allow any ZodObject (including .strict() variants) so individual tools
  // can opt into strict-key enforcement without breaking the shared type.
  schema: z.ZodObject;
  /** Register `schema` ITSELF, so an unknown key is a tool error naming it (2.21.0). Without
   *  this, server.ts registers `schema.shape` and the SDK strips unknown keys — a tool's own
   *  `.strict()` is then inert. Set on the three ADR-answer tools; the rest are a BACKLOG item. */
  strictKeys?: true;
  annotations: ToolAnnotationShape;
  /** Calls the REST API. opts.envelope=true adds ?envelope=1 (the
   *  structuredContent channel); the flat default feeds the legacy text
   *  channel, which stays byte-identical release to release. */
  handler: (args: Record<string, unknown>, opts?: ApiOpts) => Promise<unknown>;
  /** This tool's payload shape inside the envelope's `result` (every field
   *  nullish + passthrough — see envelope.ts). */
  resultSchema: z.ZodTypeAny;
  /** Pre-2.11 rich text layout (summary lead + own citation line) — preserved
   *  byte-identically for the tools that already shipped it. */
  richText?: boolean;
  /** Optional one-line human citation appended to the text content. */
  citation?: (result: unknown) => string;
  /** Local tools with no REST endpoint build their (static) envelope here,
   *  replicating the hosted /api/mcp envelope for the same tool verbatim. */
  localEnvelope?: (flat: unknown) => Record<string, unknown>;
}

// Every FreightUtils tool is a pure, read-only lookup or deterministic
// calculation. This helper keeps the annotations consistent.
const readOnlyAnnotations = (title: string): ToolAnnotationShape => ({
  title,
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
});

// Shared rate-limit sentence (Behavior: error signaling — every REST-backed tool).
// A fact about the tool, nothing else: no instruction to call another tool and no upsell
// (Anthropic's connector checklist rejects both — 2.20.1). reset_at is on every limit error
// a tool call can return: the REST 429 body (anonymous and keyed) this package surfaces, and
// the hosted endpoint's JSON-RPC error data.
/** A batch list as the REST API takes it on GET: comma-separated (0B). */
const listArg = (v: unknown): string | undefined => (Array.isArray(v) ? v.map(String).join(',') : undefined);

const RATE = 'Rate-limited: a limit error carries reset_at, the UTC time the allowance resets.';
// Shared envelope tail — what every REST-backed tool returns around its result.
const ENV = 'plus confidence, _source and citation (the FreightUtils v1 response envelope).';

// Build 1 mirror (freightutils.com, 2026-10-30): the ADR edition arguments of the five tools that read
// ADR data — the same names, values and words as the hosted server (app/api/mcp, EDITION_ARGS).
const EDITION_SHAPE = {
  edition: z.enum(['2025', '2027']).optional().describe('ADR edition; wins over as_of. Omitted: as_of picks it.'),
  as_of: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'as_of must be a date written YYYY-MM-DD, e.g. 2027-01-15').optional().describe('The date the answer is for, YYYY-MM-DD (default today, UTC).'),
};
// The ADR code registry's verification_status (2.28.0, website G2 / G2-2): the set /api/adr and the code
// pages serve (lib/adr/codes.ts VerificationStatus on freightutils.com).
const ADR_CODE_STATUS = z.enum(['paraphrase_unreviewed', 'machine_reviewed', 'contested', 'owner_reviewed', 'dg_reviewed', 'needs_fix', 'verified']);
const EDITIONS = 'edition ("2025" | "2027") and as_of (YYYY-MM-DD) choose the ADR edition — edition wins, else the date picks it (ADR 2025 before 2027-01-01, ADR 2027 from then; ADR 2025 may still be applied until 2027-06-30). An answer on a named edition carries adr_edition; neither sent, the answer is ADR 2025 until 2027-01-01.';
// 2.34.3 (run TW1): the one edition sentence each ADR-reading tool keeps; the whole rule is said once, in INSTRUCTIONS.
const EDITION_CLAUSE = 'edition ("2025" | "2027") and as_of choose the ADR edition; neither sent, ADR 2025 until 2027-01-01.';
// The field names a description lists are the snake_case ones this package serves (from the REST
// API); the hosted endpoint at /api/mcp serves the same fields in camelCase (2.22.0, probe S22).
const CASING = 'Field names as this package serves them (snake_case); the hosted /api/mcp endpoint serves the same fields in camelCase (e.g. total_cbm → totalCbm).';
// Totals from unrounded values (2.22.0, probe S1/S2): only displayed figures are rounded.
const UNROUNDED = 'totals are computed from unrounded figures and rounded only for display';
const RESOLVE_MAX_QUERY_LENGTH = 32;
const RESOLVE_MAX_FU_ID_LENGTH = 200;

// 2.33.0: an ADR Table A row echoed inside a check answer (an exemption engine item, a document line's candidate
// rows), with the identifiers the API puts on it; the rows it stands for (equivalent_variants) carry them too.
const ADR_ECHO_ROW = loose({ ...FU_ID_FIELDS, equivalent_variants: z.array(loose({ ...FU_ID_FIELDS })) });
// 2.33.0: the clause each record tool's description carries (one wording, never typed per tool).
const IDS = 'Each record carries fu_id, a stable FreightUtils identifier (and fu_version_id where the dataset has editions); resolve_reference resolves one to exactly its record.';

// LIST answers an agent can read (2.22.0, probe S21): summary rows (a subset of each record's own
// fields) with total / truncated / next_offset by default; full: true returns full records five per
// page; a single-record call always returns the full record. Sent to REST as view=summary.
const LIST_FIELDS = {
  full: z.boolean().optional().describe('Lists only: true returns full records instead of summary rows.'),
  offset: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional().describe('Lists only: rows to skip (default 0).'),
  limit: z.number().int().min(1).max(100).optional().describe('Lists only: rows per page.'),
};
const LIST_TEXT = 'A list (no single record asked for) returns summary rows with total, truncated, next_offset and detail_hint; full: true returns full records five per page, with offset / limit to page.';
const listQuery = (args: Record<string, unknown>, isList: boolean, summaryLimit?: number) => isList
  ? { ...(args.full ? {} : { view: 'summary' }), offset: args.offset, limit: args.limit ?? (args.full ? 5 : summaryLimit) }
  : {};

// adr_exemption_calculator's identifier (2.20.0): a UN number exactly as before (4 digits,
// optionally "UN"-prefixed) OR an ID-prefixed air-only number ("ID8000", "ID 8000", "ID-8000"), which
// the API routes AIR_ONLY_ID. A copy of the website's EXEMPTION_IDENTIFIER_PATTERN
// (lib/calculations/adr-identifier.ts) — the two must match.
// 2.22.0: "UN 1203" (the transport-document form) is accepted, as the API always read it (probe S36).
const EXEMPTION_IDENTIFIER_PATTERN = /^(?:\s*(?:UN\s*)?\d{4}\s*|\s*ID\s*[-:.]?\s*\d{4}\s*)$/i;
const EXEMPTION_IDENTIFIER_MESSAGE = 'UN number must be 4 digits, optionally prefixed with "UN" (e.g. "1203", "UN1203", "UN 1203") — or an ID-prefixed air-only number such as "ID8000"';

// The refusal for an unknown key (2.21.0) — the hints, labels and notes the hosted endpoint
// uses for the same tools (the website's MCP_KEY_RULES in lib/calculations/request-keys.ts).
// A hint maps a normalised key to the name to suggest: the API's own response names
// (quantity_unit, quantity_basis), the GET spellings (un, qty), and the per-line fields a
// caller sends at the top level by mistake (→ items[n].<field>).
const toItemPath = (fields: readonly string[], extra: Record<string, string> = {}) =>
  ({ ...Object.fromEntries(fields.map((f) => [normaliseKey(f), `items[n].${f}`])), ...extra });
const EXEMPTION_KEY_HINTS = { quantityunit: 'unit', quantitybasis: 'basis', un: 'un_number', qty: 'quantity' };
const LQ_ITEM_FIELDS = ['un_number', 'quantity', 'unit', 'inner_packaging_qty', 'packing_group', 'variant_index'];
const SHIPMENT_ITEM_FIELDS = ['description', 'length', 'width', 'height', 'weight', 'quantity', 'stackable', 'pallet_type', 'hs_code', 'un_number', 'adr_quantity', 'adr_quantity_unit', 'customs_value'];
const UNKNOWN_FIELDS_REFUSED = 'Fields are checked by name: a field the tool does not read is refused with a tool error naming it and listing the accepted ones, never ignored.';

// A count sent to a GET endpoint travels as String(n) — and String(1e21) is "1e+21", which the API
// used to read as 1 (parseInt stops at the "e"). 2^53 − 1 is the largest whole number JSON
// implementations read exactly (RFC 8259 §6); the API and the hosted endpoint refuse anything larger
// (2.21.2), so the schema refuses it before the call.
const WHOLE_MAX = Number.MAX_SAFE_INTEGER;
const wholeMax = (field: string) => [WHOLE_MAX, `${field} must be at most 9007199254740991 — a larger whole number is not exact in JSON, and the API refuses it`] as const;

// ─────────────────────────────────────────────────────────────
//  1. CBM Calculator
// ─────────────────────────────────────────────────────────────

const cbmCalculator: ToolDef = {
  name: 'cbm_calculator',
  description: `Cubic metres (CBM) of a shipment from per-piece dimensions in cm and a piece count, with cubic feet, litres and cubic inches. Volume only: for air billing weight from the same dimensions use chargeable_weight_calculator, for multi-line totals consignment_calculator, for one unit conversion unit_converter, for a full composite analysis shipment_summary. Deterministic; ${UNROUNDED}.`,

  schema: z.object({
    length_cm: z.number().positive().describe('Length of one piece, cm.'),
    width_cm: z.number().positive().describe('Width of one piece, cm.'),
    height_cm: z.number().positive().describe('Height of one piece, cm.'),
    pieces: z.number().int().positive().max(...wholeMax('pieces')).optional().describe('Number of identical pieces. Default 1.'),
  }).strict(),

  resultSchema: resultShape({
    cbm_per_piece: z.number(),
    total_cbm: z.number(),
    total_volume_m3: z.number(),
    cubic_feet: z.number(),
    litres: z.number(),
    cubic_inches: z.number(),
    pieces: z.number(),
    meta: z.record(z.string(), z.unknown()),
  }),

  annotations: readOnlyAnnotations('CBM Calculator'),

  handler: async (args, opts) =>
    apiGet('cbm', { l: args.length_cm, w: args.width_cm, h: args.height_cm, pcs: args.pieces }, opts),
};

// ─────────────────────────────────────────────────────────────
//  2. Chargeable Weight Calculator
// ─────────────────────────────────────────────────────────────

const chargeableWeightCalculator: ToolDef = {
  name: 'chargeable_weight_calculator',
  description: `Air freight chargeable weight — the greater of actual gross weight and volumetric weight, which is what airlines bill. The dimensions are per piece and gross_weight_kg is the TOTAL for all pieces; factor is the volumetric divisor (default 6000, the IATA standard; express integrators typically use 5000). Air only: sea W/M is consignment_calculator with mode=sea; volume alone is cbm_calculator; multi-line loads in any mode consignment_calculator; the equipment the freight flies in uld_lookup. Deterministic; ${UNROUNDED}.`,

  schema: z.object({
    length_cm: z.number().positive().describe('Length of one piece, cm.'),
    width_cm: z.number().positive().describe('Width of one piece, cm.'),
    height_cm: z.number().positive().describe('Height of one piece, cm.'),
    gross_weight_kg: z.number().positive().describe('Gross weight of the WHOLE shipment (all pieces), kg.'),
    pieces: z.number().int().positive().max(...wholeMax('pieces')).optional().describe('Number of identical pieces. Default 1.'),
    factor: z.number().int().positive().max(...wholeMax('factor')).optional().describe('Volumetric divisor, cm³/kg. Default 6000.'),
  }).strict(),

  resultSchema: resultShape({
    chargeable_weight_kg: z.number(),
    basis: z.string(),
    gross_weight_kg: z.number(),
    volumetric_weight_kg: z.number(),
    volumetric_weight_per_piece_kg: z.number(),
    cbm: z.number(),
    ratio: z.number(),
    factor: z.number(),
    pieces: z.number(),
    meta: z.record(z.string(), z.unknown()),
  }),

  annotations: readOnlyAnnotations('Chargeable Weight Calculator'),

  handler: async (args, opts) =>
    apiGet('chargeable-weight', {
      l: args.length_cm, w: args.width_cm, h: args.height_cm,
      gw: args.gross_weight_kg, pcs: args.pieces, factor: args.factor,
    }, opts),
};

// ─────────────────────────────────────────────────────────────
//  3. LDM Calculator
// ─────────────────────────────────────────────────────────────

const ldmCalculator: ToolDef = {
  name: 'ldm_calculator',
  description: `Loading metres (LDM) for European road freight — how much trailer length a pallet load occupies (1 LDM = 1 linear metre of a 2.4 m-wide trailer; a standard artic is 13.6 LDM) — and whether it fits. Provide a pallet preset OR custom length_mm + width_mm; omitting both errors. fits is true only when the load fits the vehicle's length, its pallet floor positions and, when weight_kg is given, its max payload; without weight_kg the payload is not checked. For the trailer specs behind the presets use vehicle_lookup; for boxes onto one pallet pallet_fitting_calculator; for mixed lines consignment_calculator.`,

  schema: z.object({
    pallet: z.enum(['euro', 'uk', 'half', 'quarter']).optional()
      .describe('Pallet preset (euro 1200x800, uk 1200x1000, half 800x600, quarter 600x400 mm). Provide this OR length_mm + width_mm.'),
    length_mm: z.number().positive().optional().describe('Custom pallet length, mm (with width_mm, instead of a preset).'),
    width_mm: z.number().positive().optional().describe('Custom pallet width in millimetres. Example: 980.'),
    quantity: z.number().int().positive().max(...wholeMax('quantity')).optional().describe('Number of pallets. Default: 1.'),
    stackable: z.boolean().optional().describe('Pallets can be stacked (2 or 3 high). Default false.'),
    stack_height: z.number().int().min(2).max(3).optional().describe('Stack height when stackable: 2 or 3. Default: 2.'),
    weight_kg: z.number().positive().optional().describe('Weight per pallet in kg — enables the payload side of the fits check.'),
    vehicle: z.enum(['artic', 'rigid10', 'rigid75', 'luton', 'us53', 'us48', 'custom']).optional()
      .describe('Vehicle preset (default artic = 13.6m curtainsider; rigid75 = 7.5t rigid; luton = 3.5t Luton van; us53 / us48 = US trailers; custom needs vehicle_length_m). rigid10 is DEPRECATED (removal in 3.0.0).'),
    vehicle_length_m: z.number().positive().optional()
      .describe('Custom vehicle load length in metres (required when vehicle=custom).'),
  }).strict(),

  resultSchema: resultShape({
    ldm: z.number(),
    vehicle: loose({ name: z.string(), length_m: z.number(), max_payload_kg: z.number() }),
    utilisation_percent: z.number(),
    pallet_spaces: loose({ used: z.number(), available: z.number(), floor_positions_basis: z.string() }),
    total_weight_kg: z.number(),
    payload_checked: z.boolean(),
    fits: z.boolean(),
    warnings: z.array(z.unknown()),
    meta: z.record(z.string(), z.unknown()),
  }),

  annotations: readOnlyAnnotations('LDM Calculator'),

  handler: async (args, opts) =>
    apiGet('ldm', {
      pallet: args.pallet, length: args.length_mm, width: args.width_mm,
      qty: args.quantity, stackable: args.stackable, stack: args.stack_height,
      weight: args.weight_kg, vehicle: args.vehicle, vehicle_length: args.vehicle_length_m,
    }, opts),
};

// ─────────────────────────────────────────────────────────────
//  4. ADR Lookup
// ─────────────────────────────────────────────────────────────

const adrLookup: ToolDef = {
  name: 'adr_lookup',
  description: `The European road dangerous-goods (ADR 2025) Table A entry for a substance — all 20 columns, from class, packing group and labels to special provisions, limited/excepted quantities, packing and tank codes, transport category, tunnel restriction code and hazard identification number — and what each code means (resolved_codes). 2,939 entries across all 9 classes, from UNECE ADR 2025. Provide exactly ONE of: un_number (every packing-group variant of it; "1203", "UN1203" and "un 1203" are equivalent; explosives keep their leading zero), search (partial proper shipping name), hazard_class, or un_numbers (batch). A search with no hits errors with the closest names. For an LQ/EQ quantity check use adr_lq_eq_check; for 1.1.3.6 small-load points adr_exemption_calculator; for an identifier of unknown kind resolve_reference. ${EDITION_CLAUSE} A factual compilation of the ADR table, not legal or compliance advice; classification remains the consignor's responsibility.`,

  schema: z.object({
    // "UN 1203" — the form a transport document prints (ADR 5.4.1.1.1 (a)) — is accepted, as this
    // tool's description promises and the API always did; the pattern refused the space until 2.21.2.
    // The same pattern as the hosted adr_lookup (the website's app/api/mcp route) — the two must match.
    un_number: z.string().regex(/^(?:UN\s*)?\d{4}$/i, 'UN number must be 4 digits, optionally prefixed with "UN" (e.g., "1203", "UN1203" or "UN 1203")').optional().describe('Exact UN number, 4 digits, optionally "UN"-prefixed ("0004" keeps its zero).'),
    search: z.string().min(2, 'Search term must be at least 2 characters').optional().describe('Case-insensitive partial match on the proper shipping name (min 2 characters). Example: "acetone".'),
    // Table A column (3a) gives every explosive the class "1"; the division is part of the
    // classification code (column (3b), e.g. "1.4S"), so the old example "1.4" answered not found.
    un_numbers: z.array(z.string().max(14)).min(1).max(50).optional().describe('Batch: up to 50 UN numbers. Send alone.'),
    hazard_class: z.string().optional().describe('All entries in an ADR class (Table A column (3a)), e.g. "3", "6.1", "1" (explosives; "1.4S" is a classification_code).'),
    offset: z.number().int().nonnegative().max(...wholeMax('offset')).optional().describe('search / hazard_class only: rows to skip (default 0). The response gives total and next_offset.'),
    limit: z.number().int().min(1).max(100).optional().describe('search / hazard_class only: rows per page (default and max 50 for a search, 100 for a class).'),
    include_codes: z.enum(['none', 'compact', 'full']).optional().describe('What each Table A code means (resolved_codes): compact, full or none. Default compact for un_number, none otherwise.'),
    include_statements: z.boolean().optional().describe('true adds plain-word statements[] to every row. Default false.'),
    ...EDITION_SHAPE,
  }).strict(),

  resultSchema: resultShape({
    count: z.number(),
    total: z.number(),
    truncated: z.boolean(),
    offset: z.number(),
    limit: z.number(),
    next_offset: z.number(),
    results: z.array(loose({
      ...FU_ID_FIELDS,
      un_number: z.string(),
      proper_shipping_name: z.string(),
      class: z.string(),
      classification_code: z.string(),
      packing_group: z.string(),
      // Scope flags (28 Table A rows, present only when true): the row is
      // outside ADR scope / banned from carriage — never a packing group.
      not_subject_to_adr: z.boolean(),
      carriage_prohibited: z.boolean(),
      conditions_ref: z.string(),
      table_a_remark: z.string(),
      labels: z.string(),
      special_provisions: z.string(),
      limited_quantity: z.string(),
      excepted_quantity: z.string(),
      // Table A columns (8)–(14) and (16)–(19), served since the website's 2026-10-28 rebuild:
      // codes as Table A prints them, null when the column is empty.
      packing_instructions: z.string(),
      special_packing_provisions: z.string(),
      mixed_packing_provisions: z.string(),
      portable_tank_instructions: z.string(),
      portable_tank_special_provisions: z.string(),
      tank_code: z.string(),
      tank_special_provisions: z.string(),
      vehicle_for_tank_carriage: z.string(),
      carriage_packages: z.string(),
      carriage_bulk: z.string(),
      carriage_loading_unloading_handling: z.string(),
      carriage_operation: z.string(),
      transport_category: z.string(),
      tunnel_restriction_code: z.string(),
      hazard_identification_number: z.string(),
      variant_index: z.number(),
      variant_count: z.number(),
      statements: z.array(loose({
        topic: z.string(),
        text: z.string(),
        basis: z.array(z.string()),
        codes: z.array(z.string()),
        verification_status: ADR_CODE_STATUS,
      })),
    })),
    // The ADR code registry (freightutils.com G1; once per answer since R6): what each code means,
    // served once however many rows carry it — rows[] are the results[] indexes, columns[] the
    // Table A columns. "full" adds url, title, meaning, parameters, applies_to, references.
    resolved_codes: z.array(loose({
      ...FU_ID_FIELDS,
      code: z.string(),
      family: z.string(),
      columns: z.array(z.string()),
      rows: z.array(z.number()),
      summary: z.string(),
      section: z.string(),
      verification_status: ADR_CODE_STATUS,
      url: z.string(),
      title: z.string(),
      meaning: z.string(),
      applies_to: z.string(),
      references: z.array(z.string()),
    })),
    meta: z.record(z.string(), z.unknown()),
  }),

  annotations: readOnlyAnnotations('ADR Dangerous Goods Lookup'),

  handler: async (args, opts) =>
    apiGet('adr', { un: args.un_number, q: args.search, class: args.hazard_class, offset: args.offset, limit: args.limit, un_numbers: listArg(args.un_numbers), include_codes: args.include_codes, include: args.include_statements ? 'statements' : undefined, edition: args.edition, as_of: args.as_of }, opts),
};

// ─────────────────────────────────────────────────────────────
//  5. ADR Exemption Calculator
// ─────────────────────────────────────────────────────────────

const adrExemptionCalculator: ToolDef = {
  name: 'adr_exemption_calculator',
  description: `ADR 1.1.3.6 "small load" exemption points for a dangerous-goods road load, and whether it qualifies; points = quantity x the transport category multiplier. The rule (1.1.3.6.2), for dangerous goods carried in packages: goods of ONE transport category qualify when their TOTAL on the transport unit stays within that category's 1.1.3.6.3 column (3) maximum (category 1: 20, 2: 333, 3: 1,000 kg or L; 4 unlimited; 0: 0); goods of DIFFERENT categories qualify when the 1.1.3.6.4 points sum does not exceed 1,000. Transport category 0 can never use the exemption. For limited/excepted quantity relief use adr_lq_eq_check; for a substance's row and variant_index adr_lookup; for the whole ADR picture of a load (tunnels, documents, plates) adr_consignment_check.

Send un_number + quantity for one substance OR items[] for a load — never both: a single-substance field sent beside items[] is refused, never dropped. Quantities are kg or litres per the substance's ADR unit; a quantity of 0 means not carried, and a load of nothing but zeros is refused. A UN number whose Table A rows disagree needs packing_group or variant_index, else that line has no verdict (AMBIGUOUS_UN_VARIANT with candidates[]) — never a guessed row. An ID-prefixed air-only number (e.g. "ID8000") is counted out of 1.1.3.6 only with icao_limited_quantity: true on that line, otherwise BLOCKED. A gross mass (basis "gross") is only an upper bound: send the net quantity. ${EDITION_CLAUSE} A calculation over reference data, not legal advice: 1.1.3.6 relieves goods carried in packages only (not in bulk or in tanks), and exempt loads keep core duties; verify against the current UNECE ADR text.`,

  strictKeys: true,
  schema: strictInput({
    un_number: z.string().regex(EXEMPTION_IDENTIFIER_PATTERN, EXEMPTION_IDENTIFIER_MESSAGE).optional().describe('UN number (4 digits, optionally "UN"-prefixed) or an ID-prefixed air-only number ("ID8000"). Single-substance form only.'),
    quantity: z.number().positive().max(1_000_000_000, 'quantity must be at most 1,000,000,000 — the API refuses more').optional().describe('Quantity in kg or litres per the substance\'s ADR unit. Single-substance form only.'),
    packing_group: z.enum(['I', 'II', 'III']).optional().describe('Packing group, to pin one row of a multi-row UN. Single-substance form only.'),
    variant_index: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER, 'variant_index must be a safe integer').optional().describe('ADR Table A variant index (from adr_lookup), to pin one row. Single-substance form only.'),
    unit: z.enum(['L', 'kg']).optional().describe('The dimension quantity is stated in, checked against the one ADR 1.1.3.6.3 counts for the row (a mismatch gives no points). Omitted: taken as already on that basis. Single-substance form only.'),
    basis: z.enum(['net', 'gross']).optional().describe('net or gross; a gross mass is only an upper bound of the net (send the net quantity). Single-substance form only.'),
    // T2b-2 (website #328, cc-036): the hosted tool's description verbatim. GET cannot carry it, so a
    // single-substance call that sends it goes as a one-item POST (the hosted tool's own mapping).
    icao_limited_quantity: z.boolean().optional().describe('ID-prefixed un_number only: true states the packages are ICAO Technical Instructions limited quantities (the 3.4.8 mark, or 3.4.10).'),
    items: z.array(strictInput({
      un_number: z.string().regex(EXEMPTION_IDENTIFIER_PATTERN, EXEMPTION_IDENTIFIER_MESSAGE).describe('UN number (4 digits, optionally "UN"-prefixed) or an ID-prefixed air-only number ("ID8000").'),
      // T2b-2 (cc-042): 0 is accepted — not carried, the line is left out (EXCLUDED_NIL); all zeros is refused by the API.
      quantity: z.number().nonnegative().max(1_000_000_000, 'quantity must be at most 1,000,000,000 — the API refuses more').describe('Quantity in kg or litres per the substance\'s ADR unit; 0 = not carried.'),
      packing_group: z.enum(['I', 'II', 'III']).optional().describe('Packing group for a multi-variant UN.'),
      variant_index: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER, 'variant_index must be a safe integer').optional().describe('ADR Table A variant index for a multi-variant UN.'),
      unit: z.enum(['L', 'kg']).optional().describe('The dimension quantity is stated in, checked against the one ADR 1.1.3.6.3 counts for the row (a mismatch gives no points). Omitted: taken as already on that basis.'),
      basis: z.enum(['net', 'gross']).optional().describe('net or gross; a gross mass is only an upper bound of the net.'),
      icao_limited_quantity: z.boolean().optional().describe('OPTIONAL, ID-prefixed lines only: as the top-level icao_limited_quantity.'),
    }, { hints: EXEMPTION_KEY_HINTS, acceptedLabel: 'Accepted on each item' })).min(1, 'items must hold at least one item').optional().describe('Mixed-load items, INSTEAD of un_number/quantity.'),
    consignment: z.record(z.string(), z.unknown()).optional().describe('The consignment object, instead of the other arguments. Send it alone.'),
    ...EDITION_SHAPE,
  }, {
    hints: EXEMPTION_KEY_HINTS,
    acceptedLabel: 'Accepted arguments',
    note: 'Send un_number + quantity for one substance, or items[] for a load; with items[], every field goes on the item it belongs to.',
  }),

  resultSchema: resultShape({
    items: z.array(loose({
      un_number: z.string(),
      // The line's route (2.20.0) — the FreightUtils document check's own words. EXCLUDED_NIL (2.28.0,
      // website #328): a stated quantity of 0, read as not carried.
      state: z.enum(['COUNTED', 'AIR_ONLY_ID', 'NOT_SUBJECT_TO_ADR', 'BLOCKED', 'EXCLUDED_NIL']),
      proper_shipping_name: z.string(),
      class: z.string(),
      packing_group: z.string(),
      variant_index: z.number(),
      transport_category: z.string(),
      quantity: z.number(),
      multiplier: z.number(),
      points: z.number(),
      not_subject_to_adr: z.boolean(),
      carriage_prohibited: z.boolean(),
      conditions_ref: z.string(),
      // An ID-prefixed air-only line (2.20.0): no Table A entry, never in the points.
      air_only_id: z.boolean(),
      // 2.28.0 (website #328): an ID line sent without the ICAO limited-quantity statement (BLOCKED),
      // the statement's echo, a 0 line, and a gross mass counted as an upper bound.
      entry_required: z.boolean(),
      icao_limited_quantity: z.boolean(),
      nil_quantity: z.boolean(),
      upper_bound_gross: z.boolean(),
      // 2.29.0 (website T2b-3 #332): the edition the line was counted on — "2025" on every line of an
      // ADR 2027 answer that rests on 1.6.1.1 because an entry is deleted in ADR 2027.
      edition_basis: z.enum(['2025', '2027']),
    })),
    total_points: z.number(),
    threshold: z.number(),
    exempt: z.boolean(),
    has_category_zero: z.boolean(),
    has_quantity_exceedance: z.boolean(),
    warnings: z.array(z.unknown()),
    message: z.string(),
    // What the verdict rests on (0B, Round 10): the COUNTED lines' points, whether they alone exceed
    // 1,000, the basis and the BLOCKED lines. total_points / exempt keep their meaning.
    resolved_subtotal_points: z.number(),
    threshold_exceeded_by_resolved_items: z.boolean(),
    verdict_basis: z.enum(['all_items', 'resolved_items_alone', 'none']),
    unresolved_item_indexes: z.array(z.number()),
    // 2.28.0 (website #328): the gross upper bound, and what an ADR 2027 verdict rests on.
    figure_basis: z.enum(['upper_bound_gross']),
    basis: z.enum(['adr_2027', '1.6.1.61', '1.6.1.1']),
    basis_until: z.string(),
    strict_adr_2027: loose({
      basis: z.literal('adr_2027'),
      total_points: z.number(),
      exempt: z.boolean(),
      has_category_zero: z.boolean(),
      has_quantity_exceedance: z.boolean(),
      // 2.29.0 (website T2b-3 #332): the line's ADR 2027 entry is deleted — no ADR 2027 total and no
      // ADR 2027 verdict (the four figures above are null), the load answered on 1.6.1.1 inside its window.
      entry_deleted: z.boolean(),
      deleted_un_numbers: z.array(z.string()),
      message: z.string(),
    }),
    transitional_1_6_1_61: loose({
      measure: z.literal('1.6.1.61'),
      basis: z.string(),
      un_numbers: z.array(z.string()),
      max_kg: z.number(),
      multiplier: z.number(),
      points_on_this_basis: z.number(),
      exempt_on_this_basis: z.boolean(),
      until: z.string(),
      note: z.string(),
    }),
    transitional_1_6_1_1: loose({
      measure: z.literal('1.6.1.1'),
      basis: z.string(),
      points_on_this_basis: z.number(),
      exempt_on_this_basis: z.boolean(),
      until: z.string(),
      note: z.string(),
    }),
    // Scope-verdict path (Table A "NOT SUBJECT TO ADR" / "CARRIAGE PROHIBITED"):
    // the 1.1.3.6 math is short-circuited; conditions[] quotes ADR 2025
    // carriage conditions verbatim (e.g. section 5.5.3 for UN 1845 dry ice).
    not_subject_to_adr: z.boolean(),
    conditions_ref: z.string(),
    conditions: z.array(loose({
      ref: z.string(),
      heading: z.string(),
      requirement: z.string(),
      note: z.string(),
    })),
    carriage_prohibited: z.boolean(),
    // Ambiguous-UN path: no verdict, candidates to disambiguate.
    human_review_required: z.boolean(),
    candidates: z.array(loose({
      item_index: z.number(),
      un_number: z.string(),
      variant_index: z.number(),
      packing_group: z.string(),
      proper_shipping_name: z.string(),
      transport_category: z.string(),
      multiplier: z.number(),
    })),
  }),

  annotations: readOnlyAnnotations('ADR 1.1.3.6 Exemption Calculator'),

  handler: async (args, opts) => {
    // The consignment object (0B): the API maps it onto items[] and answers as that request would.
    if (args.consignment !== undefined) return apiPost('adr-calculator', { consignment: args.consignment }, opts);
    if (args.items) {
      // Every single-substance field beside items[] is FORWARDED, not dropped (2.20.0): the
      // API refuses them by name, so the caller learns the field reached no line. Dropping
      // them here is what turned "UN 1263 + PG III" into all six UN 1263 rows, a top-level
      // unit "kg" into a petrol load scored as litres, and a top-level category 0 substance
      // into a load that read exempt. JSON.stringify leaves out the ones that were not sent.
      return apiPost('adr-calculator', {
        items: args.items,
        un_number: args.un_number, quantity: args.quantity,
        packing_group: args.packing_group, variant_index: args.variant_index,
        unit: args.unit, basis: args.basis,
        // Beside items[] the API refuses it by name (2.28.0) — forwarded, never dropped.
        icao_limited_quantity: args.icao_limited_quantity,
        edition: args.edition, as_of: args.as_of,
      }, opts);
    }
    if (args.icao_limited_quantity !== undefined) {
      // GET cannot carry the ICAO limited-quantity statement (website #328): the single substance goes
      // as a one-item POST — the hosted tool's own mapping, so the answer is the same.
      return apiPost('adr-calculator', {
        items: [{
          un_number: args.un_number, quantity: args.quantity,
          packing_group: args.packing_group, variant_index: args.variant_index,
          unit: args.unit, basis: args.basis,
          icao_limited_quantity: args.icao_limited_quantity,
        }],
        edition: args.edition, as_of: args.as_of,
      }, opts);
    }
    return apiGet('adr-calculator', {
      un: args.un_number, qty: args.quantity,
      packing_group: args.packing_group, variant_index: args.variant_index,
      // The 1.1.3.6.3 declaration. Dropping these silently made the schema a lie:
      // the tool accepted unit/basis and the API never saw them.
      unit: args.unit, basis: args.basis,
      edition: args.edition, as_of: args.as_of,
    }, opts);
  },
};

// ─────────────────────────────────────────────────────────────
//  6. Airline Lookup
// ─────────────────────────────────────────────────────────────

const airlineLookup: ToolDef = {
  name: 'airline_lookup',
  description: `Find airlines (6,356) by name, IATA code, ICAO code, AWB prefix (the first 3 digits of an air waybill number, e.g. 176 = Emirates) or country. Provide ONE parameter: query is a ranked fuzzy search; iata / icao / prefix / country are exact filters. Searches carriers, not airports — for airports use airport_lookup; to check an AWB number's check digit use validate. Provenance pending independent verification — confirm operationally critical codes with IATA/ICAO or the carrier.`,

  schema: z.object({
    query: z.string().min(2, 'Query must be at least 2 characters').refine((s) => s.trim().length >= 2, 'Query must be at least 2 characters, not counting spaces').optional().describe('Ranked fuzzy search across names and codes.'),
    iata: z.string().regex(/^[A-Za-z0-9]{2}$/, 'IATA code must be 2 letters or digits (e.g., "EK", "U2")').optional().describe('Exact 2-character IATA code.'),
    icao: z.string().regex(/^[A-Za-z]{3}$/, 'ICAO code must be 3 letters (e.g., "UAE", "BAW")').optional().describe('Exact 3-letter ICAO code.'),
    prefix: z.string().regex(/^\d{3}$/, 'AWB prefix must be exactly 3 digits').optional().describe('Exact AWB prefix, 3 digits.'),
    country: z.string().min(2, 'Country must be at least 2 characters').optional().describe('Country name filter.'),
    codes: z.array(z.string().max(14)).min(1).max(50).optional().describe('Batch: up to 50 airline codes (IATA, ICAO or AWB prefix). Send alone.'),
    ...LIST_FIELDS,
  }).strict(),

  resultSchema: resultShape({
    count: z.number(),
    results: z.array(loose({
      ...FU_ID_FIELDS,
      slug: z.string(),
      airline_name: z.string(),
      iata_code: z.string(),
      icao_code: z.string(),
      awb_prefix: z.array(z.string()),
      callsign: z.string(),
      country: z.string(),
      has_cargo: z.boolean(),
      aliases: z.array(z.string()),
      verified: z.boolean(),
      audited_at: z.string(),
      // Record v2 (freightutils.com Run A2, 2026-10-30) — additive.
      prefix_shared: z.boolean(),
      prefix_holders: z.array(z.string()),
      operational_status: z.enum(['active', 'ceased', 'unknown']),
      operational_status_basis: z.enum(['carrier_published', 'faa_designator_current', 'domain_fetch_check', 'wikidata_dissolved']),
      operational_status_since: z.string(),
      restrictions: z.array(loose({
        list: z.enum(['eu_air_safety_list', 'uk_air_safety_list']),
        annex: z.string(),
        scope: z.enum(['banned', 'restricted']),
        since: z.string(),
        regulation: z.string(),
        regulation_date: z.string(),
        list_updated: z.string(),
        source_url: z.string(),
        accessed_at: z.string(),
        sha256: z.string(),
        match_basis: z.enum(['icao_designator', 'name_and_state']),
        listed_name: z.string(),
        restricted: z.string(),
      })),
      cargo_website: z.string(),
      tracking_url_template: z.string(),
      dg_acceptance_url: z.string(),
      code_history: z.array(loose({ field: z.string(), value: z.string(), from: z.string(), until: z.string(), source: z.record(z.string(), z.unknown()) })),
      chargeable_weight_ref: z.string(),
    })),
    meta: z.record(z.string(), z.unknown()),
  }),

  annotations: readOnlyAnnotations('Airline / AWB Prefix Lookup'),

  handler: async (args, opts) =>
    apiGet('airlines', {
      codes: listArg(args.codes),
      q: args.query, iata: args.iata, icao: args.icao,
      prefix: args.prefix, country: args.country,
      ...listQuery(args, !args.iata && !args.icao && !args.prefix, 25),
    }, opts),
};

// ─────────────────────────────────────────────────────────────
//  7. Container Lookup
// ─────────────────────────────────────────────────────────────

const containerLookup: ToolDef = {
  name: 'container_lookup',
  description: `ISO shipping-container specifications for 10 types (20ft/40ft standard, 40ft and 45ft high-cube, reefer, open-top and flat-rack), with optional load-fit maths. type (a slug such as "40ft-high-cube", the ISO size-type code "45G1" or the short form "40HC") gives one record; omit it to list all 10; add item dimensions to compute how many items fit. For a container NUMBER's check digit use validate; for the air-freight equivalent uld_lookup; for the cargo volume cbm_calculator / consignment_calculator. Manufacturer-typical specs, provenance pending — confirm against the carrier's equipment guide.`,

  schema: z.object({
    type: z.string().min(2, 'Container type must be at least 2 characters').optional()
      .describe('Container slug ("40ft-high-cube"), ISO code or short form. Omit to list all.'),
    item_length_cm: z.number().positive().optional().describe('Item length in cm — provide all three item dims to get a load-fit calculation.'),
    item_width_cm: z.number().positive().optional().describe('Item width in cm.'),
    item_height_cm: z.number().positive().optional().describe('Item height in cm.'),
    item_weight_kg: z.number().nonnegative().optional().describe('Weight of ONE item, kg; caps the fit by max payload.'),
    item_quantity: z.number().int().positive().max(...wholeMax('item_quantity')).optional().describe('Number of items to check against the container.'),
    ...LIST_FIELDS,
  }).strict(),

  resultSchema: resultShape({
    ...FU_ID_FIELDS,
    slug: z.string(),
    name: z.string(),
    iso_code: z.string(),
    internal_length_cm: z.number(),
    internal_width_cm: z.number(),
    internal_height_cm: z.number(),
    capacity_cbm: z.number(),
    external_length_cm: z.number(),
    external_width_cm: z.number(),
    external_height_cm: z.number(),
    door_width_cm: z.number(),
    door_height_cm: z.number(),
    tare_weight_kg: z.number(),
    max_gross_kg: z.number(),
    max_payload_kg: z.number(),
    euro_pallets: z.string(),
    gma_pallets: z.string(),
    description: z.string(),
    notes: z.string(),
    audited_at: z.string(),
    verified: z.boolean(),
    containers: z.array(z.unknown()),
    count: z.number(),
    loading: z.record(z.string(), z.unknown()),
  }),

  annotations: readOnlyAnnotations('Container Lookup'),

  handler: async (args, opts) =>
    apiGet('containers', {
      type: args.type, l: args.item_length_cm, w: args.item_width_cm,
      h: args.item_height_cm, wt: args.item_weight_kg, qty: args.item_quantity,
      ...listQuery(args, !args.type),
    }, opts),
};

// ─────────────────────────────────────────────────────────────
//  8. HS Code Lookup
// ─────────────────────────────────────────────────────────────

const hsCodeLookup: ToolDef = {
  name: 'hs_code_lookup',
  description: `Search the 6,936 codes of the WCO Harmonized System (HS 2022), the 6-digit international customs classification (2 digits chapter, 4 heading, 6 subheading). Provide ONE of: query (free-text description), code (2-6 digits, dots or spaces ignored; returns the code with its hierarchy) or section (Roman numeral I-XXI). A description search matches whole words, then asks HMRC's everyday goods names at medium confidence; count 0 with an empty results[] is a valid answer (NO_MATCH). For UK duty/VAT on a code use uk_duty_calculator; for ENS goods-description screening ics2_check. The 6-digit level only — national tariff lines and duty rates are set per country; indicative, not a binding ruling.`,

  schema: z.object({
    query: z.string().min(2, 'Search term must be at least 2 characters').optional().describe('Search words, matched against the HS descriptions, then HMRC everyday goods names.'),
    // "8471.30" / "8471 30" — the written form — read as its digits (2.22.0, probe S14).
    code: z.string().refine((c) => /^\d{2,6}$/.test(c.trim().replace(/[\s.-]/g, '')), 'HS code must be 2–6 digits; dots, spaces and hyphens are ignored (e.g. "847130", "8471.30")').optional().describe('HS code or prefix, 2, 4 or 6 digits; dots and spaces ignored ("8471.30").'),
    section: z.string().regex(/^[ivxIVX]{1,5}$/, 'Section must be a Roman numeral I–XXI').optional().describe('A section, Roman numeral I-XXI.'),
    codes: z.array(z.string().max(14)).min(1).max(50).optional().describe('Batch: up to 50 HS codes. Send alone.'),
  }).strict(),

  resultSchema: resultShape({
    ...FU_ID_FIELDS,
    query: z.string(),
    code: z.string(),
    section: z.string(),
    count: z.number(),
    results: z.array(loose({ ...FU_ID_FIELDS })),
    ancestors: z.array(loose({ ...FU_ID_FIELDS })),
    children: z.array(loose({ ...FU_ID_FIELDS })),
    meta: z.record(z.string(), z.unknown()),
  }),

  annotations: readOnlyAnnotations('HS Code Lookup'),

  handler: async (args, opts) =>
    apiGet('hs', { q: args.query, code: args.code, section: args.section, codes: listArg(args.codes) }, opts),
};

// ─────────────────────────────────────────────────────────────
//  9. Incoterms Lookup
// ─────────────────────────────────────────────────────────────

const incotermsLookup: ToolDef = {
  name: 'incoterms_lookup',
  description: `The 11 Incoterms 2020 rules — who pays for transport, insurance and customs clearance, and where risk transfers from seller to buyer. code gives one rule; category (any_mode | sea_only) filters; neither lists all 11. An unknown code errors with the valid list; DAT names its successor, DPU. Related: uk_duty_calculator (takes an incoterm when composing the CIF value), shipment_summary. Summarised guidance; the ICC publication is the binding text.`,

  schema: z.object({
    code: z.string().regex(/^[A-Za-z]{3}$/, 'Incoterm code must be 3 letters (e.g., "FOB", "CIF", "EXW")').optional().describe('Three-letter Incoterms 2020 code.'),
    category: z.enum(['any_mode', 'sea_only']).optional().describe('Filter the list: any_mode (7 rules) or sea_only (4 rules).'),
    ...LIST_FIELDS,
  }).strict(),

  resultSchema: resultShape({
    ...FU_ID_FIELDS,
    code: z.string(),
    name: z.string(),
    slug: z.string(),
    category: z.string(),
    summary: z.string(),
    seller_responsibility: z.string(),
    buyer_responsibility: z.string(),
    risk_transfer: z.string(),
    cost_transfer: z.string(),
    insurance: z.string(),
    export_clearance: z.string(),
    import_clearance: z.string(),
    best_for: z.string(),
    watch_out: z.string(),
    count: z.number(),
    results: z.array(loose({ ...FU_ID_FIELDS })),
  }),

  annotations: readOnlyAnnotations('Incoterms 2020 Lookup'),

  handler: async (args, opts) =>
    apiGet('incoterms', { code: args.code, category: args.category, ...listQuery(args, !args.code) }, opts),
};

// ─────────────────────────────────────────────────────────────
//  10. Pallet Fitting Calculator
// ─────────────────────────────────────────────────────────────

const palletFittingCalculator: ToolDef = {
  name: 'pallet_fitting_calculator',
  description: `How many identical boxes fit on one pallet: boxes per layer (trying 90-degree rotation when allowed), layers within the max height, totals, footprint and volume utilisation (volume_utilisation_percent), capped in whole layers by max_payload_kg. One box size in aligned rows — no interlocked or mixed patterns. For pallets into trailer length use ldm_calculator; pallet capacity per vehicle vehicle_lookup; pallets into containers container_lookup. A theoretical best-effort fit — carton strength, overhang and load stability are not modelled.`,

  schema: z.object({
    pallet_length_cm: z.number().positive().describe('Pallet length, cm.'),
    pallet_width_cm: z.number().positive().describe('Pallet width, cm.'),
    pallet_max_height_cm: z.number().positive().describe('Maximum stack height in cm INCLUDING the pallet deck.'),
    pallet_deck_height_cm: z.number().positive().optional().describe('Pallet deck height in cm. Default: 15.'),
    box_length_cm: z.number().positive().describe('Box length in cm.'),
    box_width_cm: z.number().positive().describe('Box width in cm.'),
    box_height_cm: z.number().positive().describe('Box height in cm.'),
    box_weight_kg: z.number().positive().optional().describe('Weight per box in kg — enables the weight-capping check.'),
    max_payload_kg: z.number().positive().optional().describe('Maximum pallet payload in kg. Example: 1000.'),
    allow_rotation: z.boolean().optional().describe('Try 90-degree box rotation for the best layer fit. Default: true.'),
  }).strict(),

  resultSchema: resultShape({
    boxes_per_layer: z.number(),
    layers: z.number(),
    total_boxes: z.number(),
    orientation: z.string(),
    boxes_per_row: z.number(),
    boxes_per_col: z.number(),
    usable_height_cm: z.number(),
    utilisation_percent: z.number(),
    total_box_volume_cbm: z.number(),
    pallet_volume_cbm: z.number(),
    wasted_space_cbm: z.number(),
    weight_limited: z.boolean(),
    total_weight_kg: z.number(),
    remaining_weight_capacity_kg: z.number(),
    meta: z.record(z.string(), z.unknown()),
  }),

  annotations: readOnlyAnnotations('Pallet Fitting Calculator'),

  handler: async (args, opts) =>
    apiGet('pallet', {
      pl: args.pallet_length_cm, pw: args.pallet_width_cm, pmh: args.pallet_max_height_cm,
      ph: args.pallet_deck_height_cm, bl: args.box_length_cm, bw: args.box_width_cm,
      bh: args.box_height_cm, bwt: args.box_weight_kg, mpw: args.max_payload_kg,
      rotate: args.allow_rotation,
    }, opts),
};

// ─────────────────────────────────────────────────────────────
//  11. Unit Converter
// ─────────────────────────────────────────────────────────────

const unitConverter: ToolDef = {
  name: 'unit_converter',
  description: `Convert freight weight, volume and length units, plus chargeable_kg (air volumetric weight at the IATA 6,000 divisor) and freight_tonnes (sea W/M, 1 CBM = 1 freight tonne), both only FROM cbm. Cross-dimension conversions (e.g. kg to litres) and a negative value are refused. For dimensions to volume use cbm_calculator; for air billing weight with pieces and a custom divisor chargeable_weight_calculator.`,

  schema: z.object({
    value: z.number().nonnegative('value must be 0 or more — a mass, volume or length is never negative').describe('The value to convert, 0 or more.'),
    from: z.enum(['kg','lbs','oz','tonnes','short_tons','long_tons','cbm','cuft','cuin','litres','gal_us','gal_uk','cm','inches','m','feet','mm']).describe('Source unit; the same dimension as "to".'),
    to: z.enum(['kg','lbs','oz','tonnes','short_tons','long_tons','cbm','cuft','cuin','litres','gal_us','gal_uk','cm','inches','m','feet','mm','chargeable_kg','freight_tonnes']).describe('Target unit; chargeable_kg and freight_tonnes only from cbm.'),
  }).strict(),

  resultSchema: resultShape({
    input: loose({ value: z.number(), unit: z.string(), name: z.string() }),
    result: loose({ value: z.number(), unit: z.string(), name: z.string() }),
    formula: z.string(),
    note: z.string(),
  }),

  annotations: readOnlyAnnotations('Unit Converter'),

  handler: async (args, opts) =>
    apiGet('convert', { value: args.value, from: args.from, to: args.to }, opts),
};

// ─────────────────────────────────────────────────────────────
//  12. Consignment Calculator
// ─────────────────────────────────────────────────────────────

const consignmentCalculator: ToolDef = {
  name: 'consignment_calculator',
  description: `Per-line and grand totals for a multi-item mixed consignment: CBM, loading metres, volumetric weight and the mode's chargeable figure (air chargeable weight, sea revenue tonnes, road LDM), plus advisory flags (implausible density, mode/option mismatch, dangerous goods by UN number, container/AWB check digits). Send mode (sea | air | road, default road) and lines[] (each line with its own dimension and weight units), or the legacy flat items[] in cm and kg. For a vehicle/container suggestion and duty estimates use shipment_summary; for one figure cbm_calculator / chargeable_weight_calculator / ldm_calculator; for what a flagged UN number is adr_lookup. ${EDITION_CLAUSE} Flags are advisory and never state that a shipment is permitted or compliant; not regulatory, customs or dangerous-goods compliance advice.`,

  schema: z.object({
    mode: z.enum(['sea', 'air', 'road']).optional().describe('Transport mode: sea | air | road. Default: road.'),
    lines: z.array(z.object({
      description: z.string().max(200, 'description must be at most 200 characters').optional().describe('Optional item label.'),
      quantity: z.number().int().positive().max(100_000, 'quantity must be at most 100,000 per line — the API refuses more').describe('Number of identical pieces on this line.'),
      dims: z.object({
        l: z.number().positive().describe('Length in the given unit.'),
        w: z.number().positive().describe('Width in the given unit.'),
        h: z.number().positive().describe('Height in the given unit.'),
        unit: z.enum(['mm', 'cm', 'm', 'in']).describe('Dimension unit.'),
      }).strict().describe('Per-piece dimensions with unit.'),
      weight: z.object({
        value: z.number().positive().describe('Gross weight per piece.'),
        unit: z.enum(['kg', 'g', 't', 'lb']).describe('Weight unit.'),
      }).strict().describe('Per-piece weight with unit.'),
      hs_code: z.string().regex(/^\d{6,10}$/, 'HS code must be 6–10 digits').optional().describe('Optional HS commodity code (6-10 digits).'),
      un_number: z.string().regex(/^(UN)?\d{4}$/i, 'UN number must be 4 digits, optionally prefixed with "UN"').optional().describe('Optional UN number — triggers the dangerous-goods advisory flag.'),
      stackable: z.boolean().optional().describe('Stack two-high (halves the loading-metre footprint).'),
    }).strict()).min(1).max(50).optional().describe('Canonical consignment lines (preferred, 1-50). Provide lines OR items.'),
    items: z.array(z.object({
      description: z.string().optional().describe('Item description.'),
      length: z.number().positive().describe('Length in cm.'),
      width: z.number().positive().describe('Width in cm.'),
      height: z.number().positive().describe('Height in cm.'),
      quantity: z.number().int().positive().optional().describe('Number of pieces. Default: 1.'),
      gross_weight: z.number().positive().describe('Gross weight per piece in kg.'),
      stackable: z.boolean().optional().describe('Can the item be stacked?'),
      pallet_type: z.enum(['none', 'euro', 'uk', 'us', 'custom']).optional().describe('Pallet type (informational).'),
    }).strict()).min(1).max(50).optional().describe('Legacy flat alias — dimensions in cm, weight in kg. Prefer lines.'),
    options: z.object({
      air_volumetric_divisor: z.number().positive().max(10_000, 'air_volumetric_divisor must be at most 10,000').optional().describe('IATA volumetric divisor in cm³/kg. Default: 6000. Air mode only.'),
      container_number: z.string().max(20, 'container_number must be at most 20 characters').optional().describe('ISO 6346 container number — check-digit validated into flags.'),
      awb_number: z.string().max(20, 'awb_number must be at most 20 characters').optional().describe('IATA 11-digit air waybill number — check-digit validated into flags.'),
    }).strict().optional().describe('Optional settings.'),
    consignment: z.record(z.string(), z.unknown()).optional().describe('The consignment object, instead of the other arguments. Send it alone.'),
    ...EDITION_SHAPE,
  }).strict(),

  resultSchema: resultShape({
    schema_version: z.string(),
    mode: z.string(),
    air_volumetric_divisor: z.number(),
    per_line: z.array(loose({
      description: z.string(),
      quantity: z.number(),
      cbm: z.number(),
      gross_weight_kg: z.number(),
      density_kg_per_m3: z.number(),
      volumetric_weight_kg: z.number(),
      ldm: z.number(),
      revenue_tonnes: z.number(),
      chargeable_weight_kg: z.number(),
    })),
    totals: z.record(z.string(), z.unknown()),
    flags: z.array(z.unknown()),
    disclaimer: z.string(),
  }),

  annotations: readOnlyAnnotations('Consignment Calculator'),

  // Proxies straight to the website /api/consignment, which is the single
  // authoritative validate → compute → flag pipeline and accepts BOTH the
  // canonical { mode, lines, options } and the legacy { items } shapes.
  handler: async (args, opts) => apiPost('consignment', args, opts),
};

// ─────────────────────────────────────────────────────────────
//  13. UN/LOCODE Lookup
// ─────────────────────────────────────────────────────────────

const unlocodeLookup: ToolDef = {
  name: 'unlocode_lookup',
  description: `Search 116,086 UN/LOCODE transport locations — ports, airports, rail and road terminals, inland container depots and border crossings (5 characters: country + location, e.g. NLRTM = Rotterdam; "GB LHR" reads as GBLHR). code gives an exact record; query searches names, narrowed by country and function_type; an unknown code errors. For airport records with ICAO codes use airport_lookup; for airports near a coordinate nearest_airport. An administrative code list — confirm operational status and coordinates with the port or authority.`,

  schema: z.object({
    query: z.string().min(2, 'Query must be at least 2 characters').optional().describe('Location name search.'),
    // "GB LHR", the official spaced notation, is GBLHR (2.22.0, probe S15) — as the hosted tool.
    code: z.string().regex(/^\s*[A-Za-z]{2}[\s-]?[A-Za-z0-9]{3}\s*$/, 'UN/LOCODE must be 5 characters: 2-letter country + 3-char location, optionally spaced (e.g. "GBLHR" or "GB LHR")').optional().describe('Exact UN/LOCODE, 5 characters, optionally spaced ("GB LHR").'),
    country: z.string().regex(/^[A-Za-z]{2}$/, 'Country must be a 2-letter ISO code (e.g. "GB", "NL")').optional().describe('2-letter ISO country filter.'),
    function_type: z.enum(['port', 'airport', 'rail', 'road', 'icd', 'border']).optional().describe('Filter by location function.'),
    limit: z.number().int().min(1).max(100).optional().describe('Maximum results. Default: 20, max: 100.'),
    codes: z.array(z.string().max(14)).min(1).max(50).optional().describe('Batch: up to 50 UN/LOCODEs. Send alone.'),
  }).strict(),

  resultSchema: resultShape({
    ...FU_ID_FIELDS,
    code: z.string(),
    country: z.string(),
    location_code: z.string(),
    name: z.string(),
    name_ascii: z.string(),
    subdivision: z.string(),
    functions: z.array(z.string()),
    status: z.string(),
    coordinates: loose({ lat: z.number(), lon: z.number() }),
    iata_code: z.string(),
    count: z.number(),
    results: z.array(loose({ ...FU_ID_FIELDS })),
    audited_at: z.string(),
    verified: z.boolean(),
  }),

  annotations: readOnlyAnnotations('UN/LOCODE Lookup'),

  handler: async (args, opts) =>
    apiGet('unlocode', {
      codes: listArg(args.codes),
      q: args.query, code: args.code, country: args.country,
      function: args.function_type, limit: args.limit,
    }, opts),
};

// ─────────────────────────────────────────────────────────────
//  14. UK Import Duty & VAT Calculator
// ─────────────────────────────────────────────────────────────

const ukDutyCalculator: ToolDef = {
  name: 'uk_duty_calculator',
  description: `Estimate UK import duty and VAT for a commodity code from the LIVE GOV.UK Trade Tariff: CIF = customs_value + freight_cost + insurance_cost (GBP); duty = CIF x the rate for the origin country; VAT on the duty-inclusive value. commodity_code must be the declarable 10 digits: a 6- or 8-digit code is refused — never padded with zeros — with the declarable codes beneath it. To find the code first use hs_code_lookup; for who pays these costs incoterms_lookup. An estimate, not a customs ruling — confirm with a customs broker or HMRC.`,

  schema: z.object({
    // Spaces allowed, as the API and the hosted tool accept ("8471 30 00 00").
    commodity_code: z.string().regex(/^[\d\s]{6,14}$/, 'Commodity code must be 6–10 digits (spaces allowed)').refine((c) => /^\d{6,10}$/.test(c.replace(/\s/g, '')), 'Commodity code must be 6–10 digits (spaces allowed)').optional().describe('Required unless lines[] is sent. The declarable 10-digit UK commodity code, e.g. "8471300000".'),
    origin_country: z.string().regex(/^[A-Za-z]{2}$/, 'Origin country must be a 2-letter ISO code (e.g., "CN", "DE")').optional().describe('Required unless lines[] is sent. ISO 2-letter country of origin.'),
    customs_value: z.number().positive().optional().describe('Goods value, GBP. Required unless lines[] is sent.'),
    lines: z.array(z.record(z.string(), z.unknown())).min(1).max(10).optional().describe('Batch: up to 10 lines, each { commodity_code, origin_country, customs_value, freight_cost?, insurance_cost?, incoterm? }. Send alone.'),
    // A cost is 0 or more: -1000 took 1,000 off the dutiable value until 2.21.2, here, on the API
    // and on the hosted endpoint alike. The API now refuses a negative cost too.
    freight_cost: z.number().nonnegative('freight_cost must be 0 or more — a cost is never negative').optional().describe('Freight cost in GBP, 0 or more — added to the CIF value. Default: 0.'),
    insurance_cost: z.number().nonnegative('insurance_cost must be 0 or more — a cost is never negative').optional().describe('Insurance cost in GBP, 0 or more — added to the CIF value. Default: 0.'),
    incoterm: z.enum(['EXW','FCA','FAS','FOB','CFR','CIF','CPT','CIP','DAP','DPU','DDP']).optional().describe('Incoterms 2020 basis of the customs_value — documents which costs are already included.'),
  }).strict(),

  resultSchema: resultShape({
    commodity_code: z.string(),
    commodity_description: z.string(),
    origin_country: z.string(),
    origin_country_name: z.string(),
    cif_value: z.number(),
    duty_rate: z.string(),
    duty_rate_percent: z.number(),
    duty_amount: z.number(),
    vat_rate: z.string(),
    vat_rate_percent: z.number(),
    vat_amount: z.number(),
    total_import_taxes: z.number(),
    total_landed_cost: z.number(),
    warnings: z.array(z.unknown()),
    source: z.string(),
    disclaimer: z.string(),
  }),

  annotations: readOnlyAnnotations('UK Duty & VAT Calculator'),

  // /api/duty accepts both casings on the request body — send the canonical
  // snake_case form, which matches the schema.
  handler: async (args, opts) => apiPost('duty', args, opts),
};

// ─────────────────────────────────────────────────────────────
//  15. Shipment Summary (Composite)
// ─────────────────────────────────────────────────────────────

const shipmentSummary: ToolDef = {
  name: 'shipment_summary',
  description: `Composite shipment analysis in one call: volume (CBM), gross and chargeable weight, and by mode road LDM with pallet floor positions and a suggested vehicle, air volumetric weight, or sea revenue tonnes with a suggested container; plus dangerous-goods presence for items with un_number and UK duty estimates for items with hs_code + customs_value. weight and customs_value are PER ITEM; adr_quantity is the TOTAL for the dangerous-goods line, all pieces together. An item with no stackable flag is not stacked. Sections that cannot run surface in warnings instead of failing the call. Its result uses camelCase field names (legacy shape). For canonical snake_case lines[] totals with advisory flags use consignment_calculator; single figures cbm_calculator, chargeable_weight_calculator, ldm_calculator; ldm_calculator, adr_lookup and uk_duty_calculator are the engines it calls. ${EDITION_CLAUSE} A planning summary, not a quotation or compliance determination.`,

  strictKeys: true,
  schema: strictInput({
    mode: z.enum(['road', 'air', 'sea', 'multimodal']).optional().describe('Transport mode — selects the mode-specific section of the result. Required unless consignment is sent.'),
    items: z.array(strictInput({
      description: z.string().optional().describe('Optional item label.'),
      length: z.number().positive().describe('Length in cm.'),
      width: z.number().positive().describe('Width in cm.'),
      height: z.number().positive().describe('Height in cm.'),
      weight: z.number().nonnegative('weight must be 0 or more').describe('Gross weight in kg PER ITEM.'),
      quantity: z.number().int().positive().max(1_000_000, 'quantity must be at most 1,000,000 — the API refuses more').describe('Number of items.'),
      stackable: z.boolean().optional().describe('Whether this item can be stacked (affects pallet fitting).'),
      pallet_type: z.enum(['euro', 'uk', 'us', 'custom', 'none']).optional().describe('Pallet standard the item sits on, if any.'),
      hs_code: z.string().optional().describe('HS code — enables the duty section together with customs_value.'),
      un_number: z.string().optional().describe('UN number — enables the dangerous-goods section.'),
      adr_quantity: z.number().positive().max(1_000_000_000, 'quantity must be at most 1,000,000,000 — the API refuses more').optional().describe('ADR 1.1.3.6.3 quantity of the dangerous goods, the TOTAL for the whole line (never per piece), in adr_quantity_unit; separate from weight.'),
      adr_quantity_unit: z.enum(['L', 'kg']).optional().describe('Dimension of adr_quantity, checked against the one ADR 1.1.3.6.3 counts for the row.'),
      customs_value: z.number().nonnegative('customs_value must be 0 or more (GBP per item), or omitted').optional().describe('Customs value in GBP PER ITEM; enables the duty section with hs_code.'),
    }, { hints: { un: 'un_number' }, acceptedLabel: 'Accepted on each item' })).min(1, 'items must hold at least one item').max(50, 'at most 50 items — the API refuses more').optional().describe('Required unless consignment is sent. Shipment items with dimensions, weight and optional HS/UN codes.'),
    origin: strictInput({ country: z.string(), locode: z.string().optional() }, { acceptedLabel: 'Accepted in origin and destination' }).optional().describe('Origin — ISO country code and optional UN/LOCODE.'),
    destination: strictInput({ country: z.string(), locode: z.string().optional() }, { acceptedLabel: 'Accepted in origin and destination' }).optional().describe('Destination — ISO country code and optional UN/LOCODE.'),
    incoterm: z.string().optional().describe('Incoterms 2020 three-letter code.'),
    freight_cost: z.number().nonnegative('freight_cost must be 0 or more (GBP), or omitted for 0').optional().describe('Freight cost in GBP for the duty calculation, 0 or more. Default: 0.'),
    insurance_cost: z.number().nonnegative('insurance_cost must be 0 or more (GBP), or omitted for 0').optional().describe('Insurance cost in GBP for the duty calculation, 0 or more. Default: 0.'),
    consignment: z.record(z.string(), z.unknown()).optional().describe('The consignment object, instead of the other arguments. Send it alone.'),
    ...EDITION_SHAPE,
  }, { hints: toItemPath(SHIPMENT_ITEM_FIELDS), acceptedLabel: 'Accepted arguments' }),

  resultSchema: resultShape({
    mode: z.string(),
    itemCount: z.number(),
    totals: loose({
      pieces: z.number(),
      grossWeight: z.number(),
      volumeCBM: z.number(),
      chargeableWeight: z.number(),
      billingBasis: z.string(),
    }),
    modeSpecific: z.record(z.string(), z.unknown()),
    adr: z.record(z.string(), z.unknown()),
    duty: z.record(z.string(), z.unknown()),
    warnings: z.array(z.unknown()),
    disclaimer: z.string(),
    dataVersion: z.record(z.string(), z.unknown()),
  }),

  annotations: readOnlyAnnotations('Shipment Summary'),

  // The /api/shipment/summary input parser only recognises camelCase aliases
  // on freightCost / insuranceCost / items[].palletType / items[].hsCode /
  // items[].unNumber / items[].customsValue. Map snake_case → camelCase on
  // the wire until the website's input parser adds snake_case aliases.
  handler: async (args, opts) =>
    // The consignment object (0B): the API maps it onto { mode, items[], … }; mode and items are
    // optional in the schema only because the object may replace them — the API names what is missing.
    args.consignment !== undefined ? apiPost('shipment/summary', { consignment: args.consignment }, opts) :
    apiPost('shipment/summary', {
      mode: args.mode,
      items: ((args.items ?? []) as Array<Record<string, unknown>>).map((i) => ({
        description: i.description,
        length: i.length,
        width: i.width,
        height: i.height,
        weight: i.weight,
        quantity: i.quantity,
        stackable: i.stackable,
        palletType: i.pallet_type,
        hsCode: i.hs_code,
        unNumber: i.un_number,
        // ADR 1.1.3.6.3 quantity for this line — camelCase on the wire like the
        // rest of this mapper. Omitted here, the field was declarable and inert.
        adrQuantity: i.adr_quantity,
        adrQuantityUnit: i.adr_quantity_unit,
        customsValue: i.customs_value,
      })),
      origin: args.origin,
      destination: args.destination,
      incoterm: args.incoterm,
      freightCost: args.freight_cost,
      insuranceCost: args.insurance_cost,
      edition: args.edition,
      as_of: args.as_of,
    }, opts),
};

// ─────────────────────────────────────────────────────────────
//  16. ULD Lookup
// ─────────────────────────────────────────────────────────────

const uldLookup: ToolDef = {
  name: 'uld_lookup',
  description: `Air-cargo ULD (unit load device) specifications — 16 types: lower-deck containers (AKE/LD3 and family), main-deck pallets (PMC, PAG and family) and temperature-controlled units. type as an IATA code ("AKE"), slug ("ake-ld3") or the record's own name ("LD3" → AKE) gives one record; omit it to list all 16; category and deck filter. Pallet records have no internal dimensions — read max_build_up_height_cm, and do not multiply dimensions for a volume. For the sea-freight equivalent use container_lookup; for what the cargo inside is billed at chargeable_weight_calculator; for whose aircraft it flies on airline_lookup. Provenance is pending, not verified (treat tare_weight with particular caution); confirm operationally critical dimensions with the carrier.`,

  schema: z.object({
    type: z.string().min(2, 'ULD type must be at least 2 characters').optional().describe('IATA ULD code ("AKE") or slug. Omit to list all.'),
    category: z.enum(['container', 'pallet', 'special']).optional().describe('Filter by ULD category.'),
    deck: z.enum(['lower', 'main']).optional().describe('Filter by deck position.'),
    ...LIST_FIELDS,
  }).strict(),

  resultSchema: resultShape({
    result: loose({ ...FU_ID_FIELDS }),
    results: z.array(loose({ ...FU_ID_FIELDS })),
    count: z.number(),
    meta: z.record(z.string(), z.unknown()),
  }),

  annotations: readOnlyAnnotations('Air Cargo ULD Lookup'),

  handler: async (args, opts) =>
    apiGet('uld', { type: args.type, category: args.category, deck: args.deck, ...listQuery(args, !args.type) }, opts),
};

// ─────────────────────────────────────────────────────────────
//  17. Vehicle & Trailer Lookup
// ─────────────────────────────────────────────────────────────

const vehicleLookup: ToolDef = {
  name: 'vehicle_lookup',
  description: `Road-freight vehicle and trailer specifications — 17 types: EU articulated trailers, US 53ft/48ft dry vans, rigid trucks (7.5-26 t) and vans; internal dimensions, payload and gross weights, pallet capacity, axles. slug gives one record; omit it to list all 17; category (articulated | rigid | van) and region (EU | US) filter. For whether a pallet load fits use ldm_calculator; also pallet_fitting_calculator and consignment_calculator. Typical specs, provenance pending — legal payload is set by the vehicle's plated weights.`,

  schema: z.object({
    slug: z.string().min(2, 'Vehicle slug must be at least 2 characters').optional().describe('Vehicle slug ("standard-curtainsider"). Omit to list all.'),
    category: z.enum(['articulated', 'rigid', 'van']).optional().describe('Filter by vehicle category.'),
    region: z.enum(['EU', 'US']).optional().describe('Filter by region.'),
    ...LIST_FIELDS,
  }).strict(),

  resultSchema: resultShape({
    result: loose({ ...FU_ID_FIELDS }),
    results: z.array(loose({ ...FU_ID_FIELDS })),
    count: z.number(),
    meta: z.record(z.string(), z.unknown()),
  }),

  annotations: readOnlyAnnotations('Vehicle Lookup'),

  handler: async (args, opts) =>
    apiGet('vehicles', { slug: args.slug, category: args.category, region: args.region, ...listQuery(args, !args.slug) }, opts),
};

// ─────────────────────────────────────────────────────────────
//  18. ADR Limited/Excepted Quantity Check
// ─────────────────────────────────────────────────────────────

const adrLqEqCheck: ToolDef = {
  name: 'adr_lq_eq_check',
  description: `Whether dangerous goods qualify for ADR Limited Quantity (LQ, ADR 3.4) or Excepted Quantity (EQ, ADR 3.5) relief, item by item. Send mode ("lq" or "eq") and 1-20 items, each with un_number, quantity per INNER packaging (not the whole load) and unit (ml or L for liquids, g or kg for solids); inner_packaging_qty adds the EQ per-outer check. A mass against a volume limit (or the reverse) cannot be compared: that item is inconclusive — send the unit given by lq_limit_unit. A UN number whose Table A rows disagree needs packing_group or variant_index, else no verdict for it (AMBIGUOUS_UN_VARIANT with candidates[]). For the 1.1.3.6 load-points route use adr_exemption_calculator; for the per-substance LQ/EQ values and variant_index adr_lookup. ${EDITION_CLAUSE} A quantity-threshold check only — packaging, marking and documentation conformity are not assessed; not legal advice, verify against the current UNECE ADR text.`,

  strictKeys: true,
  schema: strictInput({
    mode: z.enum(['lq', 'eq']).describe('lq (Limited Quantity, ADR 3.4) or eq (Excepted Quantity, ADR 3.5).'),
    items: z.array(strictInput({
      // "UN 1263" accepted (2.22.0, probe S36) — the same pattern as the hosted adr_lq_eq_check.
      un_number: z.string().regex(/^\s*(?:UN\s*)?\d{4}\s*$/i, 'UN number must be 4 digits, optionally prefixed with "UN" (e.g. "1203", "UN1263", "UN 1263")').describe('UN number, 4 digits, optionally "UN"-prefixed ("0004" keeps its zero).'),
      quantity: z.number().positive().max(1_000_000_000, 'quantity must be at most 1,000,000,000 — the API refuses more').describe('Quantity per INNER packaging, in unit.'),
      unit: z.enum(['ml', 'L', 'g', 'kg']).describe('Unit: "ml" or "L" for liquids, "g" or "kg" for solids.'),
      inner_packaging_qty: z.number().int().positive().max(...wholeMax('inner_packaging_qty')).optional().describe('EQ mode only: inner packagings per outer package.'),
      packing_group: z.enum(['I', 'II', 'III']).optional().describe('Packing group, to pin one row of a multi-row UN.'),
      variant_index: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER, 'variant_index must be a safe integer').optional().describe('ADR Table A variant index (from adr_lookup), to pin one row.'),
    }, { hints: { innerpackagings: 'inner_packaging_qty', un: 'un_number', qty: 'quantity' }, acceptedLabel: 'Accepted on each item' })).min(1).max(20).describe('Items to check (1-20 per call).'),
    ...EDITION_SHAPE,
  }, {
    hints: toItemPath(LQ_ITEM_FIELDS, { innerpackagings: 'items[n].inner_packaging_qty' }),
    acceptedLabel: 'Accepted arguments',
    note: 'Each item carries its own un_number, quantity, unit, inner_packaging_qty, packing_group and variant_index.',
  }),

  resultSchema: resultShape({
    mode: z.string(),
    overall_status: z.string(),
    items: z.array(loose({
      ...FU_ID_FIELDS,
      un_number: z.string(),
      variant_index: z.number(),
      substance: z.string(),
      class: z.string(),
      packing_group: z.string(),
      lq_limit: z.string(),
      lq_limit_value: z.number(),
      lq_limit_unit: z.string(),
      eq_code: z.string(),
      quantity_entered: z.number(),
      unit_entered: z.string(),
      status: z.string(),
      reason: z.string(),
      not_subject_to_adr: z.boolean(),
      carriage_prohibited: z.boolean(),
      conditions_ref: z.string(),
      equivalent_variants: z.array(loose({ ...FU_ID_FIELDS })),
    })),
    summary: loose({
      total_items: z.number(),
      qualifying: z.number(),
      exceeding: z.number(),
      not_permitted: z.number(),
      not_subject: z.number(),
    }),
    references: z.record(z.string(), z.unknown()),
    // Ambiguous-UN path: no verdict, candidates to disambiguate.
    human_review_required: z.boolean(),
    candidates: z.array(loose({
      ...FU_ID_FIELDS,
      item_index: z.number(),
      un_number: z.string(),
      variant_index: z.number(),
      packing_group: z.string(),
      proper_shipping_name: z.string(),
      limited_quantity: z.string(),
      excepted_quantity: z.string(),
    })),
  }),

  annotations: readOnlyAnnotations('ADR LQ / EQ Exemption Check'),

  handler: async (args, opts) =>
    apiPost('adr/lq-check', { mode: args.mode, items: args.items, edition: args.edition, as_of: args.as_of }, opts),
};

// ─────────────────────────────────────────────────────────────
//  ADR Consignment Check (2.29.0; freightutils.com build 2a)
// ─────────────────────────────────────────────────────────────

const CC_PLACE = z.string().regex(/^[A-Za-z]{2}(?:\s?[A-Za-z2-9]{3})?$/, 'a place is a 5-character UN/LOCODE (e.g. "NLRTM") or a 2-letter ISO country code (e.g. "NL") — never an address');
const CC_MONEY = strictInput({ amount: z.number().nonnegative().max(1e12), currency: z.string().regex(/^[A-Z]{3}$/) }, { acceptedLabel: 'Accepted in an amount' });
const CC_LINE = strictInput({
  description: z.string().max(200).optional().describe('What the line is, at most 200 characters.'),
  un_number: z.string().regex(/^(?:(?:UN\s?)?\d{4}|ID\s?\d{4})$/i, 'un_number must be 4 digits, optionally "UN"-prefixed (e.g. "1203", "UN1203"), or an ID-prefixed air-only number (e.g. "ID 8000")').optional().describe('UN number ("1203", "UN1203") or ID-prefixed air-only number ("ID 8000"); a line without one is not a dangerous-goods line.'),
  packing_group: z.enum(['I', 'II', 'III']).optional().describe('Packing group, to pin one ADR Table A row of a multi-row UN.'),
  variant_index: z.number().int().nonnegative().max(1000).optional().describe('ADR Table A variant index (as adr_lookup returns it), to pin one row.'),
  quantity: strictInput({
    value: z.number().nonnegative().max(1_000_000_000).describe('The dangerous-goods quantity for the whole line, all packages together; 0 = not carried.'),
    unit: z.enum(['L', 'kg']).optional().describe('L or kg, checked against the dimension ADR 1.1.3.6.3 counts.'),
    basis: z.enum(['net', 'gross']).optional().describe('"net" or "gross"; a gross mass on a mass-counted row is an upper bound.'),
  }, { acceptedLabel: 'Accepted in quantity' }).optional().describe('The dangerous-goods quantity (ADR 1.1.3.6.3).'),
  packages: strictInput({
    count: z.number().int().positive().max(100_000),
    type: z.string().max(40).optional(),
    gross_kg: z.number().positive().max(1_000_000).optional(),
    un_mark: z.string().min(1).max(80).optional().describe('The UN packaging mark as printed (ADR 6.1.3.1), e.g. "UN 4G/Y145/S/02/NL/VL823".'),
  }, { acceptedLabel: 'Accepted in packages' }).optional().describe('The pieces; a line in packages is "other carriage" for the ADR 8.6.4 tunnel table.'),
  hs_code: z.string().regex(/^\d{6,10}$/).optional(),
  value: CC_MONEY.optional(),
  dims: strictInput({ l: z.number().positive().max(100_000), w: z.number().positive().max(100_000), h: z.number().positive().max(100_000), unit: z.enum(['mm', 'cm', 'm', 'in']) }, { acceptedLabel: 'Accepted in dims' }).optional(),
  stackable: z.boolean().optional(),
  icao_limited_quantity: z.boolean().optional().describe('ID-prefixed line only: the packages are ICAO Technical Instructions limited quantities (3.4.8 mark / 3.4.10).'),
  inner_packaging: strictInput({
    quantity: z.number().positive().max(1_000_000).describe('The quantity in ONE inner packaging.'),
    unit: z.enum(['ml', 'L', 'g', 'kg']),
    per_outer: z.number().int().min(1).max(100_000).optional().describe('Inner packagings in one outer packaging (default 1) — the excepted-quantity outer limit.'),
    regime: z.enum(['lq', 'eq']).optional().describe('The exemption the line is meant to use (a stated regime that is missed fails); omitted, both are checked and a line that fits neither is not_applicable.'),
  }, { acceptedLabel: 'Accepted in inner_packaging' }).optional().describe('The inner packaging, for the limited / excepted quantity check.'),
}, { acceptedLabel: 'Accepted on each line' });

const CC_CITATION = loose({ section: z.string(), volume: z.string(), pdf_page: z.union([z.number(), z.array(z.number())]), document: z.string(), quote: z.string(), table_a_columns: z.string() });
const CC_VERDICT = z.enum(['pass', 'fail', 'conditional', 'insufficient_data', 'not_applicable', 'not_assessed', 'not_in_this_version']);
/** build 2b: one pair of mixed_loading_7_5_2 — permitted true | false | "conditional"; the deciding cell "<row> × <column>". */
const CC_MIX_PAIR = loose({ a: z.number(), b: z.number(), labels_a: z.array(z.string()), labels_b: z.array(z.string()), permitted: z.union([z.boolean(), z.literal('conditional')]), cell: z.string(), note: z.string(), source_ref: CC_CITATION, conditions: z.array(z.string()), compatibility_groups: z.array(z.string()) });
const CC_QTY_LINE = loose({ line_index: z.number(), un_number: z.string(), assessed: z.boolean(), verdict: CC_VERDICT, reason: z.string(), answer: z.record(z.string(), z.unknown()), overall_status: z.string() });
/** build 2c: the vehicle side — a requirement's `applies` (true | false | "under_relief_only" | "conditional") and a requirement's outcome against its input. */
const CC_APPLIES = z.union([z.boolean(), z.enum(['under_relief_only', 'conditional'])]);
const CC_OUTCOME = z.enum(['pass', 'fail', 'conditional', 'unanswered', 'not_required']);
const CC_NEEDS = z.array(loose({ line_index: z.number(), question: z.string() }));
const CC_REQUIREMENT = loose({ id: z.string(), applies: CC_APPLIES, basis: z.string(), quantity: z.string(), specification: z.string(), lines: z.array(z.number()), source_ref: CC_CITATION });
const CC_EQUIPMENT_ITEM = loose({ item: z.string(), printed: z.string(), per: z.enum(['vehicle', 'transport_unit', 'crew_member']), applies: CC_APPLIES, basis: z.string(), for_labels: z.array(z.string()), lines: z.array(z.number()), on_board: z.boolean(), outcome: CC_OUTCOME, source_ref: CC_CITATION });
const CC_EXT_BAND = loose({ transport_unit_maximum_permissible_mass: z.string(), minimum_number: z.number(), minimum_total_kg: z.number(), engine_or_cab_minimum_kg: z.number(), additional_minimum_kg: z.number(), cells: z.array(z.string()) });
const EQUIPMENT_8_1_5_ITEMS = ['wheel_chock', 'warning_signs', 'eye_rinsing_liquid', 'warning_vest', 'portable_lighting', 'protective_gloves', 'eye_protection', 'emergency_escape_mask', 'shovel', 'drain_seal', 'collecting_container'] as const;

const adrConsignmentCheck: ToolDef = {
  name: 'adr_consignment_check',
  description: `One call on the consignment object for the ADR picture of a road load: the 1.1.3.6 small-load verdict, the limited / excepted quantity check of each line, the tunnel restriction code of the whole load against the tunnels on the route, each line's transport-document entry, mixed loading (7.5.2, with the foodstuffs precautions of 7.5.4), and the vehicle side — orange-coloured plates and placards (5.3), the documents, fire extinguishers and equipment on the transport unit (8.1), and driver training (8.2); and the UN packaging mark of each line (6.1.3.1). The rules are page-cited to the free UNECE ADR 2025 publication. For the 1.1.3.6 check alone use adr_exemption_calculator; LQ / EQ alone adr_lq_eq_check; a row's columns adr_lookup.

Send lines[] (un_number, quantity {value, unit, basis} and, where they apply, packing_group / variant_index, packages with un_mark, inner_packaging) and optionally journey, vehicle and crew; journey.date is the default as_of, and an as_of that contradicts it is refused. A check whose input is not sent is conditional, the input named in missing_inputs — never assumed. status is pass | fail | conditional | insufficient_data; a relief that does not apply is not_applicable, not fail. ${EDITION_CLAUSE} Not checked: whether the packaging kind is one the packing instruction allows, IBC / large-packaging marks, the vehicle approval of Part 9, the elevated temperature mark (5.3.3), handling and stowage (7.5.7). Not legal advice, verify against the current UNECE ADR text.`,

  strictKeys: true,
  schema: strictInput({
    lines: z.array(CC_LINE).min(1).max(50).describe('The lines of the load (1–50). Required.'),
    journey: strictInput({
      origin: CC_PLACE.optional(),
      destination: CC_PLACE.optional(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD').optional().describe('Date of carriage, YYYY-MM-DD — the default as_of.'),
      tunnels_on_route: z.array(z.enum(['A', 'B', 'C', 'D', 'E'])).max(20).optional().describe('ADR tunnel categories on the route (A–E).'),
      mode: z.enum(['road', 'air', 'sea', 'multimodal']).optional(),
    }, { acceptedLabel: 'Accepted in journey' }).optional(),
    vehicle: strictInput({
      type: z.string().max(60).optional(),
      max_mass_t: z.number().positive().max(100).optional().describe('The transport unit\'s maximum permissible mass, tonnes.'),
      axles: z.number().int().min(1).max(12).optional(),
      foodstuffs_carried: z.boolean().optional().describe('Foodstuffs or animal feeds are carried in the same vehicle or container (ADR 7.5.4).'),
      fire_extinguishers_kg: z.array(z.number().positive().max(100)).max(20).optional().describe('Each portable fire extinguisher on board, kg (ADR 8.1.4).'),
      orange_plates_displayed: z.boolean().optional().describe('The two orange-coloured plates are displayed.'),
      placards_displayed: z.boolean().optional().describe('The placards ADR 5.3.1.5 requires are displayed.'),
      equipment_8_1_5: z.array(z.enum(EQUIPMENT_8_1_5_ITEMS)).max(EQUIPMENT_8_1_5_ITEMS.length).optional().describe('The ADR 8.1.5 items on board; an item not listed is read as not on board.'),
      instructions_in_writing: z.boolean().optional().describe('The ADR 5.4.3 instructions in writing are in the cab.'),
    }, { acceptedLabel: 'Accepted in vehicle' }).optional().describe('The vehicle-side inputs (ADR 5.3, 7.5.4, 8.1).'),
    crew: strictInput({
      adr_training_certificate: z.boolean().optional().describe('The driver holds the ADR 8.2.1 training certificate.'),
      specialisations: z.array(z.enum(['class_1', 'class_7', 'tanks'])).max(3).optional().describe('The specialisations on the certificate.'),
      photo_identification: z.boolean().optional().describe('Each crew member carries identification with a photograph (8.1.2.1 (d)).'),
      awareness_training_1_3: z.boolean().optional().describe('The driver is trained according to Chapter 1.3 (8.2.3).'),
    }, { acceptedLabel: 'Accepted in crew' }).optional().describe('The crew, for the driver-training and document checks. Facts only — no name.'),
    options: z.record(z.string(), z.unknown()).optional().describe('The consignment object\'s options; not read by this check.'),
    ...EDITION_SHAPE,
  }, {
    hints: { items: 'lines', consignment: 'lines, journey (the consignment object at the top level)', un_number: 'lines[n].un_number', quantity: 'lines[n].quantity', date: 'journey.date', tunnels: 'journey.tunnels_on_route' },
    acceptedLabel: 'Accepted arguments',
    note: 'The arguments are the consignment object (https://www.freightutils.com/schema/consignment-object.v1.json) with edition and as_of beside it.',
  }),

  resultSchema: resultShape({
    status: z.enum(['pass', 'fail', 'conditional', 'insufficient_data']),
    regime: z.enum(['1.1.3.6', 'full_adr', 'undetermined']),
    missing_inputs: z.array(loose({ name: z.string(), check: z.string(), what: z.string() })),
    checks_performed: z.array(loose({ name: z.string(), verdict: CC_VERDICT, required: z.boolean(), edition: z.string(), as_of: z.string(), basis: z.string(), citations: z.array(CC_CITATION), run: z.string() })),
    edition: z.string(),
    as_of: z.string(),
    edition_basis: z.string(),
    lines: z.array(loose({ line_index: z.number(), un_number: z.string(), dangerous_goods: z.boolean(), description: z.string() })),
    exemption_1_1_3_6: loose({ verdict: CC_VERDICT, basis: z.string(), conditions: z.array(z.string()), notes: z.array(z.string()), engine: loose({ items: z.array(ADR_ECHO_ROW) }) }),
    limited_quantities: loose({ verdict: CC_VERDICT, lines: z.array(CC_QTY_LINE) }),
    excepted_quantities: loose({ verdict: CC_VERDICT, lines: z.array(CC_QTY_LINE) }),
    lq_eq_status_verdict: CC_VERDICT,
    tunnel_restriction: loose({
      verdict: CC_VERDICT,
      lines: z.array(loose({ line_index: z.number(), un_number: z.string(), column_15: z.string(), counted: z.boolean(), reason: z.string(), carriage: z.string(), forbidden: z.array(z.string()) })),
      whole_load: loose({ codes: z.array(z.string()), forbidden_categories: z.array(z.string()), complete: z.boolean(), ordering: z.string(), net_explosive_mass_kg: z.number() }),
      route: loose({ tunnels_on_route: z.array(z.string()), without_1_1_3_6_relief: z.record(z.string(), z.unknown()), with_1_1_3_6_relief: z.record(z.string(), z.unknown()) }),
      conditions: z.array(z.string()),
      needs_info: z.array(loose({ line_index: z.number(), question: z.string() })),
      notes: z.array(z.string()),
    }),
    transport_document: loose({
      verdict: CC_VERDICT,
      lines: z.array(loose({ line_index: z.number(), un_number: z.string(), entry: z.string().nullable(), edition: z.string(), variant_index: z.number(), elements: loose({ a: z.string(), b: z.array(z.string()), c: z.string(), d: z.string(), k: z.string() }), strings: z.array(z.string()), tunnel_code_required: z.boolean(), equivalent_rows: z.number(), notes: z.array(z.string()), reason: z.string(), candidates: z.array(ADR_ECHO_ROW) })),
      order: z.string(),
      exemption_1_1_3_6_statement: loose({ applies: z.boolean(), rule: z.string(), per_transport_category: z.array(loose({ transport_category: z.string(), total_quantity: z.array(loose({ value: z.number(), unit: z.string() })), calculated_value: z.number() })), wording: z.string() }),
      conditions: z.array(z.string()),
    }),
    mixed_loading_7_5_2: loose({
      verdict: CC_VERDICT,
      basis: z.string(),
      lines: z.array(loose({ line_index: z.number(), un_number: z.string(), labels: z.array(z.string()), classification_code: z.string(), compatibility_group: z.string(), assessed: z.boolean(), reason: z.string(), headings: z.array(z.string()), unmapped_labels: z.array(z.string()) })),
      pairs: z.array(CC_MIX_PAIR),
      class_1: loose({ assessed: z.boolean(), pairs: z.array(CC_MIX_PAIR) }),
      foodstuffs: loose({ engaged: z.boolean(), lines: z.array(loose({ line_index: z.number(), un_number: z.string(), labels: z.array(z.string()), reason: z.string() })), input: z.boolean(), verdict: CC_VERDICT, edition_text: z.string(), answer: z.string() }),
      conditions: z.array(z.string()),
      needs_info: z.array(loose({ line_index: z.number(), question: z.string() })),
      notes: z.array(z.string()),
    }),
    placards_and_plates_5_3: loose({
      verdict: CC_VERDICT,
      basis: z.string(),
      requirements: z.array(CC_REQUIREMENT),
      orange_plates: loose({ required: z.boolean(), numbered: z.union([z.boolean(), z.literal('conditional')]), basis: z.string(), hazard_identification_numbers: z.array(loose({ line_index: z.number(), un_number: z.string(), column_20: z.string() })) }),
      placards: loose({ required: z.boolean(), lines: z.array(loose({ line_index: z.number(), un_number: z.string(), class: z.string(), classification_code: z.string(), labels: z.array(z.string()), placards: z.array(z.string()) })), basis: z.string(), notes: z.array(z.string()) }),
      marks: z.array(loose({ mark: z.string(), applies: CC_APPLIES, basis: z.string(), lines: z.array(z.number()), source_ref: CC_CITATION })),
      lq_mark: loose({ applies: CC_APPLIES, condition: z.string(), basis: z.string() }),
      inputs: z.record(z.string(), z.unknown()),
      outcomes: loose({ orange_plates: CC_OUTCOME, placards: CC_OUTCOME }),
      conditions: z.array(z.string()),
      needs_info: CC_NEEDS,
      notes: z.array(z.string()),
    }),
    equipment_8_1: loose({
      verdict: CC_VERDICT,
      basis: z.string(),
      requirements: z.array(CC_REQUIREMENT),
      fire_extinguishers: loose({ band: CC_EXT_BAND, bands: z.array(CC_EXT_BAND), minimum_total_kg: z.number(), minimum_largest_kg: z.number(), small_load_rule: loose({ applies: CC_APPLIES, minimum_number: z.number(), minimum_capacity_kg: z.number(), basis: z.string() }), on_board: z.array(z.number()), verdict: z.string(), why: z.string(), s3: z.string() }),
      general_equipment: z.array(CC_EQUIPMENT_ITEM),
      label_specific_equipment: z.array(CC_EQUIPMENT_ITEM),
      documents: z.array(loose({ document: z.string(), applies: CC_APPLIES, basis: z.string(), answered_by: z.string(), verdict: CC_VERDICT, input: z.boolean(), outcome: CC_OUTCOME, source_ref: CC_CITATION })),
      inputs: z.record(z.string(), z.unknown()),
      missing_items: z.array(z.string()),
      conditions: z.array(z.string()),
      needs_info: CC_NEEDS,
      notes: z.array(z.string()),
    }),
    packaging_code_validity: loose({
      verdict: CC_VERDICT,
      basis: z.string(),
      lines: z.array(loose({ line_index: z.number(), un_number: z.string(), verdict: CC_VERDICT, mark: z.string().nullable(), field: z.enum(['a', 'b', 'c', 'd', 'e', 'f', 'g']), parsed: z.record(z.string(), z.unknown()), reason: z.string(), notes: z.array(z.string()) })),
      notes: z.array(z.string()),
    }),
    driver_training_8_2: loose({
      verdict: CC_VERDICT,
      basis: z.string(),
      requirements: z.array(CC_REQUIREMENT),
      certificate: loose({ required: CC_APPLIES, under_relief: z.boolean(), specialisations: z.array(loose({ specialisation: z.enum(['class_1', 'class_7']), applies: CC_APPLIES, lines: z.array(z.number()), held: z.boolean(), outcome: CC_OUTCOME })), held: z.boolean(), outcome: CC_OUTCOME }),
      awareness_training_1_3: loose({ applies: z.boolean(), for_driver: z.boolean(), basis: z.string(), held: z.boolean(), outcome: CC_OUTCOME }),
      inputs: z.record(z.string(), z.unknown()),
      conditions: z.array(z.string()),
      needs_info: CC_NEEDS,
      notes: z.array(z.string()),
    }),
    notes: z.array(z.string()),
    adr_edition: z.record(z.string(), z.unknown()),
  }),

  annotations: readOnlyAnnotations('ADR Consignment Check'),

  handler: async (args, opts) =>
    apiPost('adr/consignment-check', { lines: args.lines, journey: args.journey, vehicle: args.vehicle, crew: args.crew, options: args.options, edition: args.edition, as_of: args.as_of }, opts),
};

// ─────────────────────────────────────────────────────────────
//  19. Get Subscribe Link
// ─────────────────────────────────────────────────────────────

const getSubscribeLink: ToolDef = {
  name: 'get_subscribe_link',
  description: `Return the FreightUtils pricing page URL with the Pro plan's request limit (50,000 per month) and price. Use when the user asks about FreightUtils plans, pricing or API limits. A static local response — no API call, never rate-limited, no account or payment action; the user opens the URL in a browser.`,

  schema: z.object({
    tier: z.enum(['pro']).optional().describe('Tier to surface. Only "pro" is supported today.'),
  }).strict(),

  resultSchema: resultShape({
    url: z.string(),
    tier: z.string(),
    monthly_limit: z.number(),
    monthly_price: z.string(),
    currency: z.string(),
    note: z.string(),
  }),

  annotations: readOnlyAnnotations('FreightUtils Plans & Pricing'),

  // Pure static response — no upstream API call. The pricing page is the
  // canonical surface for subscription; this tool just hands the URL back.
  handler: async () => ({
    url: 'https://www.freightutils.com/pricing',
    tier: 'pro',
    monthly_limit: 50000,
    monthly_price: '£19',
    currency: 'GBP',
    note: 'Open the URL in a browser to subscribe. Agents must not attempt to complete checkout themselves.',
  }),

  // Static envelope — replicates the hosted /api/mcp get_subscribe_link
  // envelope verbatim (confidence deterministic/high, methodology source,
  // same citation line). The only locally built envelope in the package.
  localEnvelope: (flat) => ({
    envelope_version: '1',
    ok: true,
    result: flat as Record<string, unknown>,
    confidence: { level: 'high', basis: 'deterministic' },
    _source: {
      name: 'FreightUtils published methodology',
      checked: 'request-time',
      provenance_status: 'computed',
      source_url: 'https://www.freightutils.com/methodology',
    },
    citation: { text: 'FreightUtils Pro — subscribe at https://www.freightutils.com/pricing (£19/mo, 50,000 requests/mo). Open in a browser; agents must not complete checkout.' },
  }),
};

// ─────────────────────────────────────────────────────────────
//  Emissions Calculator (ISO 14083 / GLEC v3.2)
// ─────────────────────────────────────────────────────────────

const emissionsCalculator: ToolDef = {
  name: 'emissions_calculator',
  description: `Estimate freight transport greenhouse-gas emissions (kgCO2e) for one shipment leg, per ISO 14083:2023 / GLEC Framework v3.2: mass x distance x a published emission-intensity factor (DEFRA, EPA or ADEME by region). Pass ACTUAL GROSS MASS, not chargeable/volumetric weight, and a distance you provide — this tool does NOT route, geocode or compute distances. The fleet-average factor already includes average empty running: do not add an empty-return leg. An unknown mode/sub_mode/region returns available:false with the covered options. Distinct from cbm_calculator / ldm_calculator / chargeable_weight_calculator, which size or bill a shipment. A best-effort reference estimate, not a verified or audited carbon report.`,

  schema: z.object({
    mass: z.number().positive().describe('Actual gross shipment mass, in mass_unit.'),
    mass_unit: z.enum(['kg', 'tonnes']).optional().describe('Unit for mass. Default: kg.'),
    distance_km: z.number().positive().describe('Transport distance, km (you provide it).'),
    mode: z.enum(['road', 'rail', 'sea', 'air', 'inland_waterway']).describe('Transport mode.'),
    sub_mode: z.string().optional().describe('Sub-mode / vehicle class (e.g. "articulated"); omit for the representative default.'),
    region: z.enum(['uk', 'us', 'fr']).optional().describe('Factor source: uk = DEFRA, us = EPA, fr = ADEME. Default per mode.'),
    basis: z.enum(['wtw', 'ttw']).optional().describe('wtw = well-to-wheel (default), ttw = tank-to-wheel.'),
  }).strict(),

  resultSchema: resultShape({
    available: z.boolean(),
    methodology: z.string(),
    disclaimer: z.string(),
    inputs: z.record(z.string(), z.unknown()),
    tonne_km: z.number(),
    factor: loose({
      ...FU_ID_FIELDS,
      id: z.string(), mode: z.string(), sub_mode: z.string(), authority: z.string(),
      edition: z.string(), region: z.string(), unit: z.string(),
      wtw: z.number(), ttw: z.number(),
    }),
    emissions: loose({
      wtw_kgco2e: z.number(), ttw_kgco2e: z.number(),
      primary_kgco2e: z.number(), basis_used: z.string(),
    }),
    summary: z.string(),
    mass_basis: z.string(),
    empty_running: z.string(),
    representativeness: z.string(),
    confidence: z.string(),
    _source: z.record(z.string(), z.unknown()),
    message: z.string(),
    available_for: z.record(z.string(), z.unknown()),
  }),

  richText: true,

  annotations: readOnlyAnnotations('Freight Emissions Calculator'),

  handler: async (args, opts) =>
    apiGet('emissions', {
      mass: args.mass,
      mass_unit: args.mass_unit,
      distance_km: args.distance_km,
      mode: args.mode,
      sub_mode: args.sub_mode,
      region: args.region,
      basis: args.basis,
    }, opts),

  citation: (result: unknown) => {
    const r = result as {
      available?: boolean;
      factor?: { authority?: string; edition?: string; unit?: string };
      emissions?: { basis_used?: string };
    };
    if (!r || r.available === false) {
      return 'Source: FreightUtils emissions methodology (ISO 14083:2023 / GLEC Framework v3.2) — freightutils.com';
    }
    const f = r.factor ?? {};
    const b = (r.emissions?.basis_used ?? '').toUpperCase();
    return `Source: ${f.authority} (${f.edition}), ${f.unit} ${b}; method ISO 14083:2023 / GLEC Framework v3.2 — computed by freightutils.com`;
  },
};

// ─────────────────────────────────────────────────────────────
//  Identifier Validator (ISO 6346 / IATA AWB / IMO)
// ─────────────────────────────────────────────────────────────

/** Why an identifier failed (freightutils.com Run A2): validate hits, the validate refusal, resolve's validation. */
const VALIDATION_FAILURE = loose({
  reason: z.enum(['INVALID_CHECK_DIGIT', 'WRONG_LENGTH', 'BAD_CHARSET', 'UNKNOWN_PREFIX', 'UNSUPPORTED_TYPE', 'AMBIGUOUS']),
  message: z.string(),
  expected_format: z.string(),
  example: z.string(),
});

const identifierValidator: ToolDef = {
  name: 'validate',
  description: `Validate freight identifiers by their public check-digit algorithms: shipping container numbers (ISO 6346), air waybill numbers (IATA modulus-7) and IMO ship numbers. text finds and validates every identifier in a string; value + type validates one (value without type is refused); type "consignment" with consignment validates a consignment object. An AWB names its airline only when one record holds the prefix; otherwise airline_candidates[] lists every holder, never a guessed carrier. For container TYPE specs use container_lookup; for the AWB-prefix dataset airline_lookup. Structural only — a valid check digit means well-formed, NOT that the container, shipment or vessel exists.`,

  schema: z.object({
    text: z.string().optional().describe('Free text to scan for container / AWB / IMO identifiers. Provide this OR value + type.'),
    value: z.string().optional().describe('One identifier to validate; requires type.'),
    type: z.enum(['container', 'awb', 'imo', 'consignment']).optional().describe('Type of value: container (ISO 6346), awb, imo; or consignment with the consignment argument.'),
    consignment: z.record(z.string(), z.unknown()).optional().describe('With type "consignment": the consignment object to validate.'),
  }).strict(),

  resultSchema: resultShape({
    found: z.array(loose({
      type: z.string(),
      raw: z.string(),
      normalised: z.string(),
      valid: z.boolean(),
      check_digit: z.record(z.string(), z.unknown()),
      details: z.record(z.string(), z.unknown()),
      _source: z.record(z.string(), z.unknown()),
      // freightutils.com Run A2: present exactly when valid is false.
      failure: VALIDATION_FAILURE,
    })),
    disclaimer: z.string(),
    note: z.string(),
    failure: VALIDATION_FAILURE,
  }),

  richText: true,

  annotations: readOnlyAnnotations('Freight Identifier Validator'),

  handler: async (args, opts) =>
    args.type === 'consignment' || args.consignment !== undefined
      ? apiPost('validate', { type: args.type, consignment: args.consignment, ...(args.text !== undefined ? { text: args.text } : {}), ...(args.value !== undefined ? { value: args.value } : {}) }, opts)
      : apiGet('validate', { text: args.text, value: args.value, type: args.type }, opts),

  citation: (result: unknown) => {
    const r = result as { found?: { _source?: { reference?: string } }[] };
    if (!r.found || r.found.length === 0) {
      return 'Structural identifier validation (ISO 6346 / IATA AWB / IMO) — computed by freightutils.com';
    }
    const refs = [...new Set(r.found.map((h) => (h._source?.reference ?? '').split(' — ')[0]).filter(Boolean))].join(' ; ');
    return `Source: ${refs} — structural check-digit validation, computed by freightutils.com`;
  },
};

// ─────────────────────────────────────────────────────────────
//  ICS2 Stop-Words Checker (EU ICS2 goods-description terms)
// ─────────────────────────────────────────────────────────────

const ics2Check: ToolDef = {
  name: 'ics2_check',
  description: `Check a goods description against the official EU ICS2 stop-words list — terms too vague or generic for an entry summary declaration (ENS) goods description. A standalone stop-word means automatic rejection, an embedded one means make the description more specific; clean=true means no listed term matched, not that it will be accepted. For commodity codes use hs_code_lookup; for duty/VAT uk_duty_calculator. Strictly a reference check — not an ENS filing, not a customs-compliance determination, not legal advice.`,

  schema: z.object({
    description: z.string().min(1, 'description must not be empty').describe('The goods description to check.'),
  }).strict(),

  resultSchema: resultShape({
    description: z.string(),
    flagged: z.array(loose({ ...FU_ID_FIELDS, term: z.string(), note: z.string() })),
    clean: z.boolean(),
    caveat: z.string(),
    disclaimer: z.string(),
  }),

  richText: true,

  annotations: readOnlyAnnotations('ICS2 Stop-Words Checker'),

  handler: async (args, opts) => apiGet('ics2-check', { description: args.description }, opts),

  citation: (result: unknown) => {
    const r = result as { _source?: { authority?: string; legal_basis?: string; list_in_force?: string } };
    const s = r._source ?? {};
    return `Source: EU ICS2 stop-words list — ${s.authority ?? 'European Commission DG TAXUD'} (${s.legal_basis ?? 'Commission Delegated Regulation (EU) 2015/2446'}), in force ${s.list_in_force ?? '2026-05-04'} — checked by freightutils.com`;
  },
};

// ─────────────────────────────────────────────────────────────
//  Airports (OurAirports, public domain) — airport_lookup + nearest_airport
// ─────────────────────────────────────────────────────────────

const airportTypeEnum = z.enum(['large_airport', 'medium_airport', 'small_airport', 'heliport', 'closed', 'seaplane_base']);
const airportRecord = loose({
  ...FU_ID_FIELDS,
  ident: z.string(),
  iata_code: z.string(),
  name: z.string(),
  type: z.string(),
  municipality: z.string(),
  region: z.string(),
  country: z.string(),
  country_name: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  elevation_ft: z.number(),
  // freightutils.com Run A2 (OurAirports refresh 2026-10-30) — additive.
  icao_code: z.string(),
  scheduled_service: z.boolean(),
  iso_region: z.string(),
  gps_code: z.string(),
  keywords: z.string(),
});
const airportCitation = (result: unknown) => {
  const r = result as { _source?: { citeShort?: string; authority?: string } };
  const s = r._source ?? {};
  return `Source: ${s.authority ?? 'OurAirports (public domain)'} — cross-checked vs OpenFlights + Wikidata — via freightutils.com`;
};

const airportLookup: ToolDef = {
  name: 'airport_lookup',
  description: `Look up an airport by IATA code ("LHR"), ICAO code ("EGLL") or free-text name/city search (OurAirports, public domain). Provide ONE of iata, icao or query; ambiguous name searches return ranked candidates; an unknown code errors. For airports near a coordinate use nearest_airport; for carriers and AWB prefixes airline_lookup; for general transport locations unlocode_lookup. Reference data only — not for navigation.`,
  schema: z.object({
    iata: z.string().regex(/^[A-Za-z]{3}$/, 'IATA code must be 3 letters (e.g. "LHR")').optional().describe('Exact 3-letter IATA code.'),
    icao: z.string().regex(/^[A-Za-z0-9]{4}$/, 'ICAO code must be 4 characters (e.g. "EGLL")').optional().describe('Exact 4-character ICAO code / ident.'),
    query: z.string().min(2, 'Query must be at least 2 characters').optional().describe('Name or city search.'),
    type: airportTypeEnum.optional().describe('Optional filter by airport type.'),
    codes: z.array(z.string().max(14)).min(1).max(50).optional().describe('Batch: up to 50 airport codes (IATA or ICAO). Send alone.'),
  }).strict(),
  resultSchema: resultShape({
    count: z.number(),
    results: z.array(airportRecord),
    disclaimer: z.string(),
    meta: z.record(z.string(), z.unknown()),
  }),
  richText: true,
  annotations: readOnlyAnnotations('Airport Code Lookup'),
  handler: async (args, opts) => apiGet('airports', { iata: args.iata, icao: args.icao, q: args.query, type: args.type, codes: listArg(args.codes) }, opts),
  citation: airportCitation,
};

const nearestAirport: ToolDef = {
  name: 'nearest_airport',
  description: `The airports nearest a latitude/longitude you provide, sorted by great-circle distance (distance_km on each). By default only airports with scheduled airline service and an IATA code; include_all: true ranks every type except closed fields. Does NOT geocode place names — pass coordinates you already hold; nothing is stored. For an exact code or name lookup use airport_lookup; for named transport locations unlocode_lookup. Reference data only — not for navigation.`,
  schema: z.object({
    latitude: z.number().min(-90).max(90).describe('Latitude, decimal degrees.'),
    longitude: z.number().min(-180).max(180).describe('Longitude, decimal degrees.'),
    radius_km: z.number().positive().optional().describe('Maximum distance in kilometres — omit for no radius cap.'),
    max_results: z.number().int().min(1).max(50).optional().describe('Maximum results (1-50). Default: 10.'),
    type: airportTypeEnum.optional().describe('Optional filter by airport type. Example: "large_airport".'),
    include_all: z.boolean().optional().describe('true: every airport type except closed fields. Default false (scheduled service with an IATA code).'),
  }).strict(),
  resultSchema: resultShape({
    count: z.number(),
    results: z.array(airportRecord),
    distance_basis: z.literal('great_circle'),
    filter: z.enum(['scheduled_iata', 'all', 'type']),
    filter_description: z.string(),
    disclaimer: z.string(),
    meta: z.record(z.string(), z.unknown()),
  }),
  richText: true,
  annotations: readOnlyAnnotations('Nearest Airport'),
  handler: async (args, opts) => apiGet('nearest-airport', {
    lat: args.latitude, lon: args.longitude,
    radius_km: args.radius_km, max_results: args.max_results, type: args.type,
    include_all: args.include_all === true ? 'true' : undefined,
  }, opts),
  citation: airportCitation,
};

// ─────────────────────────────────────────────────────────────
//  25. Resolve Reference
// ─────────────────────────────────────────────────────────────

const resolveReference: ToolDef = {
  name: 'resolve_reference',
  description: `Resolve an arbitrary freight identifier — one opaque string in, typed and cited candidates out. Use when you hold one identifier-ish token ("176", "UN1845", "NLRTM", "FOB", "22G1", "MSKU1100810", "D/E", "TU9") and do not know what kind of identifier it is: each candidate names its entity type and carries the api_url and canonical_url of its full record. q is ONE identifier (max 32 chars), or an fu: identifier (fu_id or fu_version_id, up to 200 chars), which resolves to exactly its one record or to none. Colliding grammars return several ranked candidates, never a silent guess; zero candidates is a valid result. Single-token resolution, not free-text extraction — pass one identifier, not a manifest line. The lookups it resolves into: adr_lookup, airline_lookup, airport_lookup, unlocode_lookup, hs_code_lookup, incoterms_lookup, container_lookup, uld_lookup, validate.`,
  schema: z.object({
    // 2.33.0 (as the hosted tool since freightutils.com run 0.1b): an fu: identifier may be up to 200 characters;
    // every other identifier keeps the 32-character limit.
    q: z.string().min(1).max(RESOLVE_MAX_FU_ID_LENGTH).refine((s) => s.trim().length > 0, 'q must not be blank')
      .refine((s) => s.trim().startsWith('fu:') || s.length <= RESOLVE_MAX_QUERY_LENGTH, { message: `Too big: expected string to have <=${RESOLVE_MAX_QUERY_LENGTH} characters (an fu: identifier may have up to ${RESOLVE_MAX_FU_ID_LENGTH})` })
      .describe('One freight identifier, or an fu: identifier from an answer (e.g. "fu:adr:un:1203:II:F1@2025").'),
  }).strict(),
  resultSchema: resultShape({
    query: z.string(),
    normalized: z.string(),
    count: z.number(),
    note: z.string(),
    candidates: z.array(loose({
      entity_type: z.string(),
      identifier_type: z.string(),
      value_normalized: z.string(),
      summary: z.string(),
      record: loose({ ...FU_ID_FIELDS, variants: z.array(loose({ ...FU_ID_FIELDS })) }),
      verification_status: z.string(),
      verification_basis: z.string(),
      rank_basis: z.string(),
      canonical_url: z.string(),
      api_url: z.string(),
      citation: loose({ text: z.string(), qualifier: z.string() }),
    })),
    // freightutils.com Run A2 — additive.
    validation: loose({ type: z.enum(['awb', 'container', 'imo']), valid: z.boolean(), failure: VALIDATION_FAILURE }),
    failure: loose({ reason: z.enum(['NO_MATCH', 'AMBIGUOUS']), message: z.string(), candidate_types: z.array(z.string()) }),
  }),
  // Deliberately NOT richText: the non-richText path appends the ENVELOPE's
  // citation.text as content[1], byte-matching the hosted /api/mcp surface.
  // richText would look for a tool-local citation fn this tool does not have
  // (per-candidate citations live inside the result), silently dropping the
  // citation line (caught by the 2.17.0 adversarial review; fixed in 2.17.1).
  annotations: readOnlyAnnotations('Resolve Freight Reference'),
  handler: async (args, opts) => apiGet('resolve', { q: args.q }, opts),
};

// ─────────────────────────────────────────────────────────────
//  Export all tools
// ─────────────────────────────────────────────────────────────

export const ALL_TOOLS: ToolDef[] = [
  cbmCalculator,
  chargeableWeightCalculator,
  ldmCalculator,
  adrLookup,
  adrExemptionCalculator,
  adrLqEqCheck,
  airlineLookup,
  containerLookup,
  hsCodeLookup,
  incotermsLookup,
  palletFittingCalculator,
  unitConverter,
  consignmentCalculator,
  unlocodeLookup,
  ukDutyCalculator,
  shipmentSummary,
  uldLookup,
  vehicleLookup,
  emissionsCalculator,
  identifierValidator,
  ics2Check,
  airportLookup,
  nearestAirport,
  resolveReference,
  adrConsignmentCheck,
  getSubscribeLink,
];

/**
 * 2.33.0: the fifteen tools whose answers carry records — each record has fu_id (and fu_version_id where the
 * dataset has editions), put there by the API (freightutils.com run 0.1b). Their descriptions carry one clause
 * saying so, the same words on every tool, added here rather than typed fifteen times.
 */
export const ID_RECORD_TOOLS: ReadonlySet<string> = new Set([
  'adr_lookup', 'adr_lq_eq_check', 'adr_consignment_check', 'hs_code_lookup', 'unlocode_lookup', 'airport_lookup',
  'nearest_airport', 'airline_lookup', 'uld_lookup', 'container_lookup', 'vehicle_lookup', 'incoterms_lookup',
  'resolve_reference', 'ics2_check', 'emissions_calculator',
]);
// 2.34.3 (run TW1): the clause is no longer appended to fifteen descriptions — INSTRUCTIONS says it once.

/**
 * 2.34.3 (run TW1, the tool-list diet): the rules every tool shared, said once — the server's `instructions`
 * (initialize) instead of repeated in each description. Each sentence is the 2.34.2 description text it replaces.
 */
export const INSTRUCTIONS = [
  'Rules every FreightUtils tool shares:',
  `- structuredContent is the FreightUtils response envelope: the answer under result, ${ENV.replace(' (the FreightUtils v1 response envelope).', '.')}`,
  `- ${CASING}`,
  `- ${RATE}`,
  `- ${UNKNOWN_FIELDS_REFUSED}`,
  `- ADR editions: ${EDITIONS}`,
  `- Identifiers: ${IDS}`,
  `- Lists: ${LIST_TEXT}`,
  '- Batch arguments (codes, un_numbers, lines): send alone; answered as results[] in input order, each with its own status. One call against the daily limit, N against the Pro monthly allowance.',
  '- consignment: the consignment object (https://www.freightutils.com/schema/consignment-object.v1.json) may replace a tool\'s other arguments; send it alone; an input the tool needs and the object lacks comes back in missing_inputs.',
].join('\n');
