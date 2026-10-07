# Security policy

## Supported versions

Security fixes go into the latest release of `freightutils-mcp` and ship as a new version on npm.
Older versions do not get backported fixes — upgrade with `npx freightutils-mcp@latest` (or pin
the new version in your MCP client's config).

| Version | Supported |
|---|---|
| The latest release on [npm](https://www.npmjs.com/package/freightutils-mcp) | Yes |
| Any earlier release | No — upgrade |

The hosted MCP endpoint (`https://www.freightutils.com/api/mcp`) and the REST API behind both
surfaces are always the current version and are in scope too.

## Reporting a vulnerability

Please report privately — not in a public issue, discussion or pull request:

- **GitHub:** the repository's **Security** tab → **Report a vulnerability** (private
  vulnerability reporting), or
- **Email:** contact@freightutils.com, with "SECURITY" in the subject line.

Include the version (`npx freightutils-mcp --version`), what you did, what happened and what
you expected, and the impact you see. Please do not include real customer data or a live API key;
if a key is involved, say so and we will rotate it.

## What to expect, and by when

| Step | Target |
|---|---|
| Acknowledgement of your report | within 5 working days |
| Our assessment — confirmed or not, and how severe | within 15 working days |
| A fix for a confirmed high or critical issue | released within 30 days of confirmation |
| A fix for a confirmed lower-severity issue | released within 90 days of confirmation |

We keep you updated as it moves, agree a disclosure date with you, and publish a GitHub security
advisory with the fix — crediting you unless you would rather not be named.

## Scope

In scope: this package, the hosted MCP endpoint, and the FreightUtils REST API
(`https://www.freightutils.com/api`). Please test only against your own account and API key, and
do not degrade the service for others.

Out of scope: the published anonymous rate limit working as designed; denial-of-service or load
testing; automated-scanner output without a demonstrated impact; social engineering.

## How this package is built

See the README's [Security and data](README.md#security-and-data) section — what the server
reads, what it sends and where, how the API key is handled, and the checks that run on every
change (tests, a dependency-advisory gate, Dependabot, code scanning).
