import { z } from 'zod';
import { apiGet, apiPost } from './api.js';

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
  handler: (args: Record<string, unknown>) => Promise<unknown>;
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


// ─────────────────────────────────────────────────────────────
//  1. CBM Calculator
// ─────────────────────────────────────────────────────────────

const cbmCalculator: ToolDef = {
  name: 'cbm_calculator',
  description: `Calculate cubic metres (CBM) for a shipment.

CBM is the standard volume unit in international shipping. One CBM = 1m x 1m x 1m = 1,000 litres. Ocean freight carriers price per "freight tonne" (1 CBM or 1,000 kg, whichever is greater).

Use this tool when you need to:
- Calculate the volume of a shipment for sea freight quoting
- Convert dimensions to CBM, cubic feet, or litres
- Determine freight tonnes for ocean shipping

Input dimensions in centimetres. Specify pieces to get total volume for multiple identical items.`,

  schema: z.object({
    length_cm: z.number().positive().describe('Length in centimetres'),
    width_cm: z.number().positive().describe('Width in centimetres'),
    height_cm: z.number().positive().describe('Height in centimetres'),
    pieces: z.number().int().positive().optional().describe('Number of identical pieces (default: 1)'),
  }).strict(),

  annotations: readOnlyAnnotations('CBM Calculator'),

  handler: async (args) =>
    apiGet('cbm', { l: args.length_cm, w: args.width_cm, h: args.height_cm, pcs: args.pieces }),
};

// ─────────────────────────────────────────────────────────────
//  2. Chargeable Weight Calculator
// ─────────────────────────────────────────────────────────────

const chargeableWeightCalculator: ToolDef = {
  name: 'chargeable_weight_calculator',
  description: `Calculate air freight chargeable weight (volumetric vs actual).

Airlines charge by "chargeable weight" — the greater of actual weight or volumetric weight. The IATA standard volumetric factor is 6,000 (1 CBM = 166.67 kg). Some carriers use different factors (e.g., 5,000 for DHL).

Use this tool when you need to:
- Quote air freight shipments
- Determine if a shipment is charged by volume or weight
- Compare volumetric factors across carriers

A ratio > 1.0 means the shipment is "volumetric" (light for its size). A ratio < 1.0 means it's "heavy" (dense cargo).`,

  schema: z.object({
    length_cm: z.number().positive().describe('Length in centimetres'),
    width_cm: z.number().positive().describe('Width in centimetres'),
    height_cm: z.number().positive().describe('Height in centimetres'),
    gross_weight_kg: z.number().positive().describe('Actual gross weight in kilograms'),
    pieces: z.number().int().positive().optional().describe('Number of identical pieces (default: 1)'),
    factor: z.number().int().positive().optional().describe('Volumetric divisor (default: 6000 IATA standard, DHL uses 5000)'),
  }).strict(),

  annotations: readOnlyAnnotations('Chargeable Weight Calculator'),

  handler: async (args) =>
    apiGet('chargeable-weight', {
      l: args.length_cm, w: args.width_cm, h: args.height_cm,
      gw: args.gross_weight_kg, pcs: args.pieces, factor: args.factor,
    }),
};

// ─────────────────────────────────────────────────────────────
//  3. LDM Calculator
// ─────────────────────────────────────────────────────────────

