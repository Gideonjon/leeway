import { Suspense } from "react";
import { Tracker } from "./Tracker";

export const metadata = { title: "Track a transfer — Leeway" };

export default function TrackPage() {
  return (
    <main className="stage">
      <section className="widget">
        <header className="widget__head">
          <h1>Track a transfer</h1>
          <p>Paste your tracking code (lw-…) or a swap&apos;s deposit address.</p>
        </header>
        <div className="widget__body">
          <Suspense>
            <Tracker />
          </Suspense>
        </div>
      </section>
    </main>
  );
}
