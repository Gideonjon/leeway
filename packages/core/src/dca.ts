import { keccak256, toBytes, type Address } from "viem";

/** Minimal ABI for the parts of LeewayDCA the app and keeper use. */
export const leewayDcaAbi = [
  {
    type: "function",
    name: "createPlan",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "amountPerPeriod", type: "uint128" },
      { name: "interval", type: "uint32" },
      { name: "periodsTotal", type: "uint32" },
      { name: "zecRecipientHash", type: "bytes32" },
    ],
    outputs: [{ name: "planId", type: "uint256" }],
  },
  {
    type: "function",
    name: "cancelPlan",
    stateMutability: "nonpayable",
    inputs: [{ name: "planId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "execute",
    stateMutability: "nonpayable",
    inputs: [
      { name: "planId", type: "uint256" },
      { name: "depositAddress", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "isRunnable",
    stateMutability: "view",
    inputs: [{ name: "planId", type: "uint256" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "plans",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [
      { name: "owner", type: "address" },
      { name: "token", type: "address" },
      { name: "amountPerPeriod", type: "uint128" },
      { name: "interval", type: "uint32" },
      { name: "periodsTotal", type: "uint32" },
      { name: "periodsDone", type: "uint32" },
      { name: "nextRunAt", type: "uint64" },
      { name: "active", type: "bool" },
      { name: "zecRecipientHash", type: "bytes32" },
    ],
  },
  {
    type: "event",
    name: "PlanCreated",
    inputs: [
      { name: "planId", type: "uint256", indexed: true },
      { name: "owner", type: "address", indexed: true },
      { name: "token", type: "address", indexed: false },
      { name: "amountPerPeriod", type: "uint256", indexed: false },
      { name: "interval", type: "uint32", indexed: false },
      { name: "periodsTotal", type: "uint32", indexed: false },
      { name: "zecRecipientHash", type: "bytes32", indexed: false },
    ],
  },
] as const;

export const erc20ApproveAbi = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
] as const;

export const BASE_USDC_ADDRESS: Address = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const BASE_CHAIN_ID = 8453;

/** The on-chain commitment to a user's Zcash address. The address itself never goes on-chain. */
export function zecRecipientHash(zecAddress: string): `0x${string}` {
  return keccak256(toBytes(zecAddress.trim()));
}

export const DCA_INTERVALS = {
  daily: 86_400,
  weekly: 7 * 86_400,
  biweekly: 14 * 86_400,
  monthly: 30 * 86_400,
} as const;
export type DcaFrequency = keyof typeof DCA_INTERVALS;
