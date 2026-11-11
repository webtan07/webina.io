-- 0002_better_auth_two_factor.sql — columns Better Auth's twoFactor plugin
-- reads and writes.
--
-- 0000_init.sql created `two_factor` from the plugin's shape at the time.
-- Better Auth 1.x added a verification flag, a failed-attempt counter and a
-- lockout timestamp; without them every request fails with "Drizzle schema
-- mismatch". 2FA stays available and off by default — a new account has no
-- second factor — but the table has to match the library that owns it.
--
-- Identity tables carry no RLS (see 0001_rls.sql): a session is read before any
-- tenant is known. Grants are table-level, so the runtime role inherits these
-- columns automatically.

ALTER TABLE two_factor
  ADD COLUMN IF NOT EXISTS verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS failed_verification_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_until timestamptz;
