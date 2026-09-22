import {useEffect,useState} from 'react'
import type {ApiClient} from '../lib/api/client'
import type {RuleCatalog} from '../lib/api/schema'
import {humanize} from '../lib/text'
export function Policies({api}:{api:ApiClient}){
  const [catalog,setCatalog]=useState<RuleCatalog|null>(null);const [error,setError]=useState('');const [attempt,setAttempt]=useState(0)
  useEffect(()=>{let active=true;api.policies().then(data=>{if(active){setCatalog(data);setError('')}}).catch(()=>{if(active)setError('Could not load the policy registry. Check the TxSignX API and try again.')});return()=>{active=false}},[api,attempt])
  return <><div className="page-heading"><h1>Policy rules</h1><p>The registry published by your Rust security engine.</p></div>{error?<div role="alert"><p>{error}</p><button onClick={()=>setAttempt(a=>a+1)}>Retry registry</button></div>:!catalog?<p role="status">Loading policy registry…</p>:<><p className="scope">{catalog.active_rules.length} active rules. {catalog.deferred_rules.length} deferred rules. Active rules may still require context; every preflight report records evaluation coverage.</p><div className="rule-registry">{[...catalog.active_rules,...catalog.deferred_rules].sort((a,b)=>a.code.localeCompare(b.code)).map(rule=><article key={rule.code}><header><code>{rule.code}</code><span className={rule.active?'rule-active':'muted'}>{rule.active?'Active':'Deferred'}</span></header><h2>{rule.title}</h2><p>{rule.description}</p>{'default_severity' in rule&&typeof rule.default_severity==='string'&&<p className="muted">Trigger severity: {humanize(rule.default_severity)}</p>}<p className="muted">Required context: {rule.required_context.length?rule.required_context.join('; '):'None'}</p></article>)}</div></>}</>
}
