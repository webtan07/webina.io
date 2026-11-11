-- 0000_init.sql — Webina data model (Milestone 1)
--
-- All timestamps are timestamptz. All money is integer cents in AUD.
-- There is no GST column and no tax configuration anywhere in this schema:
-- Web Digital Assistants is a sole trader below the A$100,000 turnover
-- threshold.
--
-- Applied by `pnpm db:migrate` as the migrator role. Row Level Security is
-- added in 0001_rls.sql; the runtime role gets no DDL and no ownership.

/* ------------------------------------------------------------------ *
 * Tenancy and access
 * ------------------------------------------------------------------ */

CREATE TABLE businesses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL,
  trade_template text NOT NULL DEFAULT 'generic',
  timezone text NOT NULL DEFAULT 'Australia/Adelaide',
  owner_notify_email text NOT NULL,
  owner_notify_phone text,
  assistant_name text NOT NULL DEFAULT 'Webina',
  greeting text,
  tone text NOT NULL DEFAULT 'friendly and brief',
  business_rules text,
  brand_color text,
  logo_url text,
  show_powered_by boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'trial',
  bot_enabled boolean NOT NULL DEFAULT true,
  currency text NOT NULL DEFAULT 'AUD',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT businesses_status_check CHECK (status IN ('trial', 'active', 'paused', 'cancelled')),
  CONSTRAINT businesses_currency_check CHECK (currency = 'AUD')
);
CREATE UNIQUE INDEX businesses_slug_key ON businesses (slug);

-- Better Auth identity tables. Identity is global; tenancy lives in memberships.
CREATE TABLE "user" (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL,
  email_verified boolean NOT NULL DEFAULT false,
  image text,
  two_factor_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX user_email_key ON "user" (email);

CREATE TABLE session (
  id text PRIMARY KEY,
  expires_at timestamptz NOT NULL,
  token text NOT NULL,
  ip_address text,
  user_agent text,
  user_id text NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX session_token_key ON session (token);
CREATE INDEX session_user_id_idx ON session (user_id);

CREATE TABLE account (
  id text PRIMARY KEY,
  account_id text NOT NULL,
  provider_id text NOT NULL,
  user_id text NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  access_token text,
  refresh_token text,
  id_token text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scope text,
  password text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX account_user_id_idx ON account (user_id);

CREATE TABLE verification (
  id text PRIMARY KEY,
  identifier text NOT NULL,
  value text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX verification_identifier_idx ON verification (identifier);

CREATE TABLE two_factor (
  id text PRIMARY KEY,
  secret text NOT NULL,
  backup_codes text NOT NULL,
  user_id text NOT NULL REFERENCES "user" (id) ON DELETE CASCADE
);
CREATE INDEX two_factor_user_id_idx ON two_factor (user_id);

CREATE TABLE memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'staff',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT memberships_role_check CHECK (role IN ('owner', 'staff'))
);
CREATE UNIQUE INDEX memberships_user_business_key ON memberships (user_id, business_id);
CREATE INDEX memberships_business_id_idx ON memberships (business_id);

CREATE TABLE sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  label text,
  site_key text NOT NULL,
  allowed_origins text[] NOT NULL DEFAULT '{}',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sites_site_key_check CHECK (site_key ~ '^pk_(live|test)_[a-z2-9]{20}$')
);
CREATE UNIQUE INDEX sites_site_key_key ON sites (site_key);
CREATE INDEX sites_business_id_idx ON sites (business_id);

/* ------------------------------------------------------------------ *
 * Catalogue and rules
 * ------------------------------------------------------------------ */

CREATE TABLE services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  active boolean NOT NULL DEFAULT true,
  pricing_type text NOT NULL DEFAULT 'fixed',
  price_cents integer,
  pricing_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  duration_minutes integer,
  scheduling_type text NOT NULL DEFAULT 'time_slot',
  recurring_options jsonb NOT NULL DEFAULT '[]'::jsonb,
  intake_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT services_pricing_type_check CHECK (pricing_type IN ('fixed', 'tiered', 'from', 'quote_only')),
  CONSTRAINT services_scheduling_type_check CHECK (scheduling_type IN ('time_slot', 'day_window', 'owner_confirms')),
  CONSTRAINT services_price_non_negative CHECK (price_cents IS NULL OR price_cents >= 0)
);
CREATE INDEX services_business_id_idx ON services (business_id);

CREATE TABLE service_areas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  type text NOT NULL DEFAULT 'none',
  "values" jsonb NOT NULL DEFAULT '[]'::jsonb,
  center_lat numeric(9, 6),
  center_lng numeric(9, 6),
  radius_km integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_areas_type_check CHECK (type IN ('suburb_list', 'postcode_list', 'radius', 'none'))
);
CREATE UNIQUE INDEX service_areas_business_id_key ON service_areas (business_id);

CREATE TABLE availability_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  weekday smallint NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  slot_minutes integer NOT NULL DEFAULT 60,
  capacity integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT availability_rules_weekday_check CHECK (weekday BETWEEN 0 AND 6),
  CONSTRAINT availability_rules_capacity_check CHECK (capacity >= 1),
  CONSTRAINT availability_rules_slot_minutes_check CHECK (slot_minutes > 0)
);
CREATE INDEX availability_rules_business_weekday_idx ON availability_rules (business_id, weekday);

CREATE TABLE availability_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  date date NOT NULL,
  closed boolean NOT NULL DEFAULT true,
  start_time time,
  end_time time,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX availability_exceptions_business_date_key ON availability_exceptions (business_id, date);

