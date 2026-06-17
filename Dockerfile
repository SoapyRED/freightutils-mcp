# syntax=docker/dockerfile:1
#
# Explicit, deterministic build for the freightutils-mcp stdio MCP server so
# Glama (and any sandbox builder) does NOT have to infer a Dockerfile.
#
# Everything below is DERIVED from the repo config, not guessed:
#   - build command    : package.json "scripts".build  = "tsc"
#   - build output dir : tsconfig.json "outDir"         = "dist"
#   - stdio entrypoint : package.json "bin".freightutils-mcp = "dist/bin/cli.js"
#   - Node base        : package.json "engines".node    = ">=18" (open range, no
#                        pinned major) -> node:22-slim, the current Active LTS,
#                        which satisfies ">=18".
#
# The container starts the stdio MCP server with NO required environment.
# FREIGHTUTILS_API_KEY is OPTIONAL and only lifts the anonymous rate cap at
# tool-CALL time; initialize / tools/list / resources/list / prompts/list all
# succeed with no credentials — which is exactly how Glama introspects.

# ── Builder: install all deps and compile TypeScript -> dist ──────────────
FROM node:22-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ── Runtime: production deps + compiled output only ───────────────────────
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
# Stdio transport speaks over stdin/stdout — no port to expose, no required env.
ENTRYPOINT ["node", "dist/bin/cli.js"]
