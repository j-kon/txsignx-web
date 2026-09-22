import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiClient, MAX_TEXT_BYTES } from './client'
import pass from '../../test/fixtures/pass.json'
import raw from '../../test/fixtures/raw.json'
import psbt from '../../test/fixtures/psbt.json'
import policies from '../../test/fixtures/policies.json'
import txidConfirmed from '../../test/fixtures/txid_confirmed.json'
import txidMempool from '../../test/fixtures/txid_mempool.json'
import rawWithAddresses from '../../test/fixtures/raw_with_addresses.json'

const reply = (data: unknown, status = 200) => vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(data), {status, headers: {'Content-Type': 'application/json'}}))))
afterEach(() => vi.unstubAllGlobals())
describe('API boundary', () => {
  it('accepts complete actual Rust reports and registry', async () => {
    const api = new ApiClient('http://127.0.0.1:8080')
    reply(pass); expect(await api.preflight({psbt: 'synthetic'})).toEqual(pass)
    reply(raw); expect(await api.inspectTransaction('synthetic')).toEqual(raw)
    reply(psbt); expect(await api.inspectPsbt('synthetic')).toEqual(psbt)
    reply(policies); expect(await api.policies()).toEqual(policies)
  })

  it('accepts confirmed and mempool transaction explorer reports with chain context and float fee rates', async () => {
    const api = new ApiClient('http://127.0.0.1:8080')
    reply(txidConfirmed)
    const confirmedResult = await api.inspectTxid('7b0553bb182f567b5797be982ec47094b8e21783ae41088ec3dc71c0800d1101')
    expect(confirmedResult).toEqual(txidConfirmed)
    expect(confirmedResult.fee_rate?.sat_per_vb).toBe(180.18)
    expect(confirmedResult.chain_context?.status).toBe('confirmed')
    expect(confirmedResult.chain_context?.confirmations).toBe(6)

    reply(txidMempool)
    const mempoolResult = await api.inspectTxid('8c0664cc2930678c6808cf093fd58105c9f32894bf52199fd4ed82d1911e2212')
    expect(mempoolResult).toEqual(txidMempool)
    expect(mempoolResult.chain_context?.status).toBe('mempool')
    expect(mempoolResult.chain_context?.confirmations).toBe(0)

    reply(rawWithAddresses)
    const rawResult = await api.inspectTransaction('synthetic_hex', 'bitcoin')
    expect(rawResult).toEqual(rawWithAddresses)
    expect(rawResult.outputs[0].address).toBe('14975Ypk5124x22222222222222227d88M')
  })

  it('sends sensitive input only in POST body with no credentials/cache/referrer', async () => {
    reply(pass)
    await new ApiClient('http://127.0.0.1:8080').preflight({psbt:'sensitive'})
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:8080/api/v1/psbt/preflight', expect.objectContaining({method:'POST',body:'{"psbt":"sensitive"}',credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',redirect:'error'}))
  })

  it('sends inspectTransaction with optional network when provided', async () => {
    reply(raw)
    const api = new ApiClient('http://127.0.0.1:8080')
    await api.inspectTransaction('0200000000...', 'regtest')
    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:8080/api/v1/transactions/inspect',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ raw_transaction: '0200000000...', network: 'regtest' })
      })
    )

    await api.inspectTransaction('0200000000...')
    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:8080/api/v1/transactions/inspect',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ raw_transaction: '0200000000...' })
      })
    )
  })

  it('sends inspectTxid with trimmed txid', async () => {
    reply(txidConfirmed)
    const api = new ApiClient('http://127.0.0.1:8080')
    await api.inspectTxid('  7b0553bb182f567b5797be982ec47094b8e21783ae41088ec3dc71c0800d1101  ')
    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:8080/api/v1/transactions/inspect',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ txid: '7b0553bb182f567b5797be982ec47094b8e21783ae41088ec3dc71c0800d1101' })
      })
    )
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

  it('rejects infinite or NaN numbers in safeNumbers', async () => {
    reply({...txidConfirmed, fee_rate: { ...txidConfirmed.fee_rate, sat_per_vb: Infinity }})
    await expect(new ApiClient().inspectTxid('7b0553bb182f567b5797be982ec47094b8e21783ae41088ec3dc71c0800d1101')).rejects.toThrow('malformed')
  })

  it.each([
    ['invalid_psbt', 'The supplied PSBT could not be inspected.'],
    ['invalid_transaction', 'The supplied raw transaction could not be inspected.'],
    ['invalid_txid', 'The supplied transaction ID is invalid. Enter a 64-character hexadecimal TXID.'],
    ['invalid_network', 'The selected Bitcoin network is invalid or unsupported.'],
    ['node_not_configured', 'TXID lookup requires a Bitcoin Core node configured on the TxSignX API.'],
    ['node_unavailable', 'The configured node is unavailable. Check the local API configuration.'],
    ['invalid_context', 'The supplied context is invalid. Check wallet and node settings.'],
    ['timeout', 'Analysis timed out. Reduce the input or try again.'],
    ['busy', 'The API is busy. Try again shortly.']
  ])('maps error code %s to sanitized user message', async (code, expectedMessage) => {
    reply({ error: { code, message: 'SECRET INTERNAL DETAILS <script>bad</script>' } }, 422)
    await expect(new ApiClient().inspectTransaction('00')).rejects.toThrow(expectedMessage)
  })

  it('does not expose arbitrary server error strings for unmapped codes', async () => {
    reply({error:{code:'some_unknown_internal_code',message:'SECRET <script>bad</script>'}},500)
    await expect(new ApiClient().inspectPsbt('x')).rejects.toThrow('The API rejected the request. Check your input and context.')
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
