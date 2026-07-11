# Changelog

## 2.11.1 — 2026-07-11

### Fixed

- **`uld_lookup` description count corrected 15 → 16.** The 2.11.0 definitions rewrite carried the stale "15 types" figure from the previous description; the ULD dataset has held **16 types** since the HMA/AMJ additions, and a no-`type` listing returns 16 records. Caught by the pre-merge adversarial review of the website's hosted-description port (which generates the hosted `/api/mcp` text from this package, so both surfaces pick up the fix together). Docs-only patch — no tool, schema, or behaviour change.

## 2.11.0 — 2026-07-10

### Added

- **Typed output schemas + structured results on all 24 tools.** Every tool now declares an `outputSchema` (the FreightUtils v1 response envelope with a tool-specific `result` shape) and `tools/call` returns `structuredContent`: the envelope carries the answer under `result`, plus `confidence` (level + basis, match-quality score where applicable), `normalized_input` (interpreted inputs and defaults applied), `warnings` (e.g. `FUZZY_BEST_MATCH`, `PROVENANCE_PENDING`), `_source` (authority, checked date, provenance status) and a ready-to-use `citation`. Envelopes are built by the FreightUtils API itself (`?envelope=1`) — the same contract as the hosted `/api/mcp` surface and the REST opt-in, verified field-for-field.
- **Compatibility:** the flat JSON on the text channel (`content[0].text`) is **byte-identical** to 2.10.x for every tool, including error behaviour, so text-parsing consumers are unaffected. Non-error calls now also append the envelope's one-line citation as an additional text item. The five tools that already shipped `structuredContent` (`emissions_calculator`, `validate`, `ics2_check`, `airport_lookup`, `nearest_airport`) keep their text layout byte-identical, but their `structuredContent` is now the envelope (previously the flat body) — structured consumers of those five should read the payload under `result`.
- Note: each `tools/call` now makes two API requests (flat + envelope), which counts double against rate limits (anonymous: 25 requests/day per IP; error paths still cost one).

### Changed

- **All 24 tool definitions rewritten for agent intent-matching**: per-tool behaviour prose (limits, rounding, no-match and rate-limit signaling incl. `retry_after_seconds`), parameter descriptions with accepted formats, defaults and inline examples, an explicit "Returns:" line backed by the new output schema, proactive limitations ("structural check, not a registry lookup"; "reference data, not legal or compliance advice"), and cross-references between related tools (adr_lookup ↔ adr_lq_eq_check ↔ adr_exemption_calculator; cbm ↔ chargeable_weight ↔ consignment ↔ shipment_summary; airport_lookup ↔ nearest_airport; hs_code_lookup ↔ uk_duty_calculator; validate ↔ the lookups it defers to).
- Package description now leads with the typed, source-cited envelope alongside the neutral-reference positioning.

## 2.10.2 — 2026-07-08

### Changed

- **Docs/metadata refresh (no tool, schema, or behaviour change).** Corrected the `airline_lookup` dataset size in the README from **6,352 → 6,357** to match the live airline dataset (the count had held at 6,357 since its last additions; several surfaces still showed the stale figure). Cross-checked every other embedded dataset count against the live data — ADR 2,939, HS 6,940, UN/LOCODE 116,129, airports 85,555 all confirmed current. Tool count remains **24 MCP tools** (23 REST-backed + `get_subscribe_link`). Patch bump so the corrected metadata propagates to npm, the MCP Registry, Smithery, and Glama on their next scrape.

## 2.10.0 — 2026-06-24

### Added

- **New tool: `airport_lookup`** — look up an airport by IATA code (3 letters, e.g. `LHR`), ICAO code (4 chars, e.g. `EGLL`), or name/city search. Returns the full record (both codes, name, type, municipality, region, country, latitude/longitude, elevation), with ranked candidates for ambiguous names and an optional `type` filter. Proxies `GET /api/airports`.
- **New tool: `nearest_airport`** — find the airports nearest to a caller-provided `latitude`/`longitude`, sorted by great-circle (haversine) distance with `distance_km` on each result. Optional `radius_km`, `max_results` (1–50, default 10) and `type` filter. Coordinates are **input only — never stored or logged**. Proxies `GET /api/nearest-airport`.
- Both tools are backed by the public-domain **OurAirports** dataset (85,555 airports), cross-checked against OpenFlights + Wikidata, and registered via `server.registerTool()` with full output schemas + `structuredContent` and a `_source` citing OurAirports.
- **Tool count: 22 → 24** (REST surface: 21 → 23 endpoints).

## 2.6.0 — 2026-06-22

