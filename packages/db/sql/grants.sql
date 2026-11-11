-- Least-privilege grants for the runtime role. Idempotent; run AFTER the
-- migrations, as the migrator (the owner of the tables).
--
-- webina_app gets: SELECT/INSERT/UPDATE/DELETE on tables, USAGE on sequences,
-- EXECUTE on the three webina_* functions, USAGE on schema public.
-- It does NOT get: CREATE on the schema, ownership, TRUNCATE, REFERENCES,
-- TRIGGER, or BYPASSRLS. Row Level Security therefore applies to every query.

REVOKE ALL ON SCHEMA public FROM webina_app;
GRANT USAGE ON SCHEMA public TO webina_app;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM webina_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO webina_app;

REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM webina_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO webina_app;

-- Migration bookkeeping is not the app's business.
REVOKE ALL ON TABLE webina_migrations FROM webina_app;

-- Future tables created by the migrator inherit the same grants.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO webina_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO webina_app;

GRANT EXECUTE ON FUNCTION webina_current_business_id() TO webina_app;
GRANT EXECUTE ON FUNCTION webina_current_user_id() TO webina_app;
GRANT EXECUTE ON FUNCTION webina_resolve_site_key(text) TO webina_app;
GRANT EXECUTE ON FUNCTION webina_list_memberships(text) TO webina_app;

-- Explicitly NOT granted: CREATE on schema public (no DDL), TRUNCATE, TRIGGER.
