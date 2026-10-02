import {useState} from 'react'
import type {Report} from '../lib/api/schema'
import {humanize} from '../lib/text'

const display = (value:unknown):string => value===null||value===undefined?'Unavailable':typeof value==='boolean'?value?'Yes':'No':String(value)

/** Escaped React text only. All nested details remain available without inventing facts. */
export function Facts({value}:{value:unknown}) {
  if (!value || typeof value!=='object') return <span>{display(value)}</span>
  if (Array.isArray(value)) return value.length ? (
    <ol className="fact-list">
      {value.map((entry,index)=><li key={index}><Facts value={entry}/></li>)}
    </ol>
  ) : <span>None</span>

  return (
    <dl className="facts">
      {Object.entries(value).map(([key,entry])=>(
        <div key={key}>
          <dt>{humanize(key)}</dt>
          <dd><Facts value={entry}/></dd>
        </div>
      ))}
    </dl>
  )
}

export function ReportView({report,onClear}:{report:Report;onClear:()=>void}) {
  const [notice,setNotice]=useState('')
  const preflight='inspection' in report?report:null
  const inspection=preflight?preflight.inspection:report as Exclude<Report,{inspection:unknown}>
  const psbt='unsigned_txid' in inspection?inspection:null
  const isTransaction='txid' in inspection
  const policy=preflight?.policy

  const json=()=>JSON.stringify(report,null,2)

  async function copy(){
    try{
      await navigator.clipboard.writeText(json())
      setNotice('JSON copied to your clipboard.')
    }catch{
      setNotice('Clipboard unavailable. Download the JSON report instead.')
    }
  }

  function download(){
    const url=URL.createObjectURL(new Blob([json()],{type:'application/json'}))
    const anchor=document.createElement('a')
    anchor.href=url
    anchor.download='txsignx-report.json'
    anchor.click()
    setTimeout(()=>URL.revokeObjectURL(url),1000)
    setNotice('JSON report download requested.')
  }

  const evaluatedCount = policy?.rule_evaluations.filter(r=>r.status==='evaluated').length ?? 0
  const partiallyCount = policy?.rule_evaluations.filter(r=>r.status==='partially_evaluated').length ?? 0
  const notEvaluatedCount = policy?.rule_evaluations.filter(r=>r.status==='not_evaluated').length ?? 0

  const verdictIcon = policy?.decision==='pass' ? '✓' : policy?.decision==='review' ? '◇' : '⛔'

  return (
    <section className="report animate-verdict" aria-label="Analysis report">
      {policy?(
        <>
          <header className={`verdict-banner ${policy.decision.toLowerCase()}`}>
            <div className="verdict-main">
              <span className="verdict-label">Preflight Decision</span>
              <div className="verdict-headline">
                <span className="verdict-icon" aria-hidden="true">{verdictIcon}</span>
                <h2>{policy.decision.toUpperCase()}</h2>
              </div>
              {policy.decision==='pass'&&<p className="verdict-subtext">No evaluated active rule requires review or blocking.</p>}
            </div>
            <div className="verdict-meta">
              <div className="risk-badge">
                <span className="risk-label">Risk Level</span>
                <strong className="risk-value">{humanize(policy.risk_level).toUpperCase()}</strong>
              </div>
            </div>
          </header>

          {/* Metric Chips with sequential reveal */}
          <div className="coverage-metrics-row">
            <div className="metric-chip chip-stagger-1">
              <span className="metric-num">{policy.finding_count}</span>
              <span className="metric-name">Findings</span>
            </div>
            <div className="metric-chip chip-stagger-2">
              <span className="metric-num">{evaluatedCount}</span>
              <span className="metric-name">Evaluated</span>
            </div>
            <div className="metric-chip chip-stagger-3">
              <span className="metric-num">{partiallyCount}</span>
              <span className="metric-name">Partially evaluated</span>
            </div>
            <div className="metric-chip chip-stagger-4">
              <span className="metric-num">{notEvaluatedCount}</span>
              <span className="metric-name">Not evaluated</span>
            </div>
          </div>

          <p className="scope">{policy.scope_note}</p>

          {/* Findings Section */}
          <section className="report-section">
            <h3>Findings <span className="count">{policy.finding_count}</span></h3>
            {policy.findings.length===0?(
              <div className="clean-findings-notice">
                <span className="clean-check" aria-hidden="true">✓</span>
                <p>No findings triggered from currently evaluated active policy rules.</p>
              </div>
            ):(
              <div className="findings-list">
                {policy.findings.map((finding,index)=>(
                  <article className={`finding finding-card ${finding.severity.toLowerCase()}`} key={`${finding.code}-${index}`}>
                    <div className="finding-header">
                      <div className="finding-code-title">
                        <code className="finding-code">{finding.code}</code>
                        <h4>{finding.title}</h4>
                      </div>
                      <span className={`finding-sev sev-${finding.severity.toLowerCase()}`}>
                        {humanize(finding.severity).toUpperCase()}
                      </span>
                    </div>
                    <p className="finding-msg">{finding.message}</p>
                    <div className="finding-details-grid">
                      <div className="finding-detail-item">
                        <span className="detail-label">Location</span>
                        <span className="detail-value">
                          {humanize(finding.location.type)}
                          {finding.location.index===undefined?'':` (index ${finding.location.index})`}
                        </span>
                      </div>
                      {finding.code==='TG002'&&policy.config.max_absolute_fee_sats!==undefined&&(
                        <div className="finding-detail-item">
                          <span className="detail-label">Configured limit</span>
                          <span className="detail-value">{policy.config.max_absolute_fee_sats.toLocaleString()} sats</span>
                        </div>
                      )}
                      {finding.code==='TG003'&&policy.config.max_fee_ratio_bps!==undefined&&(
                        <div className="finding-detail-item">
                          <span className="detail-label">Configured limit</span>
                          <span className="detail-value">{(policy.config.max_fee_ratio_bps/100).toFixed(2)}% ({policy.config.max_fee_ratio_bps} bps)</span>
                        </div>
                      )}
                    </div>
                    {finding.recommendation&&(
                      <div className="finding-rec">
                        <span className="rec-kicker">Recommendation</span>
                        <p>{finding.recommendation}</p>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>

          {/* Evaluation Coverage Section */}
          <section className="report-section">
            <h3>Evaluation coverage</h3>
            <p className="muted">A decision covers only the checks listed here. Missing wallet or node context limits what can be evaluated.</p>
            <div className="coverage">
              {(['evaluated','partially_evaluated','not_evaluated'] as const).map(status=>(
                <section key={status} className="coverage-column">
                  <h4>{status==='partially_evaluated'?'Partially Evaluated':status==='not_evaluated'?'Not Evaluated':'Evaluated'}</h4>
                  {policy.rule_evaluations.filter(r=>r.status===status).length===0?(
                    <p className="coverage-empty">None</p>
                  ):(
                    <ul>
                      {policy.rule_evaluations.filter(r=>r.status===status).map(rule=>(
                        <li key={rule.code}>
                          <code>{rule.code}</code>
                          {rule.reason&&<span className="rule-reason">{humanize(rule.reason)}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              ))}
            </div>
            <details className="policy-config-details">
              <summary>Applied policy thresholds</summary>
              <Facts value={policy.config}/>
            </details>
          </section>
        </>
      ):(
        <header className="inspection-heading">
          <span className="section-kicker">Factual Inspection</span>
          <h2>{isTransaction ? 'Transaction Explorer' : 'PSBT Inspection'}</h2>
          <p>
            {isTransaction
              ? ('chain_context' in inspection && inspection.chain_context
                ? 'Confirmed transaction context and on-chain verification facts.'
                : 'Structural transaction observations and decoded facts. Offline raw transaction inspection.')
              : 'Structural PSBT observations. No preflight policy was requested.'}
          </p>
        </header>
      )}

      {/* Transaction Overview Section (when inspecting transactions) */}
      {isTransaction && (
        <section className="report-section transaction-overview-section" aria-label="Transaction Overview">
          <div className="section-header-row">
            <h3>Transaction Overview</h3>
            <div className="overview-badges">
              <span className={`status-pill ${inspection.has_witness ? 'pill-segwit' : 'pill-legacy'}`}>
                SegWit: {inspection.has_witness ? 'Yes' : 'No'}
              </span>
              <span className={`status-pill ${inspection.explicit_rbf ? 'pill-rbf' : 'pill-no-rbf'}`}>
                Explicit RBF: {inspection.explicit_rbf ? 'Yes' : 'No'}
              </span>
            </div>
          </div>

          <div className="overview-grid">
            <div className="overview-card txid-card">
              <span className="card-label">Transaction ID</span>
              <code className="hash-value card-value select-all">{inspection.txid}</code>
            </div>
            <div className="overview-card wtxid-card">
              <span className="card-label">wTXID</span>
              <code className="hash-value card-value select-all">{inspection.wtxid}</code>
            </div>
          </div>

          <div className="overview-stats-grid">
            <div className="stat-card">
              <span className="stat-label">Version</span>
              <strong className="stat-value">{inspection.version}</strong>
            </div>
            <div className="stat-card">
              <span className="stat-label">Locktime</span>
              <strong className="stat-value">{inspection.locktime}</strong>
            </div>
            <div className="stat-card">
              <span className="stat-label">Inputs</span>
              <strong className="stat-value">{inspection.input_count}</strong>
            </div>
            <div className="stat-card">
              <span className="stat-label">Outputs</span>
              <strong className="stat-value">{inspection.output_count}</strong>
            </div>
            <div className="stat-card">
              <span className="stat-label">SegWit</span>
              <strong className={`stat-value ${inspection.has_witness ? 'highlight-segwit' : ''}`}>
                {inspection.has_witness ? 'Yes' : 'No'}
              </strong>
            </div>
            <div className="stat-card">
              <span className="stat-label">Explicit RBF</span>
              <strong className="stat-value">
                {inspection.explicit_rbf ? 'Yes' : 'No'}
              </strong>
            </div>
            <div className="stat-card">
              <span className="stat-label">Size</span>
              <strong className="stat-value">{inspection.size_bytes} bytes</strong>
            </div>
            <div className="stat-card">
              <span className="stat-label">Weight</span>
              <strong className="stat-value">{inspection.weight_wu} WU</strong>
            </div>
            <div className="stat-card">
              <span className="stat-label">Virtual Size</span>
              <strong className="stat-value">{inspection.vsize_vb} vB</strong>
            </div>
          </div>
        </section>
      )}

      {/* Chain Context Section (when present from node lookup) */}
      {'chain_context' in inspection && inspection.chain_context && (
        <section className="report-section chain-context-section" aria-label="Chain Context">
          <h3>Chain Context</h3>
          <div className={`chain-context-card status-${inspection.chain_context.status}`}>
            <div className="chain-context-header">
              <span className="chain-context-title">Bitcoin Core Node Verification</span>
              <span className={`chain-status-badge status-${inspection.chain_context.status}`}>
                {inspection.chain_context.status === 'confirmed'
                  ? `Confirmed (${inspection.chain_context.confirmations ?? 0} confirmation${inspection.chain_context.confirmations === 1 ? '' : 's'})`
                  : inspection.chain_context.status === 'mempool'
                  ? 'In Mempool (0 confirmations)'
                  : 'Unavailable'}
              </span>
            </div>
            <dl className="chain-context-grid">
              <div>
                <dt>Network</dt>
                <dd><code className="badge-network">{inspection.chain_context.network}</code></dd>
              </div>
              <div>
                <dt>Confirmations</dt>
                <dd>{inspection.chain_context.confirmations !== undefined ? inspection.chain_context.confirmations.toLocaleString() : 'Unavailable'}</dd>
              </div>
              <div className="block-hash-row">
                <dt>Block Hash</dt>
                <dd className="hash-value">{inspection.chain_context.block_hash ?? 'Unconfirmed (mempool)'}</dd>
              </div>
            </dl>
          </div>
        </section>
      )}

      {/* Fee & Size Metrics Section (when inspecting transactions) */}
      {isTransaction && (
        <section className="report-section fee-metrics-section" aria-label="Fee & Size Metrics">
          <h3>Fee & Size Metrics</h3>
          <p className="muted">
            {'chain_context' in inspection && inspection.chain_context
              ? 'Transaction verified against Bitcoin Core node. Prevout values and chain status are resolved.'
              : 'Raw transactions do not provide spent-output values, fees or a network unless resolved or specified.'}
          </p>

          <div className="metrics-grid">
            <div className="metric-box">
              <span className="metric-box-label">Size</span>
              <strong className="metric-box-val">{inspection.size_bytes} bytes</strong>
            </div>
            <div className="metric-box">
              <span className="metric-box-label">Weight</span>
              <strong className="metric-box-val">{inspection.weight_wu} WU</strong>
            </div>
            <div className="metric-box">
              <span className="metric-box-label">Virtual Size</span>
              <strong className="metric-box-val">{inspection.vsize_vb} vB</strong>
            </div>
            <div className="metric-box">
              <span className="metric-box-label">Input total</span>
              <strong className="metric-box-val">
                {inspection.total_input_sats != null ? `${inspection.total_input_sats.toLocaleString()} sats` : 'Unavailable'}
              </strong>
            </div>
            <div className="metric-box">
              <span className="metric-box-label">Output total</span>
              <strong className="metric-box-val">
                {`${inspection.total_output_sats.toLocaleString()} sats`}
              </strong>
            </div>
            <div className="metric-box">
              <span className="metric-box-label">Fee (sats)</span>
              <strong className="metric-box-val">
                {inspection.fee_sats != null ? `${inspection.fee_sats.toLocaleString()} sats` : 'Unavailable'}
              </strong>
            </div>
            <div className="metric-box">
              <span className="metric-box-label">Fee rate</span>
              <strong className="metric-box-val">
                {inspection.fee_rate ? `${inspection.fee_rate.sat_per_vb} sat/vB` : 'Unavailable'}
              </strong>
            </div>
          </div>

          {inspection.fee_sats === null && (
            <div className="explorer-notice-banner fee-notice" role="note">
              <span className="notice-icon" aria-hidden="true">ℹ</span>
              <span>Fee unavailable without resolved previous outputs.</span>
            </div>
          )}
        </section>
      )}

      {/* PSBT Summary Facts Section */}
      {!isTransaction && psbt && (
        <section className="report-section">
          <h3>Transaction facts</h3>
          <p className="muted">
            Signing state describes field presence, not verified signatures. UTXO consistency checks supplied metadata.
          </p>

          <dl className="summary-facts">
            <div className="txid">
              <dt>Unsigned transaction ID</dt>
              <dd className="hash-value">{psbt.unsigned_txid}</dd>
            </div>
            <div>
              <dt>Signing state</dt>
              <dd>{humanize(psbt.signing_state)}</dd>
            </div>
            <div>
              <dt>Fee status</dt>
              <dd>{humanize(psbt.fee.status)}</dd>
            </div>
            <div>
              <dt>Fee (sats)</dt>
              <dd>{display(psbt.fee.fee_sats)}</dd>
            </div>
            <div>
              <dt>Inputs</dt>
              <dd>{inspection.input_count}</dd>
            </div>
            <div>
              <dt>Outputs</dt>
              <dd>{inspection.output_count}</dd>
            </div>
            <div>
              <dt>Explicit RBF signal</dt>
              <dd>{display(inspection.explicit_rbf)}</dd>
            </div>
          </dl>
        </section>
      )}

      {/* Inputs Section */}
      <section className="report-section inputs-section" aria-label="Inputs">
        <div className="section-header-row">
          <h3>Inputs <span className="count">{inspection.input_count}</span></h3>
        </div>

        {inspection.inputs.map(input=>(
          <details key={input.index} className="fact-details" open={inspection.inputs.length === 1}>
            <summary>
              Input {input.index} — {input.previous_txid.slice(0,12)}…:{input.previous_vout}
            </summary>
            <div className="input-detail-content">
              <dl className="facts-overview">
                <div>
                  <dt>Previous Outpoint</dt>
                  <dd className="hash-value">{input.previous_txid}:{input.previous_vout}</dd>
                </div>
                <div>
                  <dt>Sequence</dt>
                  <dd>{input.sequence}</dd>
                </div>
                <div>
                  <dt>Explicit RBF</dt>
                  <dd>{input.explicit_rbf ? 'Yes' : 'No'}</dd>
                </div>
                {'script_sig_hex' in input && (
                  <div>
                    <dt>ScriptSig Hex</dt>
                    <dd className="hash-value">{input.script_sig_hex || 'None (empty)'}</dd>
                  </div>
                )}
                {'script_sig_asm' in input && input.script_sig_asm !== undefined && (
                  <div className="asm-grid-row">
                    <dt className="asm-label-row">
                      <span>ScriptSig Disassembly</span>
                      <span className="script-badge">Script Disassembly</span>
                    </dt>
                    <dd><code className="asm-code">{input.script_sig_asm || 'None (empty)'}</code></dd>
                  </div>
                )}
                {'witness_item_count' in input && (
                  <div>
                    <dt>Witness items</dt>
                    <dd>{input.witness_item_count} item(s)</dd>
                  </div>
                )}
              </dl>

              {/* Expandable Witness Stack Section */}
              {'witness_items' in input && input.witness_items && (
                <details className="witness-stack-details" open={input.witness_items.length > 0}>
                  <summary className="witness-stack-summary">
                    <span className="witness-stack-title">Witness Stack</span>
                    <span className="witness-count-badge">
                      {input.witness_items.length} item{input.witness_items.length === 1 ? '' : 's'}
                    </span>
                  </summary>
                  {input.witness_items.length === 0 ? (
                    <p className="muted small empty-witness-note">No witness items (empty witness stack or legacy input).</p>
                  ) : (
                    <div className="witness-items-list">
                      {input.witness_items.map((wItem) => (
                        <div key={wItem.index} className="witness-item-card">
                          <div className="witness-item-meta">
                            <span className="witness-index-pill">Witness #{wItem.index}</span>
                            <span className="witness-size-label">{wItem.size_bytes} byte{wItem.size_bytes === 1 ? '' : 's'}</span>
                          </div>
                          <div className="witness-item-body">
                            <code className="hash-value witness-hex-code">
                              {wItem.hex || '<empty item (0 bytes)>'}
                            </code>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </details>
              )}

              {'resolved_prevout' in input && input.resolved_prevout && (
                <div className="prevout-card">
                  <div className="prevout-header">
                    <span className="prevout-tag">Resolved Spent Prevout</span>
                    <strong className="prevout-value">{input.resolved_prevout.value_sats.toLocaleString()} sats</strong>
                  </div>
                  <dl className="prevout-facts">
                    <div>
                      <dt>Address</dt>
                      <dd className="hash-value">{input.resolved_prevout.address ?? 'Unavailable'}</dd>
                    </div>
                    <div>
                      <dt>ScriptPubKey Hex</dt>
                      <dd className="hash-value">{input.resolved_prevout.script_pubkey_hex}</dd>
                    </div>
                    {input.resolved_prevout.script_pubkey_asm && (
                      <div>
                        <dt className="asm-label-row">
                          <span>ScriptPubKey Disassembly</span>
                          <span className="script-badge">Script Disassembly</span>
                        </dt>
                        <dd><code className="asm-code">{input.resolved_prevout.script_pubkey_asm}</code></dd>
                      </div>
                    )}
                  </dl>
                </div>
              )}

              <details className="nested-details">
                <summary>Raw input facts</summary>
                <Facts value={input}/>
              </details>
            </div>
          </details>
        ))}
      </section>

      {/* Outputs Section */}
      <section className="report-section outputs-section" aria-label="Outputs">
        <div className="section-header-row">
          <h3>Outputs <span className="count">{inspection.output_count}</span></h3>
        </div>

        {isTransaction && (!('chain_context' in inspection) || !inspection.chain_context) && inspection.outputs.every(o => !o.address) && (
          <div className="explorer-notice-banner network-notice" role="note">
            <span className="notice-icon" aria-hidden="true">ℹ</span>
            <span>Raw transaction data does not encode Bitcoin network.</span>
          </div>
        )}

        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Index</th>
                <th>Value (sats)</th>
                <th>Address</th>
                <th>Script type</th>
              </tr>
            </thead>
            <tbody>
              {inspection.outputs.map(output=>(
                <tr key={output.index}>
                  <td>{output.index}</td>
                  <td>{output.value_sats.toLocaleString()}</td>
                  <td className="table-address">
                    {output.address ? <code className="address-code">{output.address}</code> : <span className="muted">Unavailable</span>}
                  </td>
                  <td><code className="table-script">{output.script_type}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {inspection.outputs.map(output=>(
          <details key={output.index} className="fact-details" open={inspection.outputs.length === 1}>
            <summary>Output {output.index} details</summary>
            <div className="output-detail-content">
              <dl className="facts-overview">
                <div>
                  <dt>Value</dt>
                  <dd>{output.value_sats.toLocaleString()} sats</dd>
                </div>
                <div>
                  <dt>Address</dt>
                  <dd className="hash-value">{output.address ?? 'Unavailable'}</dd>
                </div>
                <div>
                  <dt>Script Type</dt>
                  <dd><code className="table-script">{output.script_type}</code></dd>
                </div>
                <div>
                  <dt>ScriptPubKey Hex</dt>
                  <dd className="hash-value">{output.script_pubkey_hex}</dd>
                </div>
                {'script_pubkey_asm' in output && output.script_pubkey_asm !== undefined && (
                  <div className="asm-grid-row">
                    <dt className="asm-label-row">
                      <span>ScriptPubKey Disassembly</span>
                      <span className="script-badge">Script Disassembly</span>
                    </dt>
                    <dd><code className="asm-code">{output.script_pubkey_asm || 'None'}</code></dd>
                  </div>
                )}
              </dl>
              <details className="nested-details">
                <summary>Raw output facts</summary>
                <Facts value={output}/>
              </details>
            </div>
          </details>
        ))}

        <details className="fact-details">
          <summary>All inspection facts and metadata counts</summary>
          <Facts value={Object.fromEntries(Object.entries(inspection).filter(([key])=>key!=='inputs'&&key!=='outputs'))}/>
        </details>
      </section>

      {/* Analysis Context Section */}
      {preflight&&(
        <section className="report-section">
          <h3>Analysis context</h3>
          {preflight.wallet_context?(
            <details className="fact-details">
              <summary>Wallet context</summary>
              <Facts value={preflight.wallet_context}/>
            </details>
          ):(
            <p className="context-unavailable">Wallet context: Unavailable</p>
          )}

          {preflight.node_context?(
            <details className="fact-details">
              <summary>Node context — point-in-time observations</summary>
              <Facts value={preflight.node_context}/>
            </details>
          ):(
            <p className="context-unavailable">Node context: Unavailable. See Not Evaluated for skipped node checks.</p>
          )}
        </section>
      )}

      {/* Export Actions Section */}
      <section className="report-section report-footer-section">
        <h3>Your report</h3>
        <p className="muted">Exports contain transaction facts and may reveal wallet or node context. Save or share them deliberately.</p>
        <div className="actions">
          <button type="button" className="button" onClick={copy}>Copy JSON</button>
          <button type="button" className="button" onClick={download}>Download JSON report</button>
          <button type="button" className="button secondary" onClick={onClear}>Inspect another transaction</button>
        </div>
        {notice&&<p role="status" className="report-notice">{notice}</p>}
      </section>
    </section>
  )
}
