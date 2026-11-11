# Webina

The AI front desk for local service businesses. One pnpm monorepo:

| Path | What it is |
| --- | --- |
| `packages/shared` | Zod schemas, plans, ids, phone and origin helpers |
| `packages/db` | Drizzle schema, migrations, RLS, `withTenant()`, tenant creation |
| `apps/web` | TanStack Start shell: sign-in, dashboard, tenant pages, Better Auth |

## Local setup

### 1. Postgres

Any Postgres 16 works. The tests expect a superuser connection on **port 5433**
(the port is only a convention — override it with `TEST_ADMIN_DATABASE_URL`).

```bash
# if you have none running, one way to get one:
docker run -d --name webina-pg -p 5433:5432 \
  -e POSTGRES_PASSWORD=postgres postgres:16
```

### 2. Environment

Copy `.env.example` to `.env` and fill it in. Two connection strings matter:

- `DATABASE_URL` — the **least-privilege runtime role** (`webina_app`). The app
  refuses to start if this role is a superuser, has `BYPASSRLS`, or owns tables,
  because any of those silently switches Row Level Security off.
- `MIGRATE_DATABASE_URL` — the migrator role that owns the tables. Used only by
  `pnpm db:migrate`, never at runtime.

`BETTER_AUTH_SECRET` (`openssl rand -base64 32`) and `BETTER_AUTH_URL` are
required for sign-in. Email is optional for now: without `EMAIL_SERVER_URL` the
magic-link email is written to the server log in development and is a loud
error in production.

### 3. Roles, database, migrations

```bash
pnpm install
pnpm db:roles     # creates webina_app and webina_migrator (superuser needed)
pnpm db:migrate   # applies packages/db/migrations/*.sql as the migrator
```

`packages/db/sql/grants.sql` is applied by the test harness; for a hand-built
database, run it after the migrations (it grants the runtime role exactly
`SELECT/INSERT/UPDATE/DELETE` and no DDL).

### 4. Run it

```bash
pnpm --filter @webina/web run dev     # http://localhost:3100
```

Sign up, then add a business — that creates the business, your owner membership
and its first website key in one transaction.

## Tests

The tests need a real Postgres; nothing is mocked and nothing runs as a
superuser except the setup step that creates roles and the database.

```bash
pnpm --filter @webina/db run test     # RLS, least privilege, tenancy, site keys
pnpm --filter @webina/web run test    # Better Auth sign-in + cross-tenant refusal
```

Each suite creates its own throwaway database (`webina_test`) from the
migrations, so they can be run in either order. CI runs both against a Postgres
service container: `.github/workflows/ci.yml`.

`pnpm run build` generates `apps/web/src/routeTree.gen.ts` (gitignored); run it
once before `pnpm -r run typecheck` on a fresh clone.

## How tenancy works

1. **Membership** — `apps/web/src/server/tenant-access.ts` resolves the Better
   Auth session, then asks `requireMembership()` whether this user belongs to
   the business they asked for. No membership: 403, with the same message
   whether the business is somebody else's or does not exist.
2. **RLS** — every tenant query runs inside `withTenant(businessId, fn)`, which
   sets `app.business_id` for that transaction only. Postgres policies then
   refuse rows belonging to another business, so a forgotten `WHERE` leaks
   nothing.

Identity (`user`, `session`, `account`, `verification`, `two_factor`) is global
and has no RLS: a session has to be read before any tenant is known. Tenancy is
`memberships`, and a user can belong to more than one business.

Auth is Better Auth: email + password (10-character minimum), a magic link
available, TOTP 2FA available and off by default. No GST anywhere — Web Digital
Assistants is a sole trader below the A$100,000 threshold, so the schema has no
tax column and the copy never mentions one.
