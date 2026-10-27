export const metadata = { title: "Who can see what — Leeway" };

const ROWS: [string, boolean, boolean][] = [
  ["Anyone reading the chain", true, false],
  ["The recipient", false, true],
  ["Leeway, during the send", true, true],
  ["Leeway, 24 hours after delivery", false, false],
];

export default function PrivacyPage() {
  return (
    <main className="stage stage--wide">
      <section className="widget widget--wide">
        <header className="widget__head">
          <h1>Who can see what</h1>
          <p>Privacy is only useful if you know where it stops.</p>
        </header>
        <div className="widget__body prose">
          <div tabIndex={0} role="region" aria-labelledby="privacy-table-caption" className="table-wrapper">
            <table className="matrix">
              <caption className="sr-only" id="privacy-table-caption">
                What each party can see during a Ghost Send
              </caption>
              <thead>
                <tr>
                  <th scope="col">During a Ghost Send</th>
                  <th scope="col">Sees your wallet send</th>
                  <th scope="col">Sees who received it</th>
                </tr>
              </thead>
              <tbody>
                {ROWS.map(([who, a, b]) => (
                  <tr key={who}>
                    <th scope="row">{who}</th>
                    <td className={a ? "yes" : "no"}>{a ? "Yes" : "No"}</td>
                    <td className={b ? "yes" : "no"}>{b ? "Yes" : "No"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Ghost Send hides the link from the public chain. Leeway runs the wallet in the middle, so for a while we can see both sides. We keep only what we
            need to finish the send, and erase it 24 hours after delivery.
          </p>
          <p>Matching amounts can still give you away. If 500 USDC goes in and 500 USDC comes out, an observer may guess. Vary the amount.</p>
          <p>Shielded DCA puts only a hash of your Zcash address on Base. The contract can take one period at a time, and you can stop it whenever you like.</p>
        </div>
      </section>
    </main>
  );
}
