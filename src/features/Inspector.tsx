import {useEffect,useRef,useState} from 'react'
import type {ChangeEvent,FormEvent} from 'react'
import {ApiClient,MAX_TEXT_BYTES,validateText} from '../lib/api/client'
import type {PreflightRequest} from '../lib/api/client'
import type {Capabilities,Report} from '../lib/api/schema'
import {ReportView} from './ReportView'
import {samples} from './samples'

function wholeNumber(text:string,label:string,max=Number.MAX_SAFE_INTEGER):number {
  if (!/^\d+$/.test(text)||!Number.isSafeInteger(Number(text))||Number(text)>max) throw new Error(`${label} must be a whole number from 0 to ${max}.`)
  return Number(text)
}
export function Inspector({api}:{api:ApiClient}) {
  const [mode,setMode]=useState<'psbt'|'raw'>('psbt');const [operation,setOperation]=useState('preflight');const [text,setText]=useState('');const [sample,setSample]=useState<'pass'|'review'|'block'>('pass')
  const [report,setReport]=useState<Report|null>(null);const [error,setError]=useState('');const [loading,setLoading]=useState(false);const [caps,setCaps]=useState<Capabilities|null>(null);const [capsError,setCapsError]=useState('')
  const [wallet,setWallet]=useState(false);const [network,setNetwork]=useState('regtest');const [external,setExternal]=useState('');const [internal,setInternal]=useState('');const [windowSize,setWindowSize]=useState('1000');const [change,setChange]=useState('');const [node,setNode]=useState(false);const [fee,setFee]=useState('');const [ratio,setRatio]=useState('')
  const generation=useRef(0);const upload=useRef<HTMLInputElement>(null)
  useEffect(()=>{let active=true;const token=generation;api.capabilities().then(value=>{if(active)setCaps(value)}).catch(()=>{if(active)setCapsError('Capabilities unavailable. Node analysis is disabled until the API can be reached.')});return()=>{active=false;token.current++}},[api])
  function invalidate(){generation.current++;setReport(null);setError('')}
  function clear(){invalidate();setText('');setExternal('');setInternal('');setWallet(false);setNode(false);setChange('');setFee('');setRatio('');if(upload.current)upload.current.value=''}
  async function loadFile(event:ChangeEvent<HTMLInputElement>){
    invalidate();const current=generation.current;const file=event.target.files?.[0];if(!file)return
    if(file.size>MAX_TEXT_BYTES){setError('File exceeds the 1 MiB text limit.');return}
    try{const value=await file.text();validateText(value);if(current===generation.current)setText(value.trim())}catch{if(current===generation.current)setError('Could not read a valid text file within the 1 MiB limit.')}
  }
  async function analyze(event:FormEvent){
    event.preventDefault();invalidate();const current=generation.current;setLoading(true)
    try{
      validateText(text)
      let result:Report
      if(mode==='raw')result=await api.inspectTransaction(text.trim())
      else if(operation==='inspect')result=await api.inspectPsbt(text.trim())
      else{
        const request:PreflightRequest={psbt:text.trim()}
        if(fee||ratio)request.policy={...(fee?{max_absolute_fee_sats:wholeNumber(fee,'Maximum fee')}:{}),...(ratio?{max_fee_ratio_bps:wholeNumber(ratio,'Fee share',10000)}:{})}
        if(wallet){
          if(!external.trim()||!internal.trim())throw new Error('Both public descriptors are required for wallet context.')
          const derivation=wholeNumber(windowSize,'Derivation window',10000);if(derivation<1)throw new Error('Derivation window must be at least 1.')
          request.wallet={network,external_descriptor:external.trim(),internal_descriptor:internal.trim(),derivation_window:derivation,expected_change_outputs:change.trim()?change.split(',').map(i=>wholeNumber(i.trim(),'Expected change index')):[]}
          if(node&&caps?.node_context_available)request.node={use_configured_node:true}
        }
        result=await api.preflight(request)
      }
      if(current===generation.current)setReport(result)
    }catch(err){if(current===generation.current)setError(err instanceof Error?err.message:'Analysis failed. Try again.')}finally{if(current===generation.current)setLoading(false)}
  }
  return <><div className="page-heading"><h1>Transaction Inspector</h1><p>Inspect. Verify. Sign with Confidence.</p></div><div className="workspace"><section className="input-panel"><div className="mode-tabs" aria-label="Input format"><button aria-pressed={mode==='psbt'} disabled={loading} onClick={()=>{clear();setMode('psbt')}}>PSBT</button><button aria-pressed={mode==='raw'} disabled={loading} onClick={()=>{clear();setMode('raw')}}>Raw Transaction</button></div>
    <p className="privacy">Your input is sent only to the configured TxSignX API. It stays in memory in this page; it is not saved in browser storage. Use public descriptors only. Never paste private keys or seeds.</p><p className="api-address">API: <code>{api.baseUrl}</code></p>
    <form onSubmit={analyze} autoComplete="off"><fieldset disabled={loading} className="form-fields">
      <label>{mode==='psbt'?'PSBT base64':'Raw transaction hex'}<textarea value={text} onChange={e=>{invalidate();setText(e.target.value)}} spellCheck={false} autoCapitalize="off" autoCorrect="off" placeholder={mode==='psbt'?'Paste a BIP174 PSBT v0 in base64…':'Paste a raw transaction in hex…'} rows={8}/></label>
      <div className="file-row"><label>Upload text file<input ref={upload} type="file" accept=".txt,.b64,.hex,text/plain" onChange={loadFile}/></label><span className="muted">Text only · 1 MiB maximum</span></div>
      <div className="sample-row">{mode==='psbt'&&<label>Public sample<select value={sample} onChange={e=>setSample(e.target.value as typeof sample)}><option value="pass">PASS — ordinary fee</option><option value="review">REVIEW — unusual sighash</option><option value="block">BLOCK — excessive fee</option></select></label>}<button type="button" onClick={()=>{clear();setText(mode==='raw'?samples.raw:samples[sample]);setOperation('preflight')}}>Use sample</button></div><p className="muted small">Synthetic fixtures, evaluated by your API. Sample labels describe default policy without wallet or node context.</p>
      {mode==='psbt'&&<><label>Operation<select value={operation} onChange={e=>{invalidate();setOperation(e.target.value)}}><option value="preflight">Inspection + policy preflight</option><option value="inspect">Inspection only</option></select></label>{operation==='preflight'&&<>
        <details className="context-controls"><summary>Policy thresholds (optional)</summary><p className="muted">Leave blank to use the engine defaults. These are development policy thresholds, not consensus limits.</p><label>Maximum fee (sats)<input inputMode="numeric" value={fee} onChange={e=>{invalidate();setFee(e.target.value)}} placeholder="API default"/></label><label>Maximum fee share (basis points)<input inputMode="numeric" value={ratio} onChange={e=>{invalidate();setRatio(e.target.value)}} placeholder="API default (0–10000)"/></label></details>
        <label className="check"><input type="checkbox" checked={wallet} onChange={e=>{invalidate();setWallet(e.target.checked);setNode(false)}}/>Add public wallet context</label>
        {wallet&&<div className="wallet-fields"><p className="muted">Wallet matches are bounded by the derivation window. Specify intended change explicitly.</p><label>Expected network<select value={network} onChange={e=>{invalidate();setNetwork(e.target.value)}}>{['bitcoin','testnet','testnet4','signet','regtest'].map(n=><option key={n}>{n}</option>)}</select></label><label>External public descriptor<textarea rows={3} value={external} onChange={e=>{invalidate();setExternal(e.target.value)}} spellCheck={false}/></label><label>Internal public descriptor<textarea rows={3} value={internal} onChange={e=>{invalidate();setInternal(e.target.value)}} spellCheck={false}/></label><label>Derivation window<input inputMode="numeric" value={windowSize} onChange={e=>{invalidate();setWindowSize(e.target.value)}}/></label><label>Expected change output indexes<input value={change} onChange={e=>{invalidate();setChange(e.target.value)}} placeholder="For example: 1, 2 (zero-based)"/></label><label className="check"><input type="checkbox" checked={node} disabled={!caps?.node_context_available} onChange={e=>{invalidate();setNode(e.target.checked)}}/>Use configured node</label><p className="muted">{caps?.node_context_available?'A node is configured on the API. Availability is checked during analysis.':'No configured node is available. Node rules will remain unevaluated.'} RPC credentials belong only on the server.</p></div>}
      </>}</>}
      <button className="primary analyze" type="submit">{loading?'Analyzing…':'Analyze Transaction'}</button>
    </fieldset></form>{capsError&&<p className="muted">{capsError}</p>}{error&&<p className="error" role="alert">{error}</p>}{loading&&<p role="status">Analyzing with the Rust engine…</p>}</section>
    <div className="result-panel" aria-live="polite" aria-busy={loading}>{report?<ReportView report={report} onClear={clear}/>:<section className="empty-report"><div className="empty-symbol" aria-hidden="true">⌁</div><h2>Understand what you’re signing.</h2><p>Paste a transaction or use a public sample. The report separates observed facts, policy findings and checks that need more context.</p><p className="muted">No signing, finalization or broadcasting. Development software; not audited or production-ready.</p></section>}</div></div></>
}
