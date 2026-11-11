/**
 * Identifiers that are safe to publish or hand to a browser.
 * Web Crypto only — this module is importable from client code.
 */

const ALPHABET = "abcdefghijkmnopqrstuvwxyz23456789"; // no i/l/o/0/1

function randomString(length: number): string {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let out = "";
  for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length];
  return out;
}

export type SiteKeyEnvironment = "live" | "test";

/**
 * Public site key. Prefixed so a key found in a page's source says what it is
 * and which environment it belongs to. 20 characters of a 32-symbol alphabet
 * is ~100 bits: not guessable, not a secret.
 */
export function generateSiteKey(environment: SiteKeyEnvironment = "live"): string {
  return `pk_${environment}_${randomString(20)}`;
}

export function isSiteKey(value: string): boolean {
  return /^pk_(live|test)_[a-z2-9]{20}$/.test(value);
}

/** Opaque conversation handle. Never a phone number or an email address. */
export function generateCustomerRef(): string {
  return `cref_${randomString(24)}`;
}

export function generateIdempotencyKey(): string {
  return `idem_${randomString(24)}`;
}

/** URL-safe slug from a business name: "Bob's Mowing" -> "bobs-mowing". */
export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
