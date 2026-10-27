export const metadata = { title: "Terms — Leeway" };

const ENTITY = process.env.NEXT_PUBLIC_LEGAL_ENTITY || "Leeway Labs Ltd.";
const JURISDICTION = process.env.NEXT_PUBLIC_GOVERNING_LAW || "the British Virgin Islands";

export default function TermsPage() {
  return (
    <main className="stage stage--wide">
      <section className="widget widget--wide">
        <header className="widget__head">
          <h1>Terms of use</h1>
          <p>
            Operated by {ENTITY} · Governing law: {JURISDICTION} · Effective October 26, 2026
          </p>
        </header>
        <div className="widget__body prose">
          <h2>1. Operator and agreement</h2>
          <p>
            These Terms of Use (&ldquo;Terms&rdquo;) form a binding legal agreement between you and <strong>{ENTITY}</strong> (&ldquo;Leeway,&rdquo;
            &ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;) governing your access to and use of the Leeway web interface, APIs, background settlement
            services, and smart contracts on Base. By connecting a wallet, requesting a quote, or submitting a transaction, you agree to these Terms.
          </p>

          <h2>2. How Leeway works</h2>
          <p>
            Leeway provides three settlement flows built on the NEAR Intents 1Click solver network and the Zcash Orchard shielded pool:
          </p>
          <p>
            <strong>Swaps.</strong> Cross-chain swaps are quoted through NEAR Intents 1Click. Your deposit goes directly from your wallet to a route deposit
            address controlled by the solver network that fills your quote. Leeway never takes custody of plain swap funds.
          </p>
          <p>
            <strong>Ghost Send (Shielded Cross-Chain Settlement).</strong> Ghost Send breaks public on-chain linkability between a sender and recipient across
            chains by routing value in two legs: (i) Leg 1 swaps your input asset via NEAR Intents 1Click into ZEC delivered to a fresh address in the
            Leeway-operated Zcash wallet, which immediately shields the ZEC into the Orchard pool; and (ii) after a randomized hold window of 10 to 90 minutes,
            Leg 2 sends shielded ZEC from the Orchard pool to a fresh 1Click deposit address that delivers the destination asset to your recipient.
          </p>
          <p>
            <strong>Shielded DCA.</strong> Dollar-cost averaging uses the non-custodial <code>LeewayDCA</code> smart contract on Base. The contract never holds
            your USDC. You approve a spending cap and register a schedule with only the <code>keccak256</code> hash of your shielded Zcash address recorded
            on-chain. On each due interval, the Leeway keeper triggers <code>execute</code>, which transfers exactly one period&apos;s USDC directly from your
            wallet to a fresh 1Click deposit address that settles shielded ZEC to your Zcash address. You may cancel your plan at any time on-chain
            (<code>cancelPlan</code>) or by revoking your token allowance.
          </p>

          <h2>3. Ghost Send specific disclosures, limits, and custody</h2>
          <p>
            <strong>Transient settlement custody.</strong> Unlike plain Swaps and Shielded DCA, Ghost Send requires Leeway&apos;s automated Zcash wallet to hold
            shielded ZEC in transit between Leg 1 confirmation and Leg 2 dispatch (typically 10 to 90 minutes, or longer if a network congestion or manual
            safety review occurs). This transient hold is solely to execute your payment instruction and does not create a deposit account, fiduciary
            relationship, or custodial wallet account.
          </p>
          <p>
            <strong>Transaction and volume caps.</strong> To mitigate operational and regulatory risk, Ghost Send enforces strict protocol limits: a maximum of{" "}
            <strong>$2,000 USD</strong> equivalent per individual transfer and a rolling 24-hour platform-wide cap (default <strong>$50,000 USD</strong>). You
            agree not to structure or split transfers to circumvent per-transfer or daily volume limits.
          </p>
          <p>
            <strong>Safety pauses and manual review.</strong> Leeway&apos;s worker never automatically retries a Zcash or Leg 2 send whose broadcast outcome is
            indeterminate. If a network error, solver refund, or node interruption leaves a transfer in an ambiguous state, the transfer is automatically
            paused for human verification (&ldquo;Paused for a manual check&rdquo;) so funds are neither double-spent nor lost.
          </p>
          <p>
            <strong>24-hour metadata purge.</strong> Twenty-four (24) hours after a Ghost Send completes, Leeway automatically purges the recipient address,
            refund address, hop address, deposit addresses, and stored route quotes from its database. Once purged, Leeway cannot reconstruct or provide
            historical linkage between Leg 1 and Leg 2.
          </p>

          <h2>4. Compliance, sanctions screening, and prohibited use</h2>
          <p>
            You represent and warrant that you are not located in, organized in, or a resident of any comprehensively sanctioned jurisdiction (including Cuba,
            Iran, North Korea, Syria, or the Crimea, Donetsk, or Luhansk regions), and that you are not listed on any sanctions list maintained by OFAC, the
            United Nations, the European Union, or HM Treasury.
          </p>
          <p>
            You may not use Leeway—and specifically may not use Ghost Send—to launder proceeds of crime, evade sanctions, finance terrorism, process ransomware
            proceeds, or obscure stolen funds. Leeway screens origin, destination, and refund addresses against sanctions intelligence providers and reserves
            the right to reject, block, or hold any transfer that triggers a compliance alert.
          </p>

          <h2>5. Your responsibilities</h2>
          <p>
            Blockchain transactions are irreversible. You are solely responsible for verifying every destination address, refund address, Zcash shielded
            address (<code>u1…</code> or <code>zs1…</code>), network selection, and deposit amount before sending funds. Sending an unsupported asset, sending
            on the wrong network, sending less than the minimum quote amount, or depositing after a quote&apos;s deadline may result in partial refunds minus
            network fees or permanent loss of funds.
          </p>

          <h2>6. Fees and shielded cashback</h2>
          <p>
            Leeway charges the application fee disclosed in the route preview prior to confirmation (default 0.50%). Eligible swaps accrue promotional cashback
            (default 0.20% of swap USD volume) payable in shielded ZEC in periodic batched transactions once the minimum payout threshold is met, subject to a
            rolling 24-hour platform cashback cap. Cashback is a discretionary fee rebate—not interest, yield, or an investment return—and may be modified,
            capped, or discontinued at any time.
          </p>

          <h2>7. Disclaimers and limitation of liability</h2>
          <p>
            Leeway is provided strictly &ldquo;as is&rdquo; and &ldquo;as available&rdquo; without warranties of any kind. Exchange rates fluctuate, third-party
            solvers (NEAR Intents 1Click) may fail to fill or may refund a route, public blockchains or RPC nodes may halt or reorganize, and smart contracts
            carry inherent technical risk. To the maximum extent permitted by applicable law, {ENTITY} and its contributors shall not be liable for any
            indirect, incidental, consequential, or special damages, or for any loss of digital assets arising from solver failures, blockchain reorganizations,
            user address errors, or unauthorized access to your wallet.
          </p>

          <h2>8. Governing law and dispute resolution</h2>
          <p>
            These Terms and any dispute or claim arising out of or in connection with them or your use of Leeway shall be governed by and construed in
            accordance with the laws of <strong>{JURISDICTION}</strong>, without regard to its conflict of law provisions. Any dispute not resolved informally
            within thirty (30) days shall be finally resolved by binding individual arbitration in accordance with the arbitration rules of {JURISDICTION}, and
            you waive any right to participate in a class, collective, or representative action.
          </p>
        </div>
      </section>
    </main>
  );
}
