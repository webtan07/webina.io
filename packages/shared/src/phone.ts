/**
 * Australian phone numbers. Stored as E.164 ("+61412345678") everywhere.
 * Returns null rather than guessing: an unparseable number must ask the
 * customer again, never be coerced into something plausible.
 */

const AU_COUNTRY_CODE = "61";

export function normaliseAuPhone(input: string): string | null {
  if (typeof input !== "string") return null;
  let digits = input.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) {
    digits = digits.slice(1);
  } else if (digits.startsWith("0011")) {
    digits = digits.slice(4);
  } else if (digits.startsWith("0")) {
    digits = AU_COUNTRY_CODE + digits.slice(1);
  } else if (!digits.startsWith(AU_COUNTRY_CODE)) {
    // Bare 9-digit mobile (412345678) — assume Australia.
    if (digits.length === 9) digits = AU_COUNTRY_CODE + digits;
  }
  if (!/^\d+$/.test(digits)) return null;
  if (!digits.startsWith(AU_COUNTRY_CODE)) return null;
  const national = digits.slice(AU_COUNTRY_CODE.length);
  // AU mobile (4xxxxxxxx) or landline (8xxxxxxxx / 2xxxxxxxx), 9 digits national.
  if (national.length !== 9) return null;
  if (!/^[2-478]/.test(national)) return null;
  return `+${AU_COUNTRY_CODE}${national}`;
}

export function isE164(value: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(value);
}