const ldmCalculator: ToolDef = {
  name: 'ldm_calculator',
  description: `Calculate loading metres (LDM) for road freight shipments.

LDM measures how much of a trailer's length a pallet load occupies. European trailers are 13.6m long and 2.4m wide. LDM = (pallet_length x pallet_width x quantity) / (trailer_width x stack_factor).

Use this tool when you need to:
- Quote European road freight (FTL/LTL)
- Calculate trailer utilisation percentage
- Check if pallets fit within vehicle weight/space limits

Supports pallet presets (euro, uk, half, quarter) or custom dimensions. Supports vehicles: artic (13.6m), rigid10, rigid75, luton, or custom length.`,

  schema: z.object({
    pallet: z.enum(['euro', 'uk', 'half', 'quarter']).optional()
      .describe('Pallet preset. Euro=1200x800mm, UK=1200x1000mm, Half=800x600mm, Quarter=600x400mm'),
    length_mm: z.number().positive().optional().describe('Custom pallet length in mm (use instead of preset)'),
    width_mm: z.number().positive().optional().describe('Custom pallet width in mm (use instead of preset)'),
    quantity: z.number().int().positive().optional().describe('Number of pallets (default: 1)'),
    stackable: z.boolean().optional().describe('Can pallets be stacked? (default: false)'),
    stack_height: z.number().int().min(2).max(3).optional().describe('Stack height: 2 or 3 (default: 2)'),
    weight_kg: z.number().positive().optional().describe('Weight per pallet in kg'),
    vehicle: z.enum(['artic', 'rigid10', 'rigid75', 'luton', 'custom']).optional()
      .describe('Vehicle type (default: artic 13.6m)'),
    vehicle_length_m: z.number().positive().optional()
      .describe('Custom vehicle length in metres (required if vehicle=custom)'),
  }).strict(),

  annotations: readOnlyAnnotations('LDM Calculator'),

  handler: async (args) =>
    apiGet('ldm', {
      pallet: args.pallet, length: args.length_mm, width: args.width_mm,
      qty: args.quantity, stackable: args.stackable, stack: args.stack_height,
      weight: args.weight_kg, vehicle: args.vehicle, vehicle_length: args.vehicle_length_m,
    }),
};

// ─────────────────────────────────────────────────────────────
//  4. ADR Lookup
// ─────────────────────────────────────────────────────────────

const adrLookup: ToolDef = {
  name: 'adr_lookup',
  description: `Look up dangerous goods (hazmat) information from the ADR 2025 database.

ADR is the European agreement for international carriage of dangerous goods by road. This tool searches 2,939 entries covering all 9 hazard classes.

Use this tool when you need to:
- Find the hazard class, packing group, and labels for a UN number
- Search dangerous goods by name (e.g., "petrol", "lithium batteries")
- Get tunnel restriction codes and transport categories
- Check limited quantity allowances

Provide a UN number for exact lookup, or a search term for name-based search.`,

  schema: z.object({
    un_number: z.string().regex(/^(UN)?\d{4}$/i, 'UN number must be 4 digits, optionally prefixed with "UN" (e.g., "1203" or "UN1203")').optional().describe('UN number (e.g., "1203", "UN1203")'),
    search: z.string().min(2, 'Search term must be at least 2 characters').optional().describe('Search by substance name (min 2 characters)'),
    hazard_class: z.string().optional().describe('Filter by hazard class (e.g., "3" for flammable liquids)'),
  }).strict(),

  annotations: readOnlyAnnotations('ADR Dangerous Goods Lookup'),

  handler: async (args) =>
    apiGet('adr', { un: args.un_number, q: args.search, class: args.hazard_class }),
};

// ─────────────────────────────────────────────────────────────
//  5. ADR Exemption Calculator
// ─────────────────────────────────────────────────────────────

const adrExemptionCalculator: ToolDef = {
  name: 'adr_exemption_calculator',
  description: `Calculate ADR 1.1.3.6 exemption thresholds for mixed hazardous loads.

ADR 1.1.3.6 allows reduced requirements when the total "points" of a mixed load are 1,000 or below. Each substance is assigned to a transport category (0-4) with a multiplier. Points = quantity x multiplier.

Use this tool when you need to:
- Check if a load of dangerous goods qualifies for the small load exemption
- Calculate total ADR points for a mixed load
- Determine if full ADR compliance is required

For single substances, provide un_number + quantity. For mixed loads, use the items array.`,

  schema: z.object({
    un_number: z.string().regex(/^(UN)?\d{4}$/i, 'UN number must be 4 digits, optionally prefixed with "UN"').optional().describe('UN number for single-substance check'),
    quantity: z.number().positive().optional().describe('Quantity in kg or litres for single-substance check'),
    items: z.array(z.object({
      un_number: z.string().regex(/^(UN)?\d{4}$/i, 'UN number must be 4 digits, optionally prefixed with "UN"').describe('UN number'),
      quantity: z.number().positive().describe('Quantity in kg or litres'),
    })).optional().describe('Array of items for mixed-load calculation (use instead of single un_number/quantity)'),
  }).strict(),

  annotations: readOnlyAnnotations('ADR 1.1.3.6 Exemption Calculator'),

  handler: async (args) => {
    if (args.items) {
      return apiPost('adr-calculator', { items: args.items });
    }
    return apiGet('adr-calculator', { un: args.un_number, qty: args.quantity });
  },
};

