import { spawn } from "node:child_process";

function startBg(name, cmd, args, retryMs = 10_000) {
  const launch = () => {
    const proc = spawn(cmd, args, { stdio: "inherit", env: process.env });
    proc.on("exit", (code) => {
      console.log(`[railway] ${name} exited with code ${code}; restarting in ${retryMs}ms`);
      setTimeout(launch, retryMs);
    });
  };
  launch();
}

if ((process.env.ZCASH_RPC_URL ?? "").includes("127.0.0.1:4020")) {
  startBg("mock-zcash-rpc", "node", ["scripts/mock-services.mjs"], 5_000);
}

if (process.env.DISABLE_EMBEDDED_WORKER !== "true") {
  startBg("leeway-worker", "node", ["apps/worker/dist/index.js"], 10_000);
}

const web = spawn("node", ["apps/web/server.js"], { stdio: "inherit", env: process.env });
web.on("exit", (code) => process.exit(code ?? 0));
