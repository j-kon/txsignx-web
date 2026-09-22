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

          {/* Segmented Filter Controls */}
          <div className="policy-filter-bar" role="toolbar" aria-label="Filter policy rules">
            <div className="filter-group">
              <span className="filter-group-label">Status:</span>
              <div className="filter-chips">
                {(['all','active','deferred'] as const).map(f=>(
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

            <div className="filter-group">
              <span className="filter-group-label">Severity:</span>
              <div className="filter-chips">
                {(['critical','high','medium','info'] as const).map(f=>(
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
          </div>

          {filteredRules.length===0?(
            <div className="empty-filter-state">
              <p>No policy rules match the selected filter.</p>
            </div>
          ):(
            <div className="rule-registry">
              {filteredRules.map((rule:CatalogRule)=>(
                <article key={rule.code} className={`rule-card registry-card ${rule.active?'is-active':'is-deferred'}`}>
                  <header className="registry-card-header">
                    <code className="rule-code">{rule.code}</code>
                    <span className={`status-indicator ${rule.active?'status-active':'status-deferred'}`}>
                      {rule.active?'Active':'Deferred'} {rule.active?'●':'○'}
                    </span>
                  </header>
                  <h2 className="rule-title">{rule.title}</h2>
                  <div className="registry-meta-row">
                    {'default_severity' in rule&&typeof rule.default_severity==='string'&&(
                      <div className="registry-meta-item">
                        <span className="meta-label">Severity</span>
                        <span className={`sev-tag sev-${rule.default_severity.toLowerCase()}`}>
                          {humanize(rule.default_severity).toUpperCase()}
                        </span>
                      </div>
                    )}
                    <div className="registry-meta-item">
                      <span className="meta-label">Required context</span>
                      <span className="meta-val">
                        {rule.required_context.length?rule.required_context.join('; '):'None'}
                      </span>
                    </div>
                  </div>
                  <div className="registry-divider" aria-hidden="true" />
                  <p className="rule-desc">{rule.description}</p>
                  {!rule.active&&(
                    <p className="rule-deferred-note">
                      Reserved / deferred; not currently evaluated.
                    </p>
                  )}
                </article>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