// ─────────────────────────────────────────────────────────────
//  6. Airline Lookup
// ─────────────────────────────────────────────────────────────

const airlineLookup: ToolDef = {
  name: 'airline_lookup',
  description: `Search 6,352 airlines by name, IATA/ICAO code, AWB prefix, or country.

Use this tool when you need to:
- Find an airline's IATA code, ICAO code, or air waybill (AWB) prefix
- Verify airline cargo capabilities
- Look up airlines by country

AWB prefixes are 3-digit codes used on air waybills to identify the issuing carrier (e.g., 176 = Emirates).`,

  schema: z.object({
    query: z.string().min(2, 'Query must be at least 2 characters').optional().describe('General search (name, code, prefix, or country — min 2 chars)'),
    iata: z.string().regex(/^[A-Za-z0-9]{2}$/, 'IATA code must be 2 letters or digits (e.g., "EK", "U2")').optional().describe('Exact IATA code (2 alphanumeric chars)'),
    icao: z.string().regex(/^[A-Za-z]{3}$/, 'ICAO code must be 3 letters (e.g., "UAE", "BAW")').optional().describe('Exact ICAO code (3 letters)'),
    prefix: z.string().regex(/^\d{3}$/, 'AWB prefix must be exactly 3 digits').optional().describe('AWB prefix (3 digits, e.g., "176")'),
    country: z.string().min(2, 'Country must be at least 2 characters').optional().describe('Filter by country name (min 2 chars)'),
  }).strict(),

  annotations: readOnlyAnnotations('Airline / AWB Prefix Lookup'),

  handler: async (args) =>
    apiGet('airlines', {
      q: args.query, iata: args.iata, icao: args.icao,
      prefix: args.prefix, country: args.country,
    }),
};

// ─────────────────────────────────────────────────────────────
//  7. Container Lookup
// ─────────────────────────────────────────────────────────────

const containerLookup: ToolDef = {
  name: 'container_lookup',
  description: `Get ISO shipping container specifications and calculate loading.

Covers 10 container types: 20ft standard, 40ft standard, 40ft high-cube, 20ft/40ft reefer, 20ft/40ft open-top, 20ft/40ft flat-rack, and 45ft high-cube.

Use this tool when you need to:
- Get internal dimensions, capacity (CBM), and weight limits
- Find how many euro/GMA pallets fit in a container
- Calculate how many items of a given size fit inside

Provide a container type for specs. Add item dimensions (l, w, h in cm) to calculate loading.`,

  schema: z.object({
    type: z.string().min(2, 'Container type must be at least 2 characters').optional()
      .describe('Container slug (e.g., "20ft-standard", "40ft-high-cube"). Omit to list all types.'),
    item_length_cm: z.number().positive().optional().describe('Item length in cm (for loading calculation)'),
    item_width_cm: z.number().positive().optional().describe('Item width in cm'),
    item_height_cm: z.number().positive().optional().describe('Item height in cm'),
    item_weight_kg: z.number().positive().optional().describe('Item weight in kg'),
    item_quantity: z.number().int().positive().optional().describe('Number of items'),
  }).strict(),

  annotations: readOnlyAnnotations('Container Lookup'),

  handler: async (args) =>
    apiGet('containers', {
      type: args.type, l: args.item_length_cm, w: args.item_width_cm,
      h: args.item_height_cm, wt: args.item_weight_kg, qty: args.item_quantity,
    }),
};

// ─────────────────────────────────────────────────────────────
//  8. HS Code Lookup
// ─────────────────────────────────────────────────────────────

const hsCodeLookup: ToolDef = {
  name: 'hs_code_lookup',
  description: `Search 6,940 Harmonized System (HS) tariff codes.

HS codes are 6-digit international product classification codes used for customs declarations and duty calculations. The first 2 digits = chapter, 4 digits = heading, 6 digits = subheading.

Use this tool when you need to:
- Find the HS code for a product (e.g., "laptop", "olive oil")
- Get the tariff classification hierarchy (section → chapter → heading → subheading)
- Browse HS sections (I through XXI)

Provide a search term for description-based search, or an exact HS code for detailed lookup.`,

  schema: z.object({
    query: z.string().min(2, 'Search term must be at least 2 characters').optional().describe('Search by product description (min 2 chars)'),
    code: z.string().regex(/^\d{2,6}$/, 'HS code must be 2–6 digits').optional().describe('Exact HS code lookup (2-6 digits)'),
    section: z.string().regex(/^[ivxIVX]{1,5}$/, 'Section must be a Roman numeral I–XXI').optional().describe('Browse by section (Roman numeral I–XXI, e.g., "II")'),
  }).strict(),

  annotations: readOnlyAnnotations('HS Code Lookup'),

  handler: async (args) =>
    apiGet('hs', { q: args.query, code: args.code, section: args.section }),
};

