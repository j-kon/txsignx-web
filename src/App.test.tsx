// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react'
import App from './App'
import pass from './test/fixtures/pass.json'
import review from './test/fixtures/review.json'
import block from './test/fixtures/block.json'
import psbt from './test/fixtures/psbt.json'
import raw from './test/fixtures/raw.json'
import policies from './test/fixtures/policies.json'
import txidConfirmed from './test/fixtures/txid_confirmed.json'
import txidMempool from './test/fixtures/txid_mempool.json'
import rawWithAddresses from './test/fixtures/raw_with_addresses.json'

const caps={
  raw_transaction_inspection:true,
  transaction_explorer:true,
  txid_inspection:true,
  transaction_address_rendering:true,
  psbt_v0_inspection:true,
  wallet_context:true,
  node_context_available:false,
  policy_preflight:true,
  broadcast_via_api:false,
  signing:false,
  finalization:false,
  psbt_v2:false,
  active_rules:15,
  deferred_rules:2
}

let currentCaps={...caps}
let report:unknown=pass
let txReport:unknown=raw
let error=false

beforeEach(()=>{
  window.location.hash=''
  currentCaps={...caps}
  report=pass
  txReport=raw
  error=false
  vi.stubGlobal('fetch',vi.fn(async (url:string)=>new Response(JSON.stringify(
    url.endsWith('capabilities')?currentCaps
    :url.endsWith('policies')?policies
    :error?{error:{code:'invalid_psbt',message:'NEVER ECHO THIS'}}
    :url.endsWith('transactions/inspect')?txReport
    :url.endsWith('psbt/inspect')?psbt
    :report
  ),{status:error&&!url.endsWith('capabilities')?422:200,headers:{'Content-Type':'application/json'}})))
})

