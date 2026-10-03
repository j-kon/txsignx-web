// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react'
import App from './App'
import { ApiClient } from './lib/api/client'
import pass from './test/fixtures/pass.json'
import review from './test/fixtures/review.json'
import block from './test/fixtures/block.json'
import psbt from './test/fixtures/psbt.json'
import raw from './test/fixtures/raw.json'
import policies from './test/fixtures/policies.json'
import txidConfirmed from './test/fixtures/txid_confirmed.json'
import txidMempool from './test/fixtures/txid_mempool.json'
import rawWithAddresses from './test/fixtures/raw_with_addresses.json'
import { getAdaptiveTimeWindow, computeCollisionFreeLayout } from './features/liveStreamLayout'

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

const defaultSnapshot = {
  network: 'regtest',
  tip_height: 101,
  tip_hash: '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f',
  recent_blocks: [
    {
      height: 101,
      hash: '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f',
      tx_count: 5,
      weight: 4200,
      size: 1500,
      timestamp: 1700000000
    },
    {
      height: 100,
      hash: '000000000029d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce270',
      tx_count: 1,
      weight: 1200,
      size: 300,
      timestamp: 1699999400
    }
  ],
  mempool_tx_count: 2,
  mempool_size_bytes: 1240,
  latest_transactions: [
    {
      txid: '7b0553bb182f567b5797be982ec47094b8e21783ae41088ec3dc71c0800d1101',
      wtxid: '561d35cd60944685cbc9155bb5ea54de63aa4ec39c4ac3f2aa936f127cbeccd1',
      vsize: 140,
      weight: 560,
      fee_sats: 1000,
      fee_rate: 7.14,
      input_count: 1,
      output_count: 2,
      explicit_rbf: true,
      has_witness: true,
      first_seen_at: 1700000010,
      depends: []
    },
    {
      txid: '8c0664cc2930678c6808cf093fd58105c9f32894bf52199fd4ed82d1911e2212',
      vsize: 210,
      weight: 840,
      fee_sats: 2500,
      fee_rate: 11.9,
      input_count: 2,
      output_count: 2,
      explicit_rbf: false,
      has_witness: true,
      first_seen_at: 1700000020,
      depends: ['7b0553bb182f567b5797be982ec47094b8e21783ae41088ec3dc71c0800d1101']
    }
  ]
}

class MockWebSocket {
  static instances: MockWebSocket[] = []
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  readyState = 0
  url: string

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
    queueMicrotask(() => {
      this.readyState = 1
      this.onopen?.()
      if (Array.isArray(liveSnapshotData?.latest_transactions)) {
        liveSnapshotData.latest_transactions.forEach((tx: any) => {
          this.emit({ type: 'transaction_added', data: { ...tx, observed_at: Math.floor(Date.now() / 1000) } })
        })
      }
    })
  }

  send = vi.fn()
  close = vi.fn(() => {
    this.readyState = 3
    this.onclose?.()
  })

  emit(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) })
  }
}

const mockBlockDetails = {
  network: 'regtest',
  height: 101,
  hash: '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f',
  previous_block_hash: '000000000029d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce270',
  next_block_hash: null,
  merkle_root: '4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b',
  version: 536870912,
  timestamp: 1700000000,
  median_time: 1699999900,
  bits: '207fffff',
  difficulty: 1.0,
  tx_count: 3,
  weight: 4200,
  size: 1500,
  transactions: {
    items: [
      {
        index: 0,
        txid: '4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b',
        is_coinbase: true
      },
      {
        index: 1,
        txid: '7b0553bb182f567b5797be982ec47094b8e21783ae41088ec3dc71c0800d1101',
        is_coinbase: false
      },
      {
        index: 2,
        txid: '8c0664cc2930678c6808cf093fd58105c9f32894bf52199fd4ed82d1911e2212',
        is_coinbase: false
      }
    ],
    offset: 0,
    limit: 50,
    total: 3,
    has_more: false
  }
}

let currentCaps={...caps}
let liveSnapshotData = JSON.parse(JSON.stringify(defaultSnapshot))
let blockDetailsData = JSON.parse(JSON.stringify(mockBlockDetails))
let report:unknown=pass
let txReport:unknown=raw
let error=false

beforeEach(()=>{
  window.location.hash=''
  currentCaps={...caps}
  liveSnapshotData = JSON.parse(JSON.stringify(defaultSnapshot))
  blockDetailsData = JSON.parse(JSON.stringify(mockBlockDetails))
  report=pass
  txReport=raw
  error=false
  MockWebSocket.instances = []
  vi.stubGlobal('WebSocket', MockWebSocket)
  vi.stubGlobal('fetch',vi.fn(async (url:string)=>new Response(JSON.stringify(
    url.endsWith('capabilities')?currentCaps
    :url.endsWith('policies')?policies
    :url.endsWith('live/snapshot')?liveSnapshotData
    :url.endsWith('blocks/recent')?liveSnapshotData.recent_blocks
    :url.includes('/blocks/')?blockDetailsData
    :url.endsWith('mempool/summary')?{tx_count:liveSnapshotData.mempool_tx_count,size_bytes:liveSnapshotData.mempool_size_bytes}
    :error?{error:{code:'invalid_psbt',message:'NEVER ECHO THIS'}}
    :url.endsWith('transactions/inspect')?txReport
    :url.endsWith('psbt/inspect')?psbt
    :report
  ),{status:error&&!url.endsWith('capabilities')&&!url.endsWith('live/snapshot')?422:200,headers:{'Content-Type':'application/json'}})))
})

