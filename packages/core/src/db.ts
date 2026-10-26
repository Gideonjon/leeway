import pg from "pg";
import type { CashbackEntry, CashbackSource, PayoutLine } from "./cashback.js";
import type { GhostState, GhostTransfer } from "./ghost.js";
import type { QuoteResponse, SwapStatus } from "./oneclick.js";

export type SwapKind = "swap" | "ghost_leg1" | "ghost_leg2" | "dca";

export interface SwapRow {
  id: string;
  kind: SwapKind;
  depositAddress: string;
  depositMemo: string | null;
  originAsset: string;
  destinationAsset: string;
  amountIn: string;
  amountInUsd: string | null;
  amountOut: string | null;
  status: SwapStatus;
  cashbackAddress: string | null;
  cashbackAccrued: boolean;
  parentId: string | null;
  createdAt: Date;
}

export interface DcaPlanRow {
  planId: number;
  owner: string;
  zecAddress: string;
  amountPerPeriod: string;
  intervalSec: number;
  periodsTotal: number;
  active: boolean;
}

export interface Stats {
  volumeUsd: string;
  completedSwaps: number;
  ghostSends: number;
  activeDcaPlans: number;
  cashbackPaidZat: bigint;
  cashbackPendingZat: bigint;
}

const swapFromRow = (r: Record<string, unknown>): SwapRow => ({
  id: r.id as string,
  kind: r.kind as SwapKind,
  depositAddress: r.deposit_address as string,
  depositMemo: (r.deposit_memo as string) ?? null,
  originAsset: r.origin_asset as string,
  destinationAsset: r.destination_asset as string,
  amountIn: r.amount_in as string,
  amountInUsd: (r.amount_in_usd as string) ?? null,
  amountOut: (r.amount_out as string) ?? null,
  status: r.status as SwapStatus,
  cashbackAddress: (r.cashback_address as string) ?? null,
  cashbackAccrued: r.cashback_accrued as boolean,
  parentId: (r.parent_id as string) ?? null,
  createdAt: r.created_at as Date,
});

const ghostFromRow = (r: Record<string, unknown>): GhostTransfer => ({
  id: r.id as string,
  code: r.code as string,
  state: r.state as GhostState,
  originAsset: r.origin_asset as string,
  destinationAsset: r.destination_asset as string,
  recipient: (r.recipient as string) ?? null,
  refundTo: (r.refund_to as string) ?? null,
  cashbackAddress: (r.cashback_address as string) ?? null,
  leg1DepositAddress: (r.leg1_deposit_address as string) ?? null,
  hopTransparentAddress: (r.hop_transparent_address as string) ?? null,
  receivedZat: r.received_zat == null ? null : BigInt(r.received_zat as string),
  shieldTxid: (r.shield_txid as string) ?? null,
  releaseAt: (r.release_at as Date) ?? null,
  leg2DepositAddress: (r.leg2_deposit_address as string) ?? null,
  leg2Txid: (r.leg2_txid as string) ?? null,
  amountInUsd: (r.amount_in_usd as string) ?? null,
  error: (r.error as string) ?? null,
  createdAt: r.created_at as Date,
  updatedAt: r.updated_at as Date,
  completedAt: (r.completed_at as Date) ?? null,
  purgedAt: (r.purged_at as Date) ?? null,
  shieldStartedAt: (r.shield_started_at as Date) ?? null,
  needsReview: Boolean(r.needs_review),
});

const GHOST_COLUMNS: Record<keyof GhostTransfer, string> = {
  id: "id",
  code: "code",
  state: "state",
  originAsset: "origin_asset",
  destinationAsset: "destination_asset",
  recipient: "recipient",
  refundTo: "refund_to",
  cashbackAddress: "cashback_address",
  leg1DepositAddress: "leg1_deposit_address",
  hopTransparentAddress: "hop_transparent_address",
  receivedZat: "received_zat",
  shieldTxid: "shield_txid",
  releaseAt: "release_at",
  leg2DepositAddress: "leg2_deposit_address",
  leg2Txid: "leg2_txid",
  amountInUsd: "amount_in_usd",
  error: "error",
  createdAt: "created_at",
  updatedAt: "updated_at",
  completedAt: "completed_at",
  purgedAt: "purged_at",
  shieldStartedAt: "shield_started_at",
  needsReview: "needs_review",
};

