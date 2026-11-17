/**
 * Tenant branding, as the widget needs it.
 *
 * The brand colour arrives from the dashboard and ends up inside a stylesheet
 * on a stranger's page, so it is never trusted: anything that is not a plain
 * colour token is replaced with the Webina teal rather than injected. This
 * module has no dependencies on purpose — the widget bundle imports it, and a
 * chat widget has no business shipping a schema library to a customer's page.
 */

export const DEFAULT_BRAND_COLOR = "#0f7b8a";

/** #rgb, #rrggbb, #rrggbbaa, rgb()/rgba()/hsl()/hsla() with digits only, or a bare colour name. */
const SAFE_COLOR =
  /^(#[0-9a-f]{3,8}|(?:rgb|rgba|hsl|hsla)\(\s*[0-9]{1,3}(?:\.\d{1,2})?%?(?:\s*[, ]\s*[0-9]{1,3}(?:\.\d{1,2})?%?){2,3}\s*(?:\/\s*[0-9.]{1,6}\s*)?\)|[a-z]{3,20})$/i;

/** A colour that is safe to put in a stylesheet, or the fallback. */
export function safeBrandColor(input: unknown, fallback: string = DEFAULT_BRAND_COLOR): string {
  if (typeof input !== "string") return fallback;
  const value = input.trim();
  if (value === "" || value.length > 60) return fallback;
  return SAFE_COLOR.test(value) ? value : fallback;
}

/** #rrggbb -> [r, g, b], or null for anything else. */
function hexToRgb(color: string): [number, number, number] | null {
  const hex = color.trim().replace(/^#/, "");
  if (!/^[0-9a-f]{3,8}$/i.test(hex)) return null;
  const full =
    hex.length === 3 || hex.length === 4
      ? hex
          .slice(0, 3)
          .split("")
          .map((part) => part + part)
          .join("")
      : hex.slice(0, 6);
  const n = Number.parseInt(full, 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function channelLuminance(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/**
 * Text colour that stays readable on the tenant's brand colour: white on a
 * dark brand, ink on a light one. Non-hex colours fall back to white, which is
 * what the default teal needs.
 */
export function brandInk(color: string, darkInk = "#101820"): string {
  const rgb = hexToRgb(color);
  if (rgb === null) return "#ffffff";
  const [r, g, b] = rgb;
  const luminance =
    0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
  return luminance > 0.5 ? darkInk : "#ffffff";
}
