import { randomBytes } from "node:crypto";
import {
  cashbackUsdMicros,
  findToken,
  isShieldedZcashAddress,
  makeTrackingCode,
  toBaseUnits,
  usdMicrosToZat,
  usdToMicros,
  validateAddress,
  validateGhostRequest,
  ZEC_ASSET_ID,
  zecPrice,
  type QuoteResponse,
} from "@leeway/core";
import { errorMessage, fail, guard, json, services, tokens } from "@/lib/server";

export const dynamic = "force-dynamic";

function hex(n: number) {
  return randomBytes(n).toString("hex");
}

/**
 * Sandbox / Testnet endpoints so users can test Ghost Send, Swap, Shielded DCA,
 * and Cashback end-to-end without spending real mainnet funds.
 */
export async function POST(req: Request) {
  const blocked = await guard(req, "testnet", { perMin: 60 });
  if (blocked) return blocked;

  const { cfg, db } = services();
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return fail("Send a JSON body.");
  }

  const action = String(body.action ?? "");
  const list = await tokens().catch(() => []);
  const zecUsd = zecPrice(list) || 512.3;

  try {
    if (action === "quote" || action === "ghost") {
      const originAsset = String(body.originAsset ?? "");
      const destinationAsset = String(body.destinationAsset ?? "");
      const rawAmount = String(body.amount ?? "");
      const recipient = String(body.recipient ?? "").trim();
      const refundTo = String(body.refundTo ?? "").trim();
      const cashback = body.cashbackAddress ? String(body.cashbackAddress).trim() : null;

      const origin = findToken(list, originAsset);
      const dest = findToken(list, destinationAsset);
      if (!origin) return fail("Pick an asset to send.");
      if (!dest) return fail("Pick an asset to receive.");

      if (action === "ghost" && destinationAsset === ZEC_ASSET_ID) {
        return fail("To receive ZEC, use Swap and paste a shielded address: it's already private on arrival.");
      }
      if (action === "ghost" && origin.blockchain === "zec") {
        return fail("Sending from shielded ZEC is already private. Use Swap instead.");
      }

      const recipientErr = validateAddress(dest.blockchain, recipient);
      if (recipientErr) return fail(`Recipient: ${recipientErr}`);
      const refundErr = validateAddress(origin.blockchain, refundTo);
      if (refundErr) return fail(`Refund address: ${refundErr}`);
      if (cashback && !isShieldedZcashAddress(cashback)) {
        return fail("Cashback goes to a shielded Zcash address: one starting with u1 or zs1.");
      }

      const baseUnits = toBaseUnits(rawAmount, origin.decimals);
      const inUsd = Number(rawAmount) * origin.price;
      if (action === "ghost") {
        const invalid = validateGhostRequest({ recipient, refundTo, cashbackAddress: cashback, amountUsd: inUsd, maxUsd: cfg.ghostMaxUsd });
        if (invalid) return fail(invalid);
      }

      const feeShare = cfg.appFeeBps / 10_000;
      const outUsd = inUsd * (1 - feeShare);
      const outAmount = outUsd / dest.price;
      const outBase = String(Math.max(1, Math.floor(outAmount * 10 ** dest.decimals)));
      const dep = `testnet_${origin.blockchain}_${hex(12)}`;
      const deadline = new Date(Date.now() + 60 * 60_000).toISOString();

      const quote: QuoteResponse = {
        correlationId: `testnet-${hex(6)}`,
        timestamp: new Date().toISOString(),
        signature: "testnet-sig",
        quoteRequest: {
          dry: false,
          swapType: "EXACT_INPUT",
          slippageTolerance: cfg.slippageBps,
          originAsset,
          depositType: "ORIGIN_CHAIN",
          destinationAsset: action === "ghost" ? ZEC_ASSET_ID : destinationAsset,
          amount: baseUnits,
          refundTo,
          refundType: "ORIGIN_CHAIN",
          recipient,
          recipientType: "DESTINATION_CHAIN",
          deadline,
        },
        quote: {
          depositAddress: dep,
          amountIn: baseUnits,
          amountInFormatted: rawAmount,
          amountInUsd: inUsd.toFixed(2),
          minAmountIn: baseUnits,
          amountOut: outBase,
          amountOutFormatted: outAmount.toFixed(6),
          amountOutUsd: outUsd.toFixed(2),
          minAmountOut: outBase,
          deadline,
          timeEstimate: 15,
        },
      };

      if (action === "quote") {
        await db.insertSwap({ kind: "swap", quote, cashbackAddress: cashback });
        return json({
          dry: false,
          depositAddress: dep,
          depositMemo: null,
          amountIn: rawAmount,
          amountInUsd: inUsd.toFixed(2),
          amountOut: outAmount.toFixed(6),
          amountOutUsd: outUsd.toFixed(2),
          minAmountOut: outBase,
          timeEstimate: 15,
          deadline,
          cashbackUsd: (inUsd * cfg.cashbackBps) / 10_000,
        });
      }

      const code = makeTrackingCode((n) => randomBytes(n));
      const ghost = await db.insertGhost({
        code,
        state: "awaiting_deposit",
        originAsset,
        destinationAsset,
        recipient,
        refundTo,
        cashbackAddress: cashback,
        leg1DepositAddress: dep,
        hopTransparentAddress: `t1TestnetHop${hex(11)}`,
        receivedZat: null,
        shieldTxid: null,
        releaseAt: null,
        leg2DepositAddress: null,
        leg2Txid: null,
        amountInUsd: inUsd.toFixed(2),
        error: null,
      });
      await db.insertSwap({ kind: "ghost_leg1", quote, cashbackAddress: cashback, parentId: ghost.id });

      return json({
        code,
        depositAddress: dep,
        depositMemo: null,
        amountIn: rawAmount,
        amountInUsd: inUsd.toFixed(2),
        deadline,
      });
    }

    if (action === "simulate") {
      const id = String(body.id ?? "");
      const kind = String(body.kind ?? "swap");
      const step = String(body.step ?? "auto");

      if (kind === "swap") {
        const s = await db.swapByDeposit(id);
        if (!s) return fail("Testnet swap not found.", 404);
        if (step === "processing") {
          await db.updateSwapStatus(s.id, "PROCESSING", s.amountOut, s.amountInUsd);
          return json({ ok: true, status: "PROCESSING" });
        }
        await db.updateSwapStatus(s.id, "SUCCESS", s.amountOut, s.amountInUsd);
        if (s.cashbackAddress && s.amountInUsd && !s.cashbackAccrued) {
          const usdMicros = cashbackUsdMicros(usdToMicros(s.amountInUsd), cfg.cashbackBps);
          const zat = usdMicrosToZat(usdMicros, zecUsd);
          await db.insertCashback({ source: "swap", sourceId: s.id, address: s.cashbackAddress, usdMicros, zat, eligibleAt: new Date() });
          await db.markCashbackAccrued(s.id);
        }
        return json({ ok: true, status: "SUCCESS" });
      }

      const g = await db.ghostByCode(id);
      if (!g) return fail("Testnet Ghost Send not found.", 404);

      if (step === "shielding") {
        await db.updateGhost(g.id, {
          state: "shielding",
          receivedZat: 25_000_000n,
          shieldTxid: `testnet_shield_${hex(12)}`,
        });
        return json({ ok: true, state: "shielding" });
      }

      if (step === "holding" || (g.state === "awaiting_deposit" && step === "auto")) {
        const releaseAt = new Date(Date.now() + 60_000);
        await db.updateGhost(g.id, {
          state: "holding",
          receivedZat: 25_000_000n,
          shieldTxid: g.shieldTxid ?? `testnet_shield_${hex(12)}`,
          releaseAt,
        });
        return json({ ok: true, state: "holding", releaseAt: releaseAt.toISOString() });
      }

      if (step === "sending_leg2") {
        await db.updateGhost(g.id, {
          state: "sending_leg2",
          leg2DepositAddress: `testnet_leg2_${hex(10)}`,
          leg2Txid: `testnet_leg2_tx_${hex(12)}`,
        });
        return json({ ok: true, state: "sending_leg2" });
      }

      await db.updateGhost(g.id, {
        state: "completed",
        leg2DepositAddress: g.leg2DepositAddress ?? `testnet_leg2_${hex(10)}`,
        leg2Txid: g.leg2Txid ?? `testnet_leg2_tx_${hex(12)}`,
        completedAt: new Date(),
        error: null,
      });

      if (g.leg1DepositAddress) {
        const leg1 = await db.swapByDeposit(g.leg1DepositAddress);
        if (leg1) {
          await db.updateSwapStatus(leg1.id, "SUCCESS", leg1.amountOut, leg1.amountInUsd);
          if (leg1.cashbackAddress && leg1.amountInUsd && !leg1.cashbackAccrued) {
            const usdMicros = cashbackUsdMicros(usdToMicros(leg1.amountInUsd), cfg.cashbackBps);
            const zat = usdMicrosToZat(usdMicros, zecUsd);
            await db.insertCashback({ source: "ghost", sourceId: leg1.id, address: leg1.cashbackAddress, usdMicros, zat, eligibleAt: new Date() });
            await db.markCashbackAccrued(leg1.id);
          }
        }
      }
      return json({ ok: true, state: "completed" });
    }

    if (action === "dca-create") {
      const owner = String(body.owner ?? "").trim();
      const zecAddress = String(body.zecAddress ?? "").trim();
      const amountUsd = Number(body.amount ?? 25);
      const intervalSec = Number(body.intervalSec ?? 604_800);
      const periodsTotal = Number(body.periodsTotal ?? 12);
      if (!owner) return fail("Missing owner address.");
      if (!isShieldedZcashAddress(zecAddress)) return fail("Use a shielded Zcash address (u1… or zs1…).");
      if (!(amountUsd >= 5)) return fail("Minimum DCA buy is 5 USDC.");

      // Negative planId marks a Testnet simulated DCA plan so the mainnet keeper ignores it.
      const planId = -Math.floor(1000 + Math.random() * 899_000);
      const amountPerPeriod = String(Math.round(amountUsd * 1_000_000));
      await db.upsertDcaPlan({
        planId,
        owner,
        zecAddress,
        amountPerPeriod,
        intervalSec,
        periodsTotal,
        active: true,
      });
      return json({ planId });
    }

    if (action === "dca-run") {
      const planId = Number(body.planId);
      const owner = String(body.owner ?? "").trim();
      const plans = await db.dcaPlansByOwner(owner);
      const plan = plans.find((p) => p.planId === planId);
      if (!plan) return fail("Testnet DCA plan not found.", 404);
      const usd = (Number(plan.amountPerPeriod) / 1e6).toFixed(2);
      const usdMicros = cashbackUsdMicros(usdToMicros(usd), cfg.cashbackBps);
      const zat = usdMicrosToZat(usdMicros, zecUsd);
      const runId = await db.insertDcaRun(plan.planId, `testnet_dca_${hex(8)}`);
      await db.updateDcaRun(runId, { txHash: `0xtestnet${hex(28)}`, status: "sent" });
      await db.insertCashback({
        source: "dca",
        sourceId: runId,
        address: plan.zecAddress,
        usdMicros,
        zat,
        eligibleAt: new Date(),
      });
      return json({ ok: true, runId, zat: zat.toString() });
    }

    if (action === "dca-stop") {
      const planId = Number(body.planId);
      await db.setDcaPlanActive(planId, false);
      return json({ ok: true });
    }

    return fail("Unknown testnet action.");
  } catch (e) {
    return fail(errorMessage(e), 500);
  }
}