const toDb = (v: unknown) => (typeof v === "bigint" ? v.toString() : v);

export class LeewayDb {
  readonly pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString, max: 10 });
  }

  close() {
    return this.pool.end();
  }

  // ------------------------------------------------------------------ swaps

  async insertSwap(input: {
    kind: SwapKind;
    quote: QuoteResponse;
    cashbackAddress?: string | null;
    parentId?: string | null;
  }): Promise<SwapRow> {
    const q = input.quote;
    if (!q.quote.depositAddress) throw new Error("quote has no deposit address (was it a dry run?)");
    const { rows } = await this.pool.query(
      `insert into swaps (kind, deposit_address, deposit_memo, origin_asset, destination_asset, amount_in, amount_in_usd, cashback_address, parent_id, quote)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
      [
        input.kind,
        q.quote.depositAddress,
        q.quote.depositMemo ?? null,
        q.quoteRequest.originAsset,
        q.quoteRequest.destinationAsset,
        q.quote.amountIn,
        q.quote.amountInUsd ?? null,
        input.cashbackAddress ?? null,
        input.parentId ?? null,
        JSON.stringify(q),
      ],
    );
    return swapFromRow(rows[0]);
  }

  async openSwaps(kinds: SwapKind[]): Promise<SwapRow[]> {
    const { rows } = await this.pool.query(
      `select * from swaps where kind = any($1) and status not in ('SUCCESS','REFUNDED','FAILED') order by created_at limit 200`,
      [kinds],
    );
    return rows.map(swapFromRow);
  }

  async swapByDeposit(depositAddress: string): Promise<SwapRow | null> {
    const { rows } = await this.pool.query(`select * from swaps where deposit_address = $1`, [depositAddress]);
    return rows[0] ? swapFromRow(rows[0]) : null;
  }

  async updateSwapStatus(id: string, status: SwapStatus, amountOut?: string | null, amountInUsd?: string | null) {
    await this.pool.query(
      `update swaps set status = $2, amount_out = coalesce($3, amount_out), amount_in_usd = coalesce($4, amount_in_usd), updated_at = now() where id = $1`,
      [id, status, amountOut ?? null, amountInUsd ?? null],
    );
  }

  /** Swaps that settled but whose cashback hasn't been written yet. */
  async swapsAwaitingCashback(): Promise<SwapRow[]> {
    const { rows } = await this.pool.query(
      // A Ghost Send earns cashback only once it has been delivered, not when leg one settles.
      `select s.* from swaps s
       left join ghost_transfers g on g.id = s.parent_id
       where s.status = 'SUCCESS' and not s.cashback_accrued and s.cashback_address is not null
         and (s.kind <> 'ghost_leg1' or g.state = 'completed')
       limit 200`,
    );
    return rows.map(swapFromRow);
  }

  async markCashbackAccrued(swapId: string) {
    await this.pool.query(`update swaps set cashback_accrued = true where id = $1`, [swapId]);
  }

  // ------------------------------------------------------------------ ghost

  async insertGhost(g: Omit<GhostTransfer, "id" | "createdAt" | "updatedAt" | "completedAt" | "purgedAt" | "shieldStartedAt" | "needsReview">): Promise<GhostTransfer> {
    const entries = Object.entries(g) as [keyof GhostTransfer, unknown][];
    const cols = entries.map(([k]) => GHOST_COLUMNS[k]);
    const vals = entries.map(([, v]) => toDb(v));
    const { rows } = await this.pool.query(
      `insert into ghost_transfers (${cols.join(",")}) values (${cols.map((_, i) => `$${i + 1}`).join(",")}) returning *`,
      vals,
    );
    return ghostFromRow(rows[0]);
  }

  async updateGhost(id: string, patch: Partial<GhostTransfer>): Promise<void> {
    const entries = (Object.entries(patch) as [keyof GhostTransfer, unknown][]).filter(([k]) => k !== "id");
    if (entries.length === 0) return;
    const sets = entries.map(([k], i) => `${GHOST_COLUMNS[k]} = $${i + 2}`);
    await this.pool.query(`update ghost_transfers set ${sets.join(", ")}, updated_at = now() where id = $1`, [
      id,
      ...entries.map(([, v]) => toDb(v)),
    ]);
  }

  async ghostByCode(code: string): Promise<GhostTransfer | null> {
    const { rows } = await this.pool.query(`select * from ghost_transfers where code = $1`, [code]);
    return rows[0] ? ghostFromRow(rows[0]) : null;
  }

  async ghostById(id: string): Promise<GhostTransfer | null> {
    const { rows } = await this.pool.query(`select * from ghost_transfers where id = $1`, [id]);
    return rows[0] ? ghostFromRow(rows[0]) : null;
  }

  /** Transfers the worker still has to act on (including settled ones awaiting purge). */
  async workableGhosts(): Promise<GhostTransfer[]> {
    const { rows } = await this.pool.query(`select * from ghost_transfers where purged_at is null and not needs_review order by created_at limit 200`);
    return rows.map(ghostFromRow);
  }

  // -------------------------------------------------------------------- dca

  async upsertDcaPlan(p: DcaPlanRow) {
    await this.pool.query(
      `insert into dca_plans (plan_id, owner, zec_address, amount_per_period, interval_sec, periods_total, active)
       values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (plan_id) do update set active = excluded.active`,
      [p.planId, p.owner.toLowerCase(), p.zecAddress, p.amountPerPeriod, p.intervalSec, p.periodsTotal, p.active],
    );
  }

  async activeDcaPlans(): Promise<DcaPlanRow[]> {
    const { rows } = await this.pool.query(`select * from dca_plans where active order by plan_id`);
    return rows.map((r) => ({
      planId: Number(r.plan_id),
      owner: r.owner,
      zecAddress: r.zec_address,
      amountPerPeriod: r.amount_per_period,
      intervalSec: r.interval_sec,
      periodsTotal: r.periods_total,
      active: r.active,
    }));
  }

  async dcaPlansByOwner(owner: string): Promise<DcaPlanRow[]> {
    const { rows } = await this.pool.query(`select * from dca_plans where owner = $1 order by plan_id desc`, [owner.toLowerCase()]);
    return rows.map((r) => ({
      planId: Number(r.plan_id),
      owner: r.owner,
      zecAddress: r.zec_address,
      amountPerPeriod: r.amount_per_period,
      intervalSec: r.interval_sec,
      periodsTotal: r.periods_total,
      active: r.active,
    }));
  }

  async setDcaPlanActive(planId: number, active: boolean) {
    await this.pool.query(`update dca_plans set active = $2 where plan_id = $1`, [planId, active]);
  }

  async insertDcaRun(planId: number, depositAddress: string): Promise<string> {
    const { rows } = await this.pool.query(
      `insert into dca_runs (plan_id, deposit_address) values ($1,$2) returning id`,
      [planId, depositAddress],
    );
    return rows[0].id;
  }

  async updateDcaRun(id: string, patch: { txHash?: string; status: string; error?: string }) {
    await this.pool.query(`update dca_runs set tx_hash = coalesce($2, tx_hash), status = $3, error = $4 where id = $1`, [
      id,
      patch.txHash ?? null,
      patch.status,
      patch.error ?? null,
    ]);
  }

  // --------------------------------------------------------------- cashback

  async insertCashback(e: { source: CashbackSource; sourceId: string; address: string; usdMicros: bigint; zat: bigint; eligibleAt: Date }) {
    await this.pool.query(
      `insert into cashback_entries (source, source_id, address, usd_micros, zat, eligible_at)
       values ($1,$2,$3,$4,$5,$6) on conflict (source, source_id) do nothing`,
      [e.source, e.sourceId, e.address, e.usdMicros.toString(), e.zat.toString(), e.eligibleAt],
    );
  }

  async pendingCashback(now: Date): Promise<CashbackEntry[]> {
    const { rows } = await this.pool.query(
      `select * from cashback_entries where status = 'pending' and eligible_at <= $1 order by created_at limit 2000`,
      [now],
    );
    return rows.map((r) => ({
      id: r.id,
      source: r.source,
      sourceId: r.source_id,
      address: r.address,
      usdMicros: BigInt(r.usd_micros),
      zat: BigInt(r.zat),
      eligibleAt: r.eligible_at,
      status: r.status,
    }));
  }

  async cashbackPaidSince(since: Date): Promise<bigint> {
    const { rows } = await this.pool.query(`select coalesce(sum(total_zat), 0) as s from cashback_payouts where created_at >= $1 and status in ('sending', 'sent', 'unknown')`, [since]);
    return BigInt(rows[0].s);
  }

  /** Reserves entries for one payout before any money moves. Returns the payout id. */
  async reservePayout(lines: PayoutLine[]): Promise<string> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const total = lines.reduce((s, l) => s + l.zat, 0n);
      const { rows } = await client.query(
        `insert into cashback_payouts (txid, total_zat, recipients, status) values (null, $1, $2, 'sending') returning id`,
        [total.toString(), lines.length],
      );
      const ids = lines.flatMap((l) => l.entryIds);
      const res = await client.query(`update cashback_entries set status = 'reserved', payout_id = $1 where id = any($2) and status = 'pending'`, [rows[0].id, ids]);
      if (res.rowCount !== ids.length) throw new Error("cashback entries changed while reserving; retrying next tick");
      await client.query("commit");
      return rows[0].id;
    } catch (e) {
      await client.query("rollback");
      throw e;
    } finally {
      client.release();
    }
  }

  async markPayoutSent(id: string, txid: string) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(`update cashback_payouts set status = 'sent', txid = $2 where id = $1`, [id, txid]);
      await client.query(`update cashback_entries set status = 'paid' where payout_id = $1`, [id]);
      await client.query("commit");
    } catch (e) {
      await client.query("rollback");
      throw e;
    } finally {
      client.release();
    }
  }

  /** The wallet refused the send before broadcast: release the entries for the next payout. */
  async releasePayout(id: string, error: string) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(`update cashback_payouts set status = 'failed', error = $2 where id = $1`, [id, error.slice(0, 500)]);
      await client.query(`update cashback_entries set status = 'pending', payout_id = null where payout_id = $1`, [id]);
      await client.query("commit");
    } catch (e) {
      await client.query("rollback");
      throw e;
    } finally {
      client.release();
    }
  }

  /** Outcome unknown: leave reserved for a human to reconcile against the wallet. */
  async flagPayout(id: string, error: string) {
    await this.pool.query(`update cashback_payouts set status = 'unknown', error = $2 where id = $1`, [id, error.slice(0, 500)]);
  }

  /** Payouts that started but never finished (a crash mid-send). Never resent automatically. */
  async stuckPayouts(): Promise<{ id: string; createdAt: Date; status: string }[]> {
    const { rows } = await this.pool.query(
      `select id, created_at, status from cashback_payouts where status = 'unknown' or (status = 'sending' and created_at < now() - interval '10 minutes')`,
    );
    return rows.map((r) => ({ id: r.id, createdAt: r.created_at, status: r.status }));
  }

  async cashbackForAddress(address: string): Promise<{ pendingZat: bigint; paidZat: bigint }> {
    const { rows } = await this.pool.query(
      `select coalesce(sum(zat) filter (where status = 'pending'), 0) as pending, coalesce(sum(zat) filter (where status = 'paid'), 0) as paid
       from cashback_entries where address = $1`,
      [address],
    );
    return { pendingZat: BigInt(rows[0].pending), paidZat: BigInt(rows[0].paid) };
  }

  // ------------------------------------------------------------------ stats

  async stats(): Promise<Stats> {
    const { rows } = await this.pool.query(`select * from leeway_stats`);
    const r = rows[0];
    return {
      volumeUsd: String(r.volume_usd),
      completedSwaps: Number(r.completed_swaps),
      ghostSends: Number(r.ghost_sends),
      activeDcaPlans: Number(r.active_dca_plans),
      cashbackPaidZat: BigInt(r.cashback_paid_zat),
      cashbackPendingZat: BigInt(r.cashback_pending_zat),
    };
  }

  // ------------------------------------------------------------- privacy

  /**
   * After the purge window, erase everything that could link the two legs of a Ghost Send:
   * the quotes (which name the hop address on both legs), deposit addresses, and memos.
   * Amounts and statuses stay for aggregate stats.
   */
  async scrubGhostSwaps(ghostId: string) {
    await this.pool.query(
      `update swaps set quote = '{}'::jsonb, deposit_address = 'purged:' || id::text, deposit_memo = null, cashback_address = null
       where parent_id = $1`,
      [ghostId],
    );
  }

  async ghostVolumeSince(since: Date): Promise<number> {
    const { rows } = await this.pool.query(
      `select coalesce(sum(nullif(amount_in_usd, '')::numeric), 0) as v from ghost_transfers where created_at >= $1 and state not in ('refunded', 'failed')`,
      [since],
    );
    return Number(rows[0].v);
  }

  // ------------------------------------------------------------ operations

  /** Holds a Postgres advisory lock for the life of the process. Only one worker may run. */
  async acquireWorkerLock(): Promise<(() => Promise<void>) | null> {
    const client = await this.pool.connect();
    const { rows } = await client.query(`select pg_try_advisory_lock(4206900) as ok`);
    if (!rows[0].ok) {
      client.release();
      return null;
    }
    return async () => {
      await client.query(`select pg_advisory_unlock(4206900)`).catch(() => undefined);
      client.release();
    };
  }

  async heartbeat(job: string, error?: string) {
    if (error) {
      await this.pool.query(
        `insert into worker_heartbeats (job, error_at, last_error) values ($1, now(), $2)
         on conflict (job) do update set error_at = now(), last_error = $2`,
        [job, error.slice(0, 500)],
      );
    } else {
      await this.pool.query(`insert into worker_heartbeats (job, ok_at) values ($1, now()) on conflict (job) do update set ok_at = now()`, [job]);
    }
  }

  async heartbeats(): Promise<{ job: string; okAt: Date | null; errorAt: Date | null; lastError: string | null }[]> {
    const { rows } = await this.pool.query(`select * from worker_heartbeats order by job`);
    return rows.map((r) => ({ job: r.job, okAt: r.ok_at, errorAt: r.error_at, lastError: r.last_error }));
  }

  async reviewQueue(): Promise<{ ghosts: number; payouts: number }> {
    const { rows } = await this.pool.query(
      `select (select count(*) from ghost_transfers where needs_review) as g,
              (select count(*) from cashback_payouts where status = 'unknown' or (status = 'sending' and created_at < now() - interval '10 minutes')) as p`,
    );
    return { ghosts: Number(rows[0].g), payouts: Number(rows[0].p) };
  }

  /** Fixed-window counter. Returns false once `limit` is exceeded in the current window. */
  async rateLimit(key: string, limit: number, windowSec = 60): Promise<boolean> {
    const { rows } = await this.pool.query(
      `insert into rate_limits (key, window_start, count)
       values ($1, to_timestamp(floor(extract(epoch from now()) / $2) * $2), 1)
       on conflict (key, window_start) do update set count = rate_limits.count + 1
       returning count`,
      [key, windowSec],
    );
    if (Math.random() < 0.01) void this.pool.query(`delete from rate_limits where window_start < now() - interval '1 hour'`).catch(() => undefined);
    return rows[0].count <= limit;
  }

  async ping() {
    await this.pool.query("select 1");
  }
}
