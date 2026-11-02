-- ClinicPilot database schema and sample data (Supabase / Postgres)
-- Safe to run more than once: tables use IF NOT EXISTS and seed rows use ON CONFLICT DO NOTHING.
-- Timestamps are stored as text in the same formats the app already uses:
--   starts_at / ends_at : 'YYYY-MM-DD HH:MM' (clinic time, Asia/Manila)
--   created_at, last_message_at : ISO 8601 (UTC)

create table if not exists services (
  id            bigserial primary key,
  name          text not null unique,
  duration_min  integer not null,
  price         text not null default '',
  active        integer not null default 1,
  recall_months integer,                       -- null = no reminder for this service
  aftercare     text not null default '',
  description   text not null default ''       -- shown to patients when they tap the service in the chat
);

-- Existing databases: add the description column if it's missing
alter table services add column if not exists description text not null default '';

create table if not exists dentists (
  id     bigserial primary key,
  name   text not null unique,
  active integer not null default 1
);

create table if not exists clients (
  id            bigserial primary key,
  full_name     text not null,
  phone         text unique,
  email         text,
  notes         text not null default '',
  created_at    text not null,
  birthday      text,                          -- YYYY-MM-DD, optional
  promo_consent integer not null default 0
);

create table if not exists appointments (
  id          bigserial primary key,
  client_id   bigint not null references clients(id),
  dentist_id  bigint not null references dentists(id),
  service_id  bigint not null references services(id),
  starts_at   text not null,
  ends_at     text not null,
  status      text not null default 'booked',  -- booked | done | no_show | cancelled
  source      text not null default 'staff',   -- website | facebook | sms | staff | ai
  created_at  text not null
);
create index if not exists idx_appt_dentist_time on appointments (dentist_id, starts_at);
create index if not exists idx_appt_client on appointments (client_id);

create table if not exists conversations (
  id              bigserial primary key,
  token           text not null default '',    -- secret the visitor's browser keeps
  channel         text not null default 'website',
  client_id       bigint references clients(id),
  ai_paused       integer not null default 0,
  needs_human     integer not null default 0,
  handoff_reason  text not null default '',
  last_message_at text not null,
  created_at      text not null
);

create table if not exists messages (
  id              bigserial primary key,
  conversation_id bigint not null references conversations(id),
  direction       text not null,               -- in | out
  sender          text not null,               -- patient | ai | staff
  text            text not null,
  created_at      text not null
);
create index if not exists idx_messages_conv on messages (conversation_id, id);

create table if not exists settings (
  key   text primary key,
  value text not null
);

-- Consent history: one row per change, so the clinic can show what a client agreed to and when.
create table if not exists consents (
  id         bigserial primary key,
  client_id  bigint not null references clients(id),
  kind       text not null,                    -- marketing (offers, win-back, birthdays) | reminder (recall visits)
  granted    integer not null,                 -- 1 = agreed, 0 = withdrew
  source     text not null default 'staff',    -- staff | website | email
  created_at text not null
);
create index if not exists idx_consents_client on consents (client_id, kind);

-- Message templates, one per automation. Placeholders: {first_name} {service} {clinic} {clinic_phone} {years}
create table if not exists message_templates (
  kind text primary key,                       -- recall | winback | birthday | anniversary
  body text not null
);

-- Message queue. Nothing is sent from here until a channel (email or Messenger) is connected.
create table if not exists outbox (
  id         bigserial primary key,
  client_id  bigint not null references clients(id),
  kind       text not null,
  ref        text not null,                    -- de-duplicates: one message per client, kind and cycle
  channel    text not null default 'email',
  body       text not null,
  status     text not null default 'queued',  -- queued | sent | failed | cancelled
  created_at text not null,
  unique (client_id, kind, ref)
);
create index if not exists idx_outbox_status on outbox (status);

-- When each queued message may go out (clinic time, 'YYYY-MM-DD HH:MM').
-- Existing queued messages with no time get the next day at 10:00.
alter table outbox add column if not exists send_at text;
update outbox
   set send_at = to_char((timezone('Asia/Manila', now())::date + 1) + time '10:00', 'YYYY-MM-DD HH24:MI')
 where send_at is null and status = 'queued';