### Changed

- **Repositioned as the neutral freight reference layer for AI agents** (metadata/copy only — no tool, schema, or behaviour change). The `package.json` description, README lead, and `server.json`/registry description now lead with the neutral-layer voice: authoritative dangerous-goods, customs, location and freight-calculation data an agent can call and cite, from primary sources (ADR 2025 / UNECE, HS 2022 / WCO, IATA-regulated airline prefixes) — neutral by design, no freight to sell and no carrier to push. Mirrors the same repositioning applied across the website, OpenAPI spec, llms.txt and GitHub About so every source agents and directories read is consistent. Removed "basic usage" framing from the install copy. Still 19 tools, same names and schemas; minor bump so the corrected metadata propagates to npm, the MCP Registry, Smithery, and Glama on re-scan.

### Security

- Verified `@modelcontextprotocol/sdk` is on **1.29.0** (installed), at or above **1.26.0** which patches CVE-2026-25536 — no change required.

## 2.5.0 — 2026-06-19

### Changed

- **Loose-schema tightening across the tool inputs — garbage is now rejected at the schema layer while every legitimate input form still validates.** Several tools advertised a bare `z.string()` where the description promised a specific format, so malformed values passed validation and only failed (or silently returned nothing) downstream. Each is now constrained to exactly the forms its underlying data/logic accepts, with a clear error message, without narrowing any feature:
  - **`unit_converter`** — `from` is now an enum of the 17 supported unit codes (weight / volume / length); `to` is those plus the freight targets `chargeable_kg` and `freight_tonnes`. Unknown units are rejected with the valid set surfaced in `tools/list`.
  - **`hs_code_lookup`** — `code` must be 2–6 digits, `section` a Roman numeral (I–XXI), `query` ≥ 2 chars.
  - **`incoterms_lookup`** — `code` must be a 3-letter Incoterm code (any case).
  - **`uk_duty_calculator`** — `incoterm` is now the 11-value Incoterms enum (commodity_code `^\d{6,10}$` and origin_country `^[A-Za-z]{2}$` were already tight; regex form aligned with the website surface).
  - **`airline_lookup`** — `iata` `^[A-Za-z0-9]{2}$`, `icao` `^[A-Za-z]{3}$` (upgraded from length checks); the 2-char IATA / 3-char ICAO / 3-digit AWB-prefix / free-form country+query union is fully preserved.
  - **`unlocode_lookup`** — the function filter is now **`function_type`** (an enum of `port | airport | rail | road | icd | border`), renamed from the previous bare-string `function` to match the website MCP surface and validated as an enum; `code` / `country` regexes aligned to the website (`^[A-Za-z0-9]{5}$` / `^[A-Za-z]{2}$`). **Note:** callers that passed `function` must switch to `function_type`.
  - **`container_lookup` / `uld_lookup` / `vehicle_lookup`** — the slug/code selector now requires ≥ 2 chars; these accept a code **or** slug from a fixed reference set, so they stay permissive (the handler returns a clear "not found" for unknown values) rather than being narrowed to a brittle enum.

### Notes

