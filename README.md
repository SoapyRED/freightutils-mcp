# FreightUtils MCP Server

[![npm version](https://img.shields.io/npm/v/freightutils-mcp)](https://www.npmjs.com/package/freightutils-mcp)
[![npm downloads (total)](https://img.shields.io/npm/dt/freightutils-mcp)](https://www.npmjs.com/package/freightutils-mcp)
[![npm downloads (month)](https://img.shields.io/npm/dm/freightutils-mcp)](https://www.npmjs.com/package/freightutils-mcp)
[![License: MIT](https://img.shields.io/npm/l/freightutils-mcp)](https://opensource.org/licenses/MIT)
[![FreightUtils MCP server](https://glama.ai/mcp/servers/SoapyRED/freightutils-mcp/badges/score.svg)](https://glama.ai/mcp/servers/SoapyRED/freightutils-mcp)

A [Model Context Protocol](https://modelcontextprotocol.io/) server that gives AI agents access to 19 freight calculation and reference tools, covering road, air, and sea freight.

Built by an ADR-certified freight transport planner for AI agents, developers, and freight professionals.

**Website:** https://www.freightutils.com
**API Docs:** https://www.freightutils.com/api-docs

---

## Tools (19)

### Calculators
| Tool | Description |
|------|-------------|
| `ldm_calculator` | Loading metres for European and US road trailers |
| `cbm_calculator` | Cubic metres for sea freight |
| `chargeable_weight_calculator` | Air freight chargeable weight (volumetric vs actual) |
| `pallet_fitting_calculator` | Box-on-pallet optimisation with rotation |
| `container_lookup` | ISO container specs (10 types) and loading calculation |
| `unit_converter` | Weight, volume, length, and freight-specific conversions |
| `consignment_calculator` | Multi-item CBM, weight, LDM, chargeable weight |

### Dangerous Goods (ADR)
| Tool | Description |
|------|-------------|
| `adr_lookup` | 2,939 UNECE ADR 2025 entries |
| `adr_exemption_calculator` | ADR 1.1.3.6 small load exemption check |
| `adr_lq_eq_check` | Limited and Excepted Quantity eligibility |

### Customs & Tariff
| Tool | Description |
|------|-------------|
| `hs_code_lookup` | 6,940 Harmonized System tariff codes (HS 2022) |
| `uk_duty_calculator` | UK import duty and VAT (live GOV.UK Trade Tariff data) |
| `incoterms_lookup` | Incoterms 2020 — all 11 rules with risk/cost transfer points |

### Reference Data
| Tool | Description |
|------|-------------|
| `airline_lookup` | 6,352 airlines with IATA/ICAO codes and AWB prefixes |
| `unlocode_lookup` | 116,129+ UN/LOCODE transport locations |
| `uld_lookup` | 16 air cargo ULD types (LD3, PMC, etc.) |
| `vehicle_lookup` | 17 road freight vehicles and trailers |

### Composite
| Tool | Description |
|------|-------------|
| `shipment_summary` | Chains CBM + weight + LDM + ADR + duty in one call |

### Subscription
| Tool | Description |
|------|-------------|
| `get_subscribe_link` | URL to upgrade to FreightUtils Pro (50,000/month at £19/mo) |

---

## Installation

### Claude Desktop / Claude Code (stdio)

Add to your MCP config (`claude_desktop_config.json` or `.claude/settings.json`):

```json
{
  "mcpServers": {
    "freightutils": {
      "command": "npx",
      "args": ["freightutils-mcp"]
    }
  }
}
```

### Remote HTTP / SSE

If your MCP client supports remote servers, use the canonical URL:

```
https://www.freightutils.com/api/mcp
```

> The older URL `https://www.freightutils.com/api/mcp/mcp` still works for backwards compatibility with existing clients.

No authentication required for basic usage.

---

## Rate Limits

All tools call the free FreightUtils API:

- **Anonymous:** 25 requests/day per IP
- **Free API key:** 100 requests/day (register at https://www.freightutils.com)
- **Pro:** 50,000 requests/month at £19/month

---

## Example Prompts

Once connected, your AI agent can:

- "Calculate CBM for a box 120cm × 80cm × 100cm, 24 pieces"
- "Look up UN 1203 in the ADR database"
- "Check if 200L of petrol qualifies for ADR 1.1.3.6 exemption"
- "Find the HS code for lithium batteries"
- "What does FOB mean in shipping?"
- "How many boxes of 40×30×25cm fit on a euro pallet?"
- "Calculate loading metres for 26 euro pallets on an artic trailer"
- "What's the UK import duty on laptops from China?"

---

## Data Sources

- **ADR 2025** — UNECE (licensed from Labeline.com)
- **HS 2022** — UN Comtrade (PDDL)
- **Airlines** — public IATA/ICAO data, cross-referenced
- **UN/LOCODE** — UNECE
- **UK Duty** — live GOV.UK Trade Tariff API
- **Containers/ULD/Vehicles** — ISO, IATA, and industry-standard specifications

---

## Changelog

Full release notes also on [GitHub Releases](https://github.com/SoapyRED/freightutils-mcp/releases).

### 2.1.1 — 2026-05-09
- **Fix:** `serverInfo.version` was stuck at `1.0.8` even after 1.1.0 / 2.0.0 / 2.1.0 published. The wire-level identity has been silently lying about the package version since the 1.0.7 fix. Now reads from `package.json` at runtime via `createRequire`, so the wire version always matches the npm-published release.
- **Fix:** `server.json` description undercounted tools (`"18 freight tools …"` → `"19 freight tools …, get_subscribe_link"`).
- **Tightened Zod input constraints** across `airline_lookup`, `adr_lookup`, `adr_exemption_calculator`, `adr_lq_eq_check`, `unlocode_lookup`, and `uk_duty_calculator` (regex / length / min-max on UN numbers, IATA / ICAO / AWB prefixes, ISO country codes, UN/LOCODE format). Field-level constraints take effect at the wire; `.strict()` on top-level schemas becomes wire-effective once the `server.registerTool()` migration ships in 2.2.0.

### 2.1.0 — 2026-05-01
- **New tool: `get_subscribe_link`.** Returns the FreightUtils `/pricing` URL plus tier / monthly limit / monthly price metadata. Tool description tells agents NOT to attempt checkout themselves — they hand the URL to the user. **Tool count: 18 → 19.**
- Pairs with the website-side fix wiring `/api/mcp/*` through the existing API rate-limit middleware so Pro keys are attributed against the 50,000/month bucket on MCP traffic.

### 2.0.0 — 2026-04-25 (BREAKING — input-side casing)
- **Tool input schemas migrated `camelCase` → `snake_case`** to match the response convention shipped in 1.1.0. 13 input keys renamed across `uk_duty_calculator`, `consignment_calculator`, and `shipment_summary` (e.g. `commodityCode` → `commodity_code`, `originCountry` → `origin_country`, `items[].grossWeight` → `items[].gross_weight`). Agents calling these tools with prior camelCase keys now get a Zod validation error instead of a 200. **Re-prompt or update tool-call code.**
- All other tools (`cbm_calculator`, `chargeable_weight_calculator`, `ldm_calculator`, `pallet_fitting_calculator`, `unit_converter`, ADR family, `airline_lookup`, `container_lookup`, `hs_code_lookup`, `incoterms_lookup`, `unlocode_lookup`, `uld_lookup`, `vehicle_lookup`) already used snake_case (or single-word) input keys and are unchanged.

### 1.1.0 — 2026-04-25 (BREAKING — response-side casing)
- **API responses migrated `camelCase` → `snake_case` site-wide** across `/api/unlocode`, `/api/uld`, `/api/containers`, `/api/vehicles`, `/api/consignment`, `/api/duty`. All MCP tools in this package are passthroughs, so AI agents see snake_case keys (e.g. `commodity_code`, `location_code`, `internal_length_cm`) instead of the prior camelCase forms. **Re-prompt or update parsing logic.**
- No code changes to MCP tool implementations — every tool was already a passthrough wrapper around `apiGet` / `apiPost`. Input schemas continue to declare camelCase here; 2.0.0 deliberately closes that asymmetry.
- README badges: added monthly + total npm downloads alongside the existing version + license + Glama score badges.

### 1.0.8 — 2026-04-23 (hotfix)
- **Critical fix:** revert `list_prompts` / `list_resources` stub handlers introduced in 1.0.7. The raw SDK asserts the corresponding capability must be declared before `setRequestHandler` is called — 1.0.7 threw `Server does not support prompts` at startup, crashing the MCP server on every run. 1.0.8 removes the stubs and restores boot.
- Server identity bumped: `version: '1.0.7'` → `'1.0.8'`.
- No other changes. 18 tools, annotations, `shipment_summary` descriptions, and `smithery.yaml` from 1.0.7 are preserved.

### 1.0.7 — 2026-04-22
- Add `smithery.yaml` with empty configSchema (Smithery Quality Score: config UX +25).
- Add read-only `annotations` to all 18 tools (`readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: false`) with human-readable `title` (+7).
- Add missing parameter `.describe(...)` text to `shipment_summary` (+1).
- Add stub `list_prompts` / `list_resources` handlers so probes return `{ prompts: [] }` / `{ resources: [] }` instead of `-32601 Method not found` (+5).
- Fix server identity: `name: 'FreightUtils'` → `'freightutils-mcp'`, `version: '1.0.0'` → `'1.0.7'`.
- No breaking changes. Same 18 tools, same names, same behaviour.

### 1.0.6 — 2026-04-22
- Security: bump `@modelcontextprotocol/sdk` to `1.26.0` to patch **CVE-2026-25536** (cross-client data leak via shared transport/server instance reuse). See [GHSA-345p-7cg4-v4c7](https://github.com/advisories/GHSA-345p-7cg4-v4c7).
- No user-facing API changes. Same 18 tools.

---

## Other ways to use FreightUtils

FreightUtils ships across multiple distribution surfaces. Pick the one that fits how you work:

- **Website** — interactive tools at [freightutils.com](https://www.freightutils.com)
- **REST API** — 19 endpoints, free tier (100/day) and Pro tier (50K/month, £19/mo). [API docs](https://www.freightutils.com/api-docs)
- **MCP server** — for LLM agents and AI tooling. [npm: freightutils-mcp](https://www.npmjs.com/package/freightutils-mcp) · [MCP Registry](https://registry.modelcontextprotocol.io/v0/servers?search=freightutils)
- **n8n custom node** — for workflow automation. [npm: n8n-nodes-freightutils](https://www.npmjs.com/package/n8n-nodes-freightutils)

Same data, same compliance reference set (ADR 2025, HS 2022, IATA-regulated airline prefixes), every surface kept in sync.

---

## License

MIT — see [LICENSE](LICENSE).

Built by [Marius Cristoiu](https://www.linkedin.com/in/marius-cristoiu-a853812a2/), ADR-certified freight transport planner.
