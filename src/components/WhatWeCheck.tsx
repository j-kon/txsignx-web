import {useRef} from 'react'
import type {MouseEvent} from 'react'

interface CheckItem {
  code: string
  title: string
  desc: string
  category: string
  triggerSeverity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'INFO'
}

const CHECKS: CheckItem[] = [
  {
    code: 'TG001 / TG002',
    title: 'Absolute & Relative Fees',
    desc: 'Flags excessive absolute satoshi fees and disproportionate fee-to-output ratios before irreversible funds leave the wallet.',
    category: 'Economics',
    triggerSeverity: 'CRITICAL'
  },
  {
    code: 'TG003',
    title: 'UTXO Prevout Verification',
    desc: 'Verifies declared spent values and scriptPubKeys against live UTXO state when node context is supplied, preventing inflated fee traps.',
    category: 'Node Context',
    triggerSeverity: 'CRITICAL'
  },
  {
    code: 'TG004',
    title: 'Wallet Ownership & Descriptors',
    desc: 'Correlates inputs against public derivation windows to confirm the wallet genuinely controls the addresses being spent.',
    category: 'Wallet Context',
    triggerSeverity: 'HIGH'
  },
  {
    code: 'TG005 / TG006',
    title: 'Change Address & Hijack Detection',
    desc: 'Detects unexpected external destinations masquerading as change outputs, protecting against malicious coordinator substitution.',
    category: 'Wallet Context',
    triggerSeverity: 'CRITICAL'
  },
  {
    code: 'TG007',
    title: 'Configured Network Consistency',
    desc: 'Blocks signing attempts where descriptors or transaction formats mismatch the expected network (mainnet, testnet4, signet, regtest).',
    category: 'Network',
    triggerSeverity: 'CRITICAL'
  },
  {
    code: 'TG008',
    title: 'Unusual SIGHASH Flags',
    desc: 'Flags transactions utilizing SIGHASH_NONE, SIGHASH_SINGLE, or ANYONECANPAY that permit unauthorized third-party modification.',
    category: 'Signature Safety',
    triggerSeverity: 'MEDIUM'
  },
  {
    code: 'TG009',
    title: 'Unknown Script Inspection',
    desc: 'Identifies non-standard or unrecognized script templates in transaction inputs and outputs to prevent unintended lockups.',
    category: 'Script',
    triggerSeverity: 'MEDIUM'
  },
  {
    code: 'TG010',
    title: 'Mempool Conflict Tracking',
    desc: 'Checks whether proposed spending outpoints are already in-flight in the node mempool, preventing unintended double-spends.',
    category: 'Node Context',
    triggerSeverity: 'MEDIUM'
  },
  {
    code: 'TG011',
    title: 'Script Data & Metadata Carrier',
    desc: 'Inspects OP_RETURN outputs, script payloads, and carrier limits, ensuring zero-value data leaves no unintended satoshis locked.',
    category: 'Metadata',
    triggerSeverity: 'CRITICAL'
  }
]

export function WhatWeCheck(){
  const containerRef=useRef<HTMLDivElement>(null)

  function handleMouseMove(e:MouseEvent<HTMLDivElement>){
    const target=e.currentTarget
    const rect=target.getBoundingClientRect()
    const x=((e.clientX-rect.left)/rect.width)*100
    const y=((e.clientY-rect.top)/rect.height)*100
    target.style.setProperty('--mouse-x',`${x}%`)
    target.style.setProperty('--mouse-y',`${y}%`)
  }

  return (
    <section className="checks-section" aria-labelledby="checks-heading">
      <div className="section-header-centered">
        <span className="section-kicker">Coverage</span>
        <h2 id="checks-heading">What TxSignX inspects before you sign.</h2>
        <p className="section-lead">
          Every rule corresponds to a real-world Bitcoin attack vector or operational failure mode. Decisions are factual, bounded, and auditable.
        </p>
      </div>

      <div className="checks-grid" ref={containerRef}>
        {CHECKS.map(check=>(
          <article
            key={check.code}
            className="check-card"
            onMouseMove={handleMouseMove}
          >
            <div className="card-light-follower" aria-hidden="true" />
            <div className="card-header">
              <span className="check-code">{check.code}</span>
              <span className={`severity-badge sev-${check.triggerSeverity.toLowerCase()}`}>
                {check.triggerSeverity}
              </span>
            </div>
            <h3 className="check-title">{check.title}</h3>
            <p className="check-desc">{check.desc}</p>
            <div className="check-footer">
              <span className="check-category">{check.category}</span>
              <span className="check-indicator" aria-hidden="true">●</span>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
