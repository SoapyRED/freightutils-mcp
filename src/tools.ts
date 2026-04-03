import { z } from 'zod';
import { apiGet, apiPost } from './api.js';

// ─────────────────────────────────────────────────────────────
//  Tool type
// ─────────────────────────────────────────────────────────────

export interface ToolDef {
  name: string;
  description: string;
  schema: z.ZodObject<z.ZodRawShape>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}


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
  }),

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
  }),

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
  }),

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
    un_number: z.string().optional().describe('UN number (e.g., "1203", "UN1203")'),
    search: z.string().optional().describe('Search by substance name (min 2 characters)'),
    hazard_class: z.string().optional().describe('Filter by hazard class (e.g., "3" for flammable liquids)'),
  }),

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
    un_number: z.string().optional().describe('UN number for single-substance check'),
    quantity: z.number().positive().optional().describe('Quantity in kg or litres for single-substance check'),
    items: z.array(z.object({
      un_number: z.string().describe('UN number'),
      quantity: z.number().positive().describe('Quantity in kg or litres'),
    })).optional().describe('Array of items for mixed-load calculation (use instead of single un_number/quantity)'),
  }),

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
    query: z.string().optional().describe('General search (name, code, prefix, or country — min 2 chars)'),
    iata: z.string().optional().describe('Exact IATA code (2 chars, e.g., "EK")'),
    icao: z.string().optional().describe('Exact ICAO code (3 chars, e.g., "UAE")'),
    prefix: z.string().optional().describe('AWB prefix (3 digits, e.g., "176")'),
    country: z.string().optional().describe('Filter by country name (min 2 chars)'),
  }),

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
    type: z.string().optional()
      .describe('Container slug (e.g., "20ft-standard", "40ft-high-cube"). Omit to list all types.'),
    item_length_cm: z.number().positive().optional().describe('Item length in cm (for loading calculation)'),
    item_width_cm: z.number().positive().optional().describe('Item width in cm'),
    item_height_cm: z.number().positive().optional().describe('Item height in cm'),
    item_weight_kg: z.number().positive().optional().describe('Item weight in kg'),
    item_quantity: z.number().int().positive().optional().describe('Number of items'),
  }),

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
    query: z.string().optional().describe('Search by product description (min 2 chars)'),
    code: z.string().optional().describe('Exact HS code lookup (2-6 digits)'),
    section: z.string().optional().describe('Browse by section (Roman numeral, e.g., "II")'),
  }),

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
    code: z.string().optional().describe('Incoterm code (e.g., "FOB", "CIF", "EXW")'),
    category: z.enum(['any_mode', 'sea_only']).optional().describe('Filter by transport mode category'),
  }),

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
  }),

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
    from: z.string().describe('Source unit code (e.g., "kg", "cbm", "cm")'),
    to: z.string().describe('Target unit code (e.g., "lbs", "cuft", "inches")'),
  }),

  handler: async (args) =>
    apiGet('convert', { value: args.value, from: args.from, to: args.to }),
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
  airlineLookup,
  containerLookup,
  hsCodeLookup,
  incotermsLookup,
  palletFittingCalculator,
  unitConverter,
];
