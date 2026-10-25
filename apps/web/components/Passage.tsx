/**
 * The hero drawing: money leaves one chain, ducks under the shielded water, surfaces on another.
 * The public route is visible above the water; underneath, only a dotted trace.
 */
export function Passage() {
  return (
    <svg className="passage" viewBox="0 0 560 190" role="img" aria-label="Funds go into shielded ZEC on one chain and come out on another, with no visible link between them">
      <rect className="passage__water" x="150" y="96" width="260" height="78" rx="16" />
      <text className="passage__water-label" x="280" y="160" textAnchor="middle">shielded pool</text>

      {/* leg one: down into the water */}
      <path className="passage__route" style={{ ["--len" as string]: 220 }} d="M40 56 H120 Q150 56 162 84 L176 112" />
      {/* under the surface: only a faint trace */}
      <path className="passage__under" d="M184 124 Q280 140 376 124" />
      {/* leg two: back up and out */}
      <path className="passage__route passage__route--out" style={{ ["--len" as string]: 220 }} d="M384 112 L398 84 Q410 56 440 56 H520" />
      <circle className="passage__dot" cx="520" cy="56" r="7" />

      <text className="passage__label" x="40" y="34">Your USDC on Base</text>
      <text className="passage__sub" x="40" y="80">leg one</text>
      <text className="passage__label" x="520" y="34" textAnchor="end">Their SOL on Solana</text>
      <text className="passage__sub" x="520" y="80" textAnchor="end">leg two</text>
    </svg>
  );
}
