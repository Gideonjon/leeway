"use client";
import { useState } from "react";
import { chainIcon, chainName, tokenIcon } from "@/lib/chains";

const HUES = [168, 38, 200, 12, 280, 140, 330, 90];
function monogramHue(s: string) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return HUES[h % HUES.length];
}

function Glyph({ src, label, size }: { src: string | null; label: string; size: number }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) {
    const hue = monogramHue(label);
    return (
      <span
        className="glyph glyph--mono"
        style={{ width: size, height: size, fontSize: size * 0.38, background: `hsl(${hue} 45% 28%)`, color: `hsl(${hue} 70% 82%)` }}
        aria-hidden="true"
      >
        {label.slice(0, 3)}
      </span>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="glyph" src={src} alt="" width={size} height={size} onError={() => setBroken(true)} />;
}

/** Token avatar with its chain as a badge, the way wallets show bridged assets. */
export function TokenIcon({ symbol, chain, size = 40 }: { symbol: string; chain?: string; size?: number }) {
  const badge = Math.round(size * 0.44);
  return (
    <span className="token-icon" style={{ width: size, height: size }} title={chain ? `${symbol} on ${chainName(chain)}` : symbol}>
      <Glyph src={tokenIcon(symbol)} label={symbol} size={size} />
      {chain && (
        <span className="token-icon__badge" style={{ width: badge + 4, height: badge + 4 }}>
          <Glyph src={chainIcon(chain)} label={chainName(chain)} size={badge} />
        </span>
      )}
    </span>
  );
}

export function ChainIcon({ chain, size = 24 }: { chain: string; size?: number }) {
  return <Glyph src={chainIcon(chain)} label={chainName(chain)} size={size} />;
}
