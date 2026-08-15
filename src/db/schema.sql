-- mail-mafia state. Run once against Neon:
--   npx tsx src/cli/db-setup.ts

create table if not exists prospects (
  id             bigserial primary key,
  -- Google's stable id, parsed out of the Maps URL. Null for email-only rows.
  place_id       text unique,
  name           text not null,
  -- Normalised for matching the same business across different exports.
  name_key       text not null,
  website        text,
  domain         text,
  email          text,
  email_verified boolean,
  phone          text,
  address        text,
  city           text,
  region         text,
  category       text,
  rating         numeric(2,1),
  review_count   integer,
  -- new -> drafted -> sent -> replied. Drives the send batch query.
  status         text not null default 'new',
  source_file    text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Draft storage. Kept on the prospect rather than a separate table: there is
-- exactly one live draft per prospect, and re-drafting replaces it.
alter table prospects add column if not exists subject     text;
alter table prospects add column if not exists opener      text;
alter table prospects add column if not exists body        text;
alter table prospects add column if not exists drafted_at  timestamptz;
-- Why a draft failed, so a rerun can retry only the failures.
alter table prospects add column if not exists draft_error text;

-- Domain is deliberately NOT unique: a chain or multi-location practice has
-- several Google listings sharing one website, and each is a real row. The
-- real rule is one *send* per domain, enforced in the send batch query — not
-- one row per domain, which would silently discard locations on import.
drop index if exists prospects_domain_key;
create index if not exists prospects_domain_idx
  on prospects (domain) where domain is not null;
create index if not exists prospects_name_key_idx on prospects (name_key);
create index if not exists prospects_status_idx on prospects (status);

-- Anyone who said stop. Checked before every send; never delete from this.
create table if not exists suppression (
  domain      text primary key,
  email       text,
  reason      text not null,
  created_at  timestamptz not null default now()
);

-- Persistent send quota, so a daily cap survives a restart. Replaces the
-- in-memory counter in src/send/pool.ts.
create table if not exists sends (
  id          bigserial primary key,
  prospect_id bigint references prospects(id),
  inbox_id    text not null,
  to_email    text not null,
  subject     text,
  message_id  text,
  sent_at     timestamptz not null default now()
);

-- Not (inbox_id, sent_at::date): casting timestamptz to date depends on the
-- session timezone, so Postgres rejects it as non-IMMUTABLE. A plain composite
-- index serves the daily-cap range query just as well:
--   where inbox_id = $1 and sent_at >= date_trunc('day', now() at time zone 'utc')
create index if not exists sends_inbox_sent_at_idx
  on sends (inbox_id, sent_at);
