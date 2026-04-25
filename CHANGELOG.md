# Changelog

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
