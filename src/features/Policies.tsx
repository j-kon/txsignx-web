import {useEffect,useMemo,useState} from 'react'
import type {ApiClient} from '../lib/api/client'
import type {RuleCatalog} from '../lib/api/schema'
import {humanize} from '../lib/text'

type FilterType = 'all' | 'active' | 'deferred' | 'critical' | 'high' | 'medium' | 'info'
type CatalogRule = RuleCatalog['active_rules'][number] | RuleCatalog['deferred_rules'][number]

export function Policies({api}:{api:ApiClient}){
  const [catalog,setCatalog]=useState<RuleCatalog|null>(null)
  const [error,setError]=useState('')
  const [attempt,setAttempt]=useState(0)
  const [filter,setFilter]=useState<FilterType>('all')

  useEffect(()=>{
    let active=true
    api.policies()
      .then(data=>{if(active){setCatalog(data);setError('')}})
      .catch(()=>{if(active)setError('Could not load the policy registry. Check the TxSignX API and try again.')})
    return ()=>{active=false}
  },[api,attempt])

  const allRules = useMemo(():CatalogRule[]=>{
    if(!catalog) return []
    return [...catalog.active_rules,...catalog.deferred_rules].sort((a,b)=>a.code.localeCompare(b.code))
  },[catalog])

  const filteredRules = useMemo(():CatalogRule[]=>{
    if(!allRules.length) return []
    return allRules.filter(rule=>{
      if(filter==='all') return true
      if(filter==='active') return rule.active
      if(filter==='deferred') return !rule.active
      if('default_severity' in rule && typeof rule.default_severity==='string'){
        return rule.default_severity.toLowerCase() === filter
      }
      return false
    })
  },[allRules,filter])

  const counts = useMemo(()=>{
    const c:Record<FilterType,number>={all:allRules.length,active:0,deferred:0,critical:0,high:0,medium:0,info:0}
    for(const r of allRules){
      if(r.active) c.active++
      else c.deferred++
      if('default_severity' in r && typeof r.default_severity==='string'){
        const sev=r.default_severity.toLowerCase() as FilterType
        if(c[sev]!==undefined) c[sev]++
      }
    }
    return c
  },[allRules])

  return (
    <div className="policies-page">
      <div className="page-heading">
        <span className="section-kicker">Security Invariants</span>
        <h1>Policy rules</h1>
        <p>The deterministic verification registry published by your Rust security engine.</p>
      </div>

      {error?(
        <div role="alert" className="error-box">
          <p>{error}</p>
          <button className="button secondary" onClick={()=>setAttempt(a=>a+1)}>Retry registry</button>
        </div>
      ):!catalog?(
        <div className="loading-state" role="status">
          <div className="loading-pulse" aria-hidden="true" />
          <p>Loading policy registry from connected API…</p>
        </div>
      ):(
        <>
          <div className="policy-overview-banner">
            <p className="scope">
              <strong>{catalog.active_rules.length} active rules</strong> · <strong>{catalog.deferred_rules.length} deferred rules</strong>. Active rules are evaluated strictly against available facts. Unsupplied wallet or node context is recorded explicitly in coverage.
            </p>
          </div>

          {/* Filter Bar */}
          <div className="policy-filter-bar" role="toolbar" aria-label="Filter policy rules">
            <span className="filter-label">Filter:</span>
            <div className="filter-chips">
              {(['all','active','deferred','critical','high','medium','info'] as const).map(f=>(
                <button
                  key={f}
                  type="button"
                  className={`filter-chip ${filter===f?'chip-active':''}`}
                  onClick={()=>setFilter(f)}
                  aria-pressed={filter===f}
                >
                  {f.charAt(0).toUpperCase()+f.slice(1)}
                  <span className="chip-count">{counts[f]}</span>
                </button>
              ))}
            </div>
          </div>

          {filteredRules.length===0?(
            <div className="empty-filter-state">
              <p>No policy rules match the selected filter.</p>
            </div>
          ):(
            <div className="rule-registry">
              {filteredRules.map((rule:CatalogRule)=>(
                <article key={rule.code} className={`rule-card ${rule.active?'is-active':'is-deferred'}`}>
                  <header>
                    <code className="rule-code">{rule.code}</code>
                    <span className={rule.active?'rule-active':'muted rule-deferred'}>
                      {rule.active?'Active':'Deferred'}
                    </span>
                  </header>
                  <h2>{rule.title}</h2>
                  <p className="rule-desc">{rule.description}</p>
                  {!rule.active&&(
                    <p className="rule-deferred-note">
                      Reserved / deferred; not currently evaluated.
                    </p>
                  )}
                  {'default_severity' in rule&&typeof rule.default_severity==='string'&&(
                    <p className="muted rule-sev">
                      Trigger severity:{' '}
                      <span className={`sev-tag sev-${rule.default_severity.toLowerCase()}`}>
                        {humanize(rule.default_severity)}
                      </span>
                    </p>
                  )}
                  <p className="muted rule-context">
                    Required context:{' '}
                    <strong>{rule.required_context.length?rule.required_context.join('; '):'None'}</strong>
                  </p>
                </article>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
