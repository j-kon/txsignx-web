import {Reveal} from '../components/Reveal'
import {SecurityOrbit} from '../components/SecurityOrbit'
import {SecurityPipeline} from '../components/SecurityPipeline'
import {PreflightDemo} from '../components/PreflightDemo'
import {TerminalDemo} from '../components/TerminalDemo'
import {WhatWeCheck} from '../components/WhatWeCheck'
import {DeterministicPolicy} from '../components/DeterministicPolicy'

export function Home(){
  return (
    <div className="home-page">
      {/* Hero Section */}
      <section className="hero">
        <div className="hero-atmosphere" aria-hidden="true" />
        <div className="hero-content">
          <div className="hero-copy">
            <div className="hero-tag-row">
              <span className="hero-tag">Bitcoin Security Infrastructure</span>
              <span className="hero-version">v0.1.0</span>
            </div>
            <h1>Bitcoin transaction security before signing.</h1>
            <p className="lead">
              A deterministic open-source pre-sign security engine for Bitcoin transactions and PSBTs.
            </p>
            <div className="actions">
              <a className="button primary hero-cta" href="#inspector">
                Open Inspector
                <span className="btn-arrow" aria-hidden="true">→</span>
              </a>
              <a className="button secondary" href="https://github.com/j-kon/txsignx" target="_blank" rel="noreferrer">
                View on GitHub
              </a>
              <a className="button tertiary" href="https://github.com/j-kon/txsignx-docs" target="_blank" rel="noreferrer">
                Read Docs
              </a>
            </div>
            <div className="positioning-box">
              <span className="pos-label">Core Philosophy</span>
              <p className="positioning">
                <strong>Not another wallet.</strong><br/>
                A security layer for wallets.
              </p>
            </div>
          </div>

          <div className="hero-visual">
            <SecurityOrbit />
          </div>
        </div>
      </section>

      {/* Interactive Demonstration Section */}
      <Reveal className="section-reveal">
        <section className="demo-section" aria-labelledby="demo-heading">
          <div className="section-header-centered">
            <span className="section-kicker">Experience</span>
            <h2 id="demo-heading">Understand what you are signing before keys touch data.</h2>
            <p className="section-lead">
              Whether invoked via HTTP API in a wallet coordinator or directly via the CLI, TxSignX validates transaction structure, policy rules, and context before broadcast.
            </p>
          </div>

          <div className="demo-duo-grid">
            <PreflightDemo />
            <TerminalDemo />
          </div>
        </section>
      </Reveal>

      {/* Architecture / Pipeline Section */}
      <Reveal className="section-reveal" delay={100}>
        <SecurityPipeline />
      </Reveal>

      {/* What We Check Cards */}
      <Reveal className="section-reveal">
        <WhatWeCheck />
      </Reveal>

      {/* Deterministic Policy Section */}
      <Reveal className="section-reveal">
        <DeterministicPolicy />
      </Reveal>

      {/* CLI & Developer Section */}
      <Reveal className="section-reveal">
        <section className="cli-section" aria-labelledby="cli-heading">
          <div className="cli-content">
            <div className="section-kicker">Developer Native</div>
            <h2 id="cli-heading">Engineered for pipelines, coordinators, and terminal power.</h2>
            <p className="cli-lead">
              TxSignX is distributed as both a lightning-fast Rust CLI and an embeddable local HTTP daemon. Integrate preflight verification directly into bash scripts, CI pipelines, or desktop wallet coordinators.
            </p>
            <div className="cli-commands-box">
              <div className="cli-cmd-row">
                <span className="cli-cmd-label">Quick Inspection</span>
                <code>txsignx tx inspect &lt;RAW_TX_HEX&gt; --json</code>
              </div>
              <div className="cli-cmd-row">
                <span className="cli-cmd-label">PSBT Preflight</span>
                <code>txsignx psbt preflight --file payment.b64 --json</code>
              </div>
              <div className="cli-cmd-row">
                <span className="cli-cmd-label">Registry Audit</span>
                <code>txsignx policy list --json</code>
              </div>
            </div>
          </div>
        </section>
      </Reveal>

      {/* Final Call to Action */}
      <Reveal className="section-reveal">
        <section className="final-cta-section">
          <div className="final-cta-card">
            <h2>Start inspecting transactions today.</h2>
            <p>Explore the web inspector with public synthetic samples, or read the documentation to connect your local node.</p>
            <div className="actions centered">
              <a className="button primary" href="#inspector">
                Open Web Inspector
              </a>
              <a className="button secondary" href="https://github.com/j-kon/txsignx-docs" target="_blank" rel="noreferrer">
                Read the Documentation
              </a>
              <a className="button tertiary" href="https://github.com/j-kon/txsignx" target="_blank" rel="noreferrer">
                GitHub Repository
              </a>
            </div>
          </div>
        </section>
      </Reveal>
    </div>
  )
}