-- Row-level security: the public anon key cannot read or write these tables.
-- The server uses the service_role key, which bypasses RLS.
alter table services      enable row level security;
alter table dentists      enable row level security;
alter table clients       enable row level security;
alter table appointments  enable row level security;
alter table conversations enable row level security;
alter table messages      enable row level security;
alter table settings      enable row level security;
alter table consents      enable row level security;
alter table message_templates enable row level security;
alter table outbox        enable row level security;

-- Admin login sessions. Stored here so every server copy (for example on Vercel) can see them.
-- Only a hash of the cookie value is stored, never the cookie itself.
create table if not exists sessions (
  token_hash text primary key,
  expires_at text not null,
  created_at text not null
);
alter table sessions enable row level security;

-- ---------- Sample data (dermatology and aesthetics clinic, matches the landing page) ----------
-- Durations, prices, and aftercare are placeholders for the clinic to confirm. Blank price shows "Ask us".
insert into services (name, duration_min, price, recall_months, aftercare, description) values
  ('Consultation',          30,  '',                 null, '', 'A skin assessment with a plan explained in plain language, so you know your options before any treatment.'),
  ('Facial',                60,  '',                 null, '', 'A cleansing facial that deep-cleans and refreshes the skin.'),
  ('Hydrafacial',           60,  '',                 null, '', 'A hydrating treatment that cleanses, exfoliates, and nourishes the skin in one session.'),
  ('Botox',                 60,  '',                 4,    '', 'Botulinum toxin treatment that softens expression lines. Your practitioner will check whether it suits you at your consultation.'),
  ('Fillers',               60,  '',                 null, '', 'Dermal filler to restore volume or smooth lines. Your practitioner will explain the options and risks at your consultation.'),
  ('Laser Hair Removal',    90,  '₱1,500 per session', null, '', 'Laser treatment that reduces unwanted hair over several sessions. Underarm sessions are ₱1,500 each, or ₱6,000 for a 5-session package.'),
  ('Chemical Peel',         60,  '',                 null, '', 'A chemical exfoliation to improve skin texture and tone. Your practitioner will recommend the right strength for your skin.'),
  ('Thread lift',           120, '',                 null, '', 'A minimally invasive lift using dissolvable threads for a refreshed look.')
on conflict (name) do nothing;

insert into dentists (name) values ('Dr. Luna'), ('Dr. Santos')
on conflict (name) do nothing;

insert into settings (key, value) values
  ('clinic_name',       'Demo Derma Clinic'),
  ('clinic_address',    '123 Sample Street, Makati City'),
  ('clinic_phone',      '(02) 8123 4567'),
  ('hours_open',        '09:00'),
  ('hours_close',       '18:00'),
  ('open_days',         '1,2,3,4,5,6'),         -- 0 = Sunday
  ('slot_minutes',      '30'),
  ('ai_instructions',   'Be warm and concise. Reply in the language the patient uses (English, Tagalog, or Taglish).'),
  ('winback_days',      '90')
on conflict (key) do nothing;

insert into clients (full_name, phone, created_at) values
  ('Maria Garcia', '09175550182', '2026-10-01T00:00:00.000Z'),
  ('Paolo Ramos',  '09275550119', '2026-10-01T00:00:00.000Z'),
  ('Bea Lopez',    '09155550177', '2026-10-01T00:00:00.000Z')
on conflict (phone) do nothing;

insert into message_templates (kind, body) values
  ('recall',      'Hi {first_name}, it has been a while since your {service} at {clinic}. You are due for a visit. Reply here or call {clinic_phone} to book.'),
  ('winback',     'Hi {first_name}, we miss you at {clinic}. Reply to this message and we will find a time that suits you.'),
  ('birthday',    'Happy birthday, {first_name}! From all of us at {clinic}.'),
  ('anniversary', '{first_name}, it has been {years} year(s) since your first visit at {clinic}. Thank you for trusting us.')
on conflict (kind) do nothing;
