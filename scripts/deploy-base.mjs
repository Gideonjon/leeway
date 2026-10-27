/**
 * Base Mainnet DCA Deployment & Safe v1.4.1 Multisig Setup
 *
 * Usage:
 *   node --env-file=.env scripts/deploy-base.mjs
 *
 * 1. Generates (or loads from .env) KEEPER_PRIVATE_KEY and DEPLOYER_PRIVATE_KEY.
 * 2. Computes the counterfactual Safe v1.4.1 Multisig address on Base Mainnet via
 *    canonical SafeProxyFactory (0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67).
 * 3. Computes the deterministic LeewayDCA contract address on Base Mainnet.
 * 4. Writes KEEPER_PRIVATE_KEY, ADMIN_ADDRESS, and LEEWAY_DCA_CONTRACT to .env and apps/web/.env.local.
 * 5. If DEPLOYER_ADDRESS has Base ETH, broadcasts:
 *      tx 0: Deploy LeewayDCA(keeper, [BASE_USDC])
 *      tx 1: dca.setAdmin(ADMIN_ADDRESS)
 *      tx 2: SafeProxyFactory.createProxyWithNonce(...) to deploy the Safe on-chain
 */
import fs from "node:fs";
import path from "node:path";
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  formatEther,
  getContractAddress,
  http,
  keccak256,
  parseAbi,
  toHex,
  zeroAddress,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

// Canonical Safe v1.4.1 deployments on Base Mainnet (chainId 8453)
const SAFE_PROXY_FACTORY = "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67";
const SAFE_L2_SINGLETON = "0x29fcB43b46531BcA003ddC8FCB67FFE91900C762";
const SAFE_FALLBACK_HANDLER = "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99";

const safeSetupAbi = parseAbi([
  "function setup(address[] _owners, uint256 _threshold, address to, bytes data, address fallbackHandler, address paymentToken, uint256 payment, address payable paymentReceiver)",
]);

const safeFactoryAbi = parseAbi([
  "function createProxyWithNonce(address _singleton, bytes initializer, uint256 saltNonce) returns (address proxy)",
]);

function upsertEnvFile(filePath, updates) {
  let content = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
  for (const [key, val] of Object.entries(updates)) {
    const re = new RegExp(`^${key}=.*$`, "m");
    if (re.test(content)) {
      content = content.replace(re, `${key}=${val}`);
    } else {
      content = content.trimEnd() + `\n${key}=${val}\n`;
    }
  }
  fs.writeFileSync(filePath, content);
}

