# FreightUtils MCP Server

[![npm version](https://img.shields.io/npm/v/freightutils-mcp.svg)](https://www.npmjs.com/package/freightutils-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![FreightUtils MCP server](https://glama.ai/mcp/servers/SoapyRED/freightutils-mcp/badges/score.svg)](https://glama.ai/mcp/servers/SoapyRED/freightutils-mcp)

A [Model Context Protocol](https://modelcontextprotocol.io/) server that gives AI agents access to 18 freight calculation and reference tools, covering road, air, and sea freight.

Built by an ADR-certified freight transport planner for AI agents, developers, and freight professionals.

**Website:** https://www.freightutils.com
**API Docs:** https://www.freightutils.com/api-docs

---

## Tools (18)

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
| `uld_lookup` | 15 air cargo ULD types (LD3, PMC, etc.) |
| `vehicle_lookup` | 17 road freight vehicles and trailers |

### Composite
| Tool | Description |
|------|-------------|
| `shipment_summary` | Chains CBM + weight + LDM + ADR + duty in one call |

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

## Links

- **Main site:** https://www.freightutils.com
- **API documentation:** https://www.freightutils.com/api-docs
- **GitHub (this repo):** https://github.com/SoapyRED/freightutils-mcp
- **npm:** https://www.npmjs.com/package/freightutils-mcp
- **Issues:** https://github.com/SoapyRED/freightutils-mcp/issues

---

## License

MIT — see [LICENSE](LICENSE).

Built by [Marius Cristoiu](https://www.linkedin.com/in/marius-cristoiu-a853812a2/), ADR-certified freight transport planner.
