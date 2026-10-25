import { Suspense } from "react";
import { Footer, Header } from "@/components/Header";
import { Tracker } from "./Tracker";

export const metadata = { title: "Track a transfer — Leeway" };

export default function TrackPage() {
  return (
    <>
      <Header current="track" />
      <main className="wrap page">
        <div className="narrow">
          <h1 className="page__title">Where is it now?</h1>
          <p className="page__lede">Paste your tracking code (lw-…) or the deposit address of a swap.</p>
          <Suspense>
            <Tracker />
          </Suspense>
        </div>
      </main>
      <Footer />
    </>
  );
}