// ─────────────────────────────────────────────────────────────
//  9. Incoterms Lookup
// ─────────────────────────────────────────────────────────────

const incotermsLookup: ToolDef = {
  name: 'incoterms_lookup',
  description: `Look up Incoterms 2020 trade rules.

Incoterms define who pays for what in international trade — transport, insurance, customs clearance, and risk transfer. There are 11 rules: 7 for any transport mode (EXW, FCA, CPT, CIP, DAP, DPU, DDP) and 4 for sea/inland waterway only (FAS, FOB, CFR, CIF).

Use this tool when you need to:
- Explain what an Incoterm means (e.g., "What does FOB mean?")
- Compare seller vs buyer responsibilities
- Determine risk and cost transfer points
- Check which Incoterms apply to sea freight vs any mode`,

  schema: z.object({
    code: z.string().regex(/^[A-Za-z]{3}$/, 'Incoterm code must be 3 letters (e.g., "FOB", "CIF", "EXW")').optional().describe('Incoterm code (3 letters, e.g., "FOB", "CIF", "EXW")'),
    category: z.enum(['any_mode', 'sea_only']).optional().describe('Filter by transport mode category'),
  }).strict(),

  annotations: readOnlyAnnotations('Incoterms 2020 Lookup'),

  handler: async (args) =>
    apiGet('incoterms', { code: args.code, category: args.category }),
};

// ─────────────────────────────────────────────────────────────
//  10. Pallet Fitting Calculator
// ─────────────────────────────────────────────────────────────

const palletFittingCalculator: ToolDef = {
  name: 'pallet_fitting_calculator',
  description: `Calculate how many boxes fit on a pallet (layers, rotation, weight limits).

This tool determines the optimal arrangement of identical boxes on a pallet, accounting for:
- Layer-by-layer stacking up to the max height
- 90-degree rotation to find the best fit
- Weight capacity limits
- Volume utilisation percentage

Use this tool when you need to:
- Plan pallet loading for warehouse/shipping
- Calculate total boxes per pallet
- Check if weight limits will be reached before space runs out`,

  schema: z.object({
    pallet_length_cm: z.number().positive().describe('Pallet length in cm'),
    pallet_width_cm: z.number().positive().describe('Pallet width in cm'),
    pallet_max_height_cm: z.number().positive().describe('Maximum stack height in cm (including pallet deck)'),
    pallet_deck_height_cm: z.number().positive().optional().describe('Pallet deck height in cm (default: 15)'),
    box_length_cm: z.number().positive().describe('Box length in cm'),
    box_width_cm: z.number().positive().describe('Box width in cm'),
    box_height_cm: z.number().positive().describe('Box height in cm'),
    box_weight_kg: z.number().positive().optional().describe('Box weight in kg'),
    max_payload_kg: z.number().positive().optional().describe('Maximum pallet payload weight in kg'),
    allow_rotation: z.boolean().optional().describe('Allow 90-degree box rotation (default: true)'),
  }).strict(),

  annotations: readOnlyAnnotations('Pallet Fitting Calculator'),

  handler: async (args) =>
    apiGet('pallet', {
      pl: args.pallet_length_cm, pw: args.pallet_width_cm, pmh: args.pallet_max_height_cm,
      ph: args.pallet_deck_height_cm, bl: args.box_length_cm, bw: args.box_width_cm,
      bh: args.box_height_cm, bwt: args.box_weight_kg, mpw: args.max_payload_kg,
      rotate: args.allow_rotation,
    }),
};

// ─────────────────────────────────────────────────────────────
//  11. Unit Converter
// ─────────────────────────────────────────────────────────────

