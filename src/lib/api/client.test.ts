import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiClient, MAX_TEXT_BYTES } from './client'
import pass from '../../test/fixtures/pass.json'
import raw from '../../test/fixtures/raw.json'
import psbt from '../../test/fixtures/psbt.json'
import policies from '../../test/fixtures/policies.json'

const reply = (data: unknown, status = 200) => vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(data), {status, headers: {'Content-Type': 'application/json'}})))
afterEach(() => vi.unstubAllGlobals())
describe('API boundary', () => {
  it('accepts complete actual Rust reports and registry', async () => {
    const api = new ApiClient('http://127.0.0.1:8080')
    reply(pass); expect(await api.preflight({psbt: 'synthetic'})).toEqual(pass)
    reply(raw); expect(await api.inspectTransaction('synthetic')).toEqual(raw)
    reply(psbt); expect(await api.inspectPsbt('synthetic')).toEqual(psbt)
    reply(policies); expect(await api.policies()).toEqual(policies)
  })
  it('sends sensitive input only in POST body with no credentials/cache/referrer', async () => {
    reply(pass)
    await new ApiClient('http://127.0.0.1:8080').preflight({psbt:'sensitive'})
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:8080/api/v1/psbt/preflight', expect.objectContaining({method:'POST',body:'{"psbt":"sensitive"}',credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',redirect:'error'}))
  })
  it.each(['allow', 'PASS', '', null])('rejects unknown decision %s', async decision => {
    reply({...pass, policy:{...pass.policy,decision}})
    await expect(new ApiClient().preflight({psbt:'x'})).rejects.toThrow('malformed')
  })
  it('rejects missing nested facts and coverage', async () => {
    reply({...pass, inspection:{...pass.inspection,inputs:[{}]}})
    await expect(new ApiClient().preflight({psbt:'x'})).rejects.toThrow('malformed')
    reply({...pass, policy:{...pass.policy,rule_evaluations:undefined}})
    await expect(new ApiClient().preflight({psbt:'x'})).rejects.toThrow('malformed')
  })
  it('rejects unsafe integer reports instead of silently rounding', async () => {
    reply({...raw,total_output_sats:9007199254740992})
    await expect(new ApiClient().inspectTransaction('x')).rejects.toThrow('malformed')
  })
  it('does not expose arbitrary server error strings', async () => {
    reply({error:{code:'invalid_psbt',message:'SECRET <script>bad</script>'}},422)
    await expect(new ApiClient().inspectPsbt('x')).rejects.toThrow('The supplied PSBT could not be inspected.')
  })
  it('rejects oversized input before network activity', async () => {
    reply(psbt)
    await expect(new ApiClient().inspectPsbt('a'.repeat(MAX_TEXT_BYTES+1))).rejects.toThrow('1 MiB')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('handles unavailable network without surfacing input', async () => {
    vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new Error('SECRET')))
    await expect(new ApiClient().inspectPsbt('x')).rejects.toThrow('Could not reach')
  })
  it('rejects non-JSON and oversized responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html/>')))
    await expect(new ApiClient().inspectPsbt('x')).rejects.toThrow('malformed')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}',{headers:{'content-type':'application/json','content-length':'9000000'}})))
    await expect(new ApiClient().inspectPsbt('x')).rejects.toThrow('too large')
  })
  it('rejects credential/query/fragment API URLs', () => {
    for (const url of ['https://user:secret@example.com','https://example.com?secret=1','https://example.com/#x','javascript:alert(1)']) expect(()=>new ApiClient(url)).toThrow('API URL')
  })
})
