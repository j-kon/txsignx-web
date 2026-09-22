import {useEffect,useState} from 'react'

const PREFLIGHT_CMD = 'txsignx psbt preflight --file payment.b64'
const POLICY_CMD = 'txsignx policy list'

function isReducedMotion():boolean {
  return typeof window!=='undefined'&&typeof window.matchMedia==='function'&&window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function TerminalDemo(){
  const [activeTab,setActiveTab]=useState<'preflight'|'policy'>('preflight')
  const currentCmd = activeTab==='preflight' ? PREFLIGHT_CMD : POLICY_CMD
  const reduced = isReducedMotion()
  const [hasCompletedInitialTyping,setHasCompletedInitialTyping]=useState(reduced)
  const [typedChars,setTypedChars]=useState(()=>reduced ? PREFLIGHT_CMD.length : 0)
  const [isTyping,setIsTyping]=useState(()=>!reduced)

  useEffect(()=>{
    if (hasCompletedInitialTyping) return

    let charIdx=0
    const timer=setInterval(()=>{
      charIdx++
      setTypedChars(charIdx)
      if (charIdx>=PREFLIGHT_CMD.length){
        clearInterval(timer)
        setIsTyping(false)
        setHasCompletedInitialTyping(true)
      }
    },40)

    return ()=>clearInterval(timer)
  },[hasCompletedInitialTyping])

  const displayedCmd = hasCompletedInitialTyping ? currentCmd : currentCmd.slice(0,typedChars)
  const showOutput = hasCompletedInitialTyping

  return (
    <div className="terminal-window" role="region" aria-label="TxSignX CLI demonstration">
      <div className="terminal-titlebar">
        <div className="terminal-buttons" aria-hidden="true">
          <span className="term-btn term-close" />
          <span className="term-btn term-min" />
          <span className="term-btn term-max" />
        </div>
        <div className="terminal-tabs">
          <button
            type="button"
            className={`term-tab ${activeTab==='preflight'?'active-tab':''}`}
            onClick={()=>setActiveTab('preflight')}
          >
            psbt preflight
          </button>
          <button
            type="button"
            className={`term-tab ${activeTab==='policy'?'active-tab':''}`}
            onClick={()=>setActiveTab('policy')}
          >
            policy list
          </button>
        </div>
        <span className="terminal-synthetic-tag">Public synthetic example</span>
      </div>

      <div className="terminal-body">
        <div className="terminal-prompt-line">
          <span className="term-user">txsignx<span className="term-x">X</span></span>
          <span className="term-prompt" aria-hidden="true">$</span>{' '}
          <span className="term-command">{displayedCmd}</span>
          {isTyping&&<span className="term-cursor" aria-hidden="true">▋</span>}
        </div>

        {showOutput && activeTab==='preflight' && (
          <pre className="terminal-output-block">
            <span className="term-dim"># Inspecting BIP174 PSBT v0...</span>{'\n'}
            <span className="term-dim"># Evaluating 15 registered policy rules...</span>{'\n\n'}
            <span className="term-key">decision:</span>        <span className="term-val-pass">"pass"</span>{'\n'}
            <span className="term-key">risk_level:</span>      <span className="term-val-low">"low"</span>{'\n'}
            <span className="term-key">findings:</span>        <span className="term-val-num">0</span>{'\n'}
            <span className="term-key">signing_state:</span>   <span className="term-val-str">"unsigned"</span>{'\n'}
            <span className="term-key">fee_sats:</span>        <span className="term-val-num">1,000</span> <span className="term-dim">(12 sat/vB)</span>{'\n'}
            <span className="term-key">input_count:</span>     <span className="term-val-num">1</span> <span className="term-dim">(p2wpkh)</span>{'\n'}
            <span className="term-key">output_count:</span>    <span className="term-val-num">2</span> <span className="term-dim">(p2wpkh, p2tr)</span>{'\n'}
            <span className="term-key">coverage:</span>        <span className="term-dim">7 evaluated, 8 skipped (no wallet/node context)</span>
          </pre>
        )}

        {showOutput && activeTab==='policy' && (
          <pre className="terminal-output-block term-policy-list">
            <span className="term-heading">TxSignX Development Policy Rules</span>{'\n'}
            <span className="term-dim">------------------------------------</span>{'\n\n'}
            <span className="term-bold">TG001</span>  <span className="term-sev-critical">CRITICAL</span>  <span className="term-rule-title">Wrong Network</span>{'\n'}
            <span className="term-bold">TG002</span>  <span className="term-sev-critical">CRITICAL</span>  <span className="term-rule-title">Excessive Absolute Fee</span>{'\n'}
            <span className="term-bold">TG003</span>  <span className="term-sev-critical">CRITICAL</span>  <span className="term-rule-title">Excessive Fee Percentage</span>{'\n'}
            <span className="term-bold">TG004</span>  <span className="term-sev-high">HIGH</span>      <span className="term-rule-title">Unknown Wallet Input</span>{'\n'}
            <span className="term-bold">TG005</span>  <span className="term-sev-high">HIGH</span>      <span className="term-rule-title">Unknown Change Output</span>{'\n'}
            <span className="term-bold">TG011</span>  <span className="term-sev-high">HIGH</span>      <span className="term-rule-title">Unusual Sighash Type</span>{'\n'}
            <span className="term-bold">TG012</span>  <span className="term-sev-info">INFO</span>      <span className="term-rule-title">Unknown or Proprietary Metadata</span>{'\n'}
            <span className="term-bold">TG013</span>  <span className="term-sev-medium">MEDIUM</span>    <span className="term-rule-title">Unrecognized Script Type</span>{'\n\n'}
            <span className="term-heading">RESERVED / DEFERRED — not evaluated</span>{'\n'}
            <span className="term-dim">------------------------------------</span>{'\n'}
            <span className="term-bold">TG007</span>  <span className="term-sev-deferred">DEFERRED</span>  <span className="term-rule-title">Dust Output</span>{'\n'}
            <span className="term-bold">TG008</span>  <span className="term-sev-deferred">DEFERRED</span>  <span className="term-rule-title">Address Reuse</span>
          </pre>
        )}
      </div>

      <div className="terminal-footer">
        {activeTab==='preflight'?(
          <>
            <span>Deterministic exit code: <code className="code-accent">0</code> (PASS)</span>
            <span className="term-dim">REVIEW: <code>2</code> | BLOCK: <code>3</code></span>
          </>
        ):(
          <>
            <span>Policy registry: <code className="code-accent">15 active</code> · <code>2 deferred</code></span>
            <span className="term-dim">Exit code: <code>0</code></span>
          </>
        )}
      </div>
    </div>
  )
}
