/**
 * Tenant creation and site keys.
 *
 * A business is created together with its first owner membership and its first
 * site key, in one transaction. The new business id is generated here so the
 * insert already satisfies the RLS policy (id = app.business_id) — there is no
 * "create a row nobody can see" window and no privileged escape hatch.
 */

import { and, eq } from "drizzle-orm";

import {
  createBusinessInput,
  generateSiteKey,
  isOriginAllowed,
  normalizeOriginList,
  siteInput,
  slugify,
  type CreateBusinessInput,
  type SiteInput,
} from "@webina/shared";

import { businesses, memberships, sites } from "./schema";
import { ensureLeastPrivilege, getPool } from "./client";
import { withTenant, withUser, resolveSiteKey } from "./tenant";

export interface CreatedTenant {
  businessId: string;
  slug: string;
  siteId: string;
  siteKey: string;
}

async function uniqueSlug(base: string): Promise<string> {
  const root = slugify(base) || "business";
  // Slug is a public, globally unique handle; a short random suffix avoids a
  // collision race between two sign-ups with the same business name.
  return `${root}-${crypto.randomUUID().slice(0, 4)}`;
}

export async function createBusiness(
  input: CreateBusinessInput,
  options: { userId: string; environment?: "live" | "test" },
): Promise<CreatedTenant> {
  const parsed = createBusinessInput.parse(input);
  if (!options.userId) throw new TypeError("createBusiness needs the signed-in user");

  const businessId = crypto.randomUUID();
  const slug = await uniqueSlug(parsed.name);
  const siteKey = generateSiteKey(options.environment ?? "live");

  return withTenant({ businessId, userId: options.userId }, async (tx) => {
    await tx.insert(businesses).values({
      id: businessId,
      name: parsed.name,
      slug,
      tradeTemplate: parsed.tradeTemplate,
      timezone: parsed.timezone,
      ownerNotifyEmail: parsed.ownerNotifyEmail,
      ownerNotifyPhone: parsed.ownerNotifyPhone ?? null,
      assistantName: parsed.assistantName,
      status: "trial",
      currency: "AUD",
    });

    await tx.insert(memberships).values({
      userId: options.userId,
      businessId,
      role: "owner",
    });

    const [site] = await tx
      .insert(sites)
      .values({
        businessId,
        label: "Main site",
        siteKey,
        allowedOrigins: [],
        isActive: true,
      })
      .returning({ id: sites.id, siteKey: sites.siteKey });

    if (!site) throw new Error("site row was not created");

    return { businessId, slug, siteId: site.id, siteKey: site.siteKey };
  });
}

export interface MembershipSummary {
  businessId: string;
  name: string;
  slug: string;
  role: string;
  timezone: string;
}

/** The businesses the signed-in user may open. Runs before a tenant is chosen. */
export async function listMemberships(userId: string): Promise<MembershipSummary[]> {
  // A SECURITY DEFINER function, because the businesses table is invisible
  // until a tenant is chosen. It returns only this user's own memberships.
  const client = await getPool().connect();
  try {
    await ensureLeastPrivilege(getPool());
    const { rows } = await client.query<{
      business_id: string;
      role: string;
      name: string;
      slug: string;
      timezone: string;
    }>("SELECT * FROM webina_list_memberships($1)", [userId]);
    return rows.map((r) => ({
      businessId: r.business_id,
      role: r.role,
      name: r.name,
      slug: r.slug,
      timezone: r.timezone,
    }));
  } finally {
    client.release();
  }
}

/** Server-side authorisation: is this user a member of this business? */
export async function requireMembership(
  businessId: string,
  userId: string,
): Promise<{ businessId: string; role: string }> {
  const rows = await withUser(userId, async (tx) =>
    tx
      .select({ businessId: memberships.businessId, role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.businessId, businessId), eq(memberships.userId, userId))),
  );
  const row = rows[0];
  if (!row) throw new Error("not a member of this business");
  return row;
}

export async function listSites(businessId: string) {
  return withTenant(businessId, async (tx) =>
    tx
      .select({
        id: sites.id,
        label: sites.label,
        siteKey: sites.siteKey,
        allowedOrigins: sites.allowedOrigins,
        isActive: sites.isActive,
        createdAt: sites.createdAt,
      })
      .from(sites)
      .where(eq(sites.businessId, businessId)),
  );
}

export async function createSite(
  businessId: string,
  input: SiteInput,
  environment: "live" | "test" = "live",
) {
  const parsed = siteInput.parse(input);
  const origins = normalizeOriginList(parsed.allowedOrigins);
  return withTenant(businessId, async (tx) => {
    const [site] = await tx
      .insert(sites)
      .values({
        businessId,
        label: parsed.label ?? "Site",
        siteKey: generateSiteKey(environment),
        allowedOrigins: origins,
        isActive: true,
      })
      .returning({ id: sites.id, siteKey: sites.siteKey, allowedOrigins: sites.allowedOrigins });
    if (!site) throw new Error("site row was not created");
    return site;
  });
}

export async function setAllowedOrigins(
  businessId: string,
  siteId: string,
  origins: readonly string[],
) {
  const normalized = normalizeOriginList(origins);
  return withTenant(businessId, async (tx) => {
    const [updated] = await tx
      .update(sites)
      .set({ allowedOrigins: normalized, updatedAt: new Date() })
      .where(and(eq(sites.id, siteId), eq(sites.businessId, businessId)))
      .returning({ id: sites.id, allowedOrigins: sites.allowedOrigins });
    if (!updated) throw new Error("site not found for this business");
    return updated;
  });
}

export async function rotateSiteKey(businessId: string, siteId: string) {
  return withTenant(businessId, async (tx) => {
    const [updated] = await tx
      .update(sites)
      .set({ siteKey: generateSiteKey("live"), updatedAt: new Date() })
      .where(and(eq(sites.id, siteId), eq(sites.businessId, businessId)))
      .returning({ id: sites.id, siteKey: sites.siteKey });
    if (!updated) throw new Error("site not found for this business");
    return updated;
  });
}

export class SiteRequestRejected extends Error {
  constructor(
    readonly code: "unknown_site_key" | "site_inactive" | "origin_not_allowed",
    message: string,
  ) {
    super(message);
    this.name = "SiteRequestRejected";
  }
}

/**
 * The widget's door: site key + Origin header -> business id.
 * The key is public, so the origin check is what makes it a tenant boundary.
 */
export async function resolveSiteForRequest(
  siteKey: string,
  origin: string | null,
): Promise<{ businessId: string; siteId: string }> {
  const site = await resolveSiteKey(siteKey);
  if (site === null) {
    throw new SiteRequestRejected("unknown_site_key", "unknown site key");
  }
  if (!site.isActive) {
    throw new SiteRequestRejected("site_inactive", "this site key is switched off");
  }
  if (!isOriginAllowed(site.allowedOrigins, origin)) {
    throw new SiteRequestRejected("origin_not_allowed", "origin is not registered for this site");
  }
  const siteRow = await withTenant(site.businessId, async (tx) => {
    const rows = await tx
      .select({ id: sites.id })
      .from(sites)
      .where(and(eq(sites.siteKey, siteKey), eq(sites.businessId, site.businessId)));
    return rows[0] ?? null;
  });
  if (siteRow === null) {
    throw new SiteRequestRejected("unknown_site_key", "unknown site key");
  }
  return { businessId: site.businessId, siteId: siteRow.id };
}
