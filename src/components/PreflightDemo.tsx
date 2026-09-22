import {useEffect,useState} from 'react'

const STEPS = [
  {id:'psbt',label:'PSBT received & format validated',status:'done',meta:'BIP174 v0 base64'},
  {id:'facts',label:'Transaction facts parsed',status:'done',meta:'1 input (p2wpkh), 2 outputs (p2wpkh, p2tr)'},
  {id:'utxo',label:'UTXO & context correlation',status:'skipped',meta:'Absent in this fixture · Marked unevaluated'},
  {id:'wallet',label:'Wallet ownership & change verification',status:'skipped',meta:'Absent in this fixture · Marked unevaluated'},
  {id:'rules',label:'Deterministic policy rules evaluated',status:'done',meta:'15 active rules registered · 0 findings triggered'}
]

function isReducedMotion():boolean {
  return typeof window!=='undefined'&&typeof window.matchMedia==='function'&&window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function PreflightDemo(){
  const [activeStep,setActiveStep]=useState(STEPS.length)
  const [paused,setPaused]=useState(false)

  useEffect(()=>{
    if (isReducedMotion()||paused) return

    const interval=setInterval(()=>{
      setActiveStep(prev=>(prev>=STEPS.length?1:prev+1))
    },1800)

    return ()=>clearInterval(interval)
  },[paused])

  return (
    <div
      className="preflight-demo-card"
      onMouseEnter={()=>setPaused(true)}
      onMouseLeave={()=>setPaused(false)}
      role="region"
      aria-label="Synthetic preflight demonstration"
    >
      {/* Scanner light effect */}
      <div className="scanner-line" aria-hidden="true" />

      <div className="demo-card-header">
        <div className="demo-badge-row">
          <span className="demo-synthetic-tag">Public synthetic example</span>
          <span className="demo-live-indicator" aria-hidden="true">
            <span className="live-dot" /> Live sequence
          </span>
        </div>
        <h3 className="demo-title">Preflight verification in progress</h3>
        <p className="demo-subtitle">Demonstrating factual parsing and rule coverage mapping on a synthetic payment PSBT.</p>
      </div>

      <div className="demo-steps-list">
        {STEPS.map((step,idx)=>{
          const isCurrent=activeStep===idx+1
          const isPassed=activeStep>idx+1||activeStep===STEPS.length
          return (
            <div
              key={step.id}
              className={`demo-step ${isPassed?'step-passed':isCurrent?'step-current':'step-pending'}`}
            >
              <div className="step-marker" aria-hidden="true">
                {isPassed?(
                  step.status==='skipped'?(
                    <span className="marker-skip">—</span>
                  ):(
                    <span className="marker-check">✓</span>
                  )
                ):isCurrent?(
                  <span className="marker-pulse" />
                ):(
                  <span className="marker-empty">○</span>
                )}
              </div>
              <div className="step-body">
                <div className="step-title-row">
                  <span className="step-name">{step.label}</span>
                  {step.status==='skipped'&&<span className="status-pill pill-skipped">Context Absent</span>}
                </div>
                <span className="step-meta">{step.meta}</span>
              </div>
            </div>
          )
        })}
      </div>

      <div className={`demo-verdict-box ${activeStep>=STEPS.length?'verdict-visible':'verdict-evaluating'}`}>
        <div className="verdict-status-row">
          <div className="verdict-pill verdict-pass">
            <span className="verdict-icon">✓</span> PASS
          </div>
          <span className="verdict-risk">LOW RISK</span>
          <span className="verdict-findings">0 Findings</span>
        </div>
        <p className="demo-scope-note">
          PASS applies only to evaluated rules. Wallet and node context were absent in this synthetic example and are explicitly recorded as skipped.
        </p>
      </div>
    </div>
  )
}
