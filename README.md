# FreightUtils MCP Server

[![npm version](https://img.shields.io/npm/v/freightutils-mcp.svg)](https://www.npmjs.com/package/freightutils-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![FreightUtils MCP server](https://glama.ai/mcp/servers/SoapyRED/freightutils-mcp/badges/score.svg)](https://glama.ai/mcp/servers/SoapyRED/freightutils-mcp)

A [Model Context Protocol](https://modelcontextprotocol.io/) server that gives AI agents access to 17 freight calculation and reference tools, covering road, air, and sea freight.

Built by an ADR-certified freight transport planner for AI agents, developers, and freight professionals.

**Website:** https://www.freightutils.com
**API Docs:** https://www.freightutils.com/api-docs

---

## Tools (17)

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

If your MCP client supports remote servers:

```
https://www.freightutils.com/api/mcp
```

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
