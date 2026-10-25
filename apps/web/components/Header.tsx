import Link from "next/link";
import { Lockup } from "./Logo";

export function Header({ current }: { current?: "send" | "dca" | "track" | "stats" }) {
  const link = (href: string, key: typeof current, label: string) => (
    <Link href={href} aria-current={current === key ? "page" : undefined}>
      {label}
    </Link>
  );
  return (
    <header className="wrap top">
      <Link href="/" className="top__brand" aria-label="Leeway home">
        <Lockup />
      </Link>
      <nav aria-label="Main">
        {link("/", "send", "Send")}
        {link("/dca", "dca", "DCA")}
        {link("/track", "track", "Track")}
        {link("/stats", "stats", "Numbers")}
      </nav>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="wrap foot">
      <span>Leeway routes swaps through NEAR Intents and settles in shielded ZEC.</span>
      <span>Not a bank. Not financial advice. Check every address before you send.</span>
    </footer>
  );
}