afterEach(()=>{
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function openInspector(){
  window.location.hash=''
  render(<App/>)
  fireEvent.click(screen.getByRole('link',{name:/Open Inspector/}))
  await screen.findByLabelText('PSBT base64')
}

async function analyze(){
  fireEvent.change(screen.getByLabelText('PSBT base64'),{target:{value:'cHNidP8='}})
  fireEvent.click(screen.getByRole('button',{name:/Run Preflight|Analyze Transaction/}))
}

describe('product flows',()=>{
  it('renders the actual positioning, orbital visual, and public synthetic preview',()=>{
    render(<App/>)
    expect(screen.getByRole('heading',{name:'Bitcoin transaction security before signing.'})).toBeTruthy()
    expect(screen.getAllByText('Public synthetic example').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('The pre-sign verification boundary.')).toBeTruthy()
    expect(screen.getByText('Transaction context')).toBeTruthy()
    expect(screen.getByText('Inspect + verify')).toBeTruthy()
    expect(screen.getByText('Deterministic rules')).toBeTruthy()
    expect(screen.getByText('External signing step')).toBeTruthy()
    expect(screen.getByText('No probabilistic AI decides if a transaction is safe.')).toBeTruthy()
  })

  it.each([['PASS',pass],['REVIEW',review],['BLOCK',block]])('renders backend %s and separate coverage with actual facts',async(decision,result)=>{
    report=result
    await openInspector()
    await analyze()
    expect(await screen.findByRole('heading',{name:decision})).toBeTruthy()
    expect(screen.getByRole('heading',{name:'Not Evaluated'})).toBeTruthy()
    expect(screen.getByRole('heading',{name:'Partially Evaluated'})).toBeTruthy()
    expect(screen.getByRole('heading',{name:'Evaluated'})).toBeTruthy()
    expect(screen.getAllByText(result.inspection.unsigned_txid).length).toBeGreaterThan(0)
    expect(screen.getAllByText('No node context').length).toBeGreaterThan(0)
    expect(screen.getAllByText('p2wpkh').length).toBeGreaterThan(0)
  })

  it('uses public samples only on explicit selection and sends through API',async()=>{
    await openInspector()
    fireEvent.change(screen.getByLabelText('Public sample'),{target:{value:'review'}})
    fireEvent.click(screen.getByRole('button',{name:'Use sample'}))
    expect((screen.getByLabelText('PSBT base64') as HTMLTextAreaElement).value).toMatch(/^cHNidP/)
    expect(fetch).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button',{name:/Run Preflight|Analyze Transaction/}))
    await screen.findByRole('heading',{name:'PASS'})
  })

  it('displays mode-specific button labels',async()=>{
    await openInspector()
    // PSBT Preflight mode
    expect(screen.getByRole('button',{name:'Run Preflight'})).toBeTruthy()
    // PSBT Inspect mode
    fireEvent.change(screen.getByLabelText('Operation'),{target:{value:'inspect'}})
    expect(screen.getByRole('button',{name:'Inspect PSBT'})).toBeTruthy()
    // Raw Transaction mode
    fireEvent.click(screen.getByRole('tab',{name:/Raw Transaction/}))
    expect(screen.getByRole('button',{name:'Inspect Transaction'})).toBeTruthy()
    // Transaction ID mode
    fireEvent.click(screen.getByRole('tab',{name:/Transaction ID/}))
    expect(screen.getByRole('button',{name:'Lookup Transaction'})).toBeTruthy()
  })

  it('uploads a bounded text file',async()=>{
    await openInspector()
    const file=new File(['cHNidP8='],'public.b64',{type:'text/plain'})
    Object.defineProperty(file,'text',{value:async()=> 'cHNidP8='})
    fireEvent.change(screen.getByLabelText('Upload text file'),{target:{files:[file]}})
    await waitFor(()=>expect((screen.getByLabelText('PSBT base64') as HTMLTextAreaElement).value).toBe('cHNidP8='))
  })

  it('rejects an oversized upload before reading it',async()=>{
    await openInspector()
    const file=new File(['x'],'large.b64')
    Object.defineProperty(file,'size',{value:1048577})
    const read=vi.fn()
    Object.defineProperty(file,'text',{value:read})
    fireEvent.change(screen.getByLabelText('Upload text file'),{target:{files:[file]}})
    expect(await screen.findByRole('alert')).toHaveProperty('textContent',expect.stringContaining('1 MiB'))
    expect(read).not.toHaveBeenCalled()
  })

  it('renders safe API failure and allows retry',async()=>{
    error=true
    await openInspector()
    await analyze()
    expect(await screen.findByRole('alert')).toHaveProperty('textContent',expect.stringContaining('could not be inspected'))
    expect(screen.queryByText('NEVER ECHO THIS')).toBeNull()
    error=false
    fireEvent.click(screen.getByRole('button',{name:/Run Preflight|Analyze Transaction/}))
    expect(await screen.findByRole('heading',{name:'PASS'})).toBeTruthy()
  })

  it('supports inspection without policy and raw transaction facts',async()=>{
    await openInspector()
    fireEvent.change(screen.getByLabelText('Operation'),{target:{value:'inspect'}})
    fireEvent.change(screen.getByLabelText('PSBT base64'),{target:{value:'cHNidP8='}})
    fireEvent.click(screen.getByRole('button',{name:/Inspect PSBT|Run Preflight/}))
    await screen.findAllByText(psbt.unsigned_txid)
    expect(screen.queryByRole('heading',{name:'PASS'})).toBeNull()

    fireEvent.click(screen.getByRole('tab',{name:/Raw Transaction/}))
    fireEvent.change(screen.getByLabelText('Raw transaction hex'),{target:{value:'00'}})
    fireEvent.click(screen.getByRole('button',{name:/Inspect Transaction/}))
    expect((await screen.findAllByText(raw.txid)).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Unavailable').length).toBeGreaterThan(0)
  })

  it('shows the real policy registry with filtering',async()=>{
    render(<App/>)
    fireEvent.click(screen.getByRole('link',{name:'Policy rules'}))
    expect(await screen.findByText('TG017')).toBeTruthy()
    expect(screen.getByText('TG007')).toBeTruthy()
    expect(screen.getAllByText('Deferred').length).toBeGreaterThan(0)

    // Filter to Deferred rules (TG007 and TG008 in fixture)
    fireEvent.click(screen.getByRole('button',{name:/Deferred/}))
    expect(screen.getByText('TG007')).toBeTruthy()
    expect(screen.getByText('TG008')).toBeTruthy()
    expect(screen.queryByText('TG001')).toBeNull()

    // Filter to Critical rules
    fireEvent.click(screen.getByRole('button',{name:/Critical/}))
    expect(screen.getByText('TG001')).toBeTruthy()
    expect(screen.queryByText('TG007')).toBeNull()
  })

  it('copies and downloads only on request and clears input on start over',async()=>{
    const copy=vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator,'clipboard',{value:{writeText:copy},configurable:true})
    const create=vi.fn().mockReturnValue('blob:report')
    const revoke=vi.fn()
    URL.createObjectURL=create
    URL.revokeObjectURL=revoke
    vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{})

    await openInspector()
    await analyze()
    await screen.findByRole('heading',{name:'PASS'})
    expect(copy).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button',{name:'Copy JSON'}))
    await waitFor(()=>expect(copy).toHaveBeenCalledWith(JSON.stringify(pass,null,2)))

    fireEvent.click(screen.getByRole('button',{name:'Download JSON report'}))
    expect(create).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button',{name:'Inspect another transaction'}))
    expect((screen.getByLabelText('PSBT base64') as HTMLTextAreaElement).value).toBe('')
    expect(screen.queryByRole('heading',{name:'PASS'})).toBeNull()
  })

  it('escapes hostile server content and never persists sensitive input',async()=>{
    const storage=vi.spyOn(Storage.prototype,'setItem')
    const log=vi.spyOn(console,'log')
    const hostile='<img src=x onerror=alert(1)>'
    report={...review,policy:{...review.policy,findings:review.policy.findings.map(f=>({...f,title:hostile}))}}

    await openInspector()
    await analyze()
    await screen.findByText(hostile)
    expect(document.querySelector('img')).toBeNull()
    expect(storage).not.toHaveBeenCalled()
    expect(log).not.toHaveBeenCalled()
    expect(window.location.href).not.toContain('cHNidP')
  })

  it('ensures no signing, finalization, or broadcast UI exists',async()=>{
    render(<App/>)
    expect(screen.queryByRole('button',{name:/sign/i})).toBeNull()
    expect(screen.queryByRole('button',{name:/broadcast/i})).toBeNull()
    expect(screen.queryByRole('button',{name:/finalize/i})).toBeNull()
  })

  it('renders generic pending state while inspecting without fake progress claims',async()=>{
    let resolveRequest: (v: unknown) => void = () => {}
    const pendingPromise = new Promise(resolve => { resolveRequest = resolve })
    vi.stubGlobal('fetch',vi.fn(async(url:string)=>{
      if (url.endsWith('capabilities')){
        return new Response(JSON.stringify(caps),{status:200,headers:{'Content-Type':'application/json'}})
      }
      await pendingPromise
      return new Response(JSON.stringify(pass),{status:200,headers:{'Content-Type':'application/json'}})
    }))

    await openInspector()
    fireEvent.change(screen.getByLabelText('PSBT base64'),{target:{value:'cHNidP8='}})
    fireEvent.click(screen.getByRole('button',{name:/Run Preflight/}))

    expect(screen.getByText('Analyzing PSBT…')).toBeTruthy()
    expect(screen.getByText('Evaluating deterministic policy rules in memory via connected Rust API.')).toBeTruthy()

    resolveRequest(null)
    expect(await screen.findByRole('heading',{name:'PASS'})).toBeTruthy()
  })

  it('includes strict reduced-motion CSS rules',()=>{
    const proc = (globalThis as unknown as { process?: { getBuiltinModule?: (m: string) => { readFileSync: (p: string, enc: string) => string } } }).process
    const fs = proc?.getBuiltinModule?.('fs')
    const css = fs?.readFileSync('src/index.css','utf-8') ?? ''
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
    expect(css).toContain('animation-duration: 0.001s !important')
    expect(css).toContain('.analyzing-scanline')
    expect(css).toContain('.flow-pulse-inbound')
  })

  it('handles Transaction ID mode with validation and node availability guard',async()=>{
    await openInspector()
    fireEvent.click(screen.getByRole('tab',{name:/Transaction ID/}))

    // Node unavailable note should be visible and button disabled when caps.node_context_available is false
    expect(screen.getByText('TXID lookup requires a Bitcoin Core node configured on the TxSignX API.')).toBeTruthy()
    const submitBtn = screen.getByRole('button',{name:'Lookup Transaction'})
    expect(submitBtn.hasAttribute('disabled')).toBe(true)

    // Now re-open with node context available
    cleanup()
    currentCaps={...caps,node_context_available:true}
    await openInspector()
    fireEvent.click(screen.getByRole('tab',{name:/Transaction ID/}))
    expect(screen.queryByText('TXID lookup requires a Bitcoin Core node configured on the TxSignX API.')).toBeNull()

    // Validation on invalid TXID
    const txidInput = screen.getByLabelText('Transaction ID')
    fireEvent.change(txidInput,{target:{value:'not-a-valid-txid'}})
    fireEvent.click(screen.getByRole('button',{name:'Lookup Transaction'}))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent',expect.stringContaining('64-character hexadecimal transaction ID'))

    // Valid TXID submission
    const validTxid = '7b0553bb182f567b5797be982ec47094b8e21783ae41088ec3dc71c0800d1101'
    fireEvent.change(txidInput,{target:{value:validTxid}})
    fireEvent.click(screen.getByRole('button',{name:'Lookup Transaction'}))

    await waitFor(()=>expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/transactions/inspect'),
      expect.objectContaining({
        method:'POST',
        body:JSON.stringify({txid:validTxid})
      })
    ))
  })

  it('renders full Transaction Explorer report for confirmed TXID with chain context and prevouts',async()=>{
    currentCaps={...caps,node_context_available:true}
    txReport=txidConfirmed
    await openInspector()
    fireEvent.click(screen.getByRole('tab',{name:/Transaction ID/}))

    const validTxid = '7b0553bb182f567b5797be982ec47094b8e21783ae41088ec3dc71c0800d1101'
    fireEvent.change(screen.getByLabelText('Transaction ID'),{target:{value:validTxid}})
    fireEvent.click(screen.getByRole('button',{name:'Lookup Transaction'}))

    // Heading should be Transaction Explorer (not Preflight Decision)
    expect(await screen.findByRole('heading',{name:'Transaction Explorer'})).toBeTruthy()
    expect(screen.queryByRole('heading',{name:'PASS'})).toBeNull()
    expect(screen.queryByRole('heading',{name:'REVIEW'})).toBeNull()
    expect(screen.queryByRole('heading',{name:'BLOCK'})).toBeNull()

    // Chain Context Card
    expect(screen.getByText('Bitcoin Core Node Verification')).toBeTruthy()
    expect(screen.getByText('Confirmed (6 confirmations)')).toBeTruthy()
    expect(screen.getAllByText('regtest').length).toBeGreaterThan(0)
    expect(screen.getAllByText('0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b').length).toBeGreaterThan(0)

    // Fees and totals
    expect(screen.getAllByText('100,000 sats').length).toBeGreaterThan(0)
    expect(screen.getAllByText('80,000 sats').length).toBeGreaterThan(0)
    expect(screen.getAllByText('20,000 sats').length).toBeGreaterThan(0)
    expect(screen.getByText('180.18 sat/vB')).toBeTruthy()

    // Resolved Prevout
    expect(screen.getByText('Resolved Spent Prevout')).toBeTruthy()
    expect(screen.getAllByText('bcrt1qpd3xxxxpqqz7t3xxxxpqqz7t3xxxxpqqe72u7x').length).toBeGreaterThan(0)
    expect(screen.getAllByText('OP_0 OP_PUSHBYTES_20 0303030303030303030303030303030303030303').length).toBeGreaterThan(0)

    // Outputs
    expect(screen.getAllByText('bcrt1qqzzxxxxpqqz7t3xxxxpqqz7t3xxxxpqq6xvy0a').length).toBeGreaterThan(0)
  })

  it('renders mempool TXID inspection with mempool chain context',async()=>{
    currentCaps={...caps,node_context_available:true}
    txReport=txidMempool
    await openInspector()
    fireEvent.click(screen.getByRole('tab',{name:/Transaction ID/}))

    fireEvent.change(screen.getByLabelText('Transaction ID'),{target:{value:'8c0664cc2930678c6808cf093fd58105c9f32894bf52199fd4ed82d1911e2212'}})
    fireEvent.click(screen.getByRole('button',{name:'Lookup Transaction'}))

    expect(await screen.findByText('In Mempool (0 confirmations)')).toBeTruthy()
    expect(screen.getByText('Unconfirmed (mempool)')).toBeTruthy()
    expect(screen.getAllByText('testnet4').length).toBeGreaterThan(0)
  })

  it('supports raw transaction mode with network address derivation and script disassembly',async()=>{
    txReport=rawWithAddresses
    await openInspector()
    fireEvent.click(screen.getByRole('tab',{name:/Raw Transaction/}))

    // Network selector should be present with options
    const networkSelect = screen.getByLabelText(/Network for address derivation/)
    expect(networkSelect).toBeTruthy()
    expect(screen.getByText(/Raw transaction data does not encode Bitcoin network/)).toBeTruthy()

    // Select bitcoin network
    fireEvent.change(networkSelect,{target:{value:'bitcoin'}})
    fireEvent.change(screen.getByLabelText('Raw transaction hex'),{target:{value:'020000000101...'}})
    fireEvent.click(screen.getByRole('button',{name:'Inspect Transaction'}))

    await waitFor(()=>expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/transactions/inspect'),
      expect.objectContaining({
        method:'POST',
        body:JSON.stringify({raw_transaction:'020000000101...',network:'bitcoin'})
      })
    ))

    // Header and address verification
    expect(await screen.findByRole('heading',{name:'Transaction Explorer'})).toBeTruthy()
    expect(screen.getAllByText('14975Ypk5124x22222222222222227d88M').length).toBeGreaterThan(0)
    expect(screen.getAllByText('bc1qwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwh7823e').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/OP_DUP OP_HASH160/).length).toBeGreaterThan(0)
  })

  it('verifies zero node credential inputs and zero client storage in any mode',async()=>{
    const localGet = vi.spyOn(Storage.prototype,'getItem')
    const localSet = vi.spyOn(Storage.prototype,'setItem')
    await openInspector()

    // Check all modes
    for (const tabName of [/PSBT v0/, /Raw Transaction/, /Transaction ID/]) {
      fireEvent.click(screen.getByRole('tab',{name:tabName}))
      // No RPC credential inputs should exist
      const inputs = document.querySelectorAll('input')
      for (const input of inputs) {
        const name = (input.getAttribute('name') ?? '').toLowerCase()
        const placeholder = (input.getAttribute('placeholder') ?? '').toLowerCase()
        expect(name).not.toMatch(/rpc|password|credential|secret/)
        expect(placeholder).not.toMatch(/rpc|password|credential|secret/)
      }
    }

    expect(localSet).not.toHaveBeenCalled()
    expect(localGet).not.toHaveBeenCalled()
  })

  it('renders mode-specific scanning messages without policy mention in raw or txid mode',async()=>{
    let resolveRequest: (v: unknown) => void = () => {}
    const pendingPromise = new Promise(resolve => { resolveRequest = resolve })
    vi.stubGlobal('fetch',vi.fn(async(url:string)=>{
      if (url.endsWith('capabilities')){
        return new Response(JSON.stringify({...caps,node_context_available:true}),{status:200,headers:{'Content-Type':'application/json'}})
      }
      await pendingPromise
      return new Response(JSON.stringify(raw),{status:200,headers:{'Content-Type':'application/json'}})
    }))

    await openInspector()

    // Test Raw mode scanning messages
    fireEvent.click(screen.getByRole('tab',{name:/Raw Transaction/}))
    fireEvent.change(screen.getByLabelText('Raw transaction hex'),{target:{value:'0200000001...'}})
    fireEvent.click(screen.getByRole('button',{name:'Inspect Transaction'}))

    expect(screen.getByRole('heading',{name:'Inspecting transaction…'})).toBeTruthy()
    expect(screen.getByText('Decoding transaction structure and resolving chain context via connected Rust API.')).toBeTruthy()
    // Should NOT mention policy rules in raw mode
    expect(screen.queryByText(/Evaluating deterministic policy rules/)).toBeNull()

    resolveRequest(null)
    expect(await screen.findByRole('heading',{name:'Transaction Explorer'})).toBeTruthy()
  })
})
