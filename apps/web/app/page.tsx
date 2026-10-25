import { Composer } from "@/components/Composer";
import { Footer, Header } from "@/components/Header";
import { Passage } from "@/components/Passage";

export default function Home() {
  return (
    <>
      <Header current="send" />
      <main>
        <div className="wrap hero">
          <div>
            <h1 className="hero__title">
              Send it
              <br />
              through the quiet.
            </h1>
            <p className="hero__lede">
              Move money between chains by way of shielded ZEC. Nobody watching the chain can tie the sender to the receiver, and every swap pays you back in
              private.
            </p>
            <div className="hero__passage">
              <Passage />
            </div>
          </div>
          <Composer />
        </div>

        <section className="section">
          <div className="wrap">
            <h2 className="section__title">Three ways to use the passage.</h2>
            <ul className="legs">
              <li>
                <h3>Ghost Send</h3>
                <p>
                  Pay someone on another chain. Your funds become shielded ZEC, wait a random while in the pool, then come out as the asset they asked for.
                </p>
              </li>
              <li>
                <h3>Shielded DCA</h3>
                <p>
                  Buy ZEC weekly or monthly from USDC on Base. A contract spends one period at a time straight from your wallet. Each buy arrives shielded.
                </p>
              </li>
              <li>
                <h3>Cashback</h3>
                <p>0.20% of every swap comes back to you as shielded ZEC. It's paid from our fee, in one private transaction a day.</p>
              </li>
            </ul>
          </div>
        </section>

        <section className="section">
          <div className="wrap honest">
            <div className="prose">
              <h2 className="section__title">Who can see what.</h2>
              <p>Privacy is only useful if you know where it stops.</p>
              <p>
                Ghost Send hides the link from the public chain. Leeway runs the wallet in the middle, so for a while we can see both sides. We keep only what
                we need to finish the send, and we erase it 24 hours after delivery.
              </p>
              <p>Matching amounts can still give you away. If you send exactly 500 USDC and 500 USDC arrives, an observer may guess. Vary the amount.</p>
            </div>
            <table>
              <caption className="sr-only">What each party can see during a Ghost Send</caption>
              <thead>
                <tr>
                  <th scope="col">Who</th>
                  <th scope="col">Sees your send</th>
                  <th scope="col">Sees who received it</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Anyone reading the chain</td>
                  <td className="yes">Yes</td>
                  <td className="no">No</td>
                </tr>
                <tr>
                  <td>The recipient</td>
                  <td className="no">No</td>
                  <td className="yes">Yes, themselves</td>
                </tr>
                <tr>
                  <td>Leeway, during the send</td>
                  <td className="yes">Yes</td>
                  <td className="yes">Yes</td>
                </tr>
                <tr>
                  <td>Leeway, 24h after delivery</td>
                  <td className="no">No</td>
                  <td className="no">No</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
