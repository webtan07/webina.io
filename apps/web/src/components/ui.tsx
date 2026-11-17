/**
 * Small presentational pieces the dashboard pages share.
 *
 * Dates are always formatted with the business's own timezone passed in
 * explicitly, so the server-rendered HTML and the browser agree — no
 * hydration mismatch and no "yesterday" for a customer in Perth.
 */

import type { ReactNode } from "react";

export function Pill({
  children,
  tone,
}: {
  children: ReactNode;
  tone?: "ok" | "warn" | "danger";
}) {
  return <span className={tone ? `pill ${tone}` : "pill"}>{children}</span>;
}

export function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="stat">
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}

/** A$1,900 — whole dollars lose the cents, as the site does. */
export function money(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "—";
  const dollars = cents / 100;
  return `A$${dollars % 1 === 0 ? dollars.toLocaleString("en-AU") : dollars.toFixed(2)}`;
}

export function formatDateTime(value: Date | string, timeZone: string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en-AU", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function formatTime(value: Date | string, timeZone: string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en-AU", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function formatDay(value: string, timeZone: string): string {
  const date = new Date(`${value}T12:00:00Z`);
  return new Intl.DateTimeFormat("en-AU", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(date);
}

/** Today's date in the business's timezone, as YYYY-MM-DD. */
export function todayIn(timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export type AnyResult = { status: string; message?: string };

/** One place to show a failed server call, so a page never fails silently. */
export function ResultNotice({ result }: { result: AnyResult | null }) {
  if (!result || result.status === "ok") return null;
  const text =
    result.status === "signed_out"
      ? "Your session expired. Sign in again."
      : result.status === "forbidden"
        ? "You do not have access to this business."
        : (result.message ?? "Something went wrong. Try again.");
  return <div className="notice error">{text}</div>;
}

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function pricingSummary(service: {
  pricingType: string;
  priceCents: number | null;
  pricingConfig: Record<string, unknown>;
}): string {
  if (service.pricingType === "quote_only") return "Quoted after a request";
  if (service.pricingType === "tiered") {
    const tiers = (service.pricingConfig.tiers as { priceCents: number }[] | undefined) ?? [];
    if (tiers.length === 0) return "Tiered";
    const prices = tiers.map((tier) => tier.priceCents);
    return `${money(Math.min(...prices))} – ${money(Math.max(...prices))}`;
  }
  if (service.pricingType === "from") return `From ${money(service.priceCents)}`;
  return money(service.priceCents);
}
