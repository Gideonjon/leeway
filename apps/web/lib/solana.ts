"use client";
/**
 * Builds a Solana deposit transfer (native SOL or any SPL / Token-2022 token) for a
 * Wallet Standard wallet to sign and send. RPC reads go through /api/solana so no
 * RPC key ships to the browser.
 */
import { PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";

const ATA_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TOKEN_2022 = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const r = await fetch("/api/solana", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ method, params }) });
  const d = await r.json();
  if (!r.ok || d.error) throw new Error(d.error?.message ?? d.error ?? "Solana RPC unavailable");
  return d.result as T;
}

function ata(owner: PublicKey, mint: PublicKey, tokenProgram: PublicKey) {
  return PublicKey.findProgramAddressSync([owner.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()], ATA_PROGRAM)[0];
}

function u64le(v: bigint) {
  const b = new Uint8Array(8);
  for (let i = 0; i < 8; i++) b[i] = Number((v >> BigInt(8 * i)) & 0xffn);
  return b;
}

export async function buildDepositTx(p: { from: string; to: string; amount: bigint; mint?: string; decimals: number }): Promise<Uint8Array> {
  const payer = new PublicKey(p.from);
  const dest = new PublicKey(p.to);
  const { value } = await rpc<{ value: { blockhash: string; lastValidBlockHeight: number } }>("getLatestBlockhash", [{ commitment: "confirmed" }]);
  const tx = new Transaction({ feePayer: payer, blockhash: value.blockhash, lastValidBlockHeight: value.lastValidBlockHeight });

  if (!p.mint) {
    tx.add(SystemProgram.transfer({ fromPubkey: payer, toPubkey: dest, lamports: p.amount }));
  } else {
    const mint = new PublicKey(p.mint);
    const info = await rpc<{ value: { owner: string } | null }>("getAccountInfo", [p.mint, { encoding: "base64" }]);
    if (!info.value) throw new Error("Token mint not found on Solana.");
    const program = info.value.owner === TOKEN_2022.toBase58() ? TOKEN_2022 : TOKEN_PROGRAM;
    const src = ata(payer, mint, program);
    const dst = ata(dest, mint, program);
    // Create the deposit address's token account if it doesn't exist yet (idempotent).
    tx.add(
      new TransactionInstruction({
        programId: ATA_PROGRAM,
        keys: [
          { pubkey: payer, isSigner: true, isWritable: true },
          { pubkey: dst, isSigner: false, isWritable: true },
          { pubkey: dest, isSigner: false, isWritable: false },
          { pubkey: mint, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: program, isSigner: false, isWritable: false },
        ],
        data: Buffer.from([1]),
      }),
    );
    // transferChecked: [12, amount u64 LE, decimals u8]
    tx.add(
      new TransactionInstruction({
        programId: program,
        keys: [
          { pubkey: src, isSigner: false, isWritable: true },
          { pubkey: mint, isSigner: false, isWritable: false },
          { pubkey: dst, isSigner: false, isWritable: true },
          { pubkey: payer, isSigner: true, isWritable: false },
        ],
        data: Buffer.from([12, ...u64le(p.amount), p.decimals]),
      }),
    );
  }
  return tx.serialize({ requireAllSignatures: false, verifySignatures: false });
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function base58(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let s = "";
  while (n > 0n) {
    s = B58[Number(n % 58n)] + s;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    s = "1" + s;
  }
  return s;
}