const unitConverter: ToolDef = {
  name: 'unit_converter',
  description: `Convert between freight and logistics units.

Supports weight (kg, lbs, oz, tonnes, short_tons, long_tons), volume (cbm, cuft, cuin, litres, gal_us, gal_uk), length (cm, inches, m, feet, mm), and freight-specific conversions (cbm→chargeable_kg, cbm→freight_tonnes).

Use this tool when you need to:
- Convert between metric and imperial units
- Calculate freight tonnes from CBM (1 CBM = 1 freight tonne = 1,000 kg)
- Convert CBM to chargeable weight for air freight quoting

Note: Short tons (US) = 2,000 lbs. Long tons (UK) = 2,240 lbs. Metric tonnes = 2,204.6 lbs.`,

  schema: z.object({
    value: z.number().describe('The value to convert'),
    from: z.enum(['kg','lbs','oz','tonnes','short_tons','long_tons','cbm','cuft','cuin','litres','gal_us','gal_uk','cm','inches','m','feet','mm']).describe('Source unit — weight (kg, lbs, oz, tonnes, short_tons, long_tons), volume (cbm, cuft, cuin, litres, gal_us, gal_uk) or length (cm, inches, m, feet, mm)'),
    to: z.enum(['kg','lbs','oz','tonnes','short_tons','long_tons','cbm','cuft','cuin','litres','gal_us','gal_uk','cm','inches','m','feet','mm','chargeable_kg','freight_tonnes']).describe('Target unit — any source unit, plus the freight targets chargeable_kg and freight_tonnes (only valid from cbm)'),
  }).strict(),

  annotations: readOnlyAnnotations('Unit Converter'),

  handler: async (args) =>
    apiGet('convert', { value: args.value, from: args.from, to: args.to }),
};

// ─────────────────────────────────────────────────────────────
//  12. Consignment Calculator
// ─────────────────────────────────────────────────────────────

const consignmentCalculator: ToolDef = {
  name: 'consignment_calculator',
  description: `Calculate total CBM, loading metres (LDM), volumetric and mode-specific chargeable weight for a multi-item mixed consignment — per-line and grand totals, plus objective advisory flags.

Provide a transport mode (sea | air | road) and either "lines" (canonical: each line has quantity, dims {l,w,h,unit}, weight {value,unit}, and optional description / hs_code / un_number / stackable) or the legacy flat "items" array (dimensions in cm, weight in kg). Air uses an IATA volumetric divisor (default 6000, settable via options.air_volumetric_divisor). Optionally pass options.container_number / options.awb_number for a check-digit sanity flag.

Flags are advisory only — implausible density, mode/option mismatch, dangerous-goods presence by UN number against the ADR 2025 reference, and container/AWB check-digit validity. They never state that a shipment is permitted or compliant. Best-effort deterministic calculation and reference data only; not regulatory, customs, or dangerous-goods compliance advice — you remain responsible for classification, documentation and carrier acceptance. Canonical schema: https://www.freightutils.com/schema/consignment.v1.json`,

  schema: z.object({
    mode: z.enum(['sea', 'air', 'road']).optional().describe('Transport mode: sea | air | road (default road)'),
    lines: z.array(z.object({
      description: z.string().optional().describe('Optional item label'),
      quantity: z.number().int().positive().describe('Number of identical pieces'),
      dims: z.object({
        l: z.number().positive().describe('Length in the given unit'),
        w: z.number().positive().describe('Width in the given unit'),
        h: z.number().positive().describe('Height in the given unit'),
        unit: z.enum(['mm', 'cm', 'm', 'in']).describe('Dimension unit'),
      }).describe('Dimensions with unit'),
      weight: z.object({
        value: z.number().positive().describe('Gross weight per piece'),
        unit: z.enum(['kg', 'g', 't', 'lb']).describe('Weight unit'),
      }).describe('Weight with unit'),
      hs_code: z.string().optional().describe('Optional HS commodity code (6–10 digits)'),
      un_number: z.string().optional().describe('Optional UN number for dangerous-goods reference'),
      stackable: z.boolean().optional().describe('Stack two-high (halves loading-metre footprint)'),
    })).min(1).max(50).optional().describe('Canonical consignment lines (preferred). Provide lines OR items.'),
    items: z.array(z.object({
      description: z.string().optional().describe('Item description'),
      length: z.number().positive().describe('Length in cm'),
      width: z.number().positive().describe('Width in cm'),
      height: z.number().positive().describe('Height in cm'),
      quantity: z.number().int().positive().optional().describe('Number of pieces (default 1)'),
      gross_weight: z.number().positive().describe('Gross weight per piece in kg'),
      stackable: z.boolean().optional().describe('Can the item be stacked?'),
      pallet_type: z.enum(['none', 'euro', 'uk', 'us', 'custom']).optional().describe('Pallet type (informational)'),
    })).min(1).max(50).optional().describe('Deprecated flat alias — dimensions in cm, weight in kg. Prefer lines.'),
    options: z.object({
      air_volumetric_divisor: z.number().positive().optional().describe('IATA volumetric divisor in cm³/kg (default 6000). Air only.'),
      container_number: z.string().optional().describe('ISO 6346 container number, check-digit validated'),
      awb_number: z.string().optional().describe('IATA 11-digit air waybill number, check-digit validated'),
    }).optional().describe('Optional settings'),
  }).strict(),

  annotations: readOnlyAnnotations('Consignment Calculator'),

  // Proxies straight to the website /api/consignment, which is the single
  // authoritative validate → compute → flag pipeline and now accepts BOTH the
  // canonical { mode, lines, options } and the legacy { items } shapes.
  handler: async (args) => apiPost('consignment', args),
};

