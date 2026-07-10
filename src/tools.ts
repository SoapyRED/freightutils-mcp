import { z } from 'zod';
import { apiGet, apiPost, type ApiOpts } from './api.js';
import { loose, resultShape } from './envelope.js';

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
  schema: z.AnyZodObject;
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
const RATE = 'Rate-limited (anonymous use: 25 requests/day per IP): a 429 error body carries retry_after_seconds and a Retry-After header — back off and retry, or call get_subscribe_link for higher limits.';
// Shared envelope tail — what every REST-backed tool returns around its result.
const ENV = 'plus confidence, _source and citation (the FreightUtils v1 response envelope).';

// ─────────────────────────────────────────────────────────────
//  1. CBM Calculator
// ─────────────────────────────────────────────────────────────

const cbmCalculator: ToolDef = {
  name: 'cbm_calculator',
  description: `Calculate cubic metres (CBM) for a shipment from per-piece dimensions. CBM is the standard volume unit in international shipping: 1 CBM = 1m x 1m x 1m = 1,000 litres, and ocean freight prices per "freight tonne" (1 CBM or 1,000 kg, whichever is greater).

Behavior: deterministic — identical inputs always return identical figures; total volume = pieces x per-piece CBM, with conversions to cubic feet, cubic inches and litres included. Missing or non-positive dimensions error with a validation message naming the parameter. ${RATE}

Returns: cbm_per_piece, total_cbm, cubic_feet, litres, cubic_inches and pieces under result, ${ENV}

Related: chargeable_weight_calculator (air billing weight from the same dims), consignment_calculator (multi-line totals), unit_converter (single conversions), shipment_summary (full composite analysis).`,

  schema: z.object({
    length_cm: z.number().positive().describe('Length of one piece in centimetres (> 0). Example: 120.'),
    width_cm: z.number().positive().describe('Width of one piece in centimetres (> 0). Example: 80.'),
    height_cm: z.number().positive().describe('Height of one piece in centimetres (> 0). Example: 100.'),
    pieces: z.number().int().positive().optional().describe('Number of identical pieces — total volume scales linearly. Default: 1.'),
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
  description: `Calculate air freight chargeable weight — the greater of actual gross weight and volumetric weight, which is what airlines bill. Volumetric weight (kg) = (L x W x H in cm) / divisor; the IATA-standard divisor is 6,000 (1 CBM = 166.67 kg), while express integrators (DHL, FedEx, UPS) typically use 5,000.

Behavior: deterministic; per-piece volumetric weight is rounded to 2 decimal places before totalling; basis reports which weight governs ("volumetric" = cargo is light for its size, "actual" = dense). Air mode only — sea W/M (1 CBM = 1,000 kg) is covered by consignment_calculator with mode=sea. Missing or non-positive inputs error with the failing parameter named. ${RATE}

Returns: chargeable_weight_kg, basis, volumetric_weight_kg (total and per piece), gross_weight_kg, cbm, ratio, factor and pieces under result; normalized_input echoes the interpreted inputs and any defaults applied; ${ENV}

Related: cbm_calculator (volume only), consignment_calculator (multi-line, all modes), uld_lookup (the equipment the freight flies in).`,

  schema: z.object({
    length_cm: z.number().positive().describe('Length of one piece in centimetres (> 0). Example: 120.'),
    width_cm: z.number().positive().describe('Width of one piece in centimetres (> 0). Example: 80.'),
    height_cm: z.number().positive().describe('Height of one piece in centimetres (> 0). Example: 100.'),
    gross_weight_kg: z.number().positive().describe('Actual gross weight of the WHOLE shipment (all pieces) in kilograms. Example: 500.'),
    pieces: z.number().int().positive().optional().describe('Number of identical pieces. Default: 1.'),
    factor: z.number().int().positive().optional().describe('Volumetric divisor in cm³/kg. Default: 6000 (IATA standard); express carriers typically 5000.'),
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
  description: `Calculate loading metres (LDM) for European road freight — how much trailer length a pallet load occupies. 1 LDM = 1 linear metre of a 2.4m-wide trailer; a standard artic is 13.6 LDM.

Provide a pallet preset OR custom length_mm + width_mm — omitting both errors with a usage hint. Behavior: deterministic; stackable=true with stack_height 2 or 3 divides the floor footprint accordingly; fits reports whether the load fits the chosen vehicle's LENGTH (give weight_kg to also see total_weight_kg against the vehicle's max payload); utilisation_percent is of the vehicle's length. ${RATE}

Returns: ldm, vehicle (name, length_m, max_payload_kg), utilisation_percent, pallet_spaces (used/available), total_weight_kg, fits and warnings under result, ${ENV}

Related: vehicle_lookup (the trailer specs behind the vehicle presets), pallet_fitting_calculator (boxes onto one pallet), consignment_calculator (mixed lines including LDM).`,

  schema: z.object({
    pallet: z.enum(['euro', 'uk', 'half', 'quarter']).optional()
      .describe('Pallet preset: euro=1200x800mm, uk=1200x1000mm, half=800x600mm, quarter=600x400mm. Provide this OR length_mm + width_mm.'),
    length_mm: z.number().positive().optional().describe('Custom pallet length in millimetres (use with width_mm instead of a preset). Example: 1140.'),
    width_mm: z.number().positive().optional().describe('Custom pallet width in millimetres. Example: 980.'),
    quantity: z.number().int().positive().optional().describe('Number of pallets. Default: 1.'),
    stackable: z.boolean().optional().describe('Whether pallets can be double/triple-stacked — halves (or thirds) the floor footprint. Default: false.'),
    stack_height: z.number().int().min(2).max(3).optional().describe('Stack height when stackable: 2 or 3. Default: 2.'),
    weight_kg: z.number().positive().optional().describe('Weight per pallet in kg — enables the payload side of the fits check.'),
    vehicle: z.enum(['artic', 'rigid10', 'rigid75', 'luton', 'custom']).optional()
      .describe('Vehicle preset: artic 13.6m (default), rigid10 = 10m rigid, rigid75 = 7.5t rigid, luton van, or custom.'),
    vehicle_length_m: z.number().positive().optional()
      .describe('Custom vehicle load length in metres (required when vehicle=custom).'),
  }).strict(),

  resultSchema: resultShape({
    ldm: z.number(),
    vehicle: loose({ name: z.string(), length_m: z.number(), max_payload_kg: z.number() }),
    utilisation_percent: z.number(),
    pallet_spaces: loose({ used: z.number(), available: z.number() }),
    total_weight_kg: z.number(),
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
  description: `Look up European road dangerous-goods (ADR 2025) reference data for a substance: hazard class, classification code, packing group, labels, special provisions, limited/excepted quantities, transport category, tunnel restriction code and Kemler (hazard identification) number. Covers 2,939 entries across all 9 hazard classes, from UNECE ADR 2025 (ECE/TRANS/352).

Provide exactly ONE of: un_number (exact lookup — returns every packing-group variant of that UN number), search (case-insensitive partial match on the proper shipping name), or hazard_class (all entries in a class or division). un_number is normalised — "1203", "UN1203" and "un 1203" are equivalent, and normalized_input reports the correction; explosives keep their leading zero ("0004").

Behavior: read-only reference lookup; name searches return up to 50 entries, class filters up to 100. An unknown UN number or a search with no hits errors with the API's NOT_FOUND body and a retry hint. ${RATE}

Returns: count and results[] — per entry: un_number, proper_shipping_name, class, classification_code, packing_group, labels, special_provisions, limited_quantity, excepted_quantity, transport_category, tunnel_restriction_code, hazard_identification_number and variant_index/variant_count — under result, ${ENV}

Limitations: a factual compilation of the ADR table, not legal or compliance advice; classification remains the consignor's responsibility — verify against the current UNECE ADR text.

Related: adr_lq_eq_check (checks quantities against the LQ/EQ values returned here), adr_exemption_calculator (1.1.3.6 small-load points), consignment_calculator (flags dangerous-goods lines by UN number).`,

  schema: z.object({
    un_number: z.string().regex(/^(UN)?\d{4}$/i, 'UN number must be 4 digits, optionally prefixed with "UN" (e.g., "1203" or "UN1203")').optional().describe('Exact UN number — 4 digits, optionally "UN"-prefixed; explosives keep their leading zero. Examples: "1203", "UN1203", "0004".'),
    search: z.string().min(2, 'Search term must be at least 2 characters').optional().describe('Case-insensitive partial match on the proper shipping name (min 2 characters). Example: "acetone".'),
    hazard_class: z.string().optional().describe('All entries in an ADR class or division. Examples: "3" (flammable liquids), "6.1" (toxic), "1.4" (an explosives division).'),
  }).strict(),

  resultSchema: resultShape({
    count: z.number(),
    results: z.array(loose({
      un_number: z.string(),
      proper_shipping_name: z.string(),
      class: z.string(),
      classification_code: z.string(),
      packing_group: z.string(),
      labels: z.string(),
      special_provisions: z.string(),
      limited_quantity: z.string(),
      excepted_quantity: z.string(),
      transport_category: z.string(),
      tunnel_restriction_code: z.string(),
      hazard_identification_number: z.string(),
      variant_index: z.number(),
      variant_count: z.number(),
    })),
    meta: z.record(z.string(), z.unknown()),
  }),

  annotations: readOnlyAnnotations('ADR Dangerous Goods Lookup'),

  handler: async (args, opts) =>
    apiGet('adr', { un: args.un_number, q: args.search, class: args.hazard_class }, opts),
};

// ─────────────────────────────────────────────────────────────
//  5. ADR Exemption Calculator
// ─────────────────────────────────────────────────────────────

const adrExemptionCalculator: ToolDef = {
  name: 'adr_exemption_calculator',
  description: `Calculate ADR 1.1.3.6 "small load" exemption points for a dangerous-goods load. Each substance's transport category (0-4) sets a points multiplier (category 1 x50, 2 x3, 3 x1, 4 x0); points = quantity x multiplier, and a load totalling 1,000 points or less qualifies for reduced ADR requirements. Transport category 0 substances can NEVER use this exemption — has_category_zero flags them.

Provide un_number + quantity for a single substance, or items[] for a mixed load (items takes precedence if both are given). Quantities are in kg or litres per the substance's ADR unit.

Behavior: deterministic points arithmetic over ADR 2025 reference data; UN numbers that cannot be resolved are reported in warnings; exempt is the overall verdict. ${RATE}

Returns: items[] (each with transport_category, multiplier, points), total_points, threshold (1000), exempt, has_category_zero, warnings and message under result, ${ENV}

Limitations: a deterministic calculation over reference data, not legal advice — even exempt loads keep core duties (packaging, marking, documentation), and mixed-packing rules still apply; verify against the current UNECE ADR text.

Related: adr_lookup (per-substance data incl. transport category), adr_lq_eq_check (the LQ/EQ relief routes instead of 1.1.3.6).`,

  schema: z.object({
    un_number: z.string().regex(/^(UN)?\d{4}$/i, 'UN number must be 4 digits, optionally prefixed with "UN"').optional().describe('UN number for a single-substance check — 4 digits, optionally "UN"-prefixed. Example: "1203".'),
    quantity: z.number().positive().optional().describe('Quantity for the single-substance check, in kg or litres per the substance\'s ADR unit. Example: 100.'),
    items: z.array(z.object({
      un_number: z.string().regex(/^(UN)?\d{4}$/i, 'UN number must be 4 digits, optionally prefixed with "UN"').describe('UN number — 4 digits, optionally "UN"-prefixed. Example: "1263".'),
      quantity: z.number().positive().describe('Quantity in kg or litres per the substance\'s ADR unit.'),
    })).optional().describe('Mixed-load items (use INSTEAD of un_number/quantity).'),
  }).strict(),

  resultSchema: resultShape({
    items: z.array(loose({
      un_number: z.string(),
      proper_shipping_name: z.string(),
      class: z.string(),
      transport_category: z.string(),
      quantity: z.number(),
      multiplier: z.number(),
      points: z.number(),
    })),
    total_points: z.number(),
    threshold: z.number(),
    exempt: z.boolean(),
    has_category_zero: z.boolean(),
    has_quantity_exceedance: z.boolean(),
    warnings: z.array(z.unknown()),
    message: z.string(),
  }),

  annotations: readOnlyAnnotations('ADR 1.1.3.6 Exemption Calculator'),

  handler: async (args, opts) => {
    if (args.items) {
      return apiPost('adr-calculator', { items: args.items }, opts);
    }
    return apiGet('adr-calculator', { un: args.un_number, qty: args.quantity }, opts);
  },
};

// ─────────────────────────────────────────────────────────────
//  6. Airline Lookup
// ─────────────────────────────────────────────────────────────

const airlineLookup: ToolDef = {
  name: 'airline_lookup',
  description: `Search 6,357 airlines by name, IATA code, ICAO code, AWB prefix, or country. AWB prefixes are the first 3 digits of an air waybill number and identify the issuing carrier (e.g. 176 = Emirates).

Provide ONE parameter: query is a ranked fuzzy search across names and codes; iata / icao / prefix / country are exact filters.

Behavior: read-only; fuzzy query hits report their match quality through the envelope's confidence (basis match_quality, score 0-1) with a FUZZY_BEST_MATCH advisory naming the matched field; a query with no hits returns count 0 with a NO_MATCH advisory rather than an error. ${RATE}

Returns: count and results[] — per airline: airline_name, iata_code, icao_code, awb_prefix[], callsign, country, has_cargo, aliases and per-record verification fields — under result, ${ENV}

Limitations: this dataset's provenance is pending independent verification (the envelope's provenance_status says so) — confirm operationally critical codes with IATA/ICAO or the carrier.

Related: airport_lookup (searches AIRPORTS, not carriers), validate (checks an AWB number's check digit and names its airline from this dataset).`,

  schema: z.object({
    query: z.string().min(2, 'Query must be at least 2 characters').optional().describe('Ranked fuzzy search across name, codes, prefix and country (min 2 chars). Example: "emirates".'),
    iata: z.string().regex(/^[A-Za-z0-9]{2}$/, 'IATA code must be 2 letters or digits (e.g., "EK", "U2")').optional().describe('Exact IATA code — 2 alphanumeric characters. Examples: "EK", "U2".'),
    icao: z.string().regex(/^[A-Za-z]{3}$/, 'ICAO code must be 3 letters (e.g., "UAE", "BAW")').optional().describe('Exact ICAO code — 3 letters. Examples: "UAE", "BAW".'),
    prefix: z.string().regex(/^\d{3}$/, 'AWB prefix must be exactly 3 digits').optional().describe('Exact AWB prefix — the first 3 digits of an air waybill. Example: "176".'),
    country: z.string().min(2, 'Country must be at least 2 characters').optional().describe('Filter by country name (min 2 chars). Example: "Netherlands".'),
  }).strict(),

  resultSchema: resultShape({
    count: z.number(),
    results: z.array(loose({
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
    })),
    meta: z.record(z.string(), z.unknown()),
  }),

  annotations: readOnlyAnnotations('Airline / AWB Prefix Lookup'),

  handler: async (args, opts) =>
    apiGet('airlines', {
      q: args.query, iata: args.iata, icao: args.icao,
      prefix: args.prefix, country: args.country,
    }, opts),
};

// ─────────────────────────────────────────────────────────────
//  7. Container Lookup
// ─────────────────────────────────────────────────────────────

const containerLookup: ToolDef = {
  name: 'container_lookup',
  description: `Get ISO shipping-container specifications, with optional load-fit maths. Covers 10 types: 20ft/40ft standard, 40ft and 45ft high-cube, 20ft/40ft reefer, 20ft/40ft open-top and 20ft/40ft flat-rack.

Provide type as a slug (e.g. "20ft-standard", "40ft-high-cube") for one container's record; omit it to list all 10. Add item dimensions (item_length_cm/width_cm/height_cm, optional item_weight_kg and item_quantity) to also compute how many such items fit.

Behavior: read-only reference data with per-record provenance (sources, audited_at, decision_rationale); an unknown type errors with the valid slug list. Fit calculations are geometric best-effort — they do not model load distribution, securing or mixed cargo. ${RATE}

Returns: the container record — internal/external/door dimensions (cm), capacity_cbm, tare_weight_kg, max_gross_kg, max_payload_kg and euro/GMA pallet counts — under result, ${ENV}

Limitations: manufacturer-typical specs, provenance pending independent verification (the envelope's provenance_status says so) — actual equipment varies by lessor and line; confirm against the carrier's equipment guide.

Related: validate (checks a container NUMBER's ISO 6346 check digit — not specs), cbm_calculator / consignment_calculator (the cargo volume to fill it), uld_lookup (the air-freight equivalent).`,

  schema: z.object({
    type: z.string().min(2, 'Container type must be at least 2 characters').optional()
      .describe('Container slug. Examples: "20ft-standard", "40ft-high-cube", "20ft-reefer". Omit to list all 10 types.'),
    item_length_cm: z.number().positive().optional().describe('Item length in cm — provide all three item dims to get a load-fit calculation.'),
    item_width_cm: z.number().positive().optional().describe('Item width in cm.'),
    item_height_cm: z.number().positive().optional().describe('Item height in cm.'),
    item_weight_kg: z.number().positive().optional().describe('Item weight in kg — caps the fit by max payload.'),
    item_quantity: z.number().int().positive().optional().describe('Number of items to check against the container.'),
  }).strict(),

  resultSchema: resultShape({
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
    }, opts),
};

// ─────────────────────────────────────────────────────────────
//  8. HS Code Lookup
// ─────────────────────────────────────────────────────────────

const hsCodeLookup: ToolDef = {
  name: 'hs_code_lookup',
  description: `Search 6,940 WCO Harmonized System (HS 2022) commodity codes — the 6-digit international customs classification layer. The first 2 digits are the chapter, 4 the heading, 6 the subheading.

Provide ONE of: query (free-text description search, min 2 chars), code (2-6 digit lookup, returns the code plus its hierarchy), or section (Roman numeral I-XXI to browse a section).

Behavior: read-only; description search is keyword-based against official HS descriptions, so everyday product words can return zero rows — count 0 with an empty results[] is a valid answer (e.g. "laptop" and "computers" find nothing; "automatic data" matches the official phrasing "automatic data processing machines"); prefer the formal tariff wording. ${RATE}

Returns: the query/code echo, count and results[] (hscode, description and hierarchy context) under result, ${ENV}

Limitations: the 6-digit international level only — national tariff lines (8-10 digits) and duty rates are set per country; classification here is indicative, not a binding ruling.

Related: uk_duty_calculator (duty/VAT for a code found here), ics2_check (EU ENS goods-description quality — a different check entirely).`,

  schema: z.object({
    query: z.string().min(2, 'Search term must be at least 2 characters').optional().describe('Keyword search on official HS descriptions (min 2 chars). Formal tariff wording works best. Example: "automatic data" rather than "laptop".'),
    code: z.string().regex(/^\d{2,6}$/, 'HS code must be 2–6 digits').optional().describe('Exact HS code or prefix — 2, 4 or 6 digits. Example: "8471".'),
    section: z.string().regex(/^[ivxIVX]{1,5}$/, 'Section must be a Roman numeral I–XXI').optional().describe('Browse a section by Roman numeral I-XXI. Example: "XVI" (machinery).'),
  }).strict(),

  resultSchema: resultShape({
    query: z.string(),
    code: z.string(),
    section: z.string(),
    count: z.number(),
    results: z.array(z.record(z.string(), z.unknown())),
    meta: z.record(z.string(), z.unknown()),
  }),

  annotations: readOnlyAnnotations('HS Code Lookup'),

  handler: async (args, opts) =>
    apiGet('hs', { q: args.query, code: args.code, section: args.section }, opts),
};

// ─────────────────────────────────────────────────────────────
//  9. Incoterms Lookup
// ─────────────────────────────────────────────────────────────

const incotermsLookup: ToolDef = {
  name: 'incoterms_lookup',
  description: `Look up the 11 Incoterms 2020 trade rules — who pays for transport, insurance and customs clearance, and where risk transfers from seller to buyer. 7 rules work for any transport mode (EXW, FCA, CPT, CIP, DAP, DPU, DDP); 4 are sea/inland-waterway only (FAS, FOB, CFR, CIF).

Provide code for one rule, category (any_mode | sea_only) for a filtered list, or neither to list all 11. Behavior: read-only reference; an unknown code errors with the valid code list. ${RATE}

Returns: the rule record — name, category, summary, seller_responsibility, buyer_responsibility, risk_transfer, cost_transfer, insurance, export/import clearance, best_for and watch_out — under result, ${ENV}

Limitations: summarised guidance on ICC Incoterms 2020; the ICC publication is the binding text and specific contract wording prevails.

Related: uk_duty_calculator (accepts an incoterm when composing the CIF value), shipment_summary (composite analysis).`,

  schema: z.object({
    code: z.string().regex(/^[A-Za-z]{3}$/, 'Incoterm code must be 3 letters (e.g., "FOB", "CIF", "EXW")').optional().describe('Three-letter Incoterms 2020 code. Examples: "FOB", "CIF", "EXW", "DAP".'),
    category: z.enum(['any_mode', 'sea_only']).optional().describe('Filter the list: any_mode (7 rules) or sea_only (4 rules).'),
  }).strict(),

  resultSchema: resultShape({
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
    results: z.array(z.unknown()),
  }),

  annotations: readOnlyAnnotations('Incoterms 2020 Lookup'),

  handler: async (args, opts) =>
    apiGet('incoterms', { code: args.code, category: args.category }, opts),
};

// ─────────────────────────────────────────────────────────────
//  10. Pallet Fitting Calculator
// ─────────────────────────────────────────────────────────────

const palletFittingCalculator: ToolDef = {
  name: 'pallet_fitting_calculator',
  description: `Calculate how many identical boxes fit on a pallet: boxes per layer (trying 90-degree rotation when allowed), layer count within the max height, totals, volume utilisation and weight capping.

Behavior: deterministic geometric packing of one box size in aligned rows and columns — it does not model interlocked or mixed-orientation patterns; weight_limited reports when max_payload_kg caps the count below the geometric fit; pallet_deck_height_cm defaults to 15. Missing or non-positive dimensions error naming the parameter. ${RATE}

Returns: boxes_per_layer, layers, total_boxes, orientation, boxes_per_row/col, usable_height_cm, utilisation_percent, total_box_volume_cbm, wasted_space_cbm and the weight fields under result, ${ENV}

Limitations: a theoretical best-effort fit — real stacking obeys carton strength, overhang and load-stability rules it does not model.

Related: ldm_calculator (pallets into trailer length), vehicle_lookup (pallet capacity per vehicle), container_lookup (pallets into containers).`,

  schema: z.object({
    pallet_length_cm: z.number().positive().describe('Pallet length in cm. Example: 120 (euro pallet).'),
    pallet_width_cm: z.number().positive().describe('Pallet width in cm. Example: 80 (euro pallet).'),
    pallet_max_height_cm: z.number().positive().describe('Maximum stack height in cm INCLUDING the pallet deck. Example: 180.'),
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
  description: `Convert freight and logistics units: weight (kg, lbs, oz, tonnes, short_tons, long_tons), volume (cbm, cuft, cuin, litres, gal_us, gal_uk), length (cm, inches, m, feet, mm), plus two freight-specific targets valid only FROM cbm — chargeable_kg (air volumetric weight at the IATA 6,000 divisor, 1 CBM = 166.67 kg) and freight_tonnes (sea W/M, 1 CBM = 1 freight tonne).

Behavior: deterministic; the response names both units and states the formula used. Cross-dimension conversions (e.g. kg to litres) and freight targets from a non-cbm source error with the accepted-unit list. Note: short ton (US) = 2,000 lb, long ton (UK) = 2,240 lb, metric tonne = 2,204.6 lb. ${RATE}

Returns: input {value, unit, name}, result {value, unit, name}, formula and note under result, ${ENV}

Related: cbm_calculator (dimensions to volume first), chargeable_weight_calculator (proper air billing weight with pieces and a custom divisor).`,

  schema: z.object({
    value: z.number().describe('The numeric value to convert. Example: 5.'),
    from: z.enum(['kg','lbs','oz','tonnes','short_tons','long_tons','cbm','cuft','cuin','litres','gal_us','gal_uk','cm','inches','m','feet','mm']).describe('Source unit — weight (kg, lbs, oz, tonnes, short_tons, long_tons), volume (cbm, cuft, cuin, litres, gal_us, gal_uk) or length (cm, inches, m, feet, mm). Must be the same dimension as "to".'),
    to: z.enum(['kg','lbs','oz','tonnes','short_tons','long_tons','cbm','cuft','cuin','litres','gal_us','gal_uk','cm','inches','m','feet','mm','chargeable_kg','freight_tonnes']).describe('Target unit — any same-dimension unit, plus chargeable_kg and freight_tonnes (both only valid from cbm).'),
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
  description: `Calculate per-line and grand totals for a multi-item mixed consignment: CBM, loading metres (LDM), volumetric weight, and the mode-specific chargeable figure (air chargeable weight, sea revenue tonnes, road LDM), plus objective advisory flags.

Provide mode (sea | air | road, default road) and either lines[] (canonical — per line: quantity, dims {l,w,h,unit}, weight {value,unit}, optional description / hs_code / un_number / stackable) or the legacy flat items[] (dimensions in cm, weight in kg). Air uses an IATA volumetric divisor (default 6000, settable via options.air_volumetric_divisor); options.container_number / options.awb_number add a check-digit sanity flag.

Behavior: deterministic; flags are advisory only — implausible density, mode/option mismatch, dangerous-goods presence by UN number against ADR 2025, and container/AWB check-digit validity — and never state that a shipment is permitted or compliant. Invalid lines error naming the offending field. Canonical schema: https://www.freightutils.com/schema/consignment.v1.json. ${RATE}

Returns: schema_version, mode, per_line[] (cbm, gross_weight_kg, density, volumetric_weight_kg, ldm, revenue_tonnes, chargeable_weight_kg), totals (incl. billing_basis) and flags[] under result, ${ENV}

Limitations: best-effort deterministic calculation and reference data — not regulatory, customs or dangerous-goods compliance advice; classification, documentation and carrier acceptance remain your responsibility.

Related: cbm_calculator / chargeable_weight_calculator / ldm_calculator (single-figure versions), shipment_summary (adds vehicle/container suggestion and duty estimates), adr_lookup (what a flagged UN number is).`,

  schema: z.object({
    mode: z.enum(['sea', 'air', 'road']).optional().describe('Transport mode: sea | air | road. Default: road.'),
    lines: z.array(z.object({
      description: z.string().optional().describe('Optional item label.'),
      quantity: z.number().int().positive().describe('Number of identical pieces on this line.'),
      dims: z.object({
        l: z.number().positive().describe('Length in the given unit.'),
        w: z.number().positive().describe('Width in the given unit.'),
        h: z.number().positive().describe('Height in the given unit.'),
        unit: z.enum(['mm', 'cm', 'm', 'in']).describe('Dimension unit.'),
      }).describe('Per-piece dimensions with unit.'),
      weight: z.object({
        value: z.number().positive().describe('Gross weight per piece.'),
        unit: z.enum(['kg', 'g', 't', 'lb']).describe('Weight unit.'),
      }).describe('Per-piece weight with unit.'),
      hs_code: z.string().optional().describe('Optional HS commodity code (6-10 digits).'),
      un_number: z.string().optional().describe('Optional UN number — triggers the dangerous-goods advisory flag.'),
      stackable: z.boolean().optional().describe('Stack two-high (halves the loading-metre footprint).'),
    })).min(1).max(50).optional().describe('Canonical consignment lines (preferred, 1-50). Provide lines OR items.'),
    items: z.array(z.object({
      description: z.string().optional().describe('Item description.'),
      length: z.number().positive().describe('Length in cm.'),
      width: z.number().positive().describe('Width in cm.'),
      height: z.number().positive().describe('Height in cm.'),
      quantity: z.number().int().positive().optional().describe('Number of pieces. Default: 1.'),
      gross_weight: z.number().positive().describe('Gross weight per piece in kg.'),
      stackable: z.boolean().optional().describe('Can the item be stacked?'),
      pallet_type: z.enum(['none', 'euro', 'uk', 'us', 'custom']).optional().describe('Pallet type (informational).'),
    })).min(1).max(50).optional().describe('Legacy flat alias — dimensions in cm, weight in kg. Prefer lines.'),
    options: z.object({
      air_volumetric_divisor: z.number().positive().optional().describe('IATA volumetric divisor in cm³/kg. Default: 6000. Air mode only.'),
      container_number: z.string().optional().describe('ISO 6346 container number — check-digit validated into flags.'),
      awb_number: z.string().optional().describe('IATA 11-digit air waybill number — check-digit validated into flags.'),
    }).optional().describe('Optional settings.'),
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
  description: `Search 116,129 UN/LOCODE transport locations worldwide — ports, airports, rail and road terminals, inland container depots and border crossings. Codes are 5 characters: a 2-letter ISO country code + a 3-character location code (GBLHR = London Heathrow, NLRTM = Rotterdam).

Provide code for an exact record, or query (name search, min 2 chars) optionally narrowed by country and function_type; limit caps results (default 20, max 100).

Behavior: read-only; exact code hits are provenance-based while fuzzy name hits report match quality via the envelope's confidence (basis match_quality); an unknown code errors with a not-found message. ${RATE}

Returns: the location record(s) — code, name and name_ascii, country, subdivision, functions[], status, coordinates {lat, lon} and iata_code where assigned — under result, ${ENV}

Limitations: an administrative code list (UNECE UN/LOCODE 2024-2) — confirm operational status and coordinates with the port or authority before critical use.

Related: airport_lookup (airport-specific records including ICAO codes), nearest_airport (find airports by coordinates).`,

  schema: z.object({
    query: z.string().min(2, 'Query must be at least 2 characters').optional().describe('Location name search (min 2 chars). Examples: "rotterdam", "heathrow".'),
    code: z.string().regex(/^[A-Za-z0-9]{5}$/, 'UN/LOCODE must be 5 characters: 2-letter country + 3-char location (e.g. "GBLHR")').optional().describe('Exact UN/LOCODE — 5 characters. Examples: "GBLHR", "NLRTM".'),
    country: z.string().regex(/^[A-Za-z]{2}$/, 'Country must be a 2-letter ISO code (e.g. "GB", "NL")').optional().describe('Filter by 2-letter ISO country code. Examples: "GB", "NL".'),
    function_type: z.enum(['port', 'airport', 'rail', 'road', 'icd', 'border']).optional().describe('Filter by location function.'),
    limit: z.number().int().min(1).max(100).optional().describe('Maximum results. Default: 20, max: 100.'),
  }).strict(),

  resultSchema: resultShape({
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
    results: z.array(z.unknown()),
    audited_at: z.string(),
    verified: z.boolean(),
  }),

  annotations: readOnlyAnnotations('UN/LOCODE Lookup'),

  handler: async (args, opts) =>
    apiGet('unlocode', {
      q: args.query, code: args.code, country: args.country,
      function: args.function_type, limit: args.limit,
    }, opts),
};

// ─────────────────────────────────────────────────────────────
//  14. UK Import Duty & VAT Calculator
// ─────────────────────────────────────────────────────────────

const ukDutyCalculator: ToolDef = {
  name: 'uk_duty_calculator',
  description: `Estimate UK import duty and VAT for a commodity code using the LIVE GOV.UK Trade Tariff — rates are fetched per request, not from a static table. The CIF value is composed from customs_value + freight_cost + insurance_cost; duty = CIF x the duty rate for the origin country; VAT (typically 20%) applies on the duty-inclusive value.

Provide commodity_code (6-10 digits), origin_country (ISO-2) and customs_value in GBP; freight_cost, insurance_cost and incoterm are optional refinements.

Behavior: live lookup plus deterministic arithmetic on the returned rate; an unknown or non-declarable commodity code errors with HMRC's message (a 6-digit code may need extending to its 8/10-digit declarable line); origin-dependent measures the tariff cannot resolve automatically surface in warnings. ${RATE}

Returns: commodity_code and description, origin country, cif_value, duty_rate (+ percent), duty_amount, vat_rate, vat_amount, total_import_taxes, total_landed_cost and warnings under result; validity.as_of marks the live-rate timestamp; ${ENV}

Limitations: an estimate, not a customs ruling — excise, quotas, anti-dumping measures, reliefs and origin-proof requirements can change the outcome; confirm with a customs broker or HMRC before relying on it.

Related: hs_code_lookup (find the 6-digit code first), incoterms_lookup (who actually pays these costs).`,

  schema: z.object({
    commodity_code: z.string().regex(/^\d{6,10}$/, 'Commodity code must be 6–10 digits').describe('HS/UK tariff code, 6-10 digits. Example: "8471300000" (portable computers). 6-digit codes may need the declarable 8/10-digit line.'),
    origin_country: z.string().regex(/^[A-Za-z]{2}$/, 'Origin country must be a 2-letter ISO code (e.g., "CN", "DE")').describe('ISO 2-letter country of origin. Examples: "CN", "DE", "US".'),
    customs_value: z.number().positive().describe('Goods value in GBP. Example: 1000.'),
    freight_cost: z.number().optional().describe('Freight cost in GBP — added to the CIF value. Default: 0.'),
    insurance_cost: z.number().optional().describe('Insurance cost in GBP — added to the CIF value. Default: 0.'),
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
  description: `Composite shipment analysis in one call: volume (CBM), gross and chargeable weight, road LDM with pallet spaces and a vehicle suggestion (road mode), volumetric weight (air), revenue tonnes with a container suggestion (sea), dangerous-goods presence for items carrying un_number, and UK duty estimates for items carrying hs_code + customs_value.

Provide mode (road | air | sea | multimodal) and items[] (dims in cm, weight in kg, quantity; optional stackable, pallet_type, hs_code, un_number, customs_value); origin/destination and incoterm refine the duty leg.

Behavior: chains the same deterministic engines as the single-purpose tools; sections that cannot run (e.g. duty without a customs value) surface in warnings instead of failing the whole call. ${RATE}

Returns: mode, itemCount, totals {pieces, grossWeight, volumeCBM, chargeableWeight, billingBasis}, modeSpecific (LDM / pallet spaces / suggested vehicle, or revenue tonnes / container), warnings and dataVersion under result — note this composite's result uses camelCase field names (legacy shape); ${ENV}

Limitations: a planning summary, not a quotation or compliance determination.

Related: consignment_calculator (canonical snake_case lines[] shape with advisory flags), cbm_calculator, chargeable_weight_calculator, ldm_calculator, adr_lookup, uk_duty_calculator (the engines this chains).`,

  schema: z.object({
    mode: z.enum(['road', 'air', 'sea', 'multimodal']).describe('Transport mode — selects the mode-specific section of the result.'),
    items: z.array(z.object({
      description: z.string().optional().describe('Optional item label.'),
      length: z.number().positive().describe('Length in cm.'),
      width: z.number().positive().describe('Width in cm.'),
      height: z.number().positive().describe('Height in cm.'),
      weight: z.number().describe('Gross weight per item in kg.'),
      quantity: z.number().int().positive().describe('Number of items.'),
      stackable: z.boolean().optional().describe('Whether this item can be stacked (affects pallet fitting).'),
      pallet_type: z.enum(['euro', 'uk', 'us', 'custom', 'none']).optional().describe('Pallet standard the item sits on, if any.'),
      hs_code: z.string().optional().describe('HS code — enables the duty section together with customs_value.'),
      un_number: z.string().optional().describe('UN number — enables the dangerous-goods section.'),
      customs_value: z.number().optional().describe('Customs value per item in GBP — enables the duty section.'),
    })).describe('Shipment items with dimensions, weight and optional HS/UN codes.'),
    origin: z.object({ country: z.string(), locode: z.string().optional() }).optional().describe('Origin — ISO country code and optional UN/LOCODE.'),
    destination: z.object({ country: z.string(), locode: z.string().optional() }).optional().describe('Destination — ISO country code and optional UN/LOCODE.'),
    incoterm: z.string().optional().describe('Incoterms 2020 three-letter code. Examples: "DAP", "EXW", "FOB".'),
    freight_cost: z.number().optional().describe('Freight cost in GBP for the duty calculation.'),
    insurance_cost: z.number().optional().describe('Insurance cost in GBP for the duty calculation.'),
  }).strict(),

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
    apiPost('shipment/summary', {
      mode: args.mode,
      items: (args.items as Array<Record<string, unknown>>).map((i) => ({
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
        customsValue: i.customs_value,
      })),
      origin: args.origin,
      destination: args.destination,
      incoterm: args.incoterm,
      freightCost: args.freight_cost,
      insuranceCost: args.insurance_cost,
    }, opts),
};

// ─────────────────────────────────────────────────────────────
//  16. ULD Lookup
// ─────────────────────────────────────────────────────────────

const uldLookup: ToolDef = {
  name: 'uld_lookup',
  description: `Look up air-cargo ULD (Unit Load Device) specifications — 15 types spanning lower-deck containers (AKE/LD3 and family), main-deck pallets (PMC, PAG and family) and temperature-controlled units. Each record carries external/internal/door dimensions (cm), tare and max gross weight (kg), usable volume (m³), deck position and compatible aircraft.

Provide type as an IATA code ("AKE", "PMC") or slug ("ake-ld3"); omit it to list all 15; category (container | pallet | special) and deck (lower | main) filter the list.

Behavior: read-only; an unknown type errors with the valid list; per-record provenance (sources, audited_at, decision_rationale) is included. ${RATE}

Returns: the ULD record (or filtered list) under result, ${ENV}

Limitations: manufacturer-typical specs, provenance pending independent verification (the envelope's provenance_status says so) — airline-specific ULD variants differ; confirm with the carrier.

Related: chargeable_weight_calculator (what the cargo inside is billed at), container_lookup (the sea-freight equivalent), airline_lookup (whose aircraft it flies on).`,

  schema: z.object({
    type: z.string().min(2, 'ULD type must be at least 2 characters').optional().describe('IATA ULD code or slug. Examples: "AKE", "PMC", "ake-ld3". Omit to list all 15.'),
    category: z.enum(['container', 'pallet', 'special']).optional().describe('Filter by ULD category.'),
    deck: z.enum(['lower', 'main']).optional().describe('Filter by deck position.'),
  }).strict(),

  resultSchema: resultShape({
    result: z.record(z.string(), z.unknown()),
    results: z.array(z.unknown()),
    count: z.number(),
    meta: z.record(z.string(), z.unknown()),
  }),

  annotations: readOnlyAnnotations('Air Cargo ULD Lookup'),

  handler: async (args, opts) =>
    apiGet('uld', { type: args.type, category: args.category, deck: args.deck }, opts),
};

// ─────────────────────────────────────────────────────────────
//  17. Vehicle & Trailer Lookup
// ─────────────────────────────────────────────────────────────

const vehicleLookup: ToolDef = {
  name: 'vehicle_lookup',
  description: `Look up road-freight vehicle and trailer specifications — 17 types: EU articulated trailers (standard/mega curtainsider, box, reefer, double-deck, flatbed, low-loader), US 53ft/48ft dry vans, rigid trucks (7.5-26 t) and vans (Luton, Transit, Sprinter). Each record carries internal dimensions, payload and gross weights, euro/UK pallet capacity, axle configuration and features.

Provide slug (e.g. "standard-curtainsider") for one record; omit it to list all 17; category (articulated | rigid | van) and region (EU | US) filter the list.

Behavior: read-only; an unknown slug errors with the valid list; per-record provenance (sources, audited_at, decision_rationale) is included. ${RATE}

Returns: the vehicle record (or filtered list) under result, ${ENV}

Limitations: typical specs, provenance pending independent verification (the envelope's provenance_status says so) — real equipment varies by operator and build; legal payload is set by the vehicle's plated weights.

Related: ldm_calculator (whether a pallet load fits), pallet_fitting_calculator, consignment_calculator.`,

  schema: z.object({
    slug: z.string().min(2, 'Vehicle slug must be at least 2 characters').optional().describe('Vehicle slug. Examples: "standard-curtainsider", "mega-trailer". Omit to list all 17.'),
    category: z.enum(['articulated', 'rigid', 'van']).optional().describe('Filter by vehicle category.'),
    region: z.enum(['EU', 'US']).optional().describe('Filter by region.'),
  }).strict(),

  resultSchema: resultShape({
    result: z.record(z.string(), z.unknown()),
    results: z.array(z.unknown()),
    count: z.number(),
    meta: z.record(z.string(), z.unknown()),
  }),

  annotations: readOnlyAnnotations('Vehicle Lookup'),

  handler: async (args, opts) =>
    apiGet('vehicles', { slug: args.slug, category: args.category, region: args.region }, opts),
};

// ─────────────────────────────────────────────────────────────
//  18. ADR Limited/Excepted Quantity Check
// ─────────────────────────────────────────────────────────────

const adrLqEqCheck: ToolDef = {
  name: 'adr_lq_eq_check',
  description: `Check whether dangerous goods qualify for ADR Limited Quantity (LQ, ADR 3.4) or Excepted Quantity (EQ, ADR 3.5) relief. LQ compares each item's per-inner-packaging quantity against that substance's LQ maximum; EQ resolves the substance's E-code (E0-E5) and checks the per-inner limit, plus the per-outer limit when inner_packaging_qty is given.

Provide mode ("lq" or "eq") and 1-20 items, each with un_number, quantity and unit — ml or L for liquids, g or kg for solids; quantity is per INNER packaging, not the whole load.

Behavior: deterministic reference check; each item gets a status and reason (an LQ value of "0" or code E0 means the relief is not permitted for that substance), with overall_status and summary counts across the batch. ${RATE}

Returns: mode, overall_status, items[] (un_number, substance, class, packing_group, lq_limit or eq_code, quantity_entered, status, reason), summary {total_items, qualifying, exceeding, not_permitted} and the ADR chapter references under result, ${ENV}

Limitations: a quantity-threshold check only — LQ/EQ relief also requires packaging, marking and documentation conformity that this tool does not assess; not legal advice, verify against the current UNECE ADR text.

Related: adr_lookup (the per-substance LQ/EQ values), adr_exemption_calculator (the 1.1.3.6 load-points route instead).`,

  schema: z.object({
    mode: z.enum(['lq', 'eq']).describe('Check mode: "lq" (Limited Quantity, ADR 3.4) or "eq" (Excepted Quantity, ADR 3.5).'),
    items: z.array(z.object({
      un_number: z.string().regex(/^(UN)?\d{4}$/i, 'UN number must be 4 digits, optionally prefixed with "UN"').describe('UN number — 4 digits, optionally "UN"-prefixed; explosives keep the leading zero. Examples: "1203", "UN1263".'),
      quantity: z.number().positive().describe('Quantity per INNER packaging, in the chosen unit. Example: 0.5.'),
      unit: z.enum(['ml', 'L', 'g', 'kg']).describe('Unit: "ml" or "L" for liquids, "g" or "kg" for solids.'),
      inner_packaging_qty: z.number().int().positive().optional().describe('EQ mode only: number of inner packagings per outer package, for the per-outer limit check. Example: 10.'),
    })).min(1).max(20).describe('Items to check (1-20 per call).'),
  }).strict(),

  resultSchema: resultShape({
    mode: z.string(),
    overall_status: z.string(),
    items: z.array(loose({
      un_number: z.string(),
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
    })),
    summary: loose({
      total_items: z.number(),
      qualifying: z.number(),
      exceeding: z.number(),
      not_permitted: z.number(),
    }),
    references: z.record(z.string(), z.unknown()),
  }),

  annotations: readOnlyAnnotations('ADR LQ / EQ Exemption Check'),

  handler: async (args, opts) =>
    apiPost('adr/lq-check', { mode: args.mode, items: args.items }, opts),
};

// ─────────────────────────────────────────────────────────────
//  19. Get Subscribe Link
// ─────────────────────────────────────────────────────────────

const getSubscribeLink: ToolDef = {
  name: 'get_subscribe_link',
  description: `Get the URL where the user can subscribe to FreightUtils Pro for higher API limits (50,000 requests/month). Use when the user asks how to upgrade or about pricing, or after any other tool errors with a 429 rate_limited body.

Behavior: static local response — no API call, never rate-limited.

Returns: url, tier, monthly_limit, monthly_price, currency and note under result. Hand the URL to the USER to open in a browser — agents must NOT attempt to complete the subscription themselves.`,

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

  annotations: readOnlyAnnotations('FreightUtils Subscribe Link'),

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
  description: `Estimate freight transport greenhouse-gas emissions (kgCO2e) for a shipment leg, per ISO 14083:2023 / GLEC Framework v3.2: emissions = mass x distance x a published emission-intensity factor (kgCO2e/tonne-km).

Provide mass + distance_km + mode (road | rail | sea | air | inland_waterway); optionally choose sub_mode, region/authority (uk = DEFRA, us = EPA, fr = ADEME) and basis (wtw default, or ttw). IMPORTANT: pass ACTUAL GROSS MASS, not chargeable/volumetric weight (a common air-freight mistake — see mass_basis in the result). Distance must be provided — this tool does NOT route, geocode, or compute distances.

Behavior: deterministic given the same factor edition; the fleet-average factor already includes average empty running (see empty_running) — do NOT add your own empty-return leg; sea and air are low-representativeness generic defaults (real emissions vary materially by vessel/aircraft, load factor and routing — see representativeness and the result summary). An unknown mode/sub_mode/region returns available:false with the covered options, never a fabricated factor. ${RATE}

Returns: well-to-wheel AND tank-to-wheel emissions where the factor has both, the exact factor used (value, authority, edition), the tonne-km activity and a per-result _source citing BOTH the ISO method and the specific open factor, all under result, ${ENV}

Limitations: best-effort reference estimate from open factors (DEFRA / EPA / ADEME) — NOT a verified or audited carbon report.

Related: distinct from cbm_calculator / ldm_calculator / chargeable_weight_calculator (those size or bill a shipment; this one estimates its CO2e).`,

  schema: z.object({
    mass: z.number().positive().describe('Shipment mass, expressed in mass_unit. Example: 1000.'),
    mass_unit: z.enum(['kg', 'tonnes']).optional().describe('Unit for mass. Default: kg.'),
    distance_km: z.number().positive().describe('Transport distance in kilometres — you provide it; the tool does not route.'),
    mode: z.enum(['road', 'rail', 'sea', 'air', 'inland_waterway']).describe('Transport mode.'),
    sub_mode: z.string().optional().describe('Optional sub-mode / vehicle class (e.g. "articulated", "container ship", "long-haul"). Omit for the representative default.'),
    region: z.enum(['uk', 'us', 'fr']).optional().describe('Factor source/region: uk = DEFRA, us = EPA, fr = ADEME. Default is per-mode.'),
    basis: z.enum(['wtw', 'ttw']).optional().describe('Emissions basis: wtw = well-to-wheel incl. upstream (default), ttw = tank-to-wheel / operation only.'),
  }).strict(),

  resultSchema: resultShape({
    available: z.boolean(),
    methodology: z.string(),
    disclaimer: z.string(),
    inputs: z.record(z.string(), z.unknown()),
    tonne_km: z.number(),
    factor: loose({
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

const identifierValidator: ToolDef = {
  name: 'validate',
  description: `Validate and parse freight identifiers by their public check-digit algorithms: shipping container numbers (ISO 6346), air waybill (AWB) numbers (IATA modulus-7) and IMO ship identification numbers.

Two modes: pass text=<arbitrary string> to find and validate every identifier in it (e.g. a booking-email line), OR pass value=<identifier> + type=<container|awb|imo> to validate one.

Behavior: deterministic check-digit arithmetic; per identifier found it reports type, the normalised form, valid (pass/fail), expected vs actual check digit, and details (container: owner prefix + equipment category; AWB: airline prefix + the operating airline resolved from the AWB-prefix dataset; IMO: the 7-digit number); text mode with no identifiers found returns an empty found[] with a note. ${RATE}

Returns: found[] (each entry with its own _source naming the standard applied) and disclaimer under result, ${ENV}

Limitations: STRUCTURAL ONLY — a valid check digit means well-formed, NOT that the container, shipment or vessel exists or is active; not a registry or tracking lookup.

Related: container_lookup (container TYPE specs, not numbers), airline_lookup (the AWB-prefix dataset the airline resolution uses).`,

  schema: z.object({
    text: z.string().optional().describe('Arbitrary string to scan for container / AWB / IMO identifiers (parse mode). Provide this OR value+type. Example: "2 cntrs MSKU3068808 / TGHU7654325 on AWB 176-12345675".'),
    value: z.string().optional().describe('A single identifier to validate (typed mode). Requires type. Example: "MSKU3068808".'),
    type: z.enum(['container', 'awb', 'imo']).optional().describe('Identifier type for value: container = ISO 6346, awb = IATA air waybill, imo = IMO ship number.'),
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
    })),
    disclaimer: z.string(),
    note: z.string(),
  }),

  richText: true,

  annotations: readOnlyAnnotations('Freight Identifier Validator'),

  handler: async (args, opts) =>
    apiGet('validate', { text: args.text, value: args.value, type: args.type }, opts),

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
  description: `Check a goods description against the official EU ICS2 stop-words list — terms the European Commission deems too vague or generic for an entry summary declaration (ENS) goods-description field (data element 18 05 000 000).

Pass description=<goods description>. Behavior: deterministic term matching against the in-force EU list; each flagged term carries a note (a standalone stop-word means automatic rejection, an embedded one means make the description more specific); clean=true means no listed term matched — it does NOT guarantee acceptance, and no binary accepted/rejected verdict is given. ${RATE}

Returns: the description echo, flagged[] (term + note), clean, caveat and disclaimer under result, plus a _source citing the EU list and legal basis, ${ENV}

Limitations: STRICTLY a reference check — not an ENS filing, not a customs-compliance determination, not legal advice; the EU list is non-exhaustive and updated periodically.

Related: hs_code_lookup (commodity codes — a different field of the ENS), uk_duty_calculator (duty/VAT, unrelated to ENS screening). Use BEFORE filing an ENS — for customs/documentation teams, brokers and agents building filing pipelines.`,

  schema: z.object({
    description: z.string().describe('The goods description to check. Example: "gifts" (flagged) vs "wooden toys for retail" (specific).'),
  }).strict(),

  resultSchema: resultShape({
    description: z.string(),
    flagged: z.array(loose({ term: z.string(), note: z.string() })),
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
});
const airportCitation = (result: unknown) => {
  const r = result as { _source?: { citeShort?: string; authority?: string } };
  const s = r._source ?? {};
  return `Source: ${s.authority ?? 'OurAirports (public domain)'} — cross-checked vs OpenFlights + Wikidata — via freightutils.com`;
};

const airportLookup: ToolDef = {
  name: 'airport_lookup',
  description: `Look up an airport by IATA code (3 letters, e.g. "LHR"), ICAO code (4 chars, e.g. "EGLL"), or free-text name/city search (e.g. "heathrow"). Covers 85,555 airports worldwide (OurAirports, public domain, cross-checked vs OpenFlights + Wikidata).

Provide ONE of iata, icao, or query; the optional type filter narrows results. Behavior: read-only; exact code hits return one record; ambiguous name searches return ranked candidates (exact codes first, then larger airports) with match quality reported via the envelope's confidence (basis match_quality); an unknown code errors with a not-found message. ${RATE}

Returns: count and results[] — per airport: IATA + ICAO/ident, name, type (large/medium/small/heliport/closed/seaplane), municipality, region, country, latitude/longitude and elevation_ft — under result, ${ENV}

Limitations: reference data only — not for navigation; verify operationally critical codes with IATA / ICAO.

Related: nearest_airport (find airports FROM a coordinate), airline_lookup (searches CARRIERS / AWB prefixes, not airports), unlocode_lookup (general transport locations, of which airports are one function).`,
  schema: z.object({
    iata: z.string().regex(/^[A-Za-z]{3}$/, 'IATA code must be 3 letters (e.g. "LHR")').optional().describe('Exact 3-letter IATA code. Example: "LHR".'),
    icao: z.string().regex(/^[A-Za-z0-9]{4}$/, 'ICAO code must be 4 characters (e.g. "EGLL")').optional().describe('Exact 4-character ICAO / ident. Example: "EGLL".'),
    query: z.string().min(2, 'Query must be at least 2 characters').optional().describe('Name / city / municipality search (min 2 chars). Example: "heathrow".'),
    type: airportTypeEnum.optional().describe('Optional filter by airport type.'),
  }).strict(),
  resultSchema: resultShape({
    count: z.number(),
    results: z.array(airportRecord),
    disclaimer: z.string(),
    meta: z.record(z.string(), z.unknown()),
  }),
  richText: true,
  annotations: readOnlyAnnotations('Airport Code Lookup'),
  handler: async (args, opts) => apiGet('airports', { iata: args.iata, icao: args.icao, q: args.query, type: args.type }, opts),
  citation: airportCitation,
};

const nearestAirport: ToolDef = {
  name: 'nearest_airport',
  description: `Find the airports nearest to a caller-provided latitude/longitude, sorted by great-circle (haversine) distance with distance_km on each result. Searches 85,555 airports (OurAirports, public domain).

Provide latitude and longitude (decimal degrees); optional radius_km, max_results (1-50, default 10) and type filter (e.g. large_airport only). Coordinates are INPUT only — nothing is stored or logged.

Behavior: deterministic distance sort; confidence reflects proximity and airport size (a large airport within 25 km scores high; closed/heliport/seaplane results cap lower). This tool does NOT geocode place names and does NOT compute routes — pass coordinates you already hold. ${RATE}

Returns: count and results[] (the airport record plus distance_km) under result, ${ENV}

Limitations: reference data only — not for navigation; verify codes with IATA / ICAO.

Related: airport_lookup (exact code or name lookup, no distance), unlocode_lookup (named transport-location search).`,
  schema: z.object({
    latitude: z.number().min(-90).max(90).describe('Latitude in decimal degrees (-90 to 90). Example: 51.47.'),
    longitude: z.number().min(-180).max(180).describe('Longitude in decimal degrees (-180 to 180). Example: -0.4543.'),
    radius_km: z.number().positive().optional().describe('Maximum distance in kilometres — omit for no radius cap.'),
    max_results: z.number().int().min(1).max(50).optional().describe('Maximum results (1-50). Default: 10.'),
    type: airportTypeEnum.optional().describe('Optional filter by airport type. Example: "large_airport".'),
  }).strict(),
  resultSchema: resultShape({
    count: z.number(),
    results: z.array(airportRecord),
    disclaimer: z.string(),
    meta: z.record(z.string(), z.unknown()),
  }),
  richText: true,
  annotations: readOnlyAnnotations('Nearest Airport'),
  handler: async (args, opts) => apiGet('nearest-airport', {
    lat: args.latitude, lon: args.longitude,
    radius_km: args.radius_km, max_results: args.max_results, type: args.type,
  }, opts),
  citation: airportCitation,
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
  getSubscribeLink,
];
