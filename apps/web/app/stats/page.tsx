import { services } from "@/lib/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Numbers — Leeway" };

const zec = (zat: bigint) => (Number(zat) / 1e8).toLocaleString(undefined, { maximumFractionDigits: 4 });

export default async function StatsPage() {
  const stats = await services()
    .db.stats()
    .catch(() => null);
  return (
    <main className="stage stage--wide">
      <section className="widget widget--wide">
        <header className="widget__head">
          <h1>The numbers, in the open</h1>
          <p>Totals only. No addresses, no individual transfers.</p>
        </header>
        {stats ? (
          <div className="stat-grid">
            <div className="stat stat--lead">
              <span className="stat__value">${Number(stats.volumeUsd).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
              <span className="stat__label">moved through Leeway</span>
            </div>
            <div className="stat">
              <span className="stat__value">{stats.ghostSends.toLocaleString()}</span>
              <span className="stat__label">Ghost Sends delivered</span>
            </div>
            <div className="stat">
              <span className="stat__value">{stats.activeDcaPlans.toLocaleString()}</span>
              <span className="stat__label">DCA plans running</span>
            </div>
            <div className="stat">
              <span className="stat__value">{zec(stats.cashbackPaidZat)}</span>
              <span className="stat__label">ZEC cashback paid, shielded</span>
            </div>
            <div className="stat">
              <span className="stat__value">{zec(stats.cashbackPendingZat)}</span>
              <span className="stat__label">ZEC cashback on its way</span>
            </div>
          </div>
        ) : (
          <div className="widget__body">
            <p className="note">The numbers aren&apos;t available right now. Try again in a minute.</p>
          </div>
        )}
      </section>
    </main>
  );
}
