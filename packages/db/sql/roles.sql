-- Create the two database roles. Idempotent.
--
-- Run ONCE per database as the project owner (Neon: the default `neondb_owner`
-- role, or the Neon console's "Create role"):
--
--   pnpm db:roles            # uses ADMIN_DATABASE_URL / MIGRATE_DATABASE_URL
--
-- On Neon, roles are also creatable from the console; the attributes below are
-- the ones that matter. Passwords are never stored in this file — the CLI sets
-- them from APP_DB_PASSWORD / MIGRATOR_DB_PASSWORD when those are present.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'webina_app') THEN
    CREATE ROLE webina_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'webina_migrator') THEN
    CREATE ROLE webina_migrator LOGIN NOSUPERUSER CREATEDB CREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END
$$;

-- Re-assert the attributes even if the roles already existed: this file is the
-- guarantee that the runtime role cannot bypass Row Level Security.
ALTER ROLE webina_app NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE webina_migrator NOSUPERUSER NOREPLICATION;

GRANT CREATE, USAGE ON SCHEMA public TO webina_migrator;
