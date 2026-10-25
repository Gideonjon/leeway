/** The Leeway mark: a quarter ring (the lee of a hull) and the light it shelters. */
export function Mark({ size = 28, title = "Leeway" }: { size?: number; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label={title}>
      <path d="M14 54 A40 40 0 0 1 54 14" fill="none" stroke="var(--lee)" strokeWidth="12" strokeLinecap="round" />
      <circle cx="46" cy="46" r="7" fill="var(--lantern)" />
    </svg>
  );
}

/** Mark plus a live-text wordmark: "lee" upright, "way" leaning forward. */
export function Lockup() {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
      <Mark size={26} title="" />
      <span style={{ font: "400 28px/1 var(--font-display)", letterSpacing: "-0.01em", color: "var(--ink)" }}>
        lee<em>way</em>
      </span>
    </span>
  );
}
