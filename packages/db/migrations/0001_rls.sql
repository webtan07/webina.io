-- 0001_rls.sql — Row Level Security for every tenant-owned table.
--
-- Two layers protect tenant data:
--   1. every query goes through withTenant(), which sets `app.business_id`
--      transaction-locally (set_config(..., true));
--   2. Postgres itself refuses rows belonging to another business, because the
--      policy compares business_id to that setting.
--
-- The runtime role (webina_app) is subject to these policies: it does not own
-- the tables, is not a superuser and does not have BYPASSRLS. The migrator role
-- owns the tables and therefore bypasses RLS — it is never used at runtime, and
-- the app refuses to start if its connection turns out to have BYPASSRLS
-- (see packages/db/src/client.ts).
--
-- Identity tables (`user`, `session`, `account`, `verification`, `two_factor`)
-- deliberately have no RLS: they are platform-global, and Better Auth must read
-- a session by token before any tenant is known. See docs/ARCHITECTURE.md.

/* ------------------------------------------------------------------ *
 * Request context helpers
 * ------------------------------------------------------------------ */

-- NULL when no tenant is set, so the policy fails closed (no rows) rather than
-- erroring or matching everything.
CREATE OR REPLACE FUNCTION webina_current_business_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.business_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION webina_current_user_id() RETURNS text
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.user_id', true), '') $$;

/* ------------------------------------------------------------------ *
 * Tenant tables
 * ------------------------------------------------------------------ */

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'services',
    'service_areas',
    'availability_rules',
    'availability_exceptions',
    'bookings',
    'job_requests',
    'conversations',
    'messages',
    'handoffs',
    'usage_events',
    'subscriptions',
    'audit_log',
    'consents',
    'opt_outs',
    'notifications',
    'scheduled_messages'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL TO PUBLIC '
      'USING (business_id = webina_current_business_id()) '
      'WITH CHECK (business_id = webina_current_business_id())',
      t
    );
  END LOOP;
END
$$;

-- `sites` and `businesses` key on id rather than a business_id column.
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON businesses;
CREATE POLICY tenant_isolation ON businesses FOR ALL TO PUBLIC
  USING (id = webina_current_business_id())
  WITH CHECK (id = webina_current_business_id());

ALTER TABLE sites ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON sites;
CREATE POLICY tenant_isolation ON sites FOR ALL TO PUBLIC
  USING (business_id = webina_current_business_id())
  WITH CHECK (business_id = webina_current_business_id());

-- Memberships is readable by the signed-in user for their own rows (the
-- dashboard has to list "my businesses" before a tenant is chosen) and
-- otherwise only inside the tenant.
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON memberships;
CREATE POLICY tenant_isolation ON memberships FOR ALL TO PUBLIC
  USING (
    business_id = webina_current_business_id()
    OR user_id = webina_current_user_id()
  )
  WITH CHECK (business_id = webina_current_business_id());

/* ------------------------------------------------------------------ *
 * Site-key resolution
 * ------------------------------------------------------------------ *
 * The widget presents a public site key, so the business has to be discovered
 * before any tenant context exists. This function is the only door: it returns
 * the business id and the registered origins for one key, and nothing else.
 */

CREATE OR REPLACE FUNCTION webina_resolve_site_key(p_site_key text)
  RETURNS TABLE (business_id uuid, allowed_origins text[], is_active boolean)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    SELECT s.business_id, s.allowed_origins, s.is_active
    FROM sites s
    WHERE s.site_key = p_site_key
  $$;

REVOKE ALL ON FUNCTION webina_resolve_site_key(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION webina_current_business_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION webina_current_user_id() FROM PUBLIC;

/* ------------------------------------------------------------------ *
 * Membership lookup
 * ------------------------------------------------------------------ *
 * The dashboard lists "my businesses" before a tenant is chosen, and the
 * businesses table is invisible without a tenant. This function returns only
 * the caller's own memberships, joined to the business name.
 */

CREATE OR REPLACE FUNCTION webina_list_memberships(p_user_id text)
  RETURNS TABLE (business_id uuid, role text, name text, slug text, timezone text)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    SELECT m.business_id, m.role, b.name, b.slug, b.timezone
    FROM memberships m
    JOIN businesses b ON b.id = m.business_id
    WHERE m.user_id = p_user_id
  $$;

REVOKE ALL ON FUNCTION webina_list_memberships(text) FROM PUBLIC;
