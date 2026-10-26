export const metadata = { title: "Terms — Leeway" };

// Plain-language terms. Have counsel review before launch and add the operating entity and governing law.
export default function TermsPage() {
  return (
    <main className="stage stage--wide">
      <section className="widget widget--wide">
        <header className="widget__head">
          <h1>Terms of use</h1>
          <p>The short version of what you agree to when you use Leeway.</p>
        </header>
        <div className="widget__body prose">
          <h2>What Leeway does</h2>
          <p>
            Leeway quotes cross-chain swaps through NEAR Intents and passes your deposit to the solver network that fills it. Ghost Send routes value through a
            Leeway-run Zcash wallet before it reaches the recipient. Shielded DCA uses a smart contract on Base that you control.
          </p>
          <h2>What you are responsible for</h2>
          <p>
            Check every address before you send. Payments on public blockchains can&apos;t be reversed. A deposit sent to the wrong address, on the wrong chain, or
            after a quote expires may be refunded to the refund address you gave, or may be lost.
          </p>
          <p>
            Don&apos;t use Leeway to move funds that come from or go to crime, or to evade sanctions. Leeway may screen addresses and refuse a transfer, and may
            pause a transfer for a manual check before completing it.
          </p>
          <h2>Custody</h2>
          <p>
            Swaps and DCA never place your funds with Leeway. During a Ghost Send, funds sit in the Leeway wallet between leg one and leg two, for up to about two
            hours. Ghost Send amounts are capped while the service is young.
          </p>
          <h2>Fees and cashback</h2>
          <p>
            Leeway charges the fee shown before you confirm. Cashback is paid from that fee in shielded ZEC, can change or end, and is not a deposit, interest or
            investment return.
          </p>
          <h2>No guarantees</h2>
          <p>
            Leeway is provided as is. Prices move, solvers can fail to fill a route, chains can halt, and smart contracts can have bugs. To the extent the law
            allows, Leeway is not liable for losses from these risks. Nothing here is financial, legal or tax advice.
          </p>
        </div>
      </section>
    </main>
  );
}
