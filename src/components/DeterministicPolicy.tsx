export function DeterministicPolicy(){
  return (
    <section className="deterministic-section" aria-labelledby="deterministic-heading">
      <div className="deterministic-card">
        <div className="deterministic-glow" aria-hidden="true" />
        <div className="deterministic-content">
          <div className="section-kicker">Security Invariant</div>
          <h2 id="deterministic-heading">No probabilistic AI decides if a transaction is safe.</h2>
          <p className="deterministic-lead">
            TxSignX’s decisions are strictly deterministic. Every PASS, REVIEW, and BLOCK verdict is calculated by transparent, audited Rust rule algorithms evaluated against explicit observable facts.
          </p>
          <div className="deterministic-points">
            <div className="det-point">
              <div className="det-icon" aria-hidden="true">1</div>
              <div className="det-text">
                <h3>Repeatable & Identical</h3>
                <p>The exact same PSBT and policy configuration will yield the exact same verdict, finding list, and exit code across every environment.</p>
              </div>
            </div>
            <div className="det-point">
              <div className="det-icon" aria-hidden="true">2</div>
              <div className="det-text">
                <h3>Explicit Coverage Accounting</h3>
                <p>When wallet or node context is absent, TxSignX explicitly marks those checks as unevaluated rather than assuming safety.</p>
              </div>
            </div>
            <div className="det-point">
              <div className="det-icon" aria-hidden="true">3</div>
              <div className="det-text">
                <h3>AI for Explanation, Never Execution</h3>
                <p>Language models may eventually help summarize complex findings for humans, but will never participate in the signing gate or verdict calculation.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
