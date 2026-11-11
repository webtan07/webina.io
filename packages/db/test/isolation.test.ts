/**
 * Milestone 1's "done when": two tenants exist and automated tests prove tenant
 * A cannot read or write tenant B's data.
 *
 * These tests run against real Postgres, as the real runtime role
 * (`webina_app`: no DDL, no ownership, NOBYPASSRLS). If RLS were inert they
 * would fail, which is the point.
 */

import { and, eq, sql } from "drizzle-orm";
import { Pool } from "pg";
import { beforeAll, describe, expect, it } from "vitest";

import { assertLeastPrivilege, closePool } from "../src/client";
import { businesses, memberships, services, sites } from "../src/schema";
import { withTenant, withUser } from "../src/tenant";
import {
  createSite,
  createBusiness,
  listMemberships,
  listSites,
  resolveSiteForRequest,
  setAllowedOrigins,
  SiteRequestRejected,
} from "../src/tenants";
import { createTestTenant, expectRefused, type TestTenant } from "./helpers";
import { APP_TEST_URL, MIGRATOR_TEST_URL } from "./db-urls";

let a: TestTenant;
let b: TestTenant;

beforeAll(async () => {
  await closePool();
  a = await createTestTenant("Alpha Mowing", { environment: "test" });
  b = await createTestTenant("Bravo Barber", { environment: "test" });

  await withTenant(a.businessId, async (tx) => {
    await tx.insert(services).values({ businessId: a.businessId, name: "Mow front lawn", priceCents: 8000 });
  });
  await withTenant(b.businessId, async (tx) => {
    await tx.insert(services).values({ businessId: b.businessId, name: "Cut and blow dry", priceCents: 6000 });
  });
});

describe("tenant isolation (RLS, as the runtime role)", () => {
  it("sees only its own business row", async () => {
    const rows = await withTenant(a.businessId, (tx) => tx.select().from(businesses));
    expect(rows.map((r) => r.id)).toEqual([a.businessId]);
    expect(rows[0]?.name).toBe("Alpha Mowing");
  });

  it("cannot read another tenant's row by id", async () => {
    const rows = await withTenant(a.businessId, (tx) =>
      tx.select().from(businesses).where(eq(businesses.id, b.businessId)),
    );
    expect(rows).toHaveLength(0);
  });

  it("cannot read another tenant's services", async () => {
    const mine = await withTenant(a.businessId, (tx) =>
      tx.select().from(services).where(eq(services.businessId, b.businessId)),
    );
    expect(mine).toHaveLength(0);

    const all = await withTenant(a.businessId, (tx) => tx.select().from(services));
    expect(all.map((s) => s.name)).toEqual(["Mow front lawn"]);
  });

  it("cannot read another tenant's sites or memberships", async () => {
    const otherSites = await withTenant(a.businessId, (tx) =>
      tx.select().from(sites).where(eq(sites.businessId, b.businessId)),
    );
    expect(otherSites).toHaveLength(0);

    const otherMemberships = await withTenant(a.businessId, (tx) =>
      tx.select().from(memberships).where(eq(memberships.businessId, b.businessId)),
    );
    expect(otherMemberships).toHaveLength(0);
  });

  it("cannot insert a row for another tenant", async () => {
    await expectRefused(
      withTenant(a.businessId, async (tx) => {
        await tx.insert(services).values({ businessId: b.businessId, name: "Injected service" });
      }),
      /row-level security/i,
    );
  });

  it("cannot update or delete another tenant's row", async () => {
    const updated = await withTenant(a.businessId, (tx) =>
      tx
        .update(services)
        .set({ name: "hijacked" })
        .where(eq(services.businessId, b.businessId))
        .returning({ id: services.id }),
    );
    expect(updated).toHaveLength(0);

    const deleted = await withTenant(a.businessId, (tx) =>
      tx.delete(services).where(eq(services.businessId, b.businessId)).returning({ id: services.id }),
    );
    expect(deleted).toHaveLength(0);

    // And the row is untouched.
    const theirs = await withTenant(b.businessId, (tx) => tx.select().from(services));
    expect(theirs.map((s) => s.name)).toEqual(["Cut and blow dry"]);
  });

  it("cannot move its own row into another tenant", async () => {
    await expectRefused(
      withTenant(a.businessId, async (tx) => {
        await tx.update(services).set({ businessId: b.businessId }).where(eq(services.businessId, a.businessId));
      }),
      /row-level security/i,
    );
  });

  it("fails closed when no tenant is set", async () => {
    const rows = await withUser(a.userId, (tx) => tx.select().from(services));
    expect(rows).toHaveLength(0);

    const businessesSeen = await withUser(a.userId, (tx) => tx.select().from(businesses));
    expect(businessesSeen).toHaveLength(0);

    // The membership list still works, because memberships has its own policy.
    const myMemberships = await withUser(a.userId, (tx) => tx.select().from(memberships));
    expect(myMemberships.map((m) => m.businessId)).toEqual([a.businessId]);
  });

  it("rejects a business id that is not a uuid before touching the database", async () => {
    await expect(withTenant("not-a-uuid", async () => 1)).rejects.toThrow(TypeError);
  });

  it("keeps contexts apart when two tenants are queried concurrently", async () => {
    const reads = await Promise.all([
      withTenant(a.businessId, (tx) => tx.select().from(businesses)),
      withTenant(b.businessId, (tx) => tx.select().from(businesses)),
      withTenant(a.businessId, (tx) => tx.select().from(businesses)),
      withTenant(b.businessId, (tx) => tx.select().from(businesses)),
    ]);
    expect(reads[0]?.map((r) => r.name)).toEqual(["Alpha Mowing"]);
    expect(reads[1]?.map((r) => r.name)).toEqual(["Bravo Barber"]);
    expect(reads[2]?.map((r) => r.name)).toEqual(["Alpha Mowing"]);
    expect(reads[3]?.map((r) => r.name)).toEqual(["Bravo Barber"]);
  });

  it("leaves no tenant setting behind on the pooled connection", async () => {
    await withTenant(a.businessId, (tx) => tx.select().from(businesses));
    const after = await withUser(a.userId, (tx) => tx.select().from(businesses));
    expect(after).toHaveLength(0);
  });
});

