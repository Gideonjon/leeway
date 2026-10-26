// End-to-end wallet test: injects a test EVM wallet (EIP-6963, backed by a local anvil
// chain with Base's chain id) and a test Solana wallet (Wallet Standard), connects both,
// and pays a real deposit from each. Run with Playwright available on NODE_PATH.
const { chromium } = require("playwright");
const { Transaction } = require("@solana/web3.js");

const APP = process.env.APP ?? "http://localhost:3100";
const SHOTS = process.env.SHOTS ?? ".";
const SOL_ADDR = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";

function inject({ solAddr }) {
  // ---- EVM wallet: EIP-1193 provider that forwards to anvil (anvil signs for its own accounts).
  const listeners = {};
  const rpc = async (method, params) => {
    const r = await fetch("http://127.0.0.1:8545", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
    const d = await r.json();
    if (d.error) throw new Error(d.error.message);
    return d.result;
  };
  const provider = {
    request: async ({ method, params }) => {
      if (method === "eth_requestAccounts") return rpc("eth_accounts", []);
      if (method === "wallet_switchEthereumChain" || method === "wallet_addEthereumChain") return null;
      return rpc(method, params ?? []);
    },
    on: (e, f) => ((listeners[e] ??= []).push(f)),
    removeListener: () => {},
  };
  const icon = "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#F6851B"/><circle cx="16" cy="16" r="7" fill="#fff"/></svg>');
  const announce = () =>
    window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info: { uuid: "t-1", name: "Test EVM", icon, rdns: "test.evm" }, provider }) }));
  window.addEventListener("eip6963:requestProvider", announce);
  announce();

  // ---- Solana wallet: Wallet Standard, records the transaction it is asked to sign.
  const account = { address: solAddr, publicKey: new Uint8Array(32), chains: ["solana:mainnet"], features: ["solana:signAndSendTransaction"] };
  const solIcon = "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#AB9FF2"/></svg>');
  const wallet = {
    version: "1.0.0",
    name: "Test Sol",
    icon: solIcon,
    chains: ["solana:mainnet"],
    accounts: [],
    features: {
      "standard:connect": { version: "1.0.0", connect: async () => ((wallet.accounts = [account]), { accounts: [account] }) },
      "standard:disconnect": { version: "1.0.0", disconnect: async () => {} },
      "standard:events": { version: "1.0.0", on: () => () => {} },
      "solana:signAndSendTransaction": {
        version: "1.0.0",
        supportedTransactionVersions: ["legacy", 0],
        signAndSendTransaction: async (...inputs) => {
          window.__solTx = Array.from(inputs[0].transaction);
          return [{ signature: new Uint8Array(64).fill(7) }];
        },
      },
    },
  };
  const register = (api) => api.register(wallet);
  window.addEventListener("wallet-standard:app-ready", (e) => register(e.detail));
  try {
    window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: register }));
  } catch {}
}