// ─────────────────────────────────────────────────────────────
//  13. UN/LOCODE Lookup
// ─────────────────────────────────────────────────────────────

const unlocodeLookup: ToolDef = {
  name: 'unlocode_lookup',
  description: `Search 116,129 UN/LOCODE transport locations worldwide.

UN/LOCODE identifies ports, airports, rail terminals, inland depots, and border crossings. Each code is 5 characters: 2-letter country code + 3-character location (e.g., GBLHR = London Heathrow, NLRTM = Rotterdam).

Use this tool when you need to:
- Find a port, airport, or terminal by name
- Look up a specific UN/LOCODE
- Filter locations by country or function type (port, airport, rail, road, icd, border)`,

  schema: z.object({
    query: z.string().min(2, 'Query must be at least 2 characters').optional().describe('Search by location name (e.g., "rotterdam", "heathrow")'),
    code: z.string().regex(/^[A-Za-z0-9]{5}$/, 'UN/LOCODE must be 5 characters: 2-letter country + 3-char location (e.g. "GBLHR")').optional().describe('Exact UN/LOCODE lookup (e.g., "GBLHR", "NLRTM")'),
    country: z.string().regex(/^[A-Za-z]{2}$/, 'Country must be a 2-letter ISO code (e.g. "GB", "NL")').optional().describe('Filter by country code (e.g., "GB", "NL")'),
    function_type: z.enum(['port', 'airport', 'rail', 'road', 'icd', 'border']).optional().describe('Filter by location function'),
    limit: z.number().int().min(1).max(100).optional().describe('Max results (default: 20, max: 100)'),
  }).strict(),

  annotations: readOnlyAnnotations('UN/LOCODE Lookup'),

  handler: async (args) =>
    apiGet('unlocode', {
      q: args.query, code: args.code, country: args.country,
      function: args.function_type, limit: args.limit,
    }),
};

// ─────────────────────────────────────────────────────────────
//  14. UK Import Duty & VAT Calculator
// ─────────────────────────────────────────────────────────────

const ukDutyCalculator: ToolDef = {
  name: 'uk_duty_calculator',
  description: `Estimate UK import duty and VAT for any commodity code.

Uses live GOV.UK Trade Tariff data. Calculates CIF value from goods value + freight + insurance, applies the appropriate duty rate, then calculates VAT (standard 20%) on the duty-inclusive value.

Use this tool when you need to:
- Estimate import costs for UK-bound shipments
- Check duty rates for specific HS/commodity codes
- Compare landed costs for different origin countries
- Determine if preferential rates apply`,

  schema: z.object({
    commodity_code: z.string().regex(/^\d{6,10}$/, 'Commodity code must be 6–10 digits').describe('HS/tariff code (6–10 digits, e.g., "847989")'),
    origin_country: z.string().regex(/^[A-Za-z]{2}$/, 'Origin country must be a 2-letter ISO code (e.g., "CN", "DE")').describe('ISO 2-letter origin country code (e.g., "CN", "DE")'),
    customs_value: z.number().positive().describe('Goods value in GBP'),
    freight_cost: z.number().optional().describe('Freight cost in GBP (added to CIF value)'),
    insurance_cost: z.number().optional().describe('Insurance cost in GBP (added to CIF value)'),
    incoterm: z.enum(['EXW','FCA','FAS','FOB','CFR','CIF','CPT','CIP','DAP','DPU','DDP']).optional().describe('Incoterm basis'),
  }).strict(),

  annotations: readOnlyAnnotations('UK Duty & VAT Calculator'),

  // /api/duty accepts both casings on the request body — send the canonical
  // snake_case form, which now matches the schema.
  handler: async (args) => apiPost('duty', args),
};

