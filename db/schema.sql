-- Leeway schema (Postgres 14+). Idempotent: safe to run more than once.

create extension if not exists pgcrypto;

-- Every 1Click swap Leeway creates: plain swaps, both Ghost Send legs, and DCA runs.
create table if not exists swaps (
  id                uuid primary key default gen_random_uuid(),
  kind              text not null check (kind in ('swap', 'ghost_leg1', 'ghost_leg2', 'dca')),
  deposit_address   text not null unique,
  deposit_memo      text,
  origin_asset      text not null,
  destination_asset text not null,
  amount_in         text not null,
  amount_in_usd     text,
  amount_out        text,
  status            text not null default 'PENDING_DEPOSIT',
  cashback_address  text,
  cashback_accrued  boolean not null default false,
  parent_id         uuid,
  quote             jsonb not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists swaps_open_idx on swaps (status) where status not in ('SUCCESS', 'REFUNDED', 'FAILED');

create table if not exists ghost_transfers (
  id                     uuid primary key default gen_random_uuid(),
  code                   text not null unique,
  state                  text not null,
  origin_asset           text not null,
  destination_asset      text not null,
  recipient              text,
  refund_to              text,
  cashback_address       text,
  leg1_deposit_address   text,
  hop_transparent_address text,
  received_zat           bigint,
  shield_txid            text,
  release_at             timestamptz,
  leg2_deposit_address   text,
  leg2_txid              text,
  amount_in_usd          text,
  error                  text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  completed_at           timestamptz,
  purged_at              timestamptz
);
create index if not exists ghost_active_idx on ghost_transfers (state) where purged_at is null;

-- DCA plans live on-chain (LeewayDCA). This table holds the one thing that must stay off-chain:
-- the user's shielded Zcash address, verified against the plan's on-chain keccak256 hash.
create table if not exists dca_plans (
  plan_id          bigint primary key,
  owner            text not null,
  zec_address      text not null,
  amount_per_period text not null,
  interval_sec     integer not null,
  periods_total    integer not null,
  active           boolean not null default true,
  created_at       timestamptz not null default now()
);

create table if not exists dca_runs (
  id              uuid primary key default gen_random_uuid(),
  plan_id         bigint not null references dca_plans(plan_id),
  deposit_address text not null,
  tx_hash         text,
  status          text not null default 'quoted',
  error           text,
  created_at      timestamptz not null default now()
);

create table if not exists cashback_entries (
  id           uuid primary key default gen_random_uuid(),
  source       text not null check (source in ('swap', 'ghost', 'dca')),
  source_id    text not null,
  address      text not null,
  usd_micros   bigint not null,
  zat          bigint not null,
  eligible_at  timestamptz not null,
  status       text not null default 'pending' check (status in ('pending', 'paid')),
  payout_id    uuid,
  created_at   timestamptz not null default now(),
  unique (source, source_id)
);
create index if not exists cashback_pending_idx on cashback_entries (eligible_at) where status = 'pending';

create table if not exists cashback_payouts (
  id         uuid primary key default gen_random_uuid(),
  txid       text not null,
  total_zat  bigint not null,
  recipients integer not null,
  created_at timestamptz not null default now()
);

-- Public counters for the stats page. Aggregates only; no addresses.
create or replace view leeway_stats as
select
  (select coalesce(sum(nullif(amount_in_usd, '')::numeric), 0) from swaps where status = 'SUCCESS' and kind <> 'ghost_leg2') as volume_usd,
  (select count(*) from swaps where status = 'SUCCESS' and kind in ('swap', 'ghost_leg1', 'dca')) as completed_swaps,
  (select count(*) from ghost_transfers where state = 'completed') as ghost_sends,
  (select count(*) from dca_plans where active) as active_dca_plans,
  (select coalesce(sum(total_zat), 0) from cashback_payouts) as cashback_paid_zat,
  (select coalesce(sum(zat), 0) from cashback_entries where status = 'pending') as cashback_pending_zat;

-- ============================================================ v2: mainnet hardening (additive, idempotent)

-- Cashback payouts are reserved before the wallet sends, so a crash can never pay twice.
alter table cashback_payouts add column if not exists status text not null default 'sent';
alter table cashback_payouts alter column txid drop not null;
alter table cashback_payouts add column if not exists error text;
alter table cashback_entries drop constraint if exists cashback_entries_status_check;
alter table cashback_entries add constraint cashback_entries_status_check check (status in ('pending', 'reserved', 'paid'));

-- Shielding is marked before the wallet call, so a crash mid-shield is detected on restart.
alter table ghost_transfers add column if not exists shield_started_at timestamptz;
alter table ghost_transfers add column if not exists needs_review boolean not null default false;

-- Liveness of each worker job, for /api/health and alerting.
create table if not exists worker_heartbeats (
  job        text primary key,
  ok_at      timestamptz,
  error_at   timestamptz,
  last_error text
);

-- Fixed-window rate limits shared by every web instance.
create table if not exists rate_limits (
  key          text not null,
  window_start timestamptz not null,
  count        integer not null default 0,
  primary key (key, window_start)
);

create index if not exists swaps_parent_idx on swaps (parent_id);
create index if not exists ghost_created_idx on ghost_transfers (created_at);

-- Stats count only mainnet payouts and swaps that actually went out.
create or replace view leeway_stats as
select
  (select coalesce(sum(nullif(amount_in_usd, '')::numeric), 0) from swaps where status = 'SUCCESS' and kind <> 'ghost_leg2' and deposit_address not like 'testnet_%') as volume_usd,
  (select count(*) from swaps where status = 'SUCCESS' and kind in ('swap', 'ghost_leg1', 'dca') and deposit_address not like 'testnet_%') as completed_swaps,
  (select count(*) from ghost_transfers where state = 'completed' and coalesce(leg1_deposit_address, '') not like 'testnet_%') as ghost_sends,
  (select count(*) from dca_plans where active and plan_id > 0) as active_dca_plans,
  (select coalesce(sum(total_zat), 0) from cashback_payouts where status = 'sent') as cashback_paid_zat,
  (select coalesce(sum(zat), 0) from cashback_entries where status in ('pending', 'reserved') and source_id not like 'testnet:%') as cashback_pending_zat;