- **No tool-count or tool-list change — still 19 tools, same names.** This is a FAULT 13 fix-once-mirror-everywhere release: the website `/api/mcp` surface ([`app/api/mcp/[transport]/route.ts`](https://github.com/SoapyRED/freighttools)) was tightened to the identical schemas in the same change, so `tools/list` and input validation match across both surfaces. `serverInfo.version` reads dynamically from `package.json`, now `2.5.0`. Minor bump because the advertised input schemas changed (stricter validation + the `unlocode_lookup` `function` → `function_type` rename).

## 2.4.1 — 2026-06-17

### Fixed

- **Keyless introspection: `resources/list` and `prompts/list` now succeed.** The server declared neither the `prompts` nor the `resources` capability, so a keyless `resources/list` / `prompts/list` returned JSON-RPC `-32601` "Method not found". Sandbox builders that compile from source and probe `initialize + tools/list + resources/list + prompts/list` with **no credentials** (e.g. Glama) failed on the last two calls — which froze our Glama listing on an old build. The server now declares `capabilities: { prompts, resources }` and answers both list methods (plus `resources/templates/list`) with an empty-but-valid result. `initialize`, `tools/list` (19 tools), `resources/list`, and `prompts/list` all succeed with no env key. The API key stays optional and call-time-only — startup and all four list methods never require it.

### Added

- **Explicit multi-stage `Dockerfile` + `.dockerignore`** so sandbox builders no longer infer the build. The builder stage runs `npm ci` + `npm run build`; the runtime stage installs prod-only dependencies and runs the stdio entry `dist/bin/cli.js` with no required environment. The Node base image, the build output dir (`dist`) and the entry are derived from `package.json` (`engines` / `bin`) and `tsconfig.json` (`outDir`), not hardcoded.

### Notes

- No tool-count or schema change — still 19 tools, same names and enriched schemas. `serverInfo.version` reads dynamically from `package.json`, now `2.4.1`. The behaviour change is purely additive (keyless list methods now respond), so this is a patch release. Mirrors the keyless-introspection contract the Glama/Smithery sandboxes require.

## 2.4.0 — 2026-06-16

### Changed

- **`consignment_calculator` upgraded to the canonical consignment v1 contract.** The tool now exposes a transport `mode` (sea | air | road) and a canonical `lines[]` shape — each line with `quantity`, `dims { l, w, h, unit }` (mm/cm/m/in) and `weight { value, unit }` (kg/g/t/lb), plus optional `description` / `hs_code` / `un_number` / `stackable` — alongside an `options` object (`air_volumetric_divisor` default 6000, `container_number`, `awb_number`). The legacy flat `items[]` array (cm/kg) is still accepted unchanged for backward compatibility. Output now includes per-line and grand totals (CBM, loading metres, volumetric and mode-specific chargeable weight), a `schema_version`, and objective advisory-only flags — implausible density, mode/option mismatch, dangerous-goods presence by UN number against the ADR 2025 reference (presence only, never a compliance verdict), and ISO 6346 container / IATA AWB check-digit validity — plus a best-effort disclaimer. The package proxies to the website `/api/consignment`, which is the single authoritative compute pipeline; the previous snake_case→camelCase item remap is removed (the endpoint now accepts both shapes). Canonical JSON Schema: <https://www.freightutils.com/schema/consignment.v1.json>.

### Notes

- No tool-count change — still 19 tools, same names. `serverInfo.version` reads dynamically from `package.json`, now `2.4.0`. Mirrors the website MCP + REST surface (FAULT 13 fix-once-mirror-everywhere).

## 2.3.0 — 2026-05-31

### Added

- **`FREIGHTUTILS_API_KEY` env var support.** [`apiGet`](src/api.ts) / [`apiPost`](src/api.ts) now build an `Authorization: Bearer` header from the env var on every outbound call when set. Backwards compatible — unset env var preserves the existing anonymous behaviour, so users running freely continue to work without code changes.

### Fixed

- **Stdio key passthrough.** Pro customers using the stdio transport were silently being rate-limited at the anonymous 25/day cap because the package was not forwarding the API key from the environment to the underlying `/api/*` HTTP calls. v2.3.0 closes this end-to-end — the same key honored by the remote `/api/mcp` transport now flows through the stdio path too.

### Updated

- **`npx freightutils-mcp ping` diagnostic** now reports observed tier. With `FREIGHTUTILS_API_KEY` set, the header now reads `auth: ✓ Authenticated as Pro` (or `Free`) after a successful `/api/auth/whoami` call; with the env var unset it reads `auth: ⚠ Anonymous (25/day cap)`. Adds a fourth informational line at the diagnostic header without changing the existing 3-check exit semantics.
- **README** — removed the "Known limitation: this npm package does not yet pass the API key through" wording from the Troubleshooting table; replaced with `FREIGHTUTILS_API_KEY` setup instructions. Added an "Authenticating with a Pro key" section under Installation with a stdio config example that wires `FREIGHTUTILS_API_KEY` into the `env` block of an MCP server entry.

## 2.2.0 — 2026-05-28

### Added

- **`npx freightutils-mcp ping` install diagnostic.** Single command that tells the user whether their install is working, in plain English. Three checks: (1) `GET /api/mcp/health` against the backend (proves the website is up; reports `mcp_version` and `tools_registered`); (2) in-process MCP handshake (`Client` ↔ `Server` via the SDK's `InMemoryTransport.createLinkedPair()` — proves the package loads and registers all `ALL_TOOLS.length` tools); (3) end-to-end `cbm_calculator` call with `l=120 w=80 h=100` and golden-value assert (`total_cbm/totalCbm ≈ 0.96 m³` — proves the network proxy works through to the website API). Exit code 0 on all-pass, 1 on any failure. Each ✗ prints a specific remediation message (network errors → check status page / `HTTPS_PROXY`; tools-count mismatch → reinstall; 429 → API key signup + note that the npm package does not yet pass keys through; `isError` → tool error body + issue link). `--help` and `--version` subcommands added alongside `ping`. ANSI colour disabled when stdout is not a TTY or `NO_COLOR=1` is set. The diagnostic is dynamic-imported in [`src/bin/cli.ts`](src/bin/cli.ts) so the cold-start cost of the diagnostic only hits the diagnostic path — the default stdio-server boot for MCP clients pays no extra import.

### Improved

- **README "Verify your setup" + "Troubleshooting" sections.** Two new top-level sections in [README.md](README.md): an install-verification block with the `ping` invocation and an example all-pass output, and a 6-row troubleshooting table mirroring the website's [/api-docs#mcp-setup](https://www.freightutils.com/api-docs#mcp-setup). The troubleshooting table documents the known anonymous-cap limitation (this package does not yet pass an API key through to proxied calls) so users hitting 429 see the workaround inline.

### Notes

- No tool surface changes — still 19 tools, same names, same behaviour. `serverInfo.version` continues to read dynamically from `package.json` via the `createRequire` pattern introduced in 2.1.1; verified intact post-bump.

## 2.1.1 — 2026-05-09

### Fixed

- **`serverInfo.version` was stuck at `1.0.8`** in `src/server.ts` even after 1.1.0 / 2.0.0 / 2.1.0 published. Smithery's admin probe reads `result.serverInfo.version` from the `initialize` response; the wire-level identity has been silently lying about the package version since the 1.0.7 fix. Replaced the hard-coded literal with a runtime `createRequire('../package.json')` read so the wire version always matches the npm-published release. Now reports `2.1.1`.
- **`server.json` description undercounted tools** (`"18 freight tools …"`). Updated to `"19 freight tools …, get_subscribe_link"` to match the 19-tool surface shipped in 2.1.0.

### Improved

- **Tighter Zod input constraints** for better agent-side errors:
  - `airline_lookup`: `iata.length(2)`, `icao.length(3)`, `prefix.regex(/^\d{3}$/)`, `query`/`country` min 2 chars.
  - `adr_lookup`, `adr_exemption_calculator`, `adr_lq_eq_check`: `un_number.regex(/^(UN)?\d{4}$/i)` (top-level and inside `items[]`).
  - `unlocode_lookup`: `code.length(5).regex(/^[A-Z0-9]{5}$/i)`, `country.length(2).regex(/^[A-Z]{2}$/i)`, `limit.min(1).max(100)`.
  - `uk_duty_calculator`: `commodity_code.regex(/^\d{6,10}$/)`, `origin_country.length(2).regex(/^[A-Z]{2}$/i)`.
- **`.strict()` declared on every top-level tool schema** — applied across all 19 tools at the source level. NOTE: this is a no-op at the wire today because the deprecated `server.tool()` overload passes only `schema.shape` to the SDK, which rebuilds the object in default `strip` mode (verified in `@modelcontextprotocol/sdk@1.26` `mcp.js#getZodSchemaObject → objectFromShape`). `.strict()` will become wire-effective once the planned migration to `server.registerTool()` ships (audit finding #4, slated for 2.2.0). Field-level constraints above (regex/length/min/max) DO take effect at the wire — verified by smoke test.

### Notes

No tool-call wire breakage. All previously-valid inputs remain valid; the new field-level constraints only reject inputs that were already malformed (e.g., a 4-letter IATA code, a country name in an ISO-2 slot). Tool surface, names, descriptions, and annotations are unchanged.

## 2.1.0 — 2026-05-01

### Added

- New tool: `get_subscribe_link`. Returns the FreightUtils `/pricing`
  URL plus tier / monthly limit / monthly price metadata. Use it when
  the user asks how to upgrade, hits a rate limit, or asks about
  pricing. Static response — no upstream API call. Tool description
  explicitly tells agents NOT to attempt checkout themselves; they
  should hand the URL to the user.

Tool count: **18 → 19**.

### Notes

Pairs with the website-side fix that wires `/api/mcp/*` through the
existing API rate-limit middleware so Pro keys get attributed against
the 50,000/month bucket on MCP traffic (previously: zero rate limiting
on the MCP surface, regardless of key). With v2.1.0 + the website fix,
agents using the npm-shipped MCP server with a Pro `Authorization:
Bearer fu_live_*` header will see `X-RateLimit-Limit: 50000` on
upstream API responses.

## 2.0.0 — 2026-04-25 (later — input-side casing)

### BREAKING

Tool input schemas migrated from `camelCase` to `snake_case` to match the response convention shipped in v1.1.0. AI agents that called these tools with the prior camelCase keys will now get a Zod validation error instead of a 200 response. **Re-prompt or update tool-call code.**

| Tool | Old key | New key |
|------|---------|---------|
| `uk_duty_calculator` | `commodityCode` | `commodity_code` |
| `uk_duty_calculator` | `originCountry` | `origin_country` |
| `uk_duty_calculator` | `customsValue` | `customs_value` |
| `uk_duty_calculator` | `freightCost` | `freight_cost` |
| `uk_duty_calculator` | `insuranceCost` | `insurance_cost` |
| `consignment_calculator` | `items[].grossWeight` | `items[].gross_weight` |
| `consignment_calculator` | `items[].palletType` | `items[].pallet_type` |
| `shipment_summary` | `freightCost` | `freight_cost` |
| `shipment_summary` | `insuranceCost` | `insurance_cost` |
| `shipment_summary` | `items[].palletType` | `items[].pallet_type` |
| `shipment_summary` | `items[].hsCode` | `items[].hs_code` |
| `shipment_summary` | `items[].unNumber` | `items[].un_number` |
| `shipment_summary` | `items[].customsValue` | `items[].customs_value` |

13 input keys renamed across 3 tools. Other tools (`cbm_calculator`, `chargeable_weight_calculator`, `ldm_calculator`, `pallet_fitting_calculator`, `unit_converter`, `adr_lookup`, `adr_exemption_calculator`, `airline_lookup`, `container_lookup`, `hs_code_lookup`, `incoterms_lookup`, `unlocode_lookup`, `uld_lookup`, `vehicle_lookup`) already used `snake_case` (or single-word) input keys in v1.x and are unchanged.

### Migration

```diff
- mcpClient.callTool('uk_duty_calculator', { commodityCode: '847989', originCountry: 'CN', customsValue: 1000 });
+ mcpClient.callTool('uk_duty_calculator', { commodity_code: '847989', origin_country: 'CN', customs_value: 1000 });
```

For `consignment_calculator` / `shipment_summary` items: rename inside each item object.

### Wire compatibility

The `/api/duty` endpoint accepts both casings on the request body (verified in the website's input parser); the v2.0.0 `uk_duty_calculator` handler sends snake_case directly to the API. The `/api/consignment` and `/api/shipment/summary` endpoints' input parsers only recognise camelCase aliases on item-level fields, so the v2.0.0 `consignment_calculator` and `shipment_summary` handlers map snake_case (caller-facing) → camelCase (wire) before calling the API. This is invisible to MCP callers but documented inline in `src/tools.ts` for future maintainers — the workaround can come out once the website's input parsers add snake_case aliases.

### Verified

`uk_duty_calculator` with snake_case inputs `{commodity_code, origin_country, customs_value}` returns 200 with response keys `commodity_code, commodity_description, origin_country, origin_country_name, cif_value, duty_rate, …` (zero camelCase keys). End-to-end confirmation that input + output now both follow the canonical convention.

## 1.1.0 — 2026-04-25

### Underlying API change (passes through to MCP responses)

The FreightUtils REST API now returns `snake_case` response fields site-wide. Six endpoints were migrated from `camelCase`: `/api/unlocode`, `/api/uld`, `/api/containers`, `/api/vehicles`, `/api/consignment`, `/api/duty`. All MCP tools in this package are passthrough — they forward the API response verbatim, so AI agents using these tools now see snake_case keys (e.g. `commodity_code`, `location_code`, `internal_length_cm`) instead of the prior camelCase forms.

**This is a breaking change for agents that pattern-matched on the old camelCase keys.** Re-prompt or update parsing logic to use the new snake_case forms. The website CHANGELOG entry on 2026-04-25 has the complete per-endpoint old → new field rename table.

### MCP-side work

- No code changes to tool implementations — every tool was already a passthrough wrapper around `apiGet` / `apiPost` (verified by static audit of `src/tools.ts`).
- Tool input schemas unchanged. The `uk_duty_calculator` tool continues to declare `commodityCode`/`originCountry`/`customsValue` etc. on input; the FreightUtils API still accepts both the camelCase and snake_case forms on POST `/api/duty`, so existing agent prompts continue to work. A future v2.0.0 may align the input schemas to snake_case as a deliberate breaking change.

### Docs

- README badges: added monthly + total npm downloads alongside the existing version + license + Glama score badges.

## 1.0.8 — 2026-04-21

Maintenance release synced with website MCP v1.0.8 (serverInfo + mirror — matches hotfix npm release).

## 1.0.7 — earlier

Smithery score fixes + root smithery.yaml.

## 1.0.6 — earlier

CVE-2026-25536 — sync to patched MCP SDK 1.26.0.
