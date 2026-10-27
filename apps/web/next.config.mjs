import path from "node:path";
import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */

// What the browser may talk to. Leeway's own API, plus WalletConnect when mobile EVM wallets are enabled.
// Every other chain call goes through the user's own wallet extension (which is outside page CSP).
const walletConnect = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
  ? " https://*.walletconnect.org https://*.walletconnect.com wss://*.walletconnect.org wss://*.walletconnect.com https://*.reown.com wss://*.reown.com https://api.web3modal.org"
  : "";

const evmRpcs =
  " https://ethereum-rpc.publicnode.com https://mainnet.base.org https://arb1.arbitrum.io https://mainnet.optimism.io https://polygon-rpc.com https://bsc-dataseed.bnbchain.org https://api.avax.network https://rpc.gnosischain.com https://rpc.berachain.com";

const csp = [
  "default-src 'self'",
  // Next.js injects small inline bootstrap scripts; no third-party script is ever loaded.
  "script-src 'self' 'unsafe-inline'" + (process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""),
  "style-src 'self' 'unsafe-inline'",
  // Wallet icons arrive as data: URIs from the extensions themselves.
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'" + walletConnect + evmRpcs,
  "frame-src" + (walletConnect ? " https://verify.walletconnect.org https://verify.walletconnect.com" : " 'none'"),
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "upgrade-insecure-requests",
].join("; ");

const nextConfig = {
  output: "standalone",
  // Monorepo: trace dependencies from the repo root so the standalone server includes @leeway/core.
  outputFileTracingRoot: path.join(path.dirname(fileURLToPath(import.meta.url)), "../.."),
  serverExternalPackages: ["pg"],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
        ],
      },
      {
        source: "/api/(.*)",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
    ];
  },
};

export default nextConfig;
