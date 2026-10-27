import { BASE_USDC_ASSET_ID, buildQuoteRequest, leewayDcaAbi, ZEC_ASSET_ID } from "@leeway/core";
import { createPublicClient, createWalletClient, http, isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import type { WorkerContext } from "./context.js";

/**
 * DCA keeper. For each plan that is due and funded on-chain:
 *   1. get a 1Click quote (Base USDC → ZEC, recipient = the user's shielded address)
 *   2. call LeewayDCA.execute(planId, depositAddress) — the contract pulls one period from the user
 *   3. tell 1Click about the deposit tx
 */
export async function tickDca(ctx: WorkerContext) {
  const { cfg, db } = ctx;
  if (!cfg.dcaContract || !cfg.keeperPrivateKey) return;

  const transport = http(cfg.baseRpcUrl);
  const pub = createPublicClient({ chain: base, transport });
  const account = privateKeyToAccount(cfg.keeperPrivateKey);
  const wallet = createWalletClient({ chain: base, transport, account });

  for (const plan of await db.activeDcaPlans()) {
    if (plan.planId < 0) continue;
    try {
      const onchain = await pub.readContract({
        address: cfg.dcaContract,
        abi: leewayDcaAbi,
        functionName: "plans",
        args: [BigInt(plan.planId)],
      });
      const active = onchain[7];
      if (!active) {
        await db.setDcaPlanActive(plan.planId, false);
        ctx.log("dca", "plan ended", { plan: plan.planId });
        continue;
      }
      const runnable = await pub.readContract({
        address: cfg.dcaContract,
        abi: leewayDcaAbi,
        functionName: "isRunnable",
        args: [BigInt(plan.planId)],
      });
      if (!runnable) continue;

      const owner = onchain[0];
      const amount = onchain[2];
      const quote = await ctx.oneclick.quote(
        buildQuoteRequest(
          {
            originAsset: BASE_USDC_ASSET_ID,
            destinationAsset: ZEC_ASSET_ID,
            amount: amount.toString(),
            recipient: plan.zecAddress,
            refundTo: owner,
            deadlineMinutes: 30,
          },
          { feeRecipient: cfg.feeRecipient, appFeeBps: cfg.appFeeBps, slippageBps: cfg.slippageBps },
        ),
      );
      const deposit = quote.quote.depositAddress;
      if (!deposit || !isAddress(deposit)) throw new Error(`unexpected deposit address: ${deposit}`);

      await db.insertSwap({ kind: "dca", quote, cashbackAddress: plan.zecAddress });
      const runId = await db.insertDcaRun(plan.planId, deposit);

      const hash = await wallet.writeContract({
        address: cfg.dcaContract,
        abi: leewayDcaAbi,
        functionName: "execute",
        args: [BigInt(plan.planId), deposit],
      });
      const receipt = await pub.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        await db.updateDcaRun(runId, { txHash: hash, status: "reverted" });
        ctx.log("dca", "execute reverted", { plan: plan.planId, hash });
        continue;
      }
      await db.updateDcaRun(runId, { txHash: hash, status: "sent" });
      await ctx.oneclick.submitDeposit(hash, deposit).catch(() => undefined);
      ctx.log("dca", "executed", { plan: plan.planId, hash });
    } catch (e) {
      ctx.log("dca", "run failed", { plan: plan.planId, error: String(e) });
    }
  }
}
