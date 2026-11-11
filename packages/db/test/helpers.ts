import { getDb } from "../src/client";
import { user } from "../src/schema";
import { createBusiness, type CreatedTenant } from "../src/tenants";

/** Identity row for a test user (Better Auth's own table, no RLS). */
export async function createTestUser(email: string): Promise<string> {
  const id = crypto.randomUUID();
  await getDb()
    .insert(user)
    .values({ id, name: email.split("@")[0] ?? "Test", email, emailVerified: true });
  return id;
}

export interface TestTenant extends CreatedTenant {
  userId: string;
  ownerNotifyEmail: string;
}

export async function createTestTenant(
  name: string,
  options: { environment?: "live" | "test" } = {},
): Promise<TestTenant> {
  const ownerNotifyEmail = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}@example.test`;
  const userId = await createTestUser(ownerNotifyEmail);
  const created = await createBusiness(
    {
      name,
      timezone: "Australia/Adelaide",
      tradeTemplate: "generic",
      ownerNotifyEmail,
      assistantName: "Webina",
    },
    { userId, environment: options.environment ?? "test" },
  );
  return { ...created, userId, ownerNotifyEmail };
}

/** Drizzle wraps driver errors; the Postgres message is on `cause`. */
export function expectPgError(error: unknown, pattern: RegExp): void {
  const err = error as { message?: string; cause?: { message?: string } };
  const message = `${err.cause?.message ?? ""} ${err.message ?? ""}`;
  if (!pattern.test(message)) {
    throw new Error(`expected a Postgres error matching ${pattern}, got: ${message}`);
  }
}

/** Await a promise that must fail, and check the Postgres message it failed with. */
export async function expectRefused(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  let caught: unknown = null;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  if (caught === null) throw new Error(`expected a failure matching ${pattern}, but it succeeded`);
  expectPgError(caught, pattern);
}
