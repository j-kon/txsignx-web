import {useState} from 'react'
import type {Report} from '../lib/api/schema'
import {humanize} from '../lib/text'
const display = (value:unknown):string => value===null||value===undefined?'Unavailable':typeof value==='boolean'?value?'Yes':'No':String(value)
/** Escaped React text only. All nested details remain available without inventing facts. */
export function Facts({value}:{value:unknown}) {
  if (!value || typeof value!=='object') return <span>{display(value)}</span>
  if (Array.isArray(value)) return value.length ? <ol className="fact-list">{value.map((entry,index)=><li key={index}><Facts value={entry}/></li>)}</ol>:<span>None</span>
  return <dl className="facts">{Object.entries(value).map(([key,entry])=><div key={key}><dt>{humanize(key)}</dt><dd><Facts value={entry}/></dd></div>)}</dl>
}
export function ReportView({report,onClear}:{report:Report;onClear:()=>void}) {
  const [notice,setNotice]=useState('')
  const preflight='inspection' in report?report:null
  const inspection=preflight?preflight.inspection:report as Exclude<Report,{inspection:unknown}>
  const psbt='unsigned_txid' in inspection?inspection:null
  const policy=preflight?.policy
  const json=()=>JSON.stringify(report,null,2)
  async function copy(){try{await navigator.clipboard.writeText(json());setNotice('JSON copied to your clipboard.')}catch{setNotice('Clipboard unavailable. Download the JSON report instead.')}}
  function download(){
    const url=URL.createObjectURL(new Blob([json()],{type:'application/json'}));const anchor=document.createElement('a');anchor.href=url;anchor.download='txsignx-report.json';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setNotice('JSON report download requested.')
  }
  return <section className="report" aria-label="Analysis report">
    {policy?<><header className={`verdict ${policy.decision}`}><div><p>Preflight decision</p><h2>{policy.decision.toUpperCase()}</h2></div><div><p>Risk level</p><strong>{humanize(policy.risk_level)}</strong></div></header>
      {policy.decision==='pass'&&<p className="scope">No evaluated active rule requires review or blocking.</p>}
      <p className="scope">{policy.scope_note}</p>
      <section className="report-section"><h3>Findings <span className="count">{policy.finding_count}</span></h3>{policy.findings.length===0?<p>No findings from evaluated rules.</p>:policy.findings.map((finding,index)=><article className={`finding ${finding.severity}`} key={`${finding.code}-${index}`}><div className="finding-heading"><code>{finding.code}</code><span>{humanize(finding.severity)}</span></div><h4>{finding.title}</h4><p>{finding.message}</p><p className="muted">Evidence location: {humanize(finding.location.type)}{finding.location.index===undefined?'':` ${finding.location.index}`}</p>{finding.recommendation&&<p>{finding.recommendation}</p>}</article>)}</section>
      <section className="report-section"><h3>Evaluation coverage</h3><p className="muted">A decision covers only the checks listed here. Missing context limits what can be evaluated.</p><div className="coverage">{(['evaluated','partially_evaluated','not_evaluated'] as const).map(status=><section key={status}><h4>{status==='partially_evaluated'?'Partially Evaluated':status==='not_evaluated'?'Not Evaluated':'Evaluated'}</h4>{policy.rule_evaluations.filter(r=>r.status===status).length===0?<p>None</p>:<ul>{policy.rule_evaluations.filter(r=>r.status===status).map(rule=><li key={rule.code}><code>{rule.code}</code>{rule.reason&&<span>{humanize(rule.reason)}</span>}</li>)}</ul>}</section>)}</div><details><summary>Applied policy thresholds</summary><Facts value={policy.config}/></details></section></>:<header className="inspection-heading"><h2>Inspection report</h2><p>Structural observations. No policy decision was requested.</p></header>}
    <section className="report-section"><h3>Transaction facts</h3><p className="muted">{psbt?'Signing state describes field presence, not verified signatures. UTXO consistency checks supplied metadata.':'Raw transactions do not provide spent-output values, fees or a network.'}</p><dl className="summary-facts">
      <div className="txid"><dt>{psbt?'Unsigned transaction ID':'Transaction ID'}</dt><dd>{psbt?psbt.unsigned_txid:'txid' in inspection?inspection.txid:''}</dd></div>
      <div><dt>Signing state</dt><dd>{psbt?humanize(psbt.signing_state):'Unavailable'}</dd></div>
      <div><dt>Fee status</dt><dd>{psbt?humanize(psbt.fee.status):'Unavailable'}</dd></div>
      <div><dt>Fee (sats)</dt><dd>{display(psbt?psbt.fee.fee_sats:'fee_sats' in inspection?inspection.fee_sats:null)}</dd></div>
      <div><dt>Inputs</dt><dd>{inspection.input_count}</dd></div><div><dt>Outputs</dt><dd>{inspection.output_count}</dd></div><div><dt>Explicit RBF signal</dt><dd>{display(inspection.explicit_rbf)}</dd></div>
    </dl>
    <h4>Inputs</h4>{inspection.inputs.map(input=><details key={input.index}><summary>Input {input.index} — {input.previous_txid.slice(0,12)}…:{input.previous_vout}</summary><Facts value={input}/></details>)}
    <h4>Outputs</h4><div className="table-scroll"><table><thead><tr><th>Index</th><th>Value (sats)</th><th>Script type</th></tr></thead><tbody>{inspection.outputs.map(output=><tr key={output.index}><td>{output.index}</td><td>{output.value_sats}</td><td>{output.script_type}</td></tr>)}</tbody></table></div>
    {inspection.outputs.map(output=><details key={output.index}><summary>Output {output.index} details</summary><Facts value={output}/></details>)}
    <details><summary>All inspection facts and metadata counts</summary><Facts value={Object.fromEntries(Object.entries(inspection).filter(([key])=>key!=='inputs'&&key!=='outputs'))}/></details>
    </section>
    {preflight&&<section className="report-section"><h3>Analysis context</h3>{preflight.wallet_context?<details><summary>Wallet context</summary><Facts value={preflight.wallet_context}/></details>:<p>Wallet context: Unavailable</p>}{preflight.node_context?<details><summary>Node context — point-in-time observations</summary><Facts value={preflight.node_context}/></details>:<p>Node context: Unavailable. See Not Evaluated for skipped node checks.</p>}</section>}
    <section className="report-section"><h3>Your report</h3><p className="muted">Exports contain transaction facts and may reveal wallet or node context. Save or share them deliberately.</p><div className="actions"><button onClick={copy}>Copy JSON</button><button onClick={download}>Download JSON report</button><button onClick={onClear}>Inspect another transaction</button></div><p role="status">{notice}</p></section>
  </section>
}
