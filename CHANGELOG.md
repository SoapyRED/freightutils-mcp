# Changelog

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
