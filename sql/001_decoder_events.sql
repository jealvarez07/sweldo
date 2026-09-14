-- 001_decoder_events.sql
--
-- One table. Anyone may INSERT. Nobody may SELECT.
--
-- Nothing in this table identifies a person. There is no user id, no IP, no
-- device fingerprint, no free text, and no session token. Salary alone, with
-- no identifier attached, is not personal information under RA 10173 — and
-- that property is the whole reason this design is safe. Do not add a column
-- that breaks it.
--
-- Run once in the Supabase SQL editor.

create table if not exists public.decoder_events (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),

  -- The observation ------------------------------------------------------
  -- Rounded to the nearest 100 on the client. A salary of 25,347 is unusual
  -- enough to be a fingerprint; 25,300 is not, and the distribution is
  -- unchanged at this resolution.
  gross_php     integer not null,
  period        text    not null,
  is_mwe        boolean not null default false,
  mode          text    not null default 'take',

  -- Which rate table produced the result. Without this, rows from before a
  -- January rate change are uninterpretable a year later.
  rates_version text    not null,

  -- The one rotated question, if they answered it. Both null if they skipped.
  answer_key    text,
  answer_value  text,

  -- Where they came from. Host only, never a full URL, never a query string.
  source        text,

  -- Return-visit measurement WITHOUT an identifier. The device knows whether
  -- it has been here before and how long ago; only those two derived facts
  -- travel. No id is ever transmitted, so rows cannot be linked to each other.
  is_return       boolean not null default false,
  days_since_first smallint,

  constraint gross_sane     check (gross_php >= 0 and gross_php <= 100000000),
  constraint period_valid   check (period in ('monthly','semiMonthly')),
  constraint mode_valid     check (mode in ('take','rev','cmp')),
  constraint answer_paired  check (num_nulls(answer_key, answer_value) <> 1),
  constraint answer_key_ok  check (
    answer_key is null or
    answer_key in ('job_family','years','region','employer_type')
  ),
  constraint answer_len     check (answer_value is null or length(answer_value) <= 40),
  constraint source_len     check (source is null or length(source) <= 64),
  constraint days_sane      check (days_since_first is null or
                                   (days_since_first >= 0 and days_since_first <= 3650))
);

-- Query patterns are "recent rows" and "rows with an answer".
create index if not exists decoder_events_created_idx
  on public.decoder_events (created_at desc);
create index if not exists decoder_events_answer_idx
  on public.decoder_events (answer_key, answer_value)
  where answer_key is not null;

-- ---------------------------------------------------------------------------
-- Access: insert-only for everyone, readable by nobody from the client.
-- ---------------------------------------------------------------------------

alter table public.decoder_events enable row level security;

drop policy if exists "anon may insert" on public.decoder_events;
create policy "anon may insert"
  on public.decoder_events
  for insert
  to anon, authenticated
  with check (true);

-- Deliberately NO select, update or delete policy. With RLS on and no policy,
-- those operations are denied to every client role. You read this table from
-- the Supabase dashboard or a service-role connection, never from the browser.

revoke all on public.decoder_events from anon, authenticated;
grant insert on public.decoder_events to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Useful reads (run these in the dashboard, not from the app)
-- ---------------------------------------------------------------------------

-- THE metric. Does a payslip explainer produce a returning user, or only a
-- satisfied reader? Everything downstream of the decoder depends on this.
--
--   select
--     date_trunc('week', created_at) as week,
--     count(*)                                as events,
--     count(*) filter (where is_return)       as returns,
--     round(100.0 * count(*) filter (where is_return) / nullif(count(*),0), 1)
--                                             as return_pct
--   from public.decoder_events
--   group by 1 order by 1 desc;

-- Salary distribution, once there is enough of it to mean anything.
--
--   select
--     answer_value as job_family,
--     count(*)                                          as n,
--     percentile_cont(0.5) within group (order by gross_php) as median,
--     percentile_cont(0.25) within group (order by gross_php) as p25,
--     percentile_cont(0.75) within group (order by gross_php) as p75
--   from public.decoder_events
--   where answer_key = 'job_family' and period = 'monthly'
--   group by 1
--   having count(*) >= 5        -- never report a bucket below k
--   order by n desc;

-- Which question earns answers, and which gets skipped.
--
--   select answer_key, count(*) as answered
--   from public.decoder_events
--   where answer_key is not null
--   group by 1 order by 2 desc;

-- ---------------------------------------------------------------------------
-- Caveat worth writing down
-- ---------------------------------------------------------------------------
-- This table holds no IP address. Supabase's own edge and API logs do, for
-- their retention window, and that is outside your control. Say "we don't
-- store it" on the page — which is true of your database — and do not claim
-- more than that.
