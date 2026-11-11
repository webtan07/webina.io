/**
 * Allowed-origin matching for site keys.
 *
 * A site key is public (it ships in the embed snippet), so it proves nothing on
 * its own: the browser request is accepted only when its Origin header matches
 * an origin the tenant registered for that site. Matching is exact on
 * scheme + host + port, case-insensitive, with an optional "*.example.com"
 * wildcard for subdomains.
 */

export function normalizeOrigin(input: string): string | null {
  const raw = input.trim().toLowerCase();
  if (raw === "") return null;
  let url: URL;
  try {
    url = new URL(raw.includes("://") ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username !== "" || url.password !== "") return null;
  if (url.pathname !== "/" && url.pathname !== "") return null;
  if (url.search !== "" || url.hash !== "") return null;
  const defaultPort = url.protocol === "https:" ? "443" : "80";
  const port = url.port === "" || url.port === defaultPort ? "" : `:${url.port}`;
  return `${url.protocol}//${url.hostname}${port}`;
}

function wildcardMatches(entry: string, origin: string): boolean {
  if (!entry.startsWith("*.")) return false;
  const suffix = entry.slice(1); // ".example.com"
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  return parsed.hostname.endsWith(suffix) && parsed.hostname.length > suffix.length;
}

/**
 * True when `origin` is registered for this site.
 * `null` (a request with no Origin header — curl, a server-side call) is never
 * accepted: the widget is a browser feature and must prove where it came from.
 */
export function isOriginAllowed(allowedOrigins: readonly string[], origin: string | null): boolean {
  if (origin === null) return false;
  const normalized = normalizeOrigin(origin);
  if (normalized === null) return false;
  for (const entry of allowedOrigins) {
    const allowed = normalizeOrigin(entry);
    if (allowed !== null && allowed === normalized) return true;
    const wildcard = entry.trim().toLowerCase();
    if (wildcardMatches(wildcard, normalized)) return true;
  }
  return false;
}

/** De-duplicated, normalised origin list for storage. Invalid entries are dropped. */
export function normalizeOriginList(input: readonly string[]): string[] {
  const out: string[] = [];
  for (const entry of input) {
    const normalized = normalizeOrigin(entry);
    if (normalized !== null && !out.includes(normalized)) out.push(normalized);
  }
  return out;
}
