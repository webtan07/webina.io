/**
 * The dashboard's server functions.
 *
 * These are the only way the browser reaches tenant data: each one reads the
 * request's session cookies on the server, decides access in
 * `server/tenant-access.ts`, and returns a plain, serialisable result. The
 * heavy imports (Better Auth, the pg pool, drizzle) are loaded inside the
 * handlers so they never enter the browser bundle.
 */

import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";

import { createBusinessInput, type CreateBusinessInput } from "@webina/shared";
import type { MembershipSummary } from "@webina/db";

import type { BusinessOverview } from "./tenant-access";

const requestHeaders = createServerOnlyFn(async (): Promise<Headers> => {
  const { getRequestHeaders } = await import("@tanstack/react-start/server");
  return new Headers(getRequestHeaders() as unknown as Record<string, string>);
});

export type DashboardResult =
  | { status: "signed_out" }
  | {
      status: "ok";
      user: { id: string; email: string; name: string };
      businesses: MembershipSummary[];
    };

export const fetchDashboard = createServerFn({ method: "GET" }).handler(
  async (): Promise<DashboardResult> => {
    const { getSessionUser, listMyBusinesses } = await import("./tenant-access");
    const headers = await requestHeaders();
    const user = await getSessionUser(headers);
    if (user === null) return { status: "signed_out" };
    return { status: "ok", user, businesses: await listMyBusinesses(headers) };
  },
);

export type BusinessResult =
  | { status: "signed_out" }
  | { status: "forbidden" }
  | { status: "ok"; business: BusinessOverview };

export const fetchBusiness = createServerFn({ method: "GET" })
  .validator((input: { businessId: string }) => input)
  .handler(async ({ data }): Promise<BusinessResult> => {
    const { loadBusinessOverview, TenantAccessError } = await import("./tenant-access");
    try {
      const business = await loadBusinessOverview(await requestHeaders(), data.businessId);
      return { status: "ok", business };
    } catch (error) {
      if (error instanceof TenantAccessError) {
        return error.status === 401 ? { status: "signed_out" } : { status: "forbidden" };
      }
      throw error;
    }
  });

export type CreateBusinessResult =
  | { status: "signed_out" }
  | { status: "invalid"; message: string }
  | { status: "ok"; businessId: string };

export const createBusinessForCurrentUser = createServerFn({ method: "POST" })
  .validator((input: CreateBusinessInput) => input)
  .handler(async ({ data }): Promise<CreateBusinessResult> => {
    const parsed = createBusinessInput.safeParse(data);
    if (!parsed.success) {
      return { status: "invalid", message: parsed.error.issues[0]?.message ?? "check the form" };
    }

    const { requireSession, TenantAccessError } = await import("./tenant-access");
    const { createBusiness } = await import("@webina/db");

    try {
      const user = await requireSession(await requestHeaders());
      const created = await createBusiness(parsed.data, { userId: user.id });
      return { status: "ok", businessId: created.businessId };
    } catch (error) {
      if (error instanceof TenantAccessError && error.status === 401) return { status: "signed_out" };
      throw error;
    }
  });