async function main() {
  const rpcUrl = process.env.BASE_RPC_URL || "https://mainnet.base.org";
  const pub = createPublicClient({ chain: base, transport: http(rpcUrl) });

  const keeperKey = process.env.KEEPER_PRIVATE_KEY || generatePrivateKey();
  const deployerKey = process.env.DEPLOYER_PRIVATE_KEY || generatePrivateKey();
  const keeper = privateKeyToAccount(keeperKey);
  const deployer = privateKeyToAccount(deployerKey);

  // Build Safe v1.4.1 initializer with deployer as initial owner (threshold 1; additional signers can be added in app.safe.global)
  const safeOwners = process.env.SAFE_OWNERS
    ? process.env.SAFE_OWNERS.split(",").map((s) => s.trim())
    : [deployer.address];
  const safeThreshold = BigInt(process.env.SAFE_THRESHOLD || 1);
  const saltNonce = BigInt(keccak256(toHex("leeway-dca-admin-safe-v1")));

  const initializer = encodeFunctionData({
    abi: safeSetupAbi,
    functionName: "setup",
    args: [
      safeOwners,
      safeThreshold,
      zeroAddress,
      "0x",
      SAFE_FALLBACK_HANDLER,
      zeroAddress,
      0n,
      zeroAddress,
    ],
  });

  // Simulate createProxyWithNonce on Base Mainnet to obtain the exact deterministic Safe address
  const { result: safeAddress } = await pub.simulateContract({
    address: SAFE_PROXY_FACTORY,
    abi: safeFactoryAbi,
    functionName: "createProxyWithNonce",
    args: [SAFE_L2_SINGLETON, initializer, saltNonce],
    account: deployer.address,
  });

  const adminAddress = process.env.ADMIN_ADDRESS || safeAddress;
  const nonce = await pub.getTransactionCount({ address: deployer.address });
  const existingContract = process.env.LEEWAY_DCA_CONTRACT;
  const existingCode = existingContract ? await pub.getBytecode({ address: existingContract }) : undefined;

  const predictedDcaAddress =
    existingCode && existingCode !== "0x"
      ? existingContract
      : getContractAddress({ from: deployer.address, nonce: BigInt(nonce) });

  const envUpdates = {
    KEEPER_PRIVATE_KEY: keeperKey,
    KEEPER_ADDRESS: keeper.address,
    DEPLOYER_PRIVATE_KEY: deployerKey,
    DEPLOYER_ADDRESS: deployer.address,
    ADMIN_ADDRESS: adminAddress,
    LEEWAY_DCA_CONTRACT: predictedDcaAddress,
  };

  upsertEnvFile(path.resolve(".env"), envUpdates);
  upsertEnvFile(path.resolve("apps/web/.env.local"), envUpdates);

  const [deployerBal, keeperBal, safeCode, dcaCode] = await Promise.all([
    pub.getBalance({ address: deployer.address }),
    pub.getBalance({ address: keeper.address }),
    pub.getBytecode({ address: adminAddress }),
    pub.getBytecode({ address: predictedDcaAddress }),
  ]);

  console.log("=== Leeway DCA — Base Mainnet Setup ===");
  console.log("Safe Multisig (ADMIN_ADDRESS):", adminAddress, safeCode && safeCode !== "0x" ? "(DEPLOYED)" : "(COUNTERFACTUAL READY)");
  console.log("Keeper EOA    (KEEPER_ADDRESS):", keeper.address, `(${formatEther(keeperBal)} ETH)`);
  console.log("Deployer EOA  (DEPLOYER_ADDR): ", deployer.address, `(${formatEther(deployerBal)} ETH)`);
  console.log("LeewayDCA     (CONTRACT):      ", predictedDcaAddress, dcaCode && dcaCode !== "0x" ? "(DEPLOYED)" : "(DETERMINISTIC READY)");

  if (dcaCode && dcaCode !== "0x") {
    console.log("LeewayDCA is already deployed on Base Mainnet at", predictedDcaAddress);
    return;
  }

  if (deployerBal === 0n) {
    console.log("\n[Action Required to Broadcast On-Chain]");
    console.log(`Fund Deployer EOA (${deployer.address}) with ~0.0005 ETH on Base Mainnet, then re-run:`);
    console.log("  node --env-file=.env scripts/deploy-base.mjs");
    return;
  }

  const abi = JSON.parse(fs.readFileSync("contracts/out/contracts_src_LeewayDCA_sol_LeewayDCA.abi", "utf8"));
  const bin = "0x" + fs.readFileSync("contracts/out/contracts_src_LeewayDCA_sol_LeewayDCA.bin", "utf8").trim();
  const wallet = createWalletClient({ account: deployer, chain: base, transport: http(rpcUrl) });

  console.log("\n1. Deploying LeewayDCA to Base Mainnet...");
  const deployHash = await wallet.deployContract({
    abi,
    bytecode: bin,
    args: [keeper.address, [BASE_USDC]],
  });
  const deployReceipt = await pub.waitForTransactionReceipt({ hash: deployHash });
  const dcaAddress = deployReceipt.contractAddress;
  console.log("   Deployed LeewayDCA:", dcaAddress, "tx:", deployHash);

  console.log("2. Transferring LeewayDCA admin to Safe Multisig:", adminAddress);
  const setAdminHash = await wallet.writeContract({
    address: dcaAddress,
    abi,
    functionName: "setAdmin",
    args: [adminAddress],
  });
  await pub.waitForTransactionReceipt({ hash: setAdminHash });
  console.log("   Admin transferred tx:", setAdminHash);

  if (!safeCode || safeCode === "0x") {
    console.log("3. Deploying Safe v1.4.1 Multisig proxy on Base Mainnet...");
    const safeHash = await wallet.writeContract({
      address: SAFE_PROXY_FACTORY,
      abi: safeFactoryAbi,
      functionName: "createProxyWithNonce",
      args: [SAFE_L2_SINGLETON, initializer, saltNonce],
    });
    await pub.waitForTransactionReceipt({ hash: safeHash });
    console.log("   Safe deployed at:", adminAddress, "tx:", safeHash);
  }

  const [onChainAdmin, onChainKeeper, usdcAllowed] = await Promise.all([
    pub.readContract({ address: dcaAddress, abi, functionName: "admin" }),
    pub.readContract({ address: dcaAddress, abi, functionName: "keeper" }),
    pub.readContract({ address: dcaAddress, abi, functionName: "allowedToken", args: [BASE_USDC] }),
  ]);

  console.log("\nPost-deploy verification:", { onChainAdmin, onChainKeeper, usdcAllowed });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
