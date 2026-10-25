import { Footer, Header } from "@/components/Header";
import { DcaPlanner } from "./DcaPlanner";

export const metadata = { title: "Shielded DCA — Leeway" };

export default function DcaPage() {
  return (
    <>
      <Header current="dca" />
      <main className="wrap page">
        <div className="narrow">
          <h1 className="page__title">Buy ZEC on a schedule.</h1>
          <p className="page__lede">
            Pick an amount and how often. On each date, the Leeway contract spends exactly that much USDC from your wallet on Base and delivers ZEC to your
            shielded address. You never deposit a lump sum, and you can stop whenever you like.
          </p>
          <DcaPlanner />
        </div>
      </main>
      <Footer />
    </>
  );
}
