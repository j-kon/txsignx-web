export function SecurityPipeline(){
  return (
    <section className="pipeline-section" aria-labelledby="pipeline-heading">
      <div className="pipeline-header">
        <span className="section-kicker">Architecture</span>
        <h2 id="pipeline-heading">The pre-sign verification boundary.</h2>
        <p className="pipeline-lead">
          TxSignX sits between transaction construction and cold signing. It intercepts proposed transactions and PSBTs, extracts observable facts, evaluates deterministic rules, and produces a structured verdict before keys touch data.
        </p>
      </div>

      <div className="pipeline-flow" role="region" aria-label="Transaction security flow">
        {/* Stage 1: Wallet / Coordinator */}
        <div className="pipeline-node node-wallet">
          <div className="node-badge">Origin</div>
          <div className="node-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="5" width="20" height="14" rx="2" />
              <path d="M16 12h2" />
              <path d="M2 10h20" />
            </svg>
          </div>
          <h3 className="node-title">Wallet / Coordinator</h3>
          <p className="node-desc">Constructs raw transaction or unsigned PSBT v0 proposal.</p>
          <div className="node-meta">Unsigned artifact</div>
        </div>

        {/* Connector 1 */}
        <div className="pipeline-connector" aria-hidden="true">
          <div className="connector-line">
            <span className="connector-pulse pulse-1" />
          </div>
          <span className="connector-arrow">→</span>
        </div>

        {/* Stage 2: TxSignX Preflight */}
        <div className="pipeline-node node-txsignx active-boundary">
          <div className="node-badge badge-accent">TxSignX Layer</div>
          <div className="node-icon icon-accent" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="12,2 21,7 21,17 12,22 3,17 3,7" />
              <path d="M8 8l8 8M16 8l-8 8" stroke="#F7931A" strokeWidth="2" />
            </svg>
          </div>
          <h3 className="node-title">Inspection & Facts</h3>
          <p className="node-desc">Parses inputs, outputs, fee rates, script types, and PSBT metadata.</p>
          <div className="node-meta meta-highlight">Factual breakdown</div>
        </div>

        {/* Connector 2 */}
        <div className="pipeline-connector" aria-hidden="true">
          <div className="connector-line">
            <span className="connector-pulse pulse-2" />
          </div>
          <span className="connector-arrow">→</span>
        </div>

        {/* Stage 3: Deterministic Policy Engine */}
        <div className="pipeline-node node-policy active-boundary">
          <div className="node-badge badge-accent">TxSignX Layer</div>
          <div className="node-icon icon-policy" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              <path d="m9 12 2 2 4-4" />
            </svg>
          </div>
          <h3 className="node-title">Deterministic Policy</h3>
          <p className="node-desc">Evaluates active security rules against optional wallet and node context.</p>
          <div className="node-verdict-chips">
            <span className="chip-pass">PASS</span>
            <span className="chip-review">REVIEW</span>
            <span className="chip-block">BLOCK</span>
          </div>
        </div>

        {/* Connector 3 */}
        <div className="pipeline-connector" aria-hidden="true">
          <div className="connector-line">
            <span className="connector-pulse pulse-3" />
          </div>
          <span className="connector-arrow">→</span>
        </div>

        {/* Stage 4: External Signer */}
        <div className="pipeline-node node-signer external-boundary">
          <div className="node-badge badge-external">External Signer</div>
          <div className="node-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="5" y="11" width="14" height="10" rx="2" />
              <path d="M8 11V7a4 4 0 0 1 8 0v4" />
              <circle cx="12" cy="16" r="1" />
            </svg>
          </div>
          <h3 className="node-title">Hardware / Signer</h3>
          <p className="node-desc">Receives vetted transaction only after preflight policies pass.</p>
          <div className="node-meta meta-warning">Keys never touch TxSignX</div>
        </div>
      </div>

      <div className="pipeline-footnote">
        <span className="boundary-pill">Strict boundary:</span> TxSignX never possesses private keys, finalizes signatures, or broadcasts to the Bitcoin peer-to-peer network. The signer operates independently.
      </div>
    </section>
  )
}
