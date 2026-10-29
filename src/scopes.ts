/**
 * Scoped tool lists (2.25.0, mirroring the hosted /api/mcp/dg | customs | ops of freightutils.com —
 * the website's lib/mcp/scopes.ts holds the same lists; scopes.test.ts asserts every name is a tool).
 * A scope is a FILTER: the same tools, names, schemas and answers. `all` (the default) is every tool.
 * Scopes leave out get_subscribe_link — its link already travels in every limit answer.
 */

export const SCOPES = ['all', 'dg', 'customs', 'ops'] as const;
export type Scope = (typeof SCOPES)[number];

export const SCOPE_TOOLS: Record<Exclude<Scope, 'all'>, readonly string[]> = {
  dg: ['adr_lookup', 'adr_exemption_calculator', 'adr_lq_eq_check', 'validate', 'resolve_reference'],
  customs: ['hs_code_lookup', 'uk_duty_calculator', 'ics2_check', 'incoterms_lookup', 'validate'],
  ops: [
    'cbm_calculator', 'chargeable_weight_calculator', 'ldm_calculator', 'pallet_fitting_calculator',
    'unit_converter', 'consignment_calculator', 'shipment_summary', 'emissions_calculator',
    'container_lookup', 'uld_lookup', 'vehicle_lookup',
    'unlocode_lookup', 'airport_lookup', 'nearest_airport',
    'airline_lookup',
    'validate', 'resolve_reference',
  ],
};

export function isScope(s: string | undefined): s is Scope {
  return !!s && (SCOPES as readonly string[]).includes(s);
}

export function inScope(scope: Scope, tool: string): boolean {
  return scope === 'all' || SCOPE_TOOLS[scope].includes(tool);
}

/** The scope from argv (--scope dg | --scope=dg) or FREIGHTUTILS_SCOPE; `all` when neither is set. */
export function scopeFromArgs(argv: readonly string[], env: Record<string, string | undefined>): Scope | { error: string } {
  let raw: string | undefined;
  const i = argv.indexOf('--scope');
  if (i >= 0) raw = argv[i + 1];
  const eq = argv.find((a) => a.startsWith('--scope='));
  if (eq) raw = eq.slice('--scope='.length);
  raw ??= env.FREIGHTUTILS_SCOPE;
  if (raw === undefined || raw === '') return 'all';
  return isScope(raw) ? raw : { error: `Unknown scope "${raw}" — use one of: ${SCOPES.join(', ')}.` };
}