afterEach(()=>{
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function openInspector(){
  window.location.hash='#inspector'
  render(<App/>)
  await screen.findByLabelText('PSBT base64')
}

async function analyze(){
  fireEvent.change(screen.getByLabelText('PSBT base64'),{target:{value:'cHNidP8='}})
  fireEvent.click(screen.getByRole('button',{name:/Run Preflight|Analyze Transaction/}))
}

describe('product flows',()=>{
  it('renders the actual positioning, orbital visual, and public synthetic preview',()=>{
    window.location.hash='#about'
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
    fireEvent.click(screen.getByRole('link',{name:/Polic/}))
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

  it('visibly renders all capstone Transaction Explorer MVP fields in raw demo mode without network',async()=>{
    txReport=raw
    await openInspector()
    fireEvent.click(screen.getByRole('tab',{name:/Raw Transaction/}))

    // Use "Load Demo Transaction" button to load SegWit fixture
    const loadDemoBtn = screen.getByRole('button',{name:'Load Demo Transaction'})
    expect(loadDemoBtn).toBeTruthy()
    fireEvent.click(loadDemoBtn)

    // Verify textarea populated with SegWit raw hex
    const textarea = screen.getByLabelText('Raw transaction hex') as HTMLTextAreaElement
    expect(textarea.value).toMatch(/^020000000001/)

    // Inspect
    fireEvent.click(screen.getByRole('button',{name:'Inspect Transaction'}))

    // 1. Transaction Overview heading
    expect(await screen.findByRole('heading',{name:'Transaction Overview'})).toBeTruthy()

    // 2. wTXID prominently visible
    expect(screen.getAllByText('561d35cd60944685cbc9155bb5ea54de63aa4ec39c4ac3f2aa936f127cbeccd1').length).toBeGreaterThan(0)

    // 3. SegWit yes/no badge & stat
    expect(screen.getAllByText('SegWit: Yes').length).toBeGreaterThan(0)

    // 4. Explicit RBF yes/no
    expect(screen.getAllByText('Explicit RBF: Yes').length).toBeGreaterThan(0)

    // 5. Separate Size, Weight, and Virtual Size
    expect(screen.getAllByText('129 bytes').length).toBeGreaterThan(0)
    expect(screen.getAllByText('483 WU').length).toBeGreaterThan(0)
    expect(screen.getAllByText('121 vB').length).toBeGreaterThan(0)

    // 6. Decoded structural fields: version, locktime, inputs, outputs
    expect(screen.getAllByText('2').length).toBeGreaterThan(0)
    expect(screen.getAllByText('42').length).toBeGreaterThan(0)

    // 7. Previous outpoint & sequence
    expect(screen.getAllByText('1111111111111111111111111111111111111111111111111111111111111111:1').length).toBeGreaterThan(0)
    expect(screen.getAllByText('4294967293').length).toBeGreaterThan(0)

    // 8. Witness Stack content: index, byte size, hex
    expect(screen.getByText('Witness Stack')).toBeTruthy()
    expect(screen.getByText('Witness #0')).toBeTruthy()
    expect(screen.getAllByText('3 bytes').length).toBeGreaterThan(0)
    expect(screen.getAllByText('010203').length).toBeGreaterThan(0)
    expect(screen.getByText('Witness #1')).toBeTruthy()
    expect(screen.getAllByText('0 bytes').length).toBeGreaterThan(0)
    expect(screen.getByText('<empty item (0 bytes)>')).toBeTruthy()
    expect(screen.getByText('Witness #2')).toBeTruthy()
    expect(screen.getAllByText('2 bytes').length).toBeGreaterThan(0)
    expect(screen.getAllByText('abcd').length).toBeGreaterThan(0)

    // 9. Output values and script classifications
    expect(screen.getAllByText('100,000 sats').length).toBeGreaterThan(0)
    expect(screen.getAllByText('50,000 sats').length).toBeGreaterThan(0)
    expect(screen.getAllByText('p2pkh').length).toBeGreaterThan(0)
    expect(screen.getAllByText('p2wpkh').length).toBeGreaterThan(0)

    // 10. Explicit notices: unavailable raw fee & unencoded network
    expect(screen.getByText('Fee unavailable without resolved previous outputs.')).toBeTruthy()
    expect(screen.getAllByText('Raw transaction data does not encode Bitcoin network.').length).toBeGreaterThan(0)
  })

  it('visibly renders script disassembly, derived addresses, and opcode details with network selected',async()=>{
    txReport=rawWithAddresses
    await openInspector()
    fireEvent.click(screen.getByRole('tab',{name:/Raw Transaction/}))

    // Select bitcoin network
    fireEvent.change(screen.getByLabelText(/Network for address derivation/),{target:{value:'bitcoin'}})
    fireEvent.change(screen.getByLabelText('Raw transaction hex'),{target:{value:'0200000001...'}})
    fireEvent.click(screen.getByRole('button',{name:'Inspect Transaction'}))

    // Header verification
    expect(await screen.findByRole('heading',{name:'Transaction Explorer'})).toBeTruthy()

    // Verify ScriptSig disassembly
    expect(screen.getAllByText('OP_PUSHBYTES_1 51').length).toBeGreaterThan(0)

    // Verify ScriptPubKey disassembly
    expect(screen.getAllByText('OP_DUP OP_HASH160 OP_PUSHBYTES_20 2222222222222222222222222222222222222222 OP_EQUALVERIFY OP_CHECKSIG').length).toBeGreaterThan(0)
    expect(screen.getAllByText('OP_0 OP_PUSHBYTES_20 3333333333333333333333333333333333333333').length).toBeGreaterThan(0)

    // Verify Script Disassembly badges
    expect(screen.getAllByText('Script Disassembly').length).toBeGreaterThan(0)

    // Verify derived addresses rendered in output table
    expect(screen.getAllByText('14975Ypk5124x22222222222222227d88M').length).toBeGreaterThan(0)
    expect(screen.getAllByText('bc1qwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwh7823e').length).toBeGreaterThan(0)
  })

  it('visibly renders confirmed chain context with block hash, confirmations, fee, and fee rate',async()=>{
    currentCaps={...caps,node_context_available:true}
    txReport=txidConfirmed
    await openInspector()
    fireEvent.click(screen.getByRole('tab',{name:/Transaction ID/}))

    fireEvent.change(screen.getByLabelText('Transaction ID'),{target:{value:'7b0553bb182f567b5797be982ec47094b8e21783ae41088ec3dc71c0800d1101'}})
    fireEvent.click(screen.getByRole('button',{name:'Lookup Transaction'}))

    // Chain context status
    expect(await screen.findByText('Confirmed (6 confirmations)')).toBeTruthy()
    expect(screen.getAllByText('6').length).toBeGreaterThan(0)
    expect(screen.getAllByText('0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b').length).toBeGreaterThan(0)

    // Fee and fee rate
    expect(screen.getAllByText('20,000 sats').length).toBeGreaterThan(0)
    expect(screen.getByText('180.18 sat/vB')).toBeTruthy()
    expect(screen.getAllByText('100,000 sats').length).toBeGreaterThan(0)
    expect(screen.getAllByText('80,000 sats').length).toBeGreaterThan(0)

    // Resolved prevout
    expect(screen.getByText('Resolved Spent Prevout')).toBeTruthy()
    expect(screen.getAllByText('bcrt1qpd3xxxxpqqz7t3xxxxpqqz7t3xxxxpqqe72u7x').length).toBeGreaterThan(0)
  })

  it('visibly renders mempool status without inventing a block hash and retains fee metrics',async()=>{
    currentCaps={...caps,node_context_available:true}
    txReport=txidMempool
    await openInspector()
    fireEvent.click(screen.getByRole('tab',{name:/Transaction ID/}))

    fireEvent.change(screen.getByLabelText('Transaction ID'),{target:{value:'8c0664cc2930678c6808cf093fd58105c9f32894bf52199fd4ed82d1911e2212'}})
    fireEvent.click(screen.getByRole('button',{name:'Lookup Transaction'}))

    // Mempool status
    expect(await screen.findByText('In Mempool (0 confirmations)')).toBeTruthy()
    expect(screen.getByText('Unconfirmed (mempool)')).toBeTruthy()
    expect(screen.getAllByText('0').length).toBeGreaterThan(0)

    // Fee and fee rate still available in mempool
    expect(screen.getAllByText('5,000 sats').length).toBeGreaterThan(0)
    expect(screen.getByText('45.05 sat/vB')).toBeTruthy()
  })
})

describe('Live Chain Observability Interface', () => {
  beforeEach(() => {
    window.location.hash = '#live'
  })

  it('loads live snapshot directly from ApiClient', async () => {
    const api = new ApiClient('http://127.0.0.1:8080')
    const snap = await api.liveSnapshot()
    expect(snap.network).toBe('regtest')
    expect(snap.tip_height).toBe(101)
  })

  it('renders Live Chain under #live with stats, recent blocks, and mempool flow', async () => {
    window.location.hash = '#live'
    render(<App />)

    expect(screen.getByRole('heading', { name: 'Live Bitcoin Chain & Mempool' })).toBeTruthy()
    expect(screen.getByPlaceholderText(/Search transaction ID/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Inspect manually' })).toBeTruthy()

    expect(await screen.findByText('regtest')).toBeTruthy()
    expect(screen.getAllByText(/#101/).length).toBeGreaterThan(0)
    expect(screen.getByText(/\(1\.2\s*kB\)/i)).toBeTruthy()
    expect(screen.getAllByTitle('000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f').length).toBeGreaterThan(0)
  })

  it('renders recent blocks with height, short hash, count, weight, and timestamp/age', async () => {
    window.location.hash = '#live'
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Recent Blocks' })).toBeTruthy()
    expect(screen.getAllByText(/#101/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/#100/).length).toBeGreaterThan(0)
    expect(screen.getAllByText('5').length).toBeGreaterThan(0)
    expect(screen.getAllByText('1').length).toBeGreaterThan(0)
    expect(screen.getByText('4 kWU')).toBeTruthy()
  })

  it('renders mempool stats accurately', async () => {
    window.location.hash = '#live'
    render(<App />)

    expect(await screen.findByText(/\(1\.2\s*kB\)/i)).toBeTruthy()
    expect(screen.getAllByText('2').length).toBeGreaterThan(0)
  })

  it('renders live transaction nodes with encoding legend', async () => {
    window.location.hash = '#live'
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'TxSignX Live Flow' })).toBeTruthy()
    expect(screen.getByText(/Node width\/size = Virtual Size \(vB\)/)).toBeTruthy()
    expect(screen.getByText(/Amber outline = BIP 125 Explicit RBF/)).toBeTruthy()
    expect(screen.getByText(/SegWit witness data present/)).toBeTruthy()
    expect(screen.getByText(/Numeric fee rate/)).toBeTruthy()

    expect(await screen.findByText('7b055…1101')).toBeTruthy()
    expect(screen.getByText('8c066…2212')).toBeTruthy()
    expect(screen.getByText('140 vB')).toBeTruthy()
    expect(screen.getByText('7.1 s/vB')).toBeTruthy()
  })

  it('opens transaction preview side drawer upon clicking a live node and verifies values', async () => {
    window.location.hash = '#live'
    render(<App />)

    const txNode = await screen.findByText('7b055…1101')
    fireEvent.click(txNode)

    expect(await screen.findByRole('dialog', { name: 'Transaction Preview' })).toBeTruthy()
    expect(screen.getByText('7b0553bb182f567b5797be982ec47094b8e21783ae41088ec3dc71c0800d1101')).toBeTruthy()
    expect(screen.getByText('In Mempool (0 confirmations)')).toBeTruthy()
    expect(screen.getAllByText('140 vB').length).toBeGreaterThan(0)
    expect(screen.getByText('560 WU')).toBeTruthy()
    expect(screen.getByText('1,000 sats')).toBeTruthy()
    expect(screen.getAllByText('7.1 sat/vB').length).toBeGreaterThan(0)
    expect(screen.getAllByText('1').length).toBeGreaterThan(0)
    expect(screen.getAllByText('2').length).toBeGreaterThan(0)
    expect(screen.getByText('Explicit RBF Enabled')).toBeTruthy()
    expect(screen.getByText('Yes (Witness Present)')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Close preview drawer' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('clicks Explore Transaction from side drawer and opens Transaction Explorer report', async () => {
    currentCaps = { ...caps, node_context_available: true }
    txReport = txidConfirmed
    window.location.hash = '#live'
    render(<App />)

    const txNode = await screen.findByText('7b055…1101')
    fireEvent.click(txNode)

    const exploreBtn = await screen.findByRole('button', { name: /Explore Transaction/ })
    fireEvent.click(exploreBtn)

    expect(await screen.findByRole('heading', { name: 'Transaction Explorer' })).toBeTruthy()
    expect(screen.getByText('Bitcoin Core Node Verification')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Back to Live Chain/ }))
    expect(await screen.findByRole('heading', { name: 'Live Bitcoin Chain & Mempool' })).toBeTruthy()
  })

  it('handles live transaction events via WebSocket stream', async () => {
    window.location.hash = '#live'
    render(<App />)

    await screen.findByText('7b055…1101')
    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1]
    expect(ws).toBeDefined()

    ws.emit({
      type: 'transaction_added',
      data: {
        txid: '9999999999999999999999999999999999999999999999999999999999999999',
        vsize: 180,
        weight: 720,
        fee_sats: 1800,
        fee_rate: 10.0,
        input_count: 1,
        output_count: 2,
        explicit_rbf: false,
        has_witness: true
      }
    })

    expect(await screen.findByText('99999…9999')).toBeTruthy()
    expect(screen.getByText('180 vB')).toBeTruthy()
    expect(screen.getByText('10.0 s/vB')).toBeTruthy()
  })

  it('handles live block connected events via WebSocket stream', async () => {
    window.location.hash = '#live'
    render(<App />)

    await screen.findAllByText(/#101/)
    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1]
    expect(ws).toBeDefined()

    ws.emit({
      type: 'block_connected',
      data: {
        height: 102,
        hash: '000000000039d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce271',
        tx_count: 12,
        weight: 9500,
        size: 3200,
        timestamp: 1700001000
      }
    })

    const blocks102 = await screen.findAllByText(/#102/)
    expect(blocks102.length).toBeGreaterThan(0)
  })

  it('supports universal search bar direct lookup into Transaction Explorer', async () => {
    currentCaps = { ...caps, node_context_available: true }
    txReport = txidConfirmed
    window.location.hash = '#live'
    render(<App />)

    const searchInput = screen.getByPlaceholderText(/Search transaction ID/)
    const validTxid = '7b0553bb182f567b5797be982ec47094b8e21783ae41088ec3dc71c0800d1101'
    fireEvent.change(searchInput, { target: { value: validTxid } })
    fireEvent.click(screen.getByRole('button', { name: /Inspect TXID/ }))

    expect(await screen.findByRole('heading', { name: 'Transaction Explorer' })).toBeTruthy()
    expect(screen.getByText('Bitcoin Core Node Verification')).toBeTruthy()
  })

  it('navigates to manual Inspector via Inspect manually button', async () => {
    window.location.hash = '#live'
    render(<App />)

    const manualBtn = await screen.findByRole('button', { name: 'Inspect manually' })
    fireEvent.click(manualBtn)

    await screen.findByLabelText('PSBT base64')
    expect(screen.getByRole('tab', { name: /PSBT v0/ })).toBeTruthy()
    expect(screen.getByRole('tab', { name: /Raw Transaction/ })).toBeTruthy()
    expect(screen.getByRole('tab', { name: /Transaction ID/ })).toBeTruthy()
  })

  it('renders polite empty mempool state when no transactions exist', async () => {
    liveSnapshotData = {
      ...defaultSnapshot,
      mempool_tx_count: 0,
      mempool_size_bytes: 0,
      latest_transactions: []
    }
    window.location.hash = '#live'
    render(<App />)

    expect(await screen.findByText('Mempool is currently empty on this node')).toBeTruthy()
    expect(screen.getByText(/Listening for new unconfirmed transactions/)).toBeTruthy()
  })

  it('renders safe node unavailable state when node is offline', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('capabilities')) return new Response(JSON.stringify(caps), { status: 200, headers: { 'Content-Type': 'application/json' } })
      if (url.endsWith('live/snapshot')) return new Response(JSON.stringify({ error: { code: 'node_unavailable', message: 'RPC down' } }), { status: 503, headers: { 'Content-Type': 'application/json' } })
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
    }))
    window.location.hash = '#live'
    render(<App />)

    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByText(/Bitcoin Core Node Observation Notice/)).toBeTruthy()
    expect(screen.getByText(/The configured node is unavailable/)).toBeTruthy()
  })

  it('toggles display mode between Live Flow and Transaction Flow Graph', async () => {
    window.location.hash = '#live'
    render(<App />)

    await screen.findByRole('heading', { name: 'TxSignX Live Flow' })
    const graphToggle = screen.getByRole('radio', { name: /Transaction Flow Graph/ })
    fireEvent.click(graphToggle)

    expect(await screen.findByText(/Bounded in-mempool relationship graph/)).toBeTruthy()

    const flowToggle = screen.getByRole('radio', { name: 'Live Flow' })
    fireEvent.click(flowToggle)
    expect(await screen.findByText('Encoding Legend:')).toBeTruthy()
  })

  it('updates stream status when WebSocket disconnects', async () => {
    window.location.hash = '#live'
    render(<App />)

    await screen.findByText(/Live \(streaming\)/)
    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1]
    expect(ws).toBeDefined()

    ws.close()
    expect(await screen.findByText('Reconnecting…')).toBeTruthy()
  })

  it('preserves reduced motion styles for live flow elements', () => {
    const proc = (globalThis as unknown as { process?: { getBuiltinModule?: (m: string) => { readFileSync: (p: string, enc: string) => string } } }).process
    const fs = proc?.getBuiltinModule?.('fs')
    const css = fs?.readFileSync('src/index.css', 'utf-8') ?? ''
    expect(css).toContain('.flow-node')
    expect(css).toContain('.flow-pulse-inbound')
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
  })

  it('renders "—" and not "regtest" when network is absent or empty', async () => {
    liveSnapshotData = {
      ...defaultSnapshot,
      network: '',
    }
    window.location.hash = '#live'
    render(<App />)

    const networkCard = await screen.findByLabelText('Bitcoin network status')
    expect(networkCard.textContent).toContain('—')
    expect(networkCard.textContent).not.toContain('regtest')
  })

  it('distinguishes unavailable mempool from 0 transactions', async () => {
    liveSnapshotData = {
      ...defaultSnapshot,
      mempool: null,
      mempool_tx_count: null,
      mempool_size_bytes: null,
      latest_transactions: null,
    }
    window.location.hash = '#live'
    render(<App />)

    expect(await screen.findByText('Unavailable')).toBeTruthy()
    expect(await screen.findByText('Mempool transaction data unavailable')).toBeTruthy()
    expect(screen.queryByText('Mempool is currently empty on this node')).toBeNull()
  })

  it('renders "Unavailable" for missing structural facts in preview drawer', async () => {
    liveSnapshotData = {
      ...defaultSnapshot,
      latest_transactions: [
        {
          txid: '1111111111111111111111111111111111111111111111111111111111111111',
          vsize: 200,
          weight: 800,
          fee_sats: 2000,
          fee_rate: 10.0,
          mempool_replaceable: true,
        }
      ]
    }
    window.location.hash = '#live'
    render(<App />)

    const txCard = await screen.findByText('11111…1111')
    fireEvent.click(txCard)

    expect(await screen.findByRole('heading', { name: 'Transaction Preview' })).toBeTruthy()
    const unavailableStats = screen.getAllByText('Unavailable')
    expect(unavailableStats.length).toBeGreaterThanOrEqual(3)
    expect(screen.getByText('Mempool Replaceability (Node Policy)')).toBeTruthy()
    expect(screen.getByText('Yes (Mempool Policy)')).toBeTruthy()
  })

  it('safely ignores malformed or unknown WebSocket messages without crashing', async () => {
    window.location.hash = '#live'
    render(<App />)

    await screen.findByText('7b055…1101')
    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1]
    expect(ws).toBeDefined()

    ws.onmessage?.({ data: 'not valid json {{{' })
    ws.emit({ type: 'future_unsupported_event', data: { foo: 'bar' } })
    ws.emit({ type: 'transaction_added', data: { corrupt: true } })

    expect(screen.getByText('7b055…1101')).toBeTruthy()
  })

  it('updates mempool statistics authoritatively on mempool_updated event', async () => {
    window.location.hash = '#live'
    render(<App />)

    await screen.findByText('7b055…1101')
    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1]
    expect(ws).toBeDefined()

    ws.emit({
      type: 'mempool_updated',
      data: {
        tx_count: 88,
        size_bytes: 45000,
        usage_bytes: 90000,
        total_fee_sats: 150000,
      }
    })

    expect(await screen.findByText(/88/)).toBeTruthy()
    expect(screen.getByText(/\(45.0 kB\)/)).toBeTruthy()
  })

  it('removes transaction and tracks confirmation on transaction_confirmed event', async () => {
    window.location.hash = '#live'
    render(<App />)

    await screen.findByText('7b055…1101')
    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1]
    expect(ws).toBeDefined()

    ws.emit({
      type: 'transaction_confirmed',
      data: {
        txid: '7b0553bb182f567b5797be982ec47094b8e21783ae41088ec3dc71c0800d1101',
        block_hash: '000000000039d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce271',
        block_height: 102,
      }
    })

    await waitFor(() => {
      expect(screen.queryByText('7b055…1101')).toBeNull()
    })
    // Other mempool transaction remains
    expect(screen.getByText('8c066…2212')).toBeTruthy()
  })

  it('maintains matching coordinates between DAG node cards and SVG paths in graph mode', async () => {
    window.location.hash = '#live'
    render(<App />)

    await screen.findByRole('heading', { name: 'TxSignX Live Flow' })
    const graphToggle = screen.getByRole('radio', { name: /Transaction Flow Graph/ })
    fireEvent.click(graphToggle)

    await screen.findByRole('region', { name: 'Transaction Flow Graph' })
    const svgLine = document.querySelector('.graph-link-line')
    expect(svgLine).not.toBeNull()
    expect(svgLine?.getAttribute('x1')).toBe('240')
    expect(svgLine?.getAttribute('y1')).toBe('64')
    expect(svgLine?.getAttribute('x2')).toBe('360')
    expect(svgLine?.getAttribute('y2')).toBe('64')
  })

  describe('Live Chain Exploration & Visual Upgrades (Phase 5)', () => {
    it('Recent Block card is keyboard and click interactive', async () => {
      window.location.hash = '#live'
      render(<App />)

      const blockBtn = await screen.findByRole('button', { name: /Explore block #101/i })
      expect(blockBtn).toBeTruthy()
      expect(blockBtn.getAttribute('aria-haspopup')).toBe('dialog')

      // Click to open drawer
      fireEvent.click(blockBtn)

      const drawer = await screen.findByRole('dialog', { name: /Block #101/i })
      expect(drawer).toBeTruthy()
    })

    it('renders authoritative block details and secondary blockchain facts in drawer', async () => {
      window.location.hash = '#live'
      render(<App />)

      const blockBtn = await screen.findByRole('button', { name: /Explore block #101/i })
      fireEvent.click(blockBtn)

      await screen.findByRole('dialog', { name: /Block #101/i })

      // Primary stats
      expect(screen.getByText('Height')).toBeTruthy()
      expect(screen.getAllByText('#101').length).toBeGreaterThan(0)
      expect(screen.getByText('4,200 WU')).toBeTruthy()
      expect(screen.getByText('1,500 B')).toBeTruthy()

      // Secondary blockchain facts
      expect(screen.getByText('Merkle Root')).toBeTruthy()
      expect(screen.getByText('Previous Block')).toBeTruthy()
      expect(screen.getByText('Version')).toBeTruthy()
      expect(screen.getByText('Bits')).toBeTruthy()
      expect(screen.getByText('Median Time')).toBeTruthy()
      expect(screen.getByText('Difficulty')).toBeTruthy()
    })

    it('renders paginated transaction list with coinbase badge identification', async () => {
      window.location.hash = '#live'
      render(<App />)

      const blockBtn = await screen.findByRole('button', { name: /Explore block #101/i })
      fireEvent.click(blockBtn)

      await screen.findByRole('dialog', { name: /Block #101/i })

      // Transactions section
      expect(await screen.findByText('Transactions in Block (3)')).toBeTruthy()

      // Coinbase badge on index 0
      const coinbaseBadges = screen.getAllByText('Coinbase')
      expect(coinbaseBadges.length).toBe(1)

      // Transaction items rendered
      expect(screen.getAllByText(/4a5e1e/).length).toBeGreaterThan(0)
      expect(screen.getByText(/7b0553/)).toBeTruthy()
      expect(screen.getByText(/8c0664/)).toBeTruthy()
    })

    it('supports pagination via Load More transactions in block drawer', async () => {
      // Setup mock data with has_more: true
      blockDetailsData = {
        ...mockBlockDetails,
        transactions: {
          items: [
            { index: 0, txid: '4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b', is_coinbase: true },
          ],
          offset: 0,
          limit: 1,
          total: 2,
          has_more: true,
        },
      }

      window.location.hash = '#live'
      render(<App />)

      const blockBtn = await screen.findByRole('button', { name: /Explore block #101/i })
      fireEvent.click(blockBtn)

      await screen.findByRole('dialog', { name: /Block #101/i })

      const loadMoreBtn = await screen.findByRole('button', { name: /Load more transactions/i })
      expect(loadMoreBtn).toBeTruthy()

      // Update mock for next page
      blockDetailsData = {
        ...mockBlockDetails,
        transactions: {
          items: [
            { index: 1, txid: '7b0553bb182f567b5797be982ec47094b8e21783ae41088ec3dc71c0800d1101', is_coinbase: false },
          ],
          offset: 1,
          limit: 1,
          total: 2,
          has_more: false,
        },
      }

      fireEvent.click(loadMoreBtn)

      await waitFor(() => {
        expect(screen.getByText(/7b0553/)).toBeTruthy()
      })
    })

    it('clicking transaction in block drawer opens Explorer with contextual back path', async () => {
      txReport = txidConfirmed
      window.location.hash = '#live'
      render(<App />)

      const blockBtn = await screen.findByRole('button', { name: /Explore block #101/i })
      fireEvent.click(blockBtn)

      await screen.findByRole('dialog', { name: /Block #101/i })

      const exploreLinks = screen.getAllByRole('button', { name: /Explore Transaction/i })
      expect(exploreLinks.length).toBeGreaterThan(0)
      fireEvent.click(exploreLinks[0])

      // Should open Transaction Explorer report
      await screen.findAllByText('Transaction Explorer')
      const backToBlockBtn = screen.getByRole('button', { name: /← Back to Block #101/i })
      const backToLiveBtn = screen.getByRole('button', { name: /← Back to Live Chain/i })
      expect(backToBlockBtn).toBeTruthy()
      expect(backToLiveBtn).toBeTruthy()

      // Clicking Back to Block returns to block drawer
      fireEvent.click(backToBlockBtn)
      expect(await screen.findByRole('dialog', { name: /Block #101/i })).toBeTruthy()

      // Closing drawer returns to Live Chain
      const closeBtn = screen.getByRole('button', { name: /Close block details/i })
      fireEvent.click(closeBtn)
      expect(screen.queryByRole('dialog', { name: /Block #101/i })).toBeNull()
    })

    it('closes block drawer on Escape key and restores focus', async () => {
      window.location.hash = '#live'
      render(<App />)

      const blockBtn = await screen.findByRole('button', { name: /Explore block #101/i })
      blockBtn.focus()
      fireEvent.click(blockBtn)

      await screen.findByRole('dialog', { name: /Block #101/i })

      // Press Escape
      fireEvent.keyDown(window, { key: 'Escape' })

      await waitFor(() => {
        expect(screen.queryByRole('dialog', { name: /Block #101/i })).toBeNull()
      })
      expect(document.activeElement).toBe(blockBtn)
    })

    it('animates new block into chain tip on block_connected event', async () => {
      window.location.hash = '#live'
      render(<App />)

      await screen.findAllByText('#101')
      const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1]
      expect(ws).toBeDefined()

      // Broadcast block_connected
      ws.emit({
        type: 'block_connected',
        data: {
          height: 102,
          hash: '000000000039d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce271',
          tx_count: 8,
          weight: 7500,
          size: 2100,
          timestamp: 1700000600,
        },
      })

      // Chain rail displays #102 as TIP
      expect((await screen.findAllByText('#102')).length).toBeGreaterThan(0)
      const newCard = document.querySelector('.chain-block-card.tip-card')
      expect(newCard).not.toBeNull()
      expect(newCard?.textContent).toContain('#102')
    })

    it('positions live stream node along the time axis using first_seen_at', async () => {
      window.location.hash = '#live'
      render(<App />)

      await screen.findByText('7b055…1101')
      const streamNodes = document.querySelectorAll('.stream-tx-node')
      expect(streamNodes.length).toBeGreaterThan(0)
      const firstNode = streamNodes[0] as HTMLElement
      // Verify style has a calculated left position percentage
      expect(firstNode.style.left).toMatch(/%$/)
    })

    it('handles transaction_added event at the NOW edge with pulse', async () => {
      window.location.hash = '#live'
      render(<App />)

      await screen.findByText('7b055…1101')
      const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1]
      expect(ws).toBeDefined()

      ws.emit({
        type: 'transaction_added',
        data: {
          txid: '9999999999999999999999999999999999999999999999999999999999999999',
          wtxid: '8888888888888888888888888888888888888888888888888888888888888888',
          vsize: 180,
          weight: 720,
          fee_sats: 1800,
          fee_rate: 10.0,
          input_count: 1,
          output_count: 2,
          explicit_rbf: true,
          has_witness: true,
          first_seen_at: Math.floor(Date.now() / 1000),
          depends: [],
        },
      })

      expect(await screen.findByText('99999…9999')).toBeTruthy()
      const newNode = document.querySelector('[data-txid="9999999999999999999999999999999999999999999999999999999999999999"]')
      expect(newNode?.classList.contains('flow-pulse-inbound')).toBe(true)
    })

    it('handles transaction_removed event neutrally', async () => {
      window.location.hash = '#live'
      render(<App />)

      await screen.findByText('7b055…1101')
      const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1]
      expect(ws).toBeDefined()

      ws.emit({
        type: 'transaction_removed',
        data: {
          txid: '7b0553bb182f567b5797be982ec47094b8e21783ae41088ec3dc71c0800d1101',
          reason: 'replaced',
        },
      })

      await waitFor(() => {
        expect(screen.queryByText('7b055…1101')).toBeNull()
      })
      expect(screen.getByText('8c066…2212')).toBeTruthy()
    })

    it('copies TXID in preview drawer and shows Copied feedback', async () => {
      const writeTextMock = vi.fn().mockResolvedValue(undefined)
      vi.stubGlobal('navigator', {
        ...navigator,
        clipboard: { writeText: writeTextMock },
      })

      window.location.hash = '#live'
      render(<App />)

      const node = await screen.findByText('7b055…1101')
      fireEvent.click(node)

      await screen.findByRole('dialog', { name: /Transaction Preview/i })

      const copyBtn = screen.getByRole('button', { name: /Copy TXID/i })
      fireEvent.click(copyBtn)

      await waitFor(() => {
        expect(writeTextMock).toHaveBeenCalledWith('7b0553bb182f567b5797be982ec47094b8e21783ae41088ec3dc71c0800d1101')
      })
      expect(copyBtn.textContent).toContain('Copied')
    })

    it('verifies CSS contains strict responsive and reduced-motion rules', () => {
      const proc = (globalThis as unknown as { process?: { getBuiltinModule?: (m: string) => { readFileSync: (p: string, enc: string) => string } } }).process
      const fs = proc?.getBuiltinModule?.('fs')
      const css = fs?.readFileSync('src/index.css', 'utf-8') ?? ''

      // Reduced motion rules
      expect(css).toContain('@media (prefers-reduced-motion: reduce)')
      expect(css).toContain('.stream-tx-node')
      expect(css).toContain('.chain-block-card')
      expect(css).toContain('.dag-edge-animated')

      // Responsive drawer rules
      expect(css).toContain('@media (max-width: 768px)')
      expect(css).toContain('.live-chain-drawer')
      expect(css).toContain('width: 100%')

      // Side drawer fixed viewport overlay rules
      expect(css).toContain(':not(.drawer-overlay)')
      expect(css).toContain('.drawer-overlay')
      expect(css).toContain('position: fixed')
      expect(css).toContain('justify-content: flex-end')
    })

    it('renders "—" or "Unavailable" for absent blockchain facts without fabricating values', async () => {
      blockDetailsData = {
        ...mockBlockDetails,
        median_time: null,
        bits: null,
        difficulty: null,
      }

      window.location.hash = '#live'
      render(<App />)

      const blockBtn = await screen.findByRole('button', { name: /Explore block #101/i })
      fireEvent.click(blockBtn)

      await screen.findByRole('dialog', { name: /Block #101/i })

      // Confirm missing facts render "—"
      const dashes = screen.getAllByText('—')
      expect(dashes.length).toBeGreaterThanOrEqual(3)
    })

    describe('Live Chain visual stabilization & regression fixes', () => {
      it('transaction age 20 sec appears near NOW', () => {
        const now = 1700000100
        const tx = {
          txid: 'aaaa111122223333444455556666777788889999aaaabbbbccccddddeeeeffff',
          vsize: 140,
          weight: 560,
          first_seen_at: now - 20,
        }
        const timeWin = getAdaptiveTimeWindow(20)
        expect(timeWin.windowSeconds).toBe(60)
        const layout = computeCollisionFreeLayout([tx as any], timeWin.windowSeconds, now)
        const placed = layout.get(tx.txid)
        expect(placed).toBeDefined()
        // In 6%..92% coordinate system, age 20s progress is 0.33, placing leftPercent around 63.3% (> 55%)
        expect(placed!.leftPercent).toBeGreaterThan(55)
        expect(placed!.leftPercent).toBeLessThanOrEqual(92)
      })

      it('transaction age 90 sec does NOT clamp into another 90-sec tx', () => {
        const now = 1700000500
        const txA = {
          txid: '1111111111111111111111111111111111111111111111111111111111111111',
          vsize: 140,
          weight: 560,
          first_seen_at: now - 90,
        }
        const txB = {
          txid: '2222222222222222222222222222222222222222222222222222222222222222',
          vsize: 140,
          weight: 560,
          first_seen_at: now - 90,
        }
        // Adaptive window expands to 300s (5m) instead of clamping to 60s
        const timeWin = getAdaptiveTimeWindow(90)
        expect(timeWin.windowSeconds).toBe(300)
        const layout = computeCollisionFreeLayout([txA as any, txB as any], timeWin.windowSeconds, now)
        const placedA = layout.get(txA.txid)!
        const placedB = layout.get(txB.txid)!
        // Neither is clamped to the left boundary
        expect(placedA.leftPercent).toBeGreaterThan(50)
        expect(placedB.leftPercent).toBeGreaterThan(50)
        // Deterministic collision avoidance places them in distinct vertical lanes
        expect(placedA.lane).not.toBe(placedB.lane)
        expect(placedA.topPercent).not.toBe(placedB.topPercent)
      })

      it('transactions older than 60 sec remain individually visible', () => {
        const now = 1700001000
        const txs = [
          { txid: '1111111111111111111111111111111111111111111111111111111111111111', vsize: 140, first_seen_at: now - 80 },
          { txid: '2222222222222222222222222222222222222222222222222222222222222222', vsize: 140, first_seen_at: now - 150 },
          { txid: '3333333333333333333333333333333333333333333333333333333333333333', vsize: 140, first_seen_at: now - 220 },
        ]
        const timeWin = getAdaptiveTimeWindow(220)
        expect(timeWin.windowSeconds).toBe(300)
        const layout = computeCollisionFreeLayout(txs as any, timeWin.windowSeconds, now)
        const positions = txs.map((t) => layout.get(t.txid)!)
        // Monotonic recency ordering: newest has highest leftPercent, oldest has lowest
        expect(positions[0].leftPercent).toBeGreaterThan(positions[1].leftPercent)
        expect(positions[1].leftPercent).toBeGreaterThan(positions[2].leftPercent)
        // Oldest is still well within visible area, not clamped to 4%
        expect(positions[2].leftPercent).toBeGreaterThan(15)
      })

      it('two transactions with same first_seen_at do not overlap', () => {
        const now = 1700000050
        const tx1 = { txid: 'aaaa111111111111111111111111111111111111111111111111111111111111', vsize: 140, first_seen_at: now - 15 }
        const tx2 = { txid: 'bbbb222222222222222222222222222222222222222222222222222222222222', vsize: 140, first_seen_at: now - 15 }
        const layout = computeCollisionFreeLayout([tx1 as any, tx2 as any], 60, now)
        const p1 = layout.get(tx1.txid)!
        const p2 = layout.get(tx2.txid)!
        expect(Math.abs(p1.topPercent - p2.topPercent)).toBeGreaterThanOrEqual(16)
      })

      it('five same-age transactions allocate separate lanes/overflow safely', () => {
        const now = 1700000050
        const txs = [1, 2, 3, 4, 5].map((i) => ({
          txid: `${i}`.repeat(64),
          vsize: 140,
          first_seen_at: now - 20,
        }))
        const layout = computeCollisionFreeLayout(txs as any, 60, now)
        const lanes = txs.map((t) => layout.get(t.txid)!.lane)
        const uniqueLanes = new Set(lanes)
        expect(uniqueLanes.size).toBe(5)
      })

      it('transaction node text does not contain oversized multi-line content', async () => {
        window.location.hash = '#live'
        render(<App />)
        const node = await screen.findByText('7b055…1101')
        const button = node.closest('.stream-tx-node') as HTMLElement
        expect(button).toBeTruthy()
        const innerOrb = button.querySelector('.node-orb-inner')
        expect(innerOrb).toBeTruthy()
        // Inner orb contains ONLY numeric vsize + vB
        expect(innerOrb?.textContent?.trim()).toMatch(/^\d+\s*vB$/)
      })

      it('tooltip contains TXID/vsize/fee rate', async () => {
        window.location.hash = '#live'
        render(<App />)
        const node = await screen.findByText('7b055…1101')
        const button = node.closest('.stream-tx-node') as HTMLElement
        expect(button).toBeTruthy()
        const tooltip = button.querySelector('.node-floating-tooltip')
        expect(tooltip).toBeTruthy()
        expect(tooltip?.textContent).toContain('TXID:')
        expect(tooltip?.textContent).toContain('7b055…1101')
        expect(tooltip?.textContent).toContain('140 vB')
        expect(tooltip?.textContent).toContain('sat/vB')
      })

      it('current tip is targeted for initial scroll', async () => {
        const scrollMock = vi.fn()
        Element.prototype.scrollIntoView = scrollMock
        window.location.hash = '#live'
        render(<App />)
        const tipCard = await screen.findByRole('button', { name: /Explore block #101/i })
        await waitFor(() => {
          expect(scrollMock).toHaveBeenCalled()
        })
        expect(tipCard.getAttribute('data-tip')).toBe('true')
        expect(scrollMock.mock.instances).toContain(tipCard)
      })

      it('block_connected targets new tip', async () => {
        const scrollMock = vi.fn()
        Element.prototype.scrollIntoView = scrollMock
        window.location.hash = '#live'
        render(<App />)
        await screen.findByRole('button', { name: /Explore block #101/i })
        scrollMock.mockClear()

        const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1]
        ws.emit({
          type: 'block_connected',
          data: {
            height: 102,
            hash: '000000000039d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce271',
            tx_count: 8,
            weight: 6000,
            size: 2000,
            timestamp: 1700000600,
          },
        })

        const newTipCard = await screen.findByRole('button', { name: /Explore block #102/i })
        await waitFor(() => {
          expect(scrollMock).toHaveBeenCalled()
        })
        expect(newTipCard.getAttribute('data-tip')).toBe('true')
      })

      it('manual historical scroll is not repeatedly overridden', async () => {
        const scrollMock = vi.fn()
        Element.prototype.scrollIntoView = scrollMock
        window.location.hash = '#live'
        const { container } = render(<App />)
        await screen.findByRole('button', { name: /Explore block #101/i })
        await waitFor(() => expect(scrollMock).toHaveBeenCalled())
        scrollMock.mockClear()

        // Wait for initial auto-scroll flag to reset
        await new Promise((r) => setTimeout(r, 70))

        const rail = container.querySelector('.chain-rail-container') as HTMLElement
        expect(rail).toBeTruthy()

        // Simulate user scrolling left into historical view
        Object.defineProperty(rail, 'scrollWidth', { value: 1200, configurable: true })
        Object.defineProperty(rail, 'clientWidth', { value: 600, configurable: true })
        Object.defineProperty(rail, 'scrollLeft', { value: 100, configurable: true })
        fireEvent.scroll(rail)

        const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1]
        ws.emit({
          type: 'block_connected',
          data: {
            height: 103,
            hash: '000000000049d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce272',
            tx_count: 2,
            weight: 1500,
            size: 500,
            timestamp: 1700001200,
          },
        })

        await screen.findByRole('button', { name: /Explore block #103/i })
        await new Promise((r) => setTimeout(r, 100))
        expect(scrollMock).not.toHaveBeenCalled()
      })

      it('reduced-motion auto-scroll uses non-animated behavior', async () => {
        const scrollMock = vi.fn()
        Element.prototype.scrollIntoView = scrollMock

        const originalMatchMedia = window.matchMedia
        window.matchMedia = vi.fn().mockImplementation((query: string) => ({
          matches: query.includes('prefers-reduced-motion'),
          media: query,
          onchange: null,
          addListener: vi.fn(),
          removeListener: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
        }))

        window.location.hash = '#live'
        render(<App />)
        await screen.findByRole('button', { name: /Explore block #101/i })

        await waitFor(() => {
          expect(scrollMock).toHaveBeenCalled()
        })

        const callArgs = scrollMock.mock.calls[0][0]
        expect(callArgs.behavior).toBe('auto')

        window.matchMedia = originalMatchMedia
      })

      it('Live Chain route/hash is consistent and wordmark links to #home', async () => {
        window.location.hash = '#live'
        render(<App />)

        expect(window.location.hash).toBe('#live')
        expect(await screen.findByRole('heading', { name: 'Live Bitcoin Chain & Mempool' })).toBeTruthy()

        const wordmark = screen.getByLabelText('TxSignX Home')
        expect(wordmark.getAttribute('href')).toBe('#home')

        const liveNav = screen.getByRole('link', { name: 'Live Chain' })
        expect(liveNav.getAttribute('aria-current')).toBe('page')
        expect(liveNav.getAttribute('href')).toBe('#live')
      })
    })

    describe('Bitcoin Mainnet Live Observability & High Density Stream', () => {
      it('renders Bitcoin Mainnet status and Public Mainnet Feed source badge with trust tooltip', async () => {
        liveSnapshotData = {
          network: 'bitcoin',
          source: 'public_mainnet',
          source_label: 'Public Mainnet Feed',
          tip_height: 969562,
          tip_hash: '00000000000000000001a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
          mempool_tx_count: 76543,
          mempool_size_bytes: 84000000,
          recent_blocks: defaultSnapshot.recent_blocks,
          latest_transactions: defaultSnapshot.latest_transactions,
        }

        window.location.hash = '#live'
        render(<App />)

        expect(await screen.findByText('Bitcoin Mainnet')).toBeTruthy()
        expect(screen.getByText(/Public Mainnet Feed/i)).toBeTruthy()
        expect(screen.getByText('#969,562')).toBeTruthy()
        expect(screen.getByText('76,543')).toBeTruthy()
        expect(screen.getByText('2 LIVE')).toBeTruthy()

        const trustBtn = screen.getByLabelText('Source trust info')
        expect(trustBtn.getAttribute('title')).toContain('Live public Bitcoin data is provided through the configured public feed')
      })

      it('supports density switching between CALM (80), NORMAL (180), and DENSE (300)', async () => {
        window.location.hash = '#live'
        render(<App />)

        await screen.findByRole('heading', { name: 'TxSignX Live Flow' })

        const calmBtn = screen.getByRole('radio', { name: 'Calm density limit 80' })
        const normalBtn = screen.getByRole('radio', { name: 'Normal density limit 180' })
        const denseBtn = screen.getByRole('radio', { name: 'Dense density limit 300' })

        expect(normalBtn.getAttribute('aria-checked')).toBe('true')

        fireEvent.click(calmBtn)
        expect(calmBtn.getAttribute('aria-checked')).toBe('true')
        expect(normalBtn.getAttribute('aria-checked')).toBe('false')

        fireEvent.click(denseBtn)
        expect(denseBtn.getAttribute('aria-checked')).toBe('true')
        expect(calmBtn.getAttribute('aria-checked')).toBe('false')
      })

      it('renders View source on mempool.space external link in preview drawer for mainnet transactions', async () => {
        liveSnapshotData = {
          ...defaultSnapshot,
          network: 'bitcoin',
          source: 'public_mainnet',
          source_label: 'Public Mainnet Feed',
        }

        window.location.hash = '#live'
        render(<App />)

        const txNode = await screen.findByText('7b055…1101')
        fireEvent.click(txNode)

        expect(await screen.findByRole('dialog', { name: 'Transaction Preview' })).toBeTruthy()

        const externalLink = screen.getByRole('link', { name: 'View source on mempool.space ↗' })
        expect(externalLink).toBeTruthy()
        expect(externalLink.getAttribute('href')).toBe(
          'https://mempool.space/tx/7b0553bb182f567b5797be982ec47094b8e21783ae41088ec3dc71c0800d1101'
        )
        expect(externalLink.getAttribute('target')).toBe('_blank')
        expect(externalLink.getAttribute('rel')).toBe('noopener noreferrer')
      })

      it('does NOT show public source link when network is regtest', async () => {
        liveSnapshotData = {
          ...defaultSnapshot,
          network: 'regtest',
          source: 'bitcoin_core',
          source_label: 'Bitcoin Core',
        }

        window.location.hash = '#live'
        render(<App />)

        const txNode = await screen.findByText('7b055…1101')
        fireEvent.click(txNode)

        expect(await screen.findByRole('dialog', { name: 'Transaction Preview' })).toBeTruthy()
        expect(screen.queryByText(/View source on mempool\.space/)).toBeNull()
      })

      it('handles transaction_updated event to hydrate pending mainnet transactions', async () => {
        window.location.hash = '#live'
        render(<App />)

        await screen.findByText('7b055…1101')
        const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1]
        expect(ws).toBeDefined()

        ws.emit({
          type: 'transaction_updated',
          data: {
            txid: '7b0553bb182f567b5797be982ec47094b8e21783ae41088ec3dc71c0800d1101',
            vsize: 155,
            weight: 620,
            fee_sats: 1550,
            fee_rate: 10.0,
            input_count: 1,
            output_count: 2,
            explicit_rbf: true,
            has_witness: true,
            hydration_status: 'hydrated',
            first_seen_at: 1700000010,
          },
        })

        expect(await screen.findByText('155 vB')).toBeTruthy()
      })

      it('renders compact particles when transaction count exceeds 120 (high-density tier)', () => {
        const txs = Array.from({ length: 150 }, (_, i) => ({
          txid: `txid_${i.toString().padStart(60, '0')}`,
          vsize: 140 + (i % 50),
          weight: 560,
          first_seen_at: 1700000000 + i,
        }))

        const layout = computeCollisionFreeLayout(txs as any, 300, 1700000200)
        expect(layout.size).toBe(150)

        const first = layout.get(txs[0].txid)!
        expect(first.densityTier).toBe('compact')
        expect(first.sizePx).toBeLessThanOrEqual(22)
        expect(first.sizePx).toBeGreaterThanOrEqual(10)
      })

      it('verifies index.css contains node-compact and density control styles', () => {
        const proc = (globalThis as unknown as { process?: { getBuiltinModule?: (m: string) => { readFileSync: (p: string, enc: string) => string } } }).process
        const fs = proc?.getBuiltinModule?.('fs')
        const css = fs?.readFileSync('src/index.css', 'utf-8') ?? ''
        expect(css).toContain('.stream-tx-node.node-compact')
        expect(css).toContain('.density-mode-segmented')
        expect(css).toContain('.mempool-space-link')
        expect(css).toContain('.source-info-btn')
      })
    })
  })
})