// ─────────────────────────────────────────────────────────────
//  15. Shipment Summary (Composite)
// ─────────────────────────────────────────────────────────────

const shipmentSummary: ToolDef = {
  name: 'shipment_summary',
  description: `Composite endpoint — chains CBM, weight, LDM/volumetric/W&M, ADR compliance, and UK duty estimation into one response.

The flagship composite tool. Accepts multiple items with a transport mode and returns comprehensive calculations. Road mode includes LDM, pallet spaces, and vehicle suggestion. Air mode includes volumetric weight. Sea mode includes revenue tonnes and container suggestion. All modes include ADR compliance checks and UK duty estimates when HS codes and customs values are provided.

Use this tool when you need a complete shipment analysis in one call.`,

  schema: z.object({
    mode: z.enum(['road', 'air', 'sea', 'multimodal']).describe('Transport mode'),
    items: z.array(z.object({
      description: z.string().optional(),
      length: z.number().positive().describe('Length in cm'),
      width: z.number().positive().describe('Width in cm'),
      height: z.number().positive().describe('Height in cm'),
      weight: z.number().describe('Gross weight per item in kg'),
      quantity: z.number().int().positive().describe('Number of items'),
      stackable: z.boolean().optional().describe('Whether this item can be stacked (affects pallet fitting calc)'),
      pallet_type: z.enum(['euro', 'uk', 'us', 'custom', 'none']).optional().describe('Pallet standard the item sits on, if any'),
      hs_code: z.string().optional().describe('HS code for customs'),
      un_number: z.string().optional().describe('UN number for dangerous goods'),
      customs_value: z.number().optional().describe('Customs value per item in GBP'),
    })).describe('Array of shipment items with dimensions, weight, and optional HS/UN codes'),
    origin: z.object({ country: z.string(), locode: z.string().optional() }).optional().describe('Origin location — ISO country code and optional UN/LOCODE'),
    destination: z.object({ country: z.string(), locode: z.string().optional() }).optional().describe('Destination location — ISO country code and optional UN/LOCODE'),
    incoterm: z.string().optional().describe("Incoterms 2020 three-letter code (e.g. 'DAP', 'EXW', 'FOB')"),
    freight_cost: z.number().optional().describe('Optional freight cost in GBP for duty calculation'),
    insurance_cost: z.number().optional().describe('Optional insurance cost in GBP for duty calculation'),
  }).strict(),

  annotations: readOnlyAnnotations('Shipment Summary'),

  // The /api/shipment/summary input parser only recognises camelCase aliases
  // on freightCost / insuranceCost / items[].palletType / items[].hsCode /
  // items[].unNumber / items[].customsValue. Map snake_case → camelCase on
  // the wire until the website's input parser adds snake_case aliases.
  handler: async (args) =>
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
    }),
};

// ─────────────────────────────────────────────────────────────
//  16. ULD Lookup
// ─────────────────────────────────────────────────────────────

const uldLookup: ToolDef = {
  name: 'uld_lookup',
  description: `Look up air freight ULD (Unit Load Device) specifications.

15 types including AKE (LD3), PMC main deck pallet, temperature-controlled containers, and more. Returns dimensions, weights, usable volume, compatible aircraft, and deck position.

Use this tool when you need to:
- Find ULD specs by IATA code (e.g., "AKE", "PMC")
- Compare container vs pallet ULD types
- Check which ULDs fit on lower deck vs main deck
- Find aircraft-compatible ULDs`,

  schema: z.object({
    type: z.string().min(2, 'ULD type must be at least 2 characters').optional().describe('ULD code (e.g., "AKE", "PMC") or slug (e.g., "ake-ld3"). Omit to list all.'),
    category: z.enum(['container', 'pallet', 'special']).optional().describe('Filter by category'),
    deck: z.enum(['lower', 'main']).optional().describe('Filter by deck position'),
  }).strict(),

  annotations: readOnlyAnnotations('Air Cargo ULD Lookup'),

  handler: async (args) =>
    apiGet('uld', { type: args.type, category: args.category, deck: args.deck }),
};