describe("the runtime role is least privilege", () => {
  it("cannot run DDL", async () => {
    await expectRefused(
      withTenant(a.businessId, (tx) => tx.execute(sql`CREATE TABLE should_not_exist (id int)`)),
      /permission denied/i,
    );
  });

  it("cannot truncate", async () => {
    await expectRefused(
      withTenant(a.businessId, (tx) => tx.execute(sql`TRUNCATE services`)),
      /permission denied/i,
    );
  });

  it("refuses to run at all as the migrator (BYPASSRLS would hide the bug)", async () => {
    const pool = new Pool({ connectionString: MIGRATOR_TEST_URL, max: 1 });
    const client = await pool.connect();
    try {
      await expect(assertLeastPrivilege(client)).rejects.toThrow(/bypass|owns tables/i);
    } finally {
      client.release();
      await pool.end();
    }
  });

  it("connects as webina_app, not as the owner", async () => {
    const pool = new Pool({ connectionString: APP_TEST_URL, max: 1 });
    const client = await pool.connect();
    try {
      const { rows } = await client.query<{ current_user: string; rolbypassrls: boolean }>(
        "SELECT current_user, (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) FROM (SELECT 1) t",
      );
      expect(rows[0]?.current_user).toBe("webina_app");
      expect(rows[0]?.rolbypassrls).toBe(false);
    } finally {
      client.release();
      await pool.end();
    }
  });
});

describe("tenant creation, memberships and site keys", () => {
  it("creates the business, the owner membership and a site key together", async () => {
    const membershipsForUser = await listMemberships(a.userId);
    expect(membershipsForUser).toHaveLength(1);
    expect(membershipsForUser[0]).toMatchObject({ businessId: a.businessId, role: "owner", name: "Alpha Mowing" });

    const siteList = await listSites(a.businessId);
    expect(siteList).toHaveLength(1);
    expect(siteList[0]?.siteKey).toMatch(/^pk_test_[a-z2-9]{20}$/);
  });

  it("does not list a business the user does not belong to", async () => {
    const bMembers = await listMemberships(b.userId);
    expect(bMembers.map((m) => m.businessId)).toEqual([b.businessId]);
  });

  it("refuses a site key from an origin the tenant has not registered", async () => {
    await expect(resolveSiteForRequest(a.siteKey, "https://evil.example")).rejects.toBeInstanceOf(
      SiteRequestRejected,
    );
    await expect(resolveSiteForRequest(a.siteKey, null)).rejects.toBeInstanceOf(SiteRequestRejected);
    await expect(resolveSiteForRequest("pk_test_aaaaaaaaaaaaaaaaaaaa", "https://a.example")).rejects.toMatchObject({
      code: "unknown_site_key",
    });
  });

  it("resolves a registered origin to the right tenant and nobody else's", async () => {
    const siteId = (await listSites(a.businessId))[0]?.id;
    if (!siteId) throw new Error("missing site");
    await setAllowedOrigins(a.businessId, siteId, ["https://alpha.example", "https://www.alpha.example"]);

    const resolved = await resolveSiteForRequest(a.siteKey, "https://alpha.example");
    expect(resolved.businessId).toBe(a.businessId);

    // B has registered no origins, so A's origin must not open B's site.
    await expect(resolveSiteForRequest(b.siteKey, "https://alpha.example")).rejects.toMatchObject({
      code: "origin_not_allowed",
    });
  });

  it("only lets a tenant add origins to its own site", async () => {
    const bSiteId = (await listSites(b.businessId))[0]?.id;
    if (!bSiteId) throw new Error("missing site");
    await expect(setAllowedOrigins(a.businessId, bSiteId, ["https://evil.example"])).rejects.toThrow(
      /not found for this business/,
    );
  });

  it("keeps a second site for the same tenant separate and scoped", async () => {
    const extra = await createSite(a.businessId, { label: "Landing page", allowedOrigins: [] }, "test");
    expect(extra.siteKey).not.toBe(a.siteKey);
    const visibleToB = await withTenant(b.businessId, (tx) =>
      tx.select().from(sites).where(and(eq(sites.id, extra.id), eq(sites.businessId, a.businessId))),
    );
    expect(visibleToB).toHaveLength(0);
  });

  it("creates a slug that is unique and url-safe", async () => {
    const other = await createBusiness(
      {
        name: "Alpha Mowing",
        timezone: "Australia/Brisbane",
        tradeTemplate: "lawn_mowing",
        ownerNotifyEmail: "second@example.test",
        assistantName: "Webina",
      },
      { userId: a.userId, environment: "test" },
    );
    expect(other.slug).toMatch(/^alpha-mowing-[0-9a-f]{4}$/);
    expect(other.businessId).not.toBe(a.businessId);
  });
});
