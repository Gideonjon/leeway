"use client";
import { useEffect, useState } from "react";
import { isEvmChain } from "@/lib/chains";

export type NetworkMode = "mainnet" | "testnet";

const KEY = "leeway.network";
const EVENT = "leeway:network";

export const SAMPLE_SHIELDED_ZEC = "u1" + "q9x7w4m2k8p5v3n6j4h2g8f5d3s7a9p2m4k6n8v3c5x7z9q2w4e6r8t3y5u7i9o2p4a6s8d3f5g7h9j2k4l6m8n3b5v7c9x2z4q6w8e3r5t7y9u2i4o6p8";

const SAMPLE_BY_CHAIN: Record<string, string> = {
  sol: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
  zec: SAMPLE_SHIELDED_ZEC,
  btc: "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq",
  ltc: "ltc1q6rz28mcfaxtmd6v789l9rrlrusdprr9pqcpvkl",
  doge: "DH5yaieqoZN36fDVciNyRueRGvGLR3mr7L",
  near: "testnet-user.near",
  tron: "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb",
  xrp: "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh",
  ton: "EQDtFpEwcFAEcRe5mLVh2N6C0x-_hJEM7W61_JLnSF74p4q2",
  sui: "0x0000000000000000000000000000000000000000000000000000000000000002",
  aptos: "0x1",
  stellar: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7",
  cardano: "addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgse35a3x",
};

export function sampleAddressForChain(chain: string): string {
  if (isEvmChain(chain)) return "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
  return SAMPLE_BY_CHAIN[chain] ?? "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
}

export function getNetwork(): NetworkMode {
  if (typeof window === "undefined") return "mainnet";
  try {
    return localStorage.getItem(KEY) === "testnet" ? "testnet" : "mainnet";
  } catch {
    return "mainnet";
  }
}

export function setNetwork(mode: NetworkMode) {
  try {
    localStorage.setItem(KEY, mode);
  } catch {}
  if (typeof document !== "undefined") {
    document.documentElement.dataset.network = mode;
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(EVENT, { detail: mode }));
  }
}

export function useNetwork(): [NetworkMode, (m: NetworkMode) => void] {
  const [net, setNet] = useState<NetworkMode>("mainnet");
  useEffect(() => {
    const initial = getNetwork();
    setNet(initial);
    document.documentElement.dataset.network = initial;
    const onChange = () => setNet(getNetwork());
    window.addEventListener(EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);
  return [net, setNetwork];
}