// ─────────────────────────────────────────────────────────────
//  17. Vehicle & Trailer Lookup
// ─────────────────────────────────────────────────────────────

const vehicleLookup: ToolDef = {
  name: 'vehicle_lookup',
  description: `Look up road freight vehicle and trailer specifications.

17 types covering articulated trailers (curtainsider, mega, box, reefer, double-deck, flatbed, low-loader, US 53ft/48ft), rigid trucks (7.5T to 26T), and vans (Luton, Transit, Sprinter). Returns internal dimensions, payload limits, pallet capacity, and features.

Use this tool when you need to:
- Find vehicle specs by type (e.g., "standard-curtainsider")
- Compare EU vs US trailer dimensions
- Determine pallet capacity for vehicle selection
- Check payload limits for heavy shipments`,

  schema: z.object({
    slug: z.string().min(2, 'Vehicle slug must be at least 2 characters').optional().describe('Vehicle slug (e.g., "standard-curtainsider"). Omit to list all.'),
    category: z.enum(['articulated', 'rigid', 'van']).optional().describe('Filter by category'),
    region: z.enum(['EU', 'US']).optional().describe('Filter by region'),
  }).strict(),

  annotations: readOnlyAnnotations('Vehicle Lookup'),

  handler: async (args) =>
    apiGet('vehicles', { slug: args.slug, category: args.category, region: args.region }),
};

// ─────────────────────────────────────────────────────────────
//  18. ADR Limited/Excepted Quantity Check
// ─────────────────────────────────────────────────────────────

const adrLqEqCheck: ToolDef = {
  name: 'adr_lq_eq_check',
  description: `Check if dangerous goods qualify for ADR Limited Quantity (LQ) or Excepted Quantity (EQ) exemptions.

ADR 3.4 (Limited Quantities) allows reduced requirements for small quantities packed in inner packagings below a per-substance maximum. ADR 3.5 (Excepted Quantities, codes E1–E5) applies to very small quantities with even stricter per-inner limits.

Use this tool when you need to:
- Check whether one or more items qualify for LQ transport (ADR 3.4)
- Check whether one or more items qualify for EQ transport (ADR 3.5)
- Work out the per-item LQ maximum or EQ code/limit for a UN number
- Batch-check up to 20 items in a single call

Provide the mode ('lq' or 'eq') and an array of items with un_number, quantity, and unit. For EQ mode, optionally include inner_packaging_qty to validate the packaging arrangement.`,

  schema: z.object({
    mode: z.enum(['lq', 'eq']).describe("Check mode: 'lq' (Limited Quantity, ADR 3.4) or 'eq' (Excepted Quantity, ADR 3.5)"),
    items: z.array(z.object({
      un_number: z.string().regex(/^(UN)?\d{4}$/i, 'UN number must be 4 digits, optionally prefixed with "UN"').describe('UN number (1–4 digits, e.g. "1203")'),
      quantity: z.number().positive().describe('Quantity of substance per inner packaging'),
      unit: z.enum(['ml', 'L', 'g', 'kg']).describe('Unit of measurement'),
      inner_packaging_qty: z.number().int().positive().optional().describe('Number of inner packagings (EQ mode only)'),
    })).min(1).max(20).describe('Items to check (max 20 per call)'),
  }).strict(),

  annotations: readOnlyAnnotations('ADR LQ / EQ Exemption Check'),

  handler: async (args) =>
    apiPost('adr/lq-check', { mode: args.mode, items: args.items }),
};

// ─────────────────────────────────────────────────────────────
//  19. Get Subscribe Link
// ─────────────────────────────────────────────────────────────

const getSubscribeLink: ToolDef = {
  name: 'get_subscribe_link',
  description: `Get the URL where the user can subscribe to FreightUtils Pro for higher API limits.

Use this tool when:
- The user asks how to upgrade or subscribe
- The user hits a rate limit and asks how to get more requests
- The user asks about pricing

Returns the subscription URL plus the tier/limit/price metadata. Agents must hand this URL to the user — DO NOT attempt to complete the subscription on the user's behalf.`,

  schema: z.object({
    tier: z.enum(['pro']).optional().describe('Tier to surface (only "pro" supported today)'),
  }).strict(),

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
  getSubscribeLink,
];
