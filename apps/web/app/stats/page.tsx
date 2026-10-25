import { Footer, Header } from "@/components/Header";
import { services } from "@/lib/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Numbers — Leeway" };

const zec = (zat: bigint) => (Number(zat) / 1e8).toLocaleString(undefined, { maximumFractionDigits: 4 });

export default async function StatsPage() {
  let stats: Awaited<ReturnType<ReturnType<typeof services>["db"]["stats"]>> | null = null;
  try {
    stats = await services().db.stats();
  } catch {
    stats = null;
  }
  return (
    <>
      <Header current="stats" />
      <main className="wrap page">
        <h1 className="page__title">The numbers, in the open.</h1>
        <p className="page__lede">Totals only. No addresses, no individual transfers.</p>
        {stats ? (
          <div className="stats">
            <div className="stat">
              <div className="stat__value">${Number(stats.volumeUsd).toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
              <div className="stat__label">moved through Leeway</div>
            </div>
            <div className="stat">
              <div className="stat__value">{stats.ghostSends.toLocaleString()}</div>
              <div className="stat__label">Ghost Sends delivered</div>
            </div>
            <div className="stat">
              <div className="stat__value">{stats.activeDcaPlans.toLocaleString()}</div>
              <div className="stat__label">DCA plans running</div>
            </div>
            <div className="stat">
              <div className="stat__value">{zec(stats.cashbackPaidZat)} ZEC</div>
              <div className="stat__label">cashback paid, shielded</div>
            </div>
            <div className="stat">
              <div className="stat__value">{zec(stats.cashbackPendingZat)} ZEC</div>
              <div className="stat__label">cashback waiting to be paid</div>
            </div>
          </div>
        ) : (
          <p className="notice">The numbers aren't available right now. Try again in a minute.</p>
        )}
      </main>
      <Footer />
    </>
  );
}
