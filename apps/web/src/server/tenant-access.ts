/**
 * Who is asking, and which tenant may they see?
 *
 * Every dashboard read goes through here, in this order:
 *   1. the Better Auth session behind the request's cookies (401 if absent);
 *   2. the caller's membership of the requested business (403 if absent);
 *   3. withTenant(), so Postgres RLS scopes the query as a second layer.
 *
 * Step 2 is the authorisation decision; step 3 means a mistake in step 2 still
 * cannot return another business's rows. Both are covered by
 * test/auth-tenant.test.ts.
 */

import { eq } from "drizzle-orm";

import {
  businesses,
  listMemberships,
  requireMembership,
  sites,
  withTenant,
  type MembershipSummary,
} from "@webina/db";

export class TenantAccessError extends Error {
  constructor(
    readonly status: 401 | 403,
    message: string,
  ) {
    super(message);
    this.name = "TenantAccessError";
  }
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

/** The signed-in user, or null. Reads the session through Better Auth itself. */
export async function getSessionUser(headers: Headers): Promise<SessionUser | null> {
  const { getAuth } = await import("../lib/auth");
  const session = await getAuth().api.getSession({ headers });
  const user = session?.user;
  if (!user) return null;
  return { id: user.id, email: user.email, name: user.name };
}

export async function requireSession(headers: Headers): Promise<SessionUser> {
  const user = await getSessionUser(headers);
  if (user === null) throw new TenantAccessError(401, "sign in to continue");
  return user;
}

export interface TenantAccess {
  businessId: string;
  userId: string;
  role: string;
}

/** 401 when signed out, 403 when signed in but not a member of this business. */
export async function requireTenantAccess(
  headers: Headers,
  businessId: string,
): Promise<TenantAccess> {
  const user = await requireSession(headers);
  try {
    const membership = await requireMembership(businessId, user.id);
    return { businessId: membership.businessId, userId: user.id, role: membership.role };
  } catch {
    // Deliberately the same answer whether the business does not exist or
    // belongs to somebody else: the caller learns nothing about other tenants.
    throw new TenantAccessError(403, "you do not have access to this business");
  }
}

export async function listMyBusinesses(headers: Headers): Promise<MembershipSummary[]> {
  const user = await requireSession(headers);
  return listMemberships(user.id);
}

export interface BusinessOverview {
  id: string;
  name: string;
  slug: string;
  status: string;
  timezone: string;
  tradeTemplate: string;
  assistantName: string;
  sites: Array<{
    id: string;
    label: string | null;
    siteKey: string;
    allowedOrigins: string[];
    isActive: boolean;
  }>;
}

/** The tenant dashboard's data, scoped by membership and then by RLS. */
export async function loadBusinessOverview(
  headers: Headers,
  businessId: string,
): Promise<BusinessOverview> {
  const access = await requireTenantAccess(headers, businessId);

  return withTenant({ businessId: access.businessId, userId: access.userId }, async (tx) => {
    const [business] = await tx
      .select({
        id: businesses.id,
        name: businesses.name,
        slug: businesses.slug,
        status: businesses.status,
        timezone: businesses.timezone,
        tradeTemplate: businesses.tradeTemplate,
        assistantName: businesses.assistantName,
      })
      .from(businesses)
      .where(eq(businesses.id, access.businessId));

    if (!business) {
      throw new TenantAccessError(403, "you do not have access to this business");
    }

    const siteRows = await tx
      .select({
        id: sites.id,
        label: sites.label,
        siteKey: sites.siteKey,
        allowedOrigins: sites.allowedOrigins,
        isActive: sites.isActive,
      })
      .from(sites)
      .where(eq(sites.businessId, access.businessId));

    return { ...business, sites: siteRows };
  });
}
