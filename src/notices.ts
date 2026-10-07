/**
 * The one start-up line this server writes (2.21.1).
 *
 * Without FREIGHTUTILS_API_KEY every call goes out on the anonymous tier, which is by design —
 * the server works with no setup. But a user who meant to set the key and missed it found out
 * only at the 26th call of the day, from a 429. So the server says it once, at start-up, on
 * STDERR: stdout is the MCP protocol channel and must carry nothing but JSON-RPC.
 *
 * The limit is the published one (https://www.freightutils.com/pricing; the website's
 * siteStats.anonDailyLimit). readme.test.ts holds the README's Rate Limits line to the same
 * number, so the two cannot drift apart inside this package.
 */
export const ANONYMOUS_DAILY_LIMIT = 25;

export const ANONYMOUS_NOTICE =
  `freightutils-mcp: FREIGHTUTILS_API_KEY is not set, so calls use the anonymous tier — ` +
  `${ANONYMOUS_DAILY_LIMIT} requests per day per IP address. Set the key to use your plan's limit: ` +
  `https://www.freightutils.com/pricing`;

/** The start-up notice for this environment, or null when a key is set. An empty string counts
 *  as unset, as it does in buildHeaders (no Authorization header is sent for it). */
export function startupNotice(env: NodeJS.ProcessEnv = process.env): string | null {
  return env.FREIGHTUTILS_API_KEY ? null : ANONYMOUS_NOTICE;
}
