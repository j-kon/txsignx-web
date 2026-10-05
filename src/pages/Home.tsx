import {TerminalDemo} from '../components/TerminalDemo'
import {useLiveFeedOptional} from '../features/LiveFeedContext'

const stages = [
  ['01', 'Transaction context', 'A wallet or coordinator constructs a transaction or PSBT.'],
  ['02', 'Inspect + verify', 'TxSignX extracts transaction facts and checks available context.'],
  ['03', 'Deterministic rules', 'Policy produces a verdict, findings, and explicit check coverage.'],
  ['04', 'External signing step', 'Your signing workflow stays separate. Your keys stay with you.'],
]

export function Home(){
  const feed = useLiveFeedOptional()
  const snapshot = feed?.snapshot
  return (
    <div className="home-page redesigned-home">
      <section className="landing-hero" aria-labelledby="home-heading">
        <div className="landing-copy">
          <p className="landing-eyebrow"><span className="brand-badge" aria-hidden="true">₿</span> Open-source Bitcoin security</p>
          <h1 id="home-heading">Bitcoin transaction security before signing.</h1>
          <p className="landing-lead">See what moves. Know what you sign. Inspect transactions, understand policy findings, and follow the Bitcoin network in one workspace.</p>
          <div className="landing-actions">
            <a className="button primary" href="#inspector">Open Inspector <span aria-hidden="true">↗</span></a>
            <a className="landing-text-link" href="#live">Explore Live Bitcoin <span aria-hidden="true">→</span></a>
          </div>
          <p className="landing-footnote">Built in Rust. Deterministic by design.</p>
        </div>
        <div className="sample-report" role="region" aria-label="Synthetic preflight report preview">
          <div className="sample-toolbar"><span><span className="sample-mark" aria-hidden="true">✳</span> TxSignX / preflight</span><span className="sample-format">PSBT v0</span></div>
          <div className="sample-content">
            <div className="sample-heading"><div><p className="sample-caption">Public synthetic example</p><h2>Transaction overview</h2></div><span className="sample-pass">✓ PASS</span></div>
            <p className="sample-file">payment.psbt <span>Unsigned transaction</span></p>
            <dl className="sample-metrics"><div><dt>Inputs</dt><dd>1</dd></div><div><dt>Outputs</dt><dd>2</dd></div><div><dt>Fee</dt><dd>1,000 <small>sats</small></dd></div></dl>
            <div className="sample-ledger"><div><span>Output 0 <small>P2PKH</small></span><strong>100,000 <small>sats</small></strong></div><div><span>Output 1 <small>P2WPKH</small></span><strong>50,000 <small>sats</small></strong></div></div>
            <div className="sample-coverage"><div><span>Transaction facts</span><span className="sample-checked">✓ Inspected</span></div><div><span>Wallet context</span><span>— Not supplied</span></div><div><span>Node context</span><span>— Not supplied</span></div></div>
            <p className="sample-note">PASS applies only to evaluated rules. Missing context is recorded, never assumed safe.</p>
          </div>
          <a href="#inspector" className="sample-open">Inspect your transaction <span aria-hidden="true">↗</span></a>
        </div>
      </section>

      <a href="#live" className="home-network" aria-label="Open live network activity">
        <div className="home-network-title"><span className="network-orb" aria-hidden="true">₿</span><div><strong>Bitcoin, in view.</strong><span>{feed?.connectionStatus === 'connected' ? 'Connected to your live feed' : snapshot ? 'Latest received network data' : 'Connect your API to follow the network'}</span></div></div>
        <dl><div><dt>Block height</dt><dd>{snapshot ? snapshot.tip_height.toLocaleString() : '—'}</dd></div><div><dt>Mempool transactions</dt><dd>{(snapshot?.mempool?.tx_count ?? snapshot?.mempool_tx_count)?.toLocaleString() ?? '—'}</dd></div></dl>
        <span className="home-network-link">Open Live Chain <span aria-hidden="true">↗</span></span>
      </a>

      <section className="landing-tools" aria-label="Explore TxSignX tools">
        <a href="#live"><span className="tool-number">Observe</span><h2>Follow the network <span aria-hidden="true">↗</span></h2><p>Explore blocks and mempool activity with a live view of Bitcoin.</p><span className="tool-destination">Live Chain</span></a>
        <a href="#inspector"><span className="tool-number">Inspect</span><h2>Read the transaction <span aria-hidden="true">↗</span></h2><p>Unpack raw transactions and PSBTs into facts you can review.</p><span className="tool-destination">Transaction Inspector</span></a>
        <a href="#policies"><span className="tool-number">Verify</span><h2>Understand the verdict <span aria-hidden="true">↗</span></h2><p>Trace findings to explicit rules, severity, and required context.</p><span className="tool-destination">Rule Registry</span></a>
      </section>

      <section className="landing-section" aria-labelledby="boundary-heading">
        <div className="landing-section-heading"><p className="landing-eyebrow">The workflow</p><div><h2 id="boundary-heading">The pre-sign verification boundary.</h2><p>A security layer between a transaction proposal and your signing workflow. Every check has a reason. Every result has a scope.</p></div></div>
        <ol className="landing-pipeline">{stages.map(([number,title,description])=><li key={number}><span>{number}</span><h3>{title}</h3><p>{description}</p></li>)}</ol>
      </section>

      <section className="landing-principles" aria-labelledby="principles-heading">
        <div><p className="landing-eyebrow">Evidence before confidence</p><h2 id="principles-heading">No probabilistic AI decides if a transaction is safe.</h2><p>The same facts and configuration produce the same policy result. Findings and coverage stay visible, so you can see what was checked and what still needs context.</p><a className="landing-text-link" href="https://github.com/j-kon/txsignx" target="_blank" rel="noreferrer">Read the source <span aria-hidden="true">↗</span></a></div>
        <dl className="landing-verdicts"><div><dt className="verdict-pass-label">PASS</dt><dd>No blocking or review findings from the evaluated rules. Check coverage still matters.</dd></div><div><dt className="verdict-review-label">REVIEW</dt><dd>Findings require attention before you continue with your signing workflow.</dd></div><div><dt className="verdict-block-label">BLOCK</dt><dd>A blocking policy finding needs to be resolved before proceeding.</dd></div></dl>
      </section>

      <section className="landing-developer" aria-labelledby="developer-heading"><div><p className="landing-eyebrow">From terminal to wallet</p><h2 id="developer-heading">One engine.<br/>Your workflow.</h2><p>Inspect from the CLI or integrate the local HTTP API into your wallet coordinator. Structured JSON keeps transaction facts and policy results useful beyond the interface.</p><a className="landing-text-link" href="https://github.com/j-kon/txsignx-docs" target="_blank" rel="noreferrer">Read Documentation <span aria-hidden="true">↗</span></a></div><TerminalDemo/></section>
      <section className="landing-end"><div><p className="landing-eyebrow">Inspect. Verify. Then decide.</p><h2>Make the next signature an informed one.</h2></div><a className="button primary" href="#inspector">Open Web Inspector <span aria-hidden="true">↗</span></a></section>
    </div>
  )
}
