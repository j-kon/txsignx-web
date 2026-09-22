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

const caps={
  raw_transaction_inspection:true,
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

let report:unknown=pass
let error=false

beforeEach(()=>{
  window.location.hash=''
  report=pass
  error=false
  vi.stubGlobal('fetch',vi.fn(async (url:string)=>new Response(JSON.stringify(
    url.endsWith('capabilities')?caps
    :url.endsWith('policies')?policies
    :error?{error:{code:'invalid_psbt',message:'NEVER ECHO THIS'}}
    :url.endsWith('transactions/inspect')?raw
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
    expect(screen.getByText('Public synthetic example')).toBeTruthy()
    expect(screen.getByText('The pre-sign verification boundary.')).toBeTruthy()
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
})
