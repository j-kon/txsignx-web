import {useEffect,useState} from 'react'

const COMMAND = 'txsignx psbt preflight --file payment.b64'

function isReducedMotion():boolean {
  return typeof window!=='undefined'&&typeof window.matchMedia==='function'&&window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function TerminalDemo(){
  const [typedChars,setTypedChars]=useState(()=>isReducedMotion()?COMMAND.length:0)
  const [isTyping,setIsTyping]=useState(()=>!isReducedMotion())

  useEffect(()=>{
    if (isReducedMotion()) return

    let charIdx=0
    const timer=setInterval(()=>{
      charIdx++
      setTypedChars(charIdx)
      if (charIdx>=COMMAND.length){
        clearInterval(timer)
        setIsTyping(false)
      }
    },45)

    return ()=>clearInterval(timer)
  },[])

  function replay(){
    setTypedChars(0)
    setIsTyping(true)
    let charIdx=0
    const timer=setInterval(()=>{
      charIdx++
      setTypedChars(charIdx)
      if (charIdx>=COMMAND.length){
        clearInterval(timer)
        setIsTyping(false)
      }
    },40)
  }

  const showOutput=typedChars>=COMMAND.length

  return (
    <div className="terminal-window" role="region" aria-label="TxSignX CLI demonstration">
      <div className="terminal-titlebar">
        <div className="terminal-buttons" aria-hidden="true">
          <span className="term-btn term-close" />
          <span className="term-btn term-min" />
          <span className="term-btn term-max" />
        </div>
        <div className="terminal-title">txsignx — preflight session</div>
        <button
          type="button"
          className="terminal-replay-btn"
          onClick={replay}
          title="Replay command"
          aria-label="Replay CLI command"
        >
          Replay
        </button>
      </div>

      <div className="terminal-body">
        <div className="terminal-prompt-line">
          <span className="term-prompt" aria-hidden="true">$</span>{' '}
          <span className="term-command">{COMMAND.slice(0,typedChars)}</span>
          {isTyping&&<span className="term-cursor" aria-hidden="true">▋</span>}
        </div>

        {showOutput&&(
          <pre className="terminal-output-block">
            <span className="term-line term-dim"># Inspecting BIP174 PSBT v0...</span>{'\n'}
            <span className="term-line term-dim"># Evaluating 15 registered policy rules...</span>{'\n\n'}
            <span className="term-key">decision:</span>        <span className="term-val-pass">"pass"</span>{'\n'}
            <span className="term-key">risk_level:</span>      <span className="term-val-low">"low"</span>{'\n'}
            <span className="term-key">finding_count:</span>   <span className="term-val-num">0</span>{'\n'}
            <span className="term-key">signing_state:</span>   <span className="term-val-str">"unsigned"</span>{'\n'}
            <span className="term-key">fee_sats:</span>        <span className="term-val-num">1000</span>{'\n'}
            <span className="term-key">input_count:</span>     <span className="term-val-num">1</span> <span className="term-dim">(p2wpkh)</span>{'\n'}
            <span className="term-key">output_count:</span>    <span className="term-val-num">2</span> <span className="term-dim">(p2wpkh, p2tr)</span>{'\n'}
            <span className="term-key">coverage:</span>        <span className="term-dim">7 evaluated, 8 skipped (no wallet/node context)</span>
          </pre>
        )}
      </div>

      <div className="terminal-footer">
        <span>Deterministic exit code: <code className="code-accent">0</code> (PASS)</span>
        <span className="term-dim">REVIEW: <code>2</code> | BLOCK: <code>3</code></span>
      </div>
    </div>
  )
}