/* ------------------------------------------------------------------ *
 * Work created by the assistant
 * ------------------------------------------------------------------ */

CREATE TABLE bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  service_id uuid REFERENCES services (id) ON DELETE SET NULL,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'confirmed',
  customer_name text NOT NULL,
  customer_phone text NOT NULL,
  customer_email text,
  address text,
  notes text,
  intake_answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  price_cents_snapshot integer,
  currency text NOT NULL DEFAULT 'AUD',
  source text NOT NULL DEFAULT 'dashboard',
  conversation_id uuid,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bookings_status_check CHECK (status IN ('confirmed', 'cancelled', 'completed', 'no_show')),
  CONSTRAINT bookings_source_check CHECK (source IN ('ai_assistant', 'dashboard', 'import')),
  CONSTRAINT bookings_currency_check CHECK (currency = 'AUD'),
  CONSTRAINT bookings_range_check CHECK (end_at > start_at)
);
CREATE UNIQUE INDEX bookings_business_idempotency_key ON bookings (business_id, idempotency_key);
-- One confirmed booking per slot start. A cancelled booking frees the slot, so
-- this is a partial unique index rather than an exclusion constraint.
CREATE UNIQUE INDEX bookings_business_start_confirmed_key
  ON bookings (business_id, start_at)
  WHERE status = 'confirmed';
CREATE INDEX bookings_business_start_idx ON bookings (business_id, start_at);
CREATE INDEX bookings_business_status_idx ON bookings (business_id, status);

CREATE TABLE job_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  service_id uuid REFERENCES services (id) ON DELETE SET NULL,
  customer_name text NOT NULL,
  customer_phone text NOT NULL,
  customer_email text,
  address text,
  requested_date_window text,
  photos jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'new',
  owner_price_cents integer,
  currency text NOT NULL DEFAULT 'AUD',
  intake_answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  source text NOT NULL DEFAULT 'dashboard',
  conversation_id uuid,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_requests_status_check CHECK (status IN ('new', 'quoted', 'scheduled', 'declined')),
  CONSTRAINT job_requests_currency_check CHECK (currency = 'AUD')
);
CREATE UNIQUE INDEX job_requests_business_idempotency_key ON job_requests (business_id, idempotency_key);
CREATE INDEX job_requests_business_status_idx ON job_requests (business_id, status);

/* ------------------------------------------------------------------ *
 * Conversations
 * ------------------------------------------------------------------ */

CREATE TABLE conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  channel text NOT NULL DEFAULT 'web',
  customer_ref text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  started_at timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conversations_channel_check CHECK (channel IN ('web', 'sms', 'whatsapp')),
  CONSTRAINT conversations_status_check CHECK (status IN ('active', 'handed_off', 'closed'))
);
CREATE INDEX conversations_business_created_idx ON conversations (business_id, started_at);
CREATE INDEX conversations_business_status_idx ON conversations (business_id, status);

CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  role text NOT NULL,
  content jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT messages_role_check CHECK (role IN ('user', 'assistant'))
);
CREATE INDEX messages_business_created_idx ON messages (business_id, created_at);
CREATE INDEX messages_conversation_id_idx ON messages (conversation_id);

CREATE TABLE handoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  reason text NOT NULL,
  summary text NOT NULL,
  resolved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX handoffs_business_status_idx ON handoffs (business_id, resolved);

CREATE TABLE usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  type text NOT NULL,
  quantity integer NOT NULL DEFAULT 1,
  tokens_in integer,
  tokens_out integer,
  cost_estimate_cents integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT usage_events_type_check CHECK (type IN ('conversation', 'ai_call', 'sms', 'whatsapp'))
);
CREATE INDEX usage_events_business_created_idx ON usage_events (business_id, created_at);

/* ------------------------------------------------------------------ *
 * Billing, admin, outbound work
 * ------------------------------------------------------------------ */

CREATE TABLE subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  stripe_customer_id text,
  stripe_subscription_id text,
  plan_key text NOT NULL DEFAULT 'answer',
  status text NOT NULL DEFAULT 'trialing',
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  addons jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT subscriptions_plan_key_check CHECK (plan_key IN ('answer', 'front_desk'))
);
CREATE UNIQUE INDEX subscriptions_business_id_key ON subscriptions (business_id);
CREATE UNIQUE INDEX subscriptions_stripe_subscription_id_key ON subscriptions (stripe_subscription_id);

CREATE TABLE audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES businesses (id) ON DELETE CASCADE,
  actor text NOT NULL,
  action text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_business_created_idx ON audit_log (business_id, created_at);

CREATE TABLE consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  phone text NOT NULL,
  channel text NOT NULL,
  type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX consents_business_phone_idx ON consents (business_id, phone);

CREATE TABLE opt_outs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  phone text NOT NULL,
  channel text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX opt_outs_business_phone_channel_key ON opt_outs (business_id, phone, channel);

CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  kind text NOT NULL,
  dedupe_key text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX notifications_business_dedupe_key ON notifications (business_id, dedupe_key);

CREATE TABLE scheduled_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  booking_id uuid REFERENCES bookings (id) ON DELETE CASCADE,
  kind text NOT NULL,
  send_after timestamptz NOT NULL,
  sent_at timestamptz,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scheduled_messages_kind_check CHECK (kind IN ('reminder', 'review_request')),
  CONSTRAINT scheduled_messages_status_check CHECK (status IN ('pending', 'sent', 'failed', 'cancelled'))
);
CREATE INDEX scheduled_messages_due_idx ON scheduled_messages (status, send_after);
