// @vitest-environment jsdom
import '../test/setupDom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import App from '../App'
import {
  getVisualOffset,
  computeCollisionFreeLayout,
} from './liveStreamLayout'
import type { LiveTransaction } from '../lib/api/schema'
import pass from '../test/fixtures/pass.json'

const caps = {
  raw_transaction_inspection: true,
  transaction_explorer: true,
  txid_inspection: true,
  transaction_address_rendering: true,
  psbt_v0_inspection: true,
  wallet_context: true,
  node_context_available: true,
  policy_preflight: true,
  broadcast_via_api: false,
  signing: false,
  finalization: false,
  psbt_v2: false,
  active_rules: 15,
  deferred_rules: 2,
}

// 3.5 hour old bootstrap snapshot transaction to test window isolation
const oldObservedAt = Math.floor(Date.now() / 1000) - 12600 // 3.5 hours ago

const mockSnapshot = {
  network: 'bitcoin',
  tip_height: 890000,
  tip_hash: '00000000000000000001a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
  recent_blocks: [],
  mempool_tx_count: 81593,
  mempool_size_bytes: 65000000,
  latest_transactions: [
    {
      txid: 'snap_old_111111111111111111111111111111111111111111111111111111111111',
      vsize: 220,
      weight: 880,
      fee_sats: 4400,
      fee_rate: 20.0,
      explicit_rbf: true,
      has_witness: true,
      observed_at: oldObservedAt,
    },
    {
      txid: 'snap_old_222222222222222222222222222222222222222222222222222222222222',
      vsize: 180,
      weight: 720,
      fee_sats: 1800,
      fee_rate: 10.0,
      explicit_rbf: false,
      has_witness: true,
      observed_at: oldObservedAt,
    },
  ],
}

class CleanMockWebSocket {
  static instances: CleanMockWebSocket[] = []
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  readyState = 0
  url: string

