/**
 * The Milestone 1 "done when", from the outside: a real sign-up, a real
 * sign-in, and a signed-in owner who can only reach their own tenant.
 *
 * Nothing here is mocked. The requests go through Better Auth's own handler
 * (so sessions are real rows and the cookie is the real cookie), the
 * authorisation decision is the same `server/tenant-access.ts` the dashboard
 * uses, and the database is the migrated test database running as the
 * least-privilege role with RLS switched on.
 */

import { afterAll, describe, expect, it } from "vitest";

import { closePool, createBusiness, type CreatedTenant } from "@webina/db";

import { getAuth } from "../src/lib/auth";
import {
  TenantAccessError,
  listMyBusinesses,
  loadBusinessOverview,
  requireTenantAccess,
} from "../src/server/tenant-access";

const BASE = process.env.BETTER_AUTH_URL ?? "http://localhost:3100";
const PASSWORD = "correct-horse-battery-9";

function authFetch(path: string, body: unknown, cookie?: string): Promise<Response> {
  return getAuth().handler(
    new Request(`${BASE}/api/auth${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: BASE,
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
}

/** The request headers a browser would replay after sign-in. */
function sessionHeaders(response: Response): Headers {
  const cookies = response.headers.getSetCookie();
  const cookie = cookies
    .map((line) => line.split(";")[0] ?? "")
    .filter((pair) => pair !== "")
    .join("; ");
  return new Headers({ cookie, origin: BASE });
}

interface Owner {
  userId: string;
  email: string;
  headers: Headers;
}

async function signUp(email: string, name: string): Promise<Owner> {
  const response = await authFetch("/sign-up/email", { email, password: PASSWORD, name });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { user: { id: string; email: string } };
  return { userId: body.user.id, email: body.user.email, headers: sessionHeaders(response) };
}

async function tenantFor(owner: Owner, name: string): Promise<CreatedTenant> {
  return createBusiness(
    {
      name,
      timezone: "Australia/Adelaide",
      tradeTemplate: "generic",
      ownerNotifyEmail: owner.email,
      assistantName: "Webina",
    },
    { userId: owner.userId, environment: "test" },
  );
}

afterAll(async () => {
  await closePool();
});

describe("sign-in", () => {
  it("sets a session cookie on sign-up and accepts the password again later", async () => {
    const email = "owner-one@example.test";
    const signUpResponse = await authFetch("/sign-up/email", {
      email,
      password: PASSWORD,
      name: "Owner One",
    });
    expect(signUpResponse.status).toBe(200);

    const setCookie = signUpResponse.headers.getSetCookie().join(" ");
    expect(setCookie).toMatch(/HttpOnly/i);

    const signIn = await authFetch("/sign-in/email", { email, password: PASSWORD });
    expect(signIn.status).toBe(200);
    expect(sessionHeaders(signIn).get("cookie")).toContain("session_token");
  });

  it("rejects the wrong password", async () => {
    const email = "owner-two@example.test";
    await authFetch("/sign-up/email", { email, password: PASSWORD, name: "Owner Two" });

    const bad = await authFetch("/sign-in/email", { email, password: "not-the-password-1" });
    expect(bad.status).toBe(401);
  });

  it("treats a request with no cookie as signed out", async () => {
    const business = await tenantFor(await signUp("owner-anon@example.test", "Anon"), "Anon Co");
    await expect(loadBusinessOverview(new Headers(), business.businessId)).rejects.toMatchObject({
      status: 401,
    });
    await expect(listMyBusinesses(new Headers())).rejects.toBeInstanceOf(TenantAccessError);
  });
});

describe("a signed-in owner reaches their own tenant and nobody else's", () => {
  it("opens their own business", async () => {
    const owner = await signUp("alpha-owner@example.test", "Alpha Owner");
    const alpha = await tenantFor(owner, "Alpha Mowing");

    const overview = await loadBusinessOverview(owner.headers, alpha.businessId);
    expect(overview.id).toBe(alpha.businessId);
    expect(overview.name).toBe("Alpha Mowing");
    expect(overview.sites).toHaveLength(1);
    expect(overview.sites[0]?.siteKey).toMatch(/^pk_test_[a-z2-9]{20}$/);
  });

  it("is refused another owner's business, with a 403 and no detail about it", async () => {
    const alpha = await signUp("alpha-two@example.test", "Alpha Two");
    const bravo = await signUp("bravo-two@example.test", "Bravo Two");
    const alphaTenant = await tenantFor(alpha, "Alpha Detailing");
    const bravoTenant = await tenantFor(bravo, "Bravo Barbers");

    await expect(
      loadBusinessOverview(alpha.headers, bravoTenant.businessId),
    ).rejects.toMatchObject({ status: 403, message: "you do not have access to this business" });

    await expect(requireTenantAccess(alpha.headers, bravoTenant.businessId)).rejects.toBeInstanceOf(
      TenantAccessError,
    );

    // And the same answer for a business that does not exist at all.
    await expect(
      loadBusinessOverview(alpha.headers, "00000000-0000-4000-8000-000000000000"),
    ).rejects.toMatchObject({ status: 403 });

    // Their own still opens.
    await expect(loadBusinessOverview(alpha.headers, alphaTenant.businessId)).resolves.toMatchObject(
      { name: "Alpha Detailing" },
    );
  });

  it("lists only the businesses the user belongs to", async () => {
    const carla = await signUp("carla@example.test", "Carla");
    const dave = await signUp("dave@example.test", "Dave");
    const carlaTenant = await tenantFor(carla, "Carla Cleaning");
    const daveTenant = await tenantFor(dave, "Dave's Detail");

    const carlaBusinesses = await listMyBusinesses(carla.headers);
    expect(carlaBusinesses.map((b) => b.businessId)).toEqual([carlaTenant.businessId]);
    expect(carlaBusinesses.map((b) => b.businessId)).not.toContain(daveTenant.businessId);

    const daveBusinesses = await listMyBusinesses(dave.headers);
    expect(daveBusinesses.map((b) => b.businessId)).toEqual([daveTenant.businessId]);
  });

  it("admits a member who was added to a business, and only that business", async () => {
    const owner = await signUp("shop-owner@example.test", "Shop Owner");
    const staff = await signUp("shop-staff@example.test", "Shop Staff");
    const shop = await tenantFor(owner, "Shop Owner Barbers");
    const staffOwnBusiness = await tenantFor(staff, "Staff Side Business");

    // Not a member yet.
    await expect(loadBusinessOverview(staff.headers, shop.businessId)).rejects.toMatchObject({
      status: 403,
    });

    // The owner adds them as staff, inside the shop's tenant context.
    const { withTenant, memberships } = await import("@webina/db");
    await withTenant(shop.businessId, async (tx) => {
      await tx
        .insert(memberships)
        .values({ businessId: shop.businessId, userId: staff.userId, role: "staff" });
    });

    await expect(loadBusinessOverview(staff.headers, shop.businessId)).resolves.toMatchObject({
      name: "Shop Owner Barbers",
    });
    expect((await requireTenantAccess(staff.headers, shop.businessId)).role).toBe("staff");

    // Membership of one business does not open another.
    await expect(
      loadBusinessOverview(staff.headers, staffOwnBusiness.businessId),
    ).resolves.toMatchObject({ name: "Staff Side Business" });
    await expect(
      loadBusinessOverview(staff.headers, "00000000-0000-4000-8000-000000000001"),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("returns nothing when a query asks for another tenant's rows (RLS under the membership check)", async () => {
    const erin = await signUp("erin@example.test", "Erin");
    const frank = await signUp("frank@example.test", "Frank");
    const erinTenant = await tenantFor(erin, "Erin's Gifts");
    const frankTenant = await tenantFor(frank, "Frank's Lawn");

    const { withTenant, businesses } = await import("@webina/db");
    const { eq } = await import("drizzle-orm");

    // Scoped to Erin's own business, but deliberately asking for Frank's row —
    // the query a bug would produce. Postgres returns nothing.
    const rows = await withTenant(erinTenant.businessId, (tx) =>
      tx
        .select({ id: businesses.id })
        .from(businesses)
        .where(eq(businesses.id, frankTenant.businessId)),
    );
    expect(rows).toHaveLength(0);
  });
});