const anvil = async (method, params) =>
  (await (await fetch("http://127.0.0.1:8545", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).json()).result;

(async () => {
  const b = await chromium.launch();
  // bypassCSP: the injected test wallets call anvil from page context; real wallet extensions run outside page CSP.
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark", bypassCSP: true });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => console.log("PAGE ERROR", e.message));
  await p.addInitScript(inject, { solAddr: SOL_ADDR });
  await p.goto(APP + "/swap", { waitUntil: "networkidle" });
  await p.waitForTimeout(1200);

  // 1. Connect sheet lists both detected wallets.
  await p.click(".connect");
  await p.waitForTimeout(500);
  await p.screenshot({ path: `${SHOTS}/w1-sheet.png` });
  const rows = await p.$$eval(".wrow__text strong", (els) => els.map((e) => e.textContent));
  console.log("detected:", rows.join(", "));
  await p.click('.wrow:has-text("Test EVM")');
  await p.waitForTimeout(800);
  await p.click('.wrow:has-text("Test Sol")');
  await p.waitForTimeout(800);
  await p.screenshot({ path: `${SHOTS}/w2-connected.png` });
  await p.keyboard.press("Escape");
  console.log("header:", await p.textContent(".connect"));

  // 2. EVM pay: ETH on Base -> SOL. Refund should fill from the EVM wallet; recipient from the Solana wallet.
  const pick = async (which, symbol, chainName) => {
    await p.click(`.tok-btn >> nth=${which}`);
    await p.fill(".search input", symbol);
    try {
      await p.click(`.token-row:has(strong:text-is("${symbol}")):has-text("${chainName}")`, { timeout: 5000 });
    } catch (e) {
      await p.screenshot({ path: `${SHOTS}/w-debug.png` });
      console.log("rows:", await p.$$eval(".token-row", (els) => els.map((e) => e.textContent)));
      throw e;
    }
  };
  await pick(0, "ETH", "Base");
  await pick(1, "SOL", "Solana");
  await p.fill(".tcard__amount", "0.05");
  await p.waitForTimeout(1500);
  const refund = await p.inputValue(".opt__input >> nth=0");
  console.log("refund autofilled:", refund);
  await p.click(".addr__fill");
  console.log("recipient filled:", await p.inputValue(".addr__input"));
  await p.click(".opt--cash .switch"); // cashback off for this one
  await p.click("form .cta");
  await p.waitForSelector(".deposit__addr code", { timeout: 15000 });
  const dep = await p.textContent(".deposit__addr code");
  await p.screenshot({ path: `${SHOTS}/w3-evm-deposit.png` });
  await p.click(".deposit .cta");
  await p.waitForTimeout(3000);
  const bal = BigInt(await anvil("eth_getBalance", [dep, "latest"]));
  console.log("EVM deposit", dep, "received wei:", bal.toString(), bal === 50000000000000000n ? "OK" : "MISMATCH");
  await p.screenshot({ path: `${SHOTS}/w4-evm-paid.png` });

  // 3. Solana pay: USDC on Solana -> ETH on Base.
  await p.click(".cta--quiet");
  await pick(0, "USDC", "Solana");
  await pick(1, "ETH", "Base");
  await p.fill(".tcard__amount", "12.5");
  await p.waitForTimeout(1500);
  console.log("refund autofilled:", await p.inputValue(".opt__input >> nth=0"));
  await p.click(".addr__fill");
  await p.click("form .cta");
  await p.waitForSelector(".deposit__addr code", { timeout: 15000 });
  const solDep = await p.textContent(".deposit__addr code");
  await p.click(".deposit .cta");
  await p.waitForTimeout(2500);
  const bytes = await p.evaluate(() => window.__solTx);
  const tx = Transaction.from(Buffer.from(bytes));
  const ix = tx.instructions.map((i) => i.programId.toBase58());
  const tc = tx.instructions[1];
  const amount = tc.data.readBigUInt64LE(1);
  console.log("SOL tx fee payer:", tx.feePayer.toBase58(), "programs:", ix.join(" → "));
  console.log("transferChecked amount:", amount.toString(), "decimals:", tc.data[9], amount === 12500000n && tc.data[9] === 6 ? "OK" : "MISMATCH");
  console.log("deposit owner in ATA create:", tx.instructions[0].keys[2].pubkey.toBase58() === solDep ? "OK" : "MISMATCH");
  await p.screenshot({ path: `${SHOTS}/w5-sol-paid.png` });

  // 4. ZEC origin: payment request link for Zcash wallets.
  await p.click(".cta--quiet");
  await pick(0, "ZEC", "Zcash");
  await pick(1, "USDC", "Base");
  await p.fill(".tcard__amount", "0.25");
  await p.waitForTimeout(1500);
  await p.fill(".addr__input", "0x2527D02599Ba641c19FEa793cD0F167589a0f10D");
  await p.fill(".opt__input >> nth=0", "t1Rv4exT7bqhZqi2j7xz8bUHDMxwosrjADU");
  await p.click("form .cta");
  await p.waitForSelector(".cta--link", { timeout: 15000 });
  console.log("ZIP-321 link:", await p.getAttribute(".cta--link", "href"));
  await p.screenshot({ path: `${SHOTS}/w6-zec-request.png` });
  await b.close();
})();