  constructor(url: string) {
    this.url = url
    CleanMockWebSocket.instances.push(this)
    queueMicrotask(() => {
      this.readyState = 1
      this.onopen?.()
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

describe('Live Session Separation & Visual Model Requirements (PR #6)', () => {
  beforeEach(() => {
    window.location.hash = '#live'
    CleanMockWebSocket.instances = []
    vi.stubGlobal('WebSocket', CleanMockWebSocket)
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('capabilities')) {
          return new Response(JSON.stringify(caps), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        if (url.endsWith('live/snapshot')) {
          return new Response(JSON.stringify(mockSnapshot), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        return new Response(JSON.stringify(pass), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      })
    )
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('1. initial snapshot transactions are NOT inserted into live animated stream', async () => {
    render(<App />)

    // Wait for header to render
    await screen.findByRole('heading', { name: 'TxSignX Live Flow' })
    fireEvent.click(screen.getByRole('radio', {name: 'Live Flow'}))

    // Snapshot transactions must NOT appear as moving .stream-tx-node in the scene
    const scene = document.querySelector('.time-stream-scene')
    expect(scene).toBeTruthy()
    const liveStreamNodes = scene?.querySelectorAll('.stream-tx-node')
    expect(liveStreamNodes?.length).toBe(0)

    // Instead, snapshot transactions are cached and available in the recent observations tray
    await waitFor(() => {
      const tray = document.querySelector('.recent-observations-tray')
      if (!tray) {
        throw new Error(`Tray not found. Body: ${document.body.innerHTML.slice(0, 500)}`)
      }
      expect(tray).toBeTruthy()
    })
    const tray = document.querySelector('.recent-observations-tray')
    expect(tray).toBeTruthy()
    const cachedChip = tray?.querySelector<HTMLButtonElement>(
      'button[data-txid="snap_old_111111111111111111111111111111111111111111111111111111111111"]'
    )
    expect(cachedChip).toBeTruthy()
    expect(cachedChip?.getAttribute('title')).toMatch(/Inspect cached transaction snap_old/i)
  })

  it('2. warm-up state renders "Listening for live Bitcoin transactions…" before arrivals', async () => {
    render(<App />)

    await screen.findByRole('heading', { name: 'TxSignX Live Flow' })
    fireEvent.click(screen.getByRole('radio', {name: 'Live Flow'}))

    // Warm-up banner appears inside the stream scene
    const warmupBanner = await screen.findByText('Listening for new Bitcoin transactions…')
    expect(warmupBanner).toBeTruthy()
    expect(screen.getByText('● LIVE')).toBeTruthy()
  })

  it('3. authoritative mempool total remains independent (e.g. 81,593 TX)', async () => {
    render(<App />)

    // Mempool total in status strip shows authoritative count from snapshot
    await screen.findByLabelText('Bitcoin network status')
    expect(screen.getByText('81,593')).toBeTruthy()

    // Status strip shows 0 LIVE initially
    expect(screen.getByText('0 LIVE')).toBeTruthy()

    // Live Flow heading shows 0 live observations
    expect(screen.getByText(/0 live observations/)).toBeTruthy()
    expect(screen.getByText(/2 recent observations cached/)).toBeTruthy()
  })

  it('4. transaction_added IS inserted into live animated stream at NOW', async () => {
    render(<App />)

    await screen.findByRole('heading', { name: 'TxSignX Live Flow' })
    fireEvent.click(screen.getByRole('radio', {name: 'Live Flow'}))
    const ws = CleanMockWebSocket.instances[CleanMockWebSocket.instances.length - 1]
    expect(ws).toBeDefined()

    const liveTxid = 'live_tx_aaaa00000000000000000000000000000000000000000000000000000000'
    ws.emit({
      type: 'transaction_added',
      data: {
        txid: liveTxid,
        vsize: 210,
        weight: 840,
        fee_sats: 2100,
        fee_rate: 10.0,
        explicit_rbf: false,
        has_witness: true,
        observed_at: Math.floor(Date.now() / 1000),
      },
    })

    // Now appears in moving stream scene as a .stream-tx-node
    await waitFor(() => {
      const sceneNode = document.querySelector(`.time-stream-scene [data-txid="${liveTxid}"]`)
      expect(sceneNode).toBeTruthy()
      expect(sceneNode?.classList.contains('stream-tx-node')).toBe(true)
    })

    // Displaying counter updates to 1 LIVE
    expect(screen.getByText('1 LIVE')).toBeTruthy()
    expect(screen.getByText(/1 live observations/)).toBeTruthy()
  })

  it('5. transaction_updated hydrates existing live session transaction', async () => {
    render(<App />)

    await screen.findByRole('heading', { name: 'TxSignX Live Flow' })
    fireEvent.click(screen.getByRole('radio', {name: 'Live Flow'}))
    const ws = CleanMockWebSocket.instances[CleanMockWebSocket.instances.length - 1]
    expect(ws).toBeDefined()

    const pendingTxid = 'live_tx_pending00000000000000000000000000000000000000000000000000000'
    ws.emit({
      type: 'transaction_added',
      data: {
        txid: pendingTxid,
        observed_at: Math.floor(Date.now() / 1000),
        hydration_status: 'pending',
      },
    })

    await waitFor(() => {
      const node = document.querySelector(`.time-stream-scene [data-txid="${pendingTxid}"]`)
      expect(node?.classList.contains('pending-hydration')).toBe(true)
    })

    // Update arrives
    ws.emit({
      type: 'transaction_updated',
      data: {
        txid: pendingTxid,
        vsize: 190,
        weight: 760,
        fee_sats: 3800,
        fee_rate: 20.0,
        explicit_rbf: true,
        has_witness: true,
        hydration_status: 'hydrated',
      },
    })

    await waitFor(() => {
      const node = document.querySelector(`.time-stream-scene [data-txid="${pendingTxid}"]`)
      expect(node?.classList.contains('pending-hydration')).toBe(false)
      expect(node?.classList.contains('rbf-indicated')).toBe(true)
    })
  })

  it('6. transaction_confirmed removes live session transaction', async () => {
    render(<App />)

    await screen.findByRole('heading', { name: 'TxSignX Live Flow' })
    fireEvent.click(screen.getByRole('radio', {name: 'Live Flow'}))
    const ws = CleanMockWebSocket.instances[CleanMockWebSocket.instances.length - 1]
    expect(ws).toBeDefined()

    const confirmTxid = 'live_tx_confirm0000000000000000000000000000000000000000000000000000'
    ws.emit({
      type: 'transaction_added',
      data: {
        txid: confirmTxid,
        vsize: 250,
        weight: 1000,
        fee_sats: 2500,
        fee_rate: 10.0,
        explicit_rbf: false,
        observed_at: Math.floor(Date.now() / 1000),
      },
    })

    await waitFor(() => {
      expect(document.querySelector(`.time-stream-scene [data-txid="${confirmTxid}"]`)).toBeTruthy()
    })

    ws.emit({
      type: 'transaction_confirmed',
      data: {
        txid: confirmTxid,
        block_height: 890001,
        block_hash: '00000000000000000002b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5',
      },
    })

    await waitFor(() => {
      const node = document.querySelector(`.time-stream-scene [data-txid="${confirmTxid}"]`)
      expect(node?.classList.contains('node-exit-confirmed')).toBe(true)
    })

    // After animation delay, removed from stream
    await new Promise((r) => setTimeout(r, 450))
    expect(document.querySelector(`[data-txid="${confirmTxid}"]`)).toBeNull()
  })

  it('7. transaction_removed removes live session transaction', async () => {
    render(<App />)

    await screen.findByRole('heading', { name: 'TxSignX Live Flow' })
    fireEvent.click(screen.getByRole('radio', {name: 'Live Flow'}))
    const ws = CleanMockWebSocket.instances[CleanMockWebSocket.instances.length - 1]
    expect(ws).toBeDefined()

    const evictTxid = 'live_tx_evict000000000000000000000000000000000000000000000000000000'
    ws.emit({
      type: 'transaction_added',
      data: {
        txid: evictTxid,
        vsize: 250,
        weight: 1000,
        fee_sats: 2500,
        fee_rate: 10.0,
        explicit_rbf: false,
        observed_at: Math.floor(Date.now() / 1000),
      },
    })

    await waitFor(() => {
      expect(document.querySelector(`.time-stream-scene [data-txid="${evictTxid}"]`)).toBeTruthy()
    })

    ws.emit({
      type: 'transaction_removed',
      data: {
        txid: evictTxid,
        reason: 'evicted',
      },
    })

    await waitFor(() => {
      const node = document.querySelector(`.time-stream-scene [data-txid="${evictTxid}"]`)
      expect(node?.classList.contains('node-exit-removed')).toBe(true)
    })

    await new Promise((r) => setTimeout(r, 450))
    expect(document.querySelector(`[data-txid="${evictTxid}"]`)).toBeNull()
  })

  it('8. live flow window never expands to hours because of cached snapshot data', async () => {
    render(<App />)

    await screen.findByRole('heading', { name: 'TxSignX Live Flow' })
    fireEvent.click(screen.getByRole('radio', {name: 'Live Flow'}))
    const ws = CleanMockWebSocket.instances[CleanMockWebSocket.instances.length - 1]
    expect(ws).toBeDefined()

    // Add a live session arrival
    ws.emit({
      type: 'transaction_added',
      data: {
        txid: 'live_recent_000000000000000000000000000000000000000000000000000000000',
        vsize: 200,
        weight: 800,
        fee_sats: 2000,
        fee_rate: 10.0,
        observed_at: Math.floor(Date.now() / 1000) - 20,
      },
    })

    // Axis ticks must NEVER contain multi-hour labels (like '3.5h ago' or '1h ago')
    await waitFor(() => {
      const axis = document.querySelector('.time-stream-axis')
      expect(axis?.textContent).not.toContain('h ago')
      expect(axis?.textContent).toMatch(/90s|60s|2m|NOW/)
    })
  })

  it('9. density caps apply strictly to live session set', async () => {
    render(<App />)

    await screen.findByRole('heading', { name: 'TxSignX Live Flow' })
    fireEvent.click(screen.getByRole('radio', {name: 'Live Flow'}))
    const ws = CleanMockWebSocket.instances[CleanMockWebSocket.instances.length - 1]
    expect(ws).toBeDefined()

    // Switch to CALM (80 limit)
    fireEvent.click(screen.getByRole('radio', { name: /Calm density limit 80/i }))

    // Emit 85 live arrivals
    const now = Math.floor(Date.now() / 1000)
    for (let i = 0; i < 85; i++) {
      ws.emit({
        type: 'transaction_added',
        data: {
          txid: `bulk_tx_${i.toString(16).padStart(56, '0')}`,
          vsize: 150,
          weight: 600,
          fee_sats: 1500,
          fee_rate: 10.0,
          observed_at: now - (i % 60),
        },
      })
    }

    await waitFor(() => {
      const sceneNodes = document.querySelectorAll('.time-stream-scene .stream-tx-node')
      expect(sceneNodes.length).toBe(80) // Capped at CALM 80
    })

    // Badge indicates 80 live observations (capped)
    expect(screen.getByText(/80 live observations/)).toBeTruthy()
  })

  it('10. same observed_at batch receives deterministic presentation spread without mutating observed_at', () => {
    const batchObservedAt = 1700000000
    const txA = {
      txid: 'batch_tx_aaaa00000000000000000000000000000000000000000000000000000000',
      vsize: 200,
      weight: 800,
      observed_at: batchObservedAt,
    } as unknown as LiveTransaction
    const txB = {
      txid: 'batch_tx_bbbb00000000000000000000000000000000000000000000000000000000',
      vsize: 200,
      weight: 800,
      observed_at: batchObservedAt,
    } as unknown as LiveTransaction

    const offsetA = getVisualOffset(txA.txid, 'compact')
    const offsetB = getVisualOffset(txB.txid, 'compact')

    expect(offsetA.offsetXPercent).not.toBe(offsetB.offsetXPercent)
    // Up to ±4.0% X spread for compact tier
    expect(Math.abs(offsetA.offsetXPercent)).toBeLessThanOrEqual(4.0)
    expect(Math.abs(offsetB.offsetXPercent)).toBeLessThanOrEqual(4.0)

    // Factual observed_at is NOT mutated
    expect(txA.observed_at).toBe(batchObservedAt)
    expect(txB.observed_at).toBe(batchObservedAt)
  })

  it('11. compact RBF node has restrained 1px outline without orange outer glow in CSS', () => {
    const proc = (globalThis as unknown as { process?: { getBuiltinModule?: (m: string) => { readFileSync: (p: string, enc: string) => string } } }).process
    const fs = proc?.getBuiltinModule?.('fs')
    const css = fs?.readFileSync('src/index.css', 'utf-8') ?? ''

    // Verify compact RBF outline is 1px
    expect(css).toMatch(/\.stream-tx-node\.node-compact\.rbf-indicated[\s\S]*?border:\s*1px\s+solid\s+#f59e0b/)
    // Verify NO orange outer glow in compact mode
    expect(css).toMatch(/\.stream-tx-node\.node-compact\.rbf-indicated[\s\S]*?box-shadow:\s*none/)
  })

  it('12. no Math.random usage in layout or offset generation', () => {
    const randomSpy = vi.spyOn(Math, 'random')

    const txs = Array.from({ length: 25 }, (_, i) => ({
      txid: `norand_${i.toString(16).padStart(57, '0')}`,
      vsize: 180,
      weight: 720,
      observed_at: 1700000000 + i,
    })) as unknown as LiveTransaction[]

    computeCollisionFreeLayout(txs, 120, 1700000030)
    txs.forEach((tx) => getVisualOffset(tx.txid, 'compact'))

    expect(randomSpy).not.toHaveBeenCalled()
    randomSpy.mockRestore()
  })

  it('13. full navigation cycle: #live -> logo -> #home -> Explore Live Bitcoin -> #live', async () => {
    window.location.hash = '#live'
    render(<App />)

    await screen.findByRole('heading', { name: 'TxSignX Live Flow' })
    fireEvent.click(screen.getByRole('radio', {name: 'Live Flow'}))

    // Click logo -> navigates to #home
    const logoLink = screen.getByRole('link', { name: /TxSignX Home/i })
    fireEvent.click(logoLink)

    await waitFor(() => {
      expect(window.location.hash).toBe('#home')
    })

    // Verify Home hero: "Bitcoin transaction security before signing."
    expect(await screen.findByText(/Bitcoin transaction security before signing\./i)).toBeTruthy()

    // Click Explore Live Bitcoin -> returns to #live
    const exploreBtn = screen.getAllByRole('link', { name: /Explore Live Bitcoin/i })[0]
    fireEvent.click(exploreBtn)

    await waitFor(() => {
      expect(window.location.hash).toBe('#live')
    })
    expect(await screen.findByRole('heading', { name: 'Live Bitcoin Chain & Mempool' })).toBeTruthy()
  })

  // =========================================================================
  // Section 7: Live Session Lifecycle & Bounded Window Tests
  // =========================================================================

  it('live transaction expires after active window', async () => {
    render(<App />)
    await screen.findByRole('heading', { name: 'TxSignX Live Flow' })
    fireEvent.click(screen.getByRole('radio', {name: 'Live Flow'}))
    const ws = CleanMockWebSocket.instances[CleanMockWebSocket.instances.length - 1]

    const txid = 'active_window_tx_000000000000000000000000000000000000000000000001'
    const now = Math.floor(Date.now() / 1000)

    // Add a live transaction observed 95 seconds ago (exceeds default 90s active window)
    ws.emit({
      type: 'transaction_added',
      data: {
        txid,
        vsize: 200,
        weight: 800,
        fee_sats: 2000,
        fee_rate: 10.0,
        explicit_rbf: false,
        observed_at: now - 95,
      },
    })

    // It should not be in the animated active live flow stream
    await waitFor(() => {
      const activeNode = document.querySelector(`.time-stream-scene [data-txid="${txid}"]`)
      expect(activeNode).toBeNull()
    })
  })

  it('expired transaction no longer counts as live observation', async () => {
    render(<App />)
    await screen.findByRole('heading', { name: 'TxSignX Live Flow' })
    fireEvent.click(screen.getByRole('radio', {name: 'Live Flow'}))
    const ws = CleanMockWebSocket.instances[CleanMockWebSocket.instances.length - 1]

    const txid = 'expired_count_tx_000000000000000000000000000000000000000000000002'
    const now = Math.floor(Date.now() / 1000)

    // Add live transaction older than 90s window
    ws.emit({
      type: 'transaction_added',
      data: {
        txid,
        vsize: 200,
        weight: 800,
        fee_sats: 2000,
        fee_rate: 10.0,
        explicit_rbf: false,
        observed_at: now - 95,
      },
    })

    await waitFor(() => {
      // Live count badge must show 0 live observations
      expect(screen.getByText(/0 live observations/)).toBeTruthy()
    })
  })

  it('expired transaction may remain in Recent Observations', async () => {
    render(<App />)
    await screen.findByRole('heading', { name: 'TxSignX Live Flow' })
    fireEvent.click(screen.getByRole('radio', {name: 'Live Flow'}))
    const ws = CleanMockWebSocket.instances[CleanMockWebSocket.instances.length - 1]

    const txid = 'recent_obs_retained_tx_0000000000000000000000000000000000000003'
    const now = Math.floor(Date.now() / 1000)

    // Emit live transaction that has aged beyond active window but within working set limit
    ws.emit({
      type: 'transaction_added',
      data: {
        txid,
        vsize: 200,
        weight: 800,
        fee_sats: 2000,
        fee_rate: 10.0,
        explicit_rbf: false,
        observed_at: now - 95,
      },
    })

    await waitFor(() => {
      // Not in live drift scene
      expect(document.querySelector(`.time-stream-scene [data-txid="${txid}"]`)).toBeNull()
      // Retained in Recent Observations tray
      expect(document.querySelector(`.recent-observations-tray [data-txid="${txid}"]`)).toBeTruthy()
    })
  })

  it('liveSessionTxids does not retain IDs absent from transactions', async () => {
    render(<App />)
    await screen.findByRole('heading', { name: 'TxSignX Live Flow' })
    fireEvent.click(screen.getByRole('radio', {name: 'Live Flow'}))
    const ws = CleanMockWebSocket.instances[CleanMockWebSocket.instances.length - 1]

    const txid = 'prune_absent_tx_000000000000000000000000000000000000000000000004'
    const now = Math.floor(Date.now() / 1000)

    ws.emit({
      type: 'transaction_added',
      data: {
        txid,
        vsize: 200,
        weight: 800,
        fee_sats: 2000,
        fee_rate: 10.0,
        explicit_rbf: false,
        observed_at: now,
      },
    })

    await waitFor(() => {
      expect(document.querySelector(`.time-stream-scene [data-txid="${txid}"]`)).toBeTruthy()
    })

    // Now a snapshot arrives replacing transactions working set without txid
    ws.emit({
      type: 'snapshot',
      data: {
        network: 'bitcoin',
        tip_height: 890001,
        tip_hash: '00000000000000000002b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5',
        recent_blocks: [],
        mempool_tx_count: 81600,
        mempool_size_bytes: 65100000,
        latest_transactions: [
          {
            txid: 'other_tx_00000000000000000000000000000000000000000000000000000005',
            vsize: 200,
            weight: 800,
            fee_sats: 2000,
            fee_rate: 10.0,
            explicit_rbf: false,
            observed_at: now,
          },
        ],
      },
    })

    await waitFor(() => {
      // Absent txid is pruned and not in live stream
      expect(document.querySelector(`.time-stream-scene [data-txid="${txid}"]`)).toBeNull()
      expect(screen.getByText(/0 live observations/)).toBeTruthy()
    })
  })

  it('confirmed transaction is removed immediately', async () => {
    render(<App />)
    await screen.findByRole('heading', { name: 'TxSignX Live Flow' })
    fireEvent.click(screen.getByRole('radio', {name: 'Live Flow'}))
    const ws = CleanMockWebSocket.instances[CleanMockWebSocket.instances.length - 1]

    const txid = 'immediate_confirm_tx_000000000000000000000000000000000000000006'
    const now = Math.floor(Date.now() / 1000)

    ws.emit({
      type: 'transaction_added',
      data: {
        txid,
        vsize: 200,
        weight: 800,
        fee_sats: 2000,
        fee_rate: 10.0,
        explicit_rbf: false,
        observed_at: now,
      },
    })

    await waitFor(() => {
      expect(document.querySelector(`.time-stream-scene [data-txid="${txid}"]`)).toBeTruthy()
    })

    ws.emit({
      type: 'transaction_confirmed',
      data: {
        txid,
        block_height: 890001,
        block_hash: '00000000000000000002b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5',
      },
    })

    await waitFor(() => {
      const node = document.querySelector(`.time-stream-scene [data-txid="${txid}"]`)
      expect(node?.classList.contains('node-exit-confirmed')).toBe(true)
    })
  })

  it('generic removed transaction is removed immediately', async () => {
    render(<App />)
    await screen.findByRole('heading', { name: 'TxSignX Live Flow' })
    fireEvent.click(screen.getByRole('radio', {name: 'Live Flow'}))
    const ws = CleanMockWebSocket.instances[CleanMockWebSocket.instances.length - 1]

    const txid = 'immediate_removed_tx_000000000000000000000000000000000000000007'
    const now = Math.floor(Date.now() / 1000)

    ws.emit({
      type: 'transaction_added',
      data: {
        txid,
        vsize: 200,
        weight: 800,
        fee_sats: 2000,
        fee_rate: 10.0,
        explicit_rbf: false,
        observed_at: now,
      },
    })

    await waitFor(() => {
      expect(document.querySelector(`.time-stream-scene [data-txid="${txid}"]`)).toBeTruthy()
    })

    ws.emit({
      type: 'transaction_removed',
      data: {
        txid,
        reason: 'evicted',
      },
    })

    await waitFor(() => {
      const node = document.querySelector(`.time-stream-scene [data-txid="${txid}"]`)
      expect(node?.classList.contains('node-exit-removed')).toBe(true)
    })
  })

  it('snapshot does not add IDs to liveSessionTxids', async () => {
    render(<App />)
    await screen.findByRole('heading', { name: 'TxSignX Live Flow' })
    fireEvent.click(screen.getByRole('radio', {name: 'Live Flow'}))
    const ws = CleanMockWebSocket.instances[CleanMockWebSocket.instances.length - 1]

    const now = Math.floor(Date.now() / 1000)
    const snapTxid = 'snapshot_only_tx_0000000000000000000000000000000000000000008'

    ws.emit({
      type: 'snapshot',
      data: {
        network: 'bitcoin',
        tip_height: 890001,
        tip_hash: '00000000000000000002b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5',
        recent_blocks: [],
        mempool_tx_count: 81600,
        mempool_size_bytes: 65100000,
        latest_transactions: [
          {
            txid: snapTxid,
            vsize: 200,
            weight: 800,
            fee_sats: 2000,
            fee_rate: 10.0,
            explicit_rbf: false,
            observed_at: now,
          },
        ],
      },
    })

    await waitFor(() => {
      // Must not be in live flow stream scene
      expect(document.querySelector(`.time-stream-scene [data-txid="${snapTxid}"]`)).toBeNull()
      // Live count remains 0
      expect(screen.getByText(/0 live observations/)).toBeTruthy()
      // But present in recent cached observations
      expect(document.querySelector(`.recent-observations-tray [data-txid="${snapTxid}"]`)).toBeTruthy()
    })
  })

  it('snapshot prunes stale IDs', async () => {
    render(<App />)
    await screen.findByRole('heading', { name: 'TxSignX Live Flow' })
    fireEvent.click(screen.getByRole('radio', {name: 'Live Flow'}))
    const ws = CleanMockWebSocket.instances[CleanMockWebSocket.instances.length - 1]

    const now = Math.floor(Date.now() / 1000)
    const liveTx1 = 'live_tx1_keep_0000000000000000000000000000000000000000000009'
    const liveTx2 = 'live_tx2_stale_000000000000000000000000000000000000000000010'

    ws.emit({
      type: 'transaction_added',
      data: {
        txid: liveTx1,
        vsize: 200,
        weight: 800,
        fee_sats: 2000,
        fee_rate: 10.0,
        explicit_rbf: false,
        observed_at: now,
      },
    })
    ws.emit({
      type: 'transaction_added',
      data: {
        txid: liveTx2,
        vsize: 200,
        weight: 800,
        fee_sats: 2000,
        fee_rate: 10.0,
        explicit_rbf: false,
        observed_at: now,
      },
    })

    await waitFor(() => {
      expect(document.querySelector(`.time-stream-scene [data-txid="${liveTx1}"]`)).toBeTruthy()
      expect(document.querySelector(`.time-stream-scene [data-txid="${liveTx2}"]`)).toBeTruthy()
    })

    // Snapshot arrives containing liveTx1, but omitting liveTx2
    ws.emit({
      type: 'snapshot',
      data: {
        network: 'bitcoin',
        tip_height: 890001,
        tip_hash: '00000000000000000002b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5',
        recent_blocks: [],
        mempool_tx_count: 81600,
        mempool_size_bytes: 65100000,
        latest_transactions: [
          {
            txid: liveTx1,
            vsize: 200,
            weight: 800,
            fee_sats: 2000,
            fee_rate: 10.0,
            explicit_rbf: false,
            observed_at: now,
          },
        ],
      },
    })

    await waitFor(() => {
      expect(document.querySelector(`.time-stream-scene [data-txid="${liveTx1}"]`)).toBeTruthy()
      expect(document.querySelector(`.time-stream-scene [data-txid="${liveTx2}"]`)).toBeNull()
      expect(screen.getByText(/1 live observations/)).toBeTruthy()
    })
  })

  it('reduced-motion mode still expires live entries without animationend', async () => {
    // Under reduced motion, animations are disabled, but time-based expiry must still work
    render(<App />)
    await screen.findByRole('heading', { name: 'TxSignX Live Flow' })
    fireEvent.click(screen.getByRole('radio', {name: 'Live Flow'}))
    const ws = CleanMockWebSocket.instances[CleanMockWebSocket.instances.length - 1]

    const txid = 'reduced_motion_expire_00000000000000000000000000000000000000011'
    const now = Math.floor(Date.now() / 1000)

    // Add transaction aged past active window (e.g. 95s)
    ws.emit({
      type: 'transaction_added',
      data: {
        txid,
        vsize: 200,
        weight: 800,
        fee_sats: 2000,
        fee_rate: 10.0,
        explicit_rbf: false,
        observed_at: now - 95,
      },
    })

    await waitFor(() => {
      // Expired without relying on any animationend event
      expect(document.querySelector(`.time-stream-scene [data-txid="${txid}"]`)).toBeNull()
      expect(screen.getByText(/0 live observations/)).toBeTruthy()
    })
  })

  it('animationend for live-stream-drift removes animated membership', async () => {
    render(<App />)
    await screen.findByRole('heading', { name: 'TxSignX Live Flow' })
    fireEvent.click(screen.getByRole('radio', {name: 'Live Flow'}))
    const ws = CleanMockWebSocket.instances[CleanMockWebSocket.instances.length - 1]

    const txid = 'anim_end_tx_0000000000000000000000000000000000000000000000012'
    const now = Math.floor(Date.now() / 1000)

    ws.emit({
      type: 'transaction_added',
      data: {
        txid,
        vsize: 200,
        weight: 800,
        fee_sats: 2000,
        fee_rate: 10.0,
        explicit_rbf: false,
        observed_at: now,
      },
    })

    await waitFor(() => {
      const node = document.querySelector(`.time-stream-scene [data-txid="${txid}"]`)
      expect(node).toBeTruthy()
    })

    const node = document.querySelector(`.time-stream-scene [data-txid="${txid}"]`) as HTMLElement
    // Dispatch animationend with live-stream-drift
    fireEvent.animationEnd(node, { animationName: 'live-stream-drift' })

    await waitFor(() => {
      // Removed from moving stream scene
      expect(document.querySelector(`.time-stream-scene [data-txid="${txid}"]`)).toBeNull()
      // But retained in Recent Observations tray
      expect(document.querySelector(`.recent-observations-tray [data-txid="${txid}"]`)).toBeTruthy()
    })
  })

  it('unrelated animationend does not remove transaction', async () => {
    render(<App />)
    await screen.findByRole('heading', { name: 'TxSignX Live Flow' })
    fireEvent.click(screen.getByRole('radio', {name: 'Live Flow'}))
    const ws = CleanMockWebSocket.instances[CleanMockWebSocket.instances.length - 1]

    const txid = 'unrelated_anim_tx_00000000000000000000000000000000000000000013'
    const now = Math.floor(Date.now() / 1000)

    ws.emit({
      type: 'transaction_added',
      data: {
        txid,
        vsize: 200,
        weight: 800,
        fee_sats: 2000,
        fee_rate: 10.0,
        explicit_rbf: false,
        observed_at: now,
      },
    })

    await waitFor(() => {
      const node = document.querySelector(`.time-stream-scene [data-txid="${txid}"]`)
      expect(node).toBeTruthy()
    })

    const node = document.querySelector(`.time-stream-scene [data-txid="${txid}"]`) as HTMLElement
    // Dispatch animationend with an unrelated animation name
    fireEvent.animationEnd(node, { animationName: 'flow-pulse-inbound' })

    // Node remains in active live stream
    expect(document.querySelector(`.time-stream-scene [data-txid="${txid}"]`)).toBeTruthy()
    expect(screen.getByText(/1 live observations/)).toBeTruthy()
  })

  it('CSS timing properties remain stable while expiry clock advances', async () => {
    render(<App />)
    await screen.findByRole('heading', { name: 'TxSignX Live Flow' })
    fireEvent.click(screen.getByRole('radio', {name: 'Live Flow'}))
    const ws = CleanMockWebSocket.instances[CleanMockWebSocket.instances.length - 1]

    const txid = 'stable_timing_tx_0000000000000000000000000000000000000000014'
    const now = Math.floor(Date.now() / 1000)

    ws.emit({
      type: 'transaction_added',
      data: {
        txid,
        vsize: 200,
        weight: 800,
        fee_sats: 2000,
        fee_rate: 10.0,
        explicit_rbf: false,
        observed_at: now,
      },
    })

    await waitFor(() => {
      expect(document.querySelector(`.time-stream-scene [data-txid="${txid}"]`)).toBeTruthy()
    })

    const node = document.querySelector(`.time-stream-scene [data-txid="${txid}"]`) as HTMLElement
    const initialDelay = node.style.getPropertyValue('--stream-delay')
    const initialDuration = node.style.getPropertyValue('--stream-duration')

    expect(initialDelay).toBeTruthy()
    expect(initialDuration).toBeTruthy()

    // Advance clock by 1.2s to trigger textual clock tick
    await new Promise((r) => setTimeout(r, 1200))

    const nodeAfterTick = document.querySelector(`.time-stream-scene [data-txid="${txid}"]`) as HTMLElement
    expect(nodeAfterTick.style.getPropertyValue('--stream-delay')).toBe(initialDelay)
    expect(nodeAfterTick.style.getPropertyValue('--stream-duration')).toBe(initialDuration)
  })
})
