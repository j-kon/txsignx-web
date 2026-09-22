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
          <h2>Inspection report</h2>
          <p>Structural observations and transaction facts. No preflight policy was requested.</p>
        </header>
      )}

      {/* Transaction Facts Section */}
      <section className="report-section">
        <h3>Transaction facts</h3>
        <p className="muted">
          {psbt
            ?'Signing state describes field presence, not verified signatures. UTXO consistency checks supplied metadata.'
            :'Raw transactions do not provide spent-output values, fees or a network.'}
        </p>

        <dl className="summary-facts">
          <div className="txid">
            <dt>{psbt?'Unsigned transaction ID':'Transaction ID'}</dt>
            <dd className="hash-value">{psbt?psbt.unsigned_txid:'txid' in inspection?inspection.txid:''}</dd>
          </div>
          <div>
            <dt>Signing state</dt>
            <dd>{psbt?humanize(psbt.signing_state):'Unavailable'}</dd>
          </div>
          <div>
            <dt>Fee status</dt>
            <dd>{psbt?humanize(psbt.fee.status):'Unavailable'}</dd>
          </div>
          <div>
            <dt>Fee (sats)</dt>
            <dd>{display(psbt?psbt.fee.fee_sats:'fee_sats' in inspection?inspection.fee_sats:null)}</dd>
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

        <h4>Inputs</h4>
        {inspection.inputs.map(input=>(
          <details key={input.index} className="fact-details">
            <summary>
              Input {input.index} — {input.previous_txid.slice(0,12)}…:{input.previous_vout}
            </summary>
            <Facts value={input}/>
          </details>
        ))}

        <h4>Outputs</h4>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Index</th>
                <th>Value (sats)</th>
                <th>Script type</th>
              </tr>
            </thead>
            <tbody>
              {inspection.outputs.map(output=>(
                <tr key={output.index}>
                  <td>{output.index}</td>
                  <td>{output.value_sats}</td>
                  <td><code className="table-script">{output.script_type}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {inspection.outputs.map(output=>(
          <details key={output.index} className="fact-details">
            <summary>Output {output.index} details</summary>
            <Facts value={output}/>
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
