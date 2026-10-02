import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiClient, MAX_TEXT_BYTES } from './client'
import pass from '../../test/fixtures/pass.json'
import raw from '../../test/fixtures/raw.json'
import psbt from '../../test/fixtures/psbt.json'
import policies from '../../test/fixtures/policies.json'
import txidConfirmed from '../../test/fixtures/txid_confirmed.json'
import txidMempool from '../../test/fixtures/txid_mempool.json'
import rawWithAddresses from '../../test/fixtures/raw_with_addresses.json'
import { liveEventSchema } from './schema'

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

  it('fetches live snapshot, recent blocks, and mempool summary correctly', async () => {
    const api = new ApiClient('http://127.0.0.1:8080')
    const snapshotData = {
      network: 'regtest',
      tip_height: 101,
      tip_hash: '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f',
      recent_blocks: [
        {
          height: 101,
          hash: '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f',
          tx_count: 5,
          size: 1500,
          weight: 4200,
          timestamp: 1700000000
        }
      ],
      mempool_tx_count: 2,
      mempool_size_bytes: 800,
      latest_transactions: [
        {
          txid: '0101010101010101010101010101010101010101010101010101010101010101',
          vsize: 140,
          weight: 560,
          fee_sats: 1000,
          fee_rate: 7.14,
          input_count: 1,
          output_count: 2,
          explicit_rbf: true,
          has_witness: true
        }
      ]
    }
    reply(snapshotData)
    const snapshot = await api.liveSnapshot()
    expect(snapshot.network).toBe('regtest')
    expect(snapshot.tip_height).toBe(101)
    expect(snapshot.recent_blocks?.length).toBe(1)
    expect(snapshot.latest_transactions?.length).toBe(1)

    reply(snapshotData.recent_blocks)
    const blocks = await api.recentBlocks()
    expect(blocks.length).toBe(1)
    expect(blocks[0].height).toBe(101)

    const mempoolData = {
      tx_count: 2,
      size_bytes: 800,
      total_fee_sats: 5000
    }
    reply(mempoolData)
    const mempool = await api.mempoolSummary()
    expect(mempool.tx_count).toBe(2)
  })

  it('generates correct liveStreamUrl with ws and wss schemes', () => {
    const httpApi = new ApiClient('http://127.0.0.1:8080')
    expect(httpApi.liveStreamUrl()).toBe('ws://127.0.0.1:8080/api/v1/live/stream')

    const httpsApi = new ApiClient('https://api.txsignx.com')
    expect(httpsApi.liveStreamUrl()).toBe('wss://api.txsignx.com/api/v1/live/stream')
  })

  it('accepts live snapshot with null/undefined optional collections and missing structural facts', async () => {
    const api = new ApiClient('http://127.0.0.1:8080')
    const minimalSnapshot = {
      network: 'regtest',
      tip_height: 105,
      tip_hash: '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f',
      recent_blocks: null,
      mempool: null,
      mempool_tx_count: null,
      mempool_size_bytes: null,
      latest_transactions: [
        {
          txid: '0101010101010101010101010101010101010101010101010101010101010101',
          vsize: 140,
          weight: 560,
          // input_count, output_count, explicit_rbf, has_witness are omitted/null
          mempool_replaceable: true,
        }
      ]
    }
    reply(minimalSnapshot)
    const snapshot = await api.liveSnapshot()
    expect(snapshot.network).toBe('regtest')
    expect(snapshot.recent_blocks == null).toBe(true)
    expect(snapshot.mempool == null).toBe(true)
    expect(snapshot.latest_transactions?.[0].input_count == null).toBe(true)
    expect(snapshot.latest_transactions?.[0].explicit_rbf == null).toBe(true)
    expect(snapshot.latest_transactions?.[0].mempool_replaceable).toBe(true)
  })

  it('safely parses all valid LiveEvent types with liveEventSchema.parse', () => {
    // 1. snapshot
    const snapshotEvent = liveEventSchema.parse({
      type: 'snapshot',
      data: {
        network: 'regtest',
        tip_height: 101,
        tip_hash: '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f',
      }
    })
    expect(snapshotEvent?.type).toBe('snapshot')

    // 2. transaction_added
    const txAddedEvent = liveEventSchema.parse({
      type: 'transaction_added',
      data: {
        txid: '0101010101010101010101010101010101010101010101010101010101010101',
        vsize: 140,
        weight: 560,
      }
    })
    expect(txAddedEvent?.type).toBe('transaction_added')

    // 3. transaction_removed
    const txRemovedEvent = liveEventSchema.parse({
      type: 'transaction_removed',
      data: {
        txid: '0101010101010101010101010101010101010101010101010101010101010101',
      }
    })
    expect(txRemovedEvent?.type).toBe('transaction_removed')

    // 4. transaction_confirmed
    const txConfirmedEvent = liveEventSchema.parse({
      type: 'transaction_confirmed',
      data: {
        txid: '0101010101010101010101010101010101010101010101010101010101010101',
        block_hash: '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f',
        block_height: 102,
      }
    })
    expect(txConfirmedEvent?.type).toBe('transaction_confirmed')

    // 5. block_connected
    const blockEvent = liveEventSchema.parse({
      type: 'block_connected',
      data: {
        height: 102,
        hash: '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f',
        tx_count: 5,
      }
    })
    expect(blockEvent?.type).toBe('block_connected')

    // 6. mempool_updated
    const mempoolEvent = liveEventSchema.parse({
      type: 'mempool_updated',
      data: {
        tx_count: 10,
        size_bytes: 4000,
      }
    })
    expect(mempoolEvent?.type).toBe('mempool_updated')
  })

  it('safely rejects malformed or unknown events returning null without throwing', () => {
    expect(liveEventSchema.parse(null)).toBeNull()
    expect(liveEventSchema.parse('not an object')).toBeNull()
    expect(liveEventSchema.parse({})).toBeNull()
    expect(liveEventSchema.parse({ type: 'unknown_type', data: {} })).toBeNull()
    expect(liveEventSchema.parse({ type: 'transaction_added', data: { missing_txid: 123 } })).toBeNull()
    expect(liveEventSchema.parse({ type: 'block_connected', data: { height: -1 } })).toBeNull()
  })

  it('fetches block details by hash and height with bounded query parameters', async () => {
    const api = new ApiClient('http://127.0.0.1:8080')
    const sampleBlock = {
      network: 'regtest',
      height: 105,
      hash: '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f',
      previous_block_hash: '1111111111111111111111111111111111111111111111111111111111111111',
      next_block_hash: null,
      merkle_root: '2222222222222222222222222222222222222222222222222222222222222222',
      version: 536870912,
      timestamp: 1700000105,
      median_time: 1700000100,
      bits: '207fffff',
      difficulty: 0.000000001,
      tx_count: 2,
      weight: 888,
      size: 249,
      transactions: {
        items: [
          { index: 0, txid: '4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b', is_coinbase: true },
          { index: 1, txid: '7b0553bb182f567b5797be982ec47094b8e21783ae41088ec3dc71c0800d1101', is_coinbase: false },
        ],
        offset: 0,
        limit: 50,
        total: 2,
        has_more: false,
      },
    }

    reply(sampleBlock)
    const res = await api.blockDetails('000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f', 0, 50)
    expect(res.height).toBe(105)
    expect(res.transactions.items[0].is_coinbase).toBe(true)
    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:8080/api/v1/blocks/000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f?offset=0&limit=50',
      expect.objectContaining({ method: 'GET' })
    )

    reply(sampleBlock)
    const byHeight = await api.blockDetailsByHeight(105)
    expect(byHeight.height).toBe(105)
    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:8080/api/v1/blocks/height/105',
      expect.objectContaining({ method: 'GET' })
    )
  })

  it('translates invalid_block_hash and block_not_found errors properly', async () => {
    const api = new ApiClient('http://127.0.0.1:8080')
    reply({ error: { code: 'invalid_block_hash' } }, 400)
    await expect(api.blockDetails('invalid')).rejects.toThrow('The supplied block hash is invalid.')

    reply({ error: { code: 'block_not_found' } }, 404)
    await expect(api.blockDetails('0000000000000000000000000000000000000000000000000000000000000404')).rejects.toThrow('Block not found.')
  })
})
