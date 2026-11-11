/**
 * Service-area checks.
 *
 * The honest failure mode matters more than the clever one: if we cannot tell
 * where the customer is, we ask for a suburb or postcode. We never guess "yes"
 * — a booking outside the area is a wasted trip for the owner.
 */

export interface ServiceAreaLike {
  type: string;
  values: string[];
  centerLat: number | null;
  centerLng: number | null;
  radiusKm: number | null;
}

export interface AreaInput {
  address?: string;
  suburb?: string;
  postcode?: string;
  lat?: number;
  lng?: number;
}

export type AreaVerdict =
  | { determined: true; inArea: boolean; matched: string | null; reason: string }
  | { determined: false; reason: string };

function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(/[.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Suburb names to test against, most specific first. */
function suburbCandidates(input: AreaInput): string[] {
  const out: string[] = [];
  if (input.suburb) out.push(normalise(input.suburb));
  if (input.address) {
    const address = normalise(input.address);
    out.push(address);
    // "12 Smith St, Norwood SA 5067" -> the comma-separated parts, and the
    // part with a trailing state/postcode removed.
    for (const part of address.split(",")) {
      const trimmed = part.trim();
      if (trimmed) out.push(trimmed.replace(/\s+(nsw|vic|qld|sa|wa|tas|nt|act)\s+\d{4}$/, "").trim());
    }
  }
  return out.filter((value) => value.length > 0);
}

function postcodeCandidates(input: AreaInput): string[] {
  const out: string[] = [];
  if (input.postcode) out.push(input.postcode.trim());
  const source = `${input.suburb ?? ""} ${input.address ?? ""}`;
  for (const match of source.matchAll(/\b(\d{4})\b/g)) out.push(match[1] ?? "");
  return out.filter((value) => /^\d{4}$/.test(value));
}

/** Great-circle distance in km. */
export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371;
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function checkArea(area: ServiceAreaLike, input: AreaInput): AreaVerdict {
  if (area.type === "none") {
    return { determined: true, inArea: true, matched: null, reason: "no area restriction is set" };
  }

  if (area.type === "suburb_list") {
    const candidates = suburbCandidates(input);
    if (candidates.length === 0) {
      return { determined: false, reason: "ask the customer for their suburb or postcode" };
    }
    for (const configured of area.values) {
      const wanted = normalise(configured);
      const hit = candidates.find(
        (candidate) => candidate === wanted || candidate.startsWith(`${wanted} `) ||
          candidate.endsWith(` ${wanted}`) || candidate.includes(` ${wanted} `),
      );
      if (hit) return { determined: true, inArea: true, matched: configured, reason: "in the service area" };
    }
    return {
      determined: true,
      inArea: false,
      matched: null,
      reason: `we only service: ${area.values.join(", ")}`,
    };
  }

  if (area.type === "postcode_list") {
    const candidates = postcodeCandidates(input);
    if (candidates.length === 0) {
      return { determined: false, reason: "ask the customer for their suburb or postcode" };
    }
    const match = candidates.find((candidate) => area.values.includes(candidate));
    if (match) {
      return { determined: true, inArea: true, matched: match, reason: "in the service area" };
    }
    return {
      determined: true,
      inArea: false,
      matched: null,
      reason: `we only service postcodes: ${area.values.join(", ")}`,
    };
  }

  if (area.type === "radius") {
    if (area.centerLat == null || area.centerLng == null || area.radiusKm == null) {
      return { determined: false, reason: "this business has no radius configured yet" };
    }
    if (input.lat == null || input.lng == null) {
      return {
        determined: false,
        reason: "ask the customer for their suburb or postcode so we can check the distance",
      };
    }
    const distance = haversineKm(
      { lat: area.centerLat, lng: area.centerLng },
      { lat: input.lat, lng: input.lng },
    );
    return {
      determined: true,
      inArea: distance <= area.radiusKm,
      matched: `${distance.toFixed(1)} km away`,
      reason:
        distance <= area.radiusKm
          ? `within ${area.radiusKm} km`
          : `outside the ${area.radiusKm} km service radius`,
    };
  }

  return { determined: false, reason: "this business has no service area configured" };
}
