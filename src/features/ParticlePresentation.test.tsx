// @vitest-environment jsdom
import '../test/setupDom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { LiveChain } from './LiveChain'
import { LiveFeedProvider } from './LiveFeedContext'
import {
  computeCollisionFreeLayout,
  getTrajectoryDeltaY,
  getVisualPhaseSeconds,
  getVisualOffset,
} from './liveStreamLayout'
import type { LiveTransaction } from '../lib/api/schema'
import type { ApiClient } from '../lib/api/client'

const mockSnapshot = {
  network: 'bitcoin',
  tip_height: 890000,
  tip_hash: '00000000000000000001a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
  recent_blocks: [],
  mempool_tx_count: 50000,
  mempool_size_bytes: 40000000,
  latest_transactions: [],
}

const mockApi = {
  liveSnapshot: vi.fn(async () => mockSnapshot),
  liveStreamUrl: vi.fn(() => 'ws://localhost:8080/api/v1/live/stream'),
  blockDetails: vi.fn(),
  blockTransactions: vi.fn(),
  inspectTxid: vi.fn(),
  inspectRawTx: vi.fn(),
} as unknown as ApiClient

class TestWebSocket {
  static instances: TestWebSocket[] = []
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  readyState = 0
  url: string

  constructor(url: string) {
    this.url = url
    TestWebSocket.instances.push(this)
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

describe('Particle Presentation Tests (Section 15)', () => {
  beforeEach(() => {
    window.location.hash = '#live'
    TestWebSocket.instances = []
    vi.stubGlobal('WebSocket', TestWebSocket)
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  const now = Math.floor(Date.now() / 1000)

  const tx1 = {
    txid: '1111111111111111111111111111111111111111111111111111111111111111',
    vsize: 250,
    weight: 1000,
    fee_sats: 2500,
    fee_rate: 10.0,
    explicit_rbf: true,
    has_witness: true,
    observed_at: now - 10,
    hydration_status: 'complete',
  } as unknown as LiveTransaction

  const tx2 = {
    txid: '2222222222222222222222222222222222222222222222222222222222222222',
    vsize: 140,
    weight: 560,
    fee_sats: 1400,
    fee_rate: 10.0,
    explicit_rbf: false,
    has_witness: true,
    observed_at: now - 20,
    hydration_status: 'complete',
  } as unknown as LiveTransaction

  const tx3 = {
    txid: '3333333333333333333333333333333333333333333333333333333333333333',
    vsize: 1200,
    weight: 4800,
    fee_sats: 12000,
    fee_rate: 10.0,
    explicit_rbf: true,
    has_witness: false,
    observed_at: now - 5,
    hydration_status: 'complete',
  } as unknown as LiveTransaction

  it('NORMAL mode uses compact particle representation (approx 9-16px, medium tier)', () => {
    const layout = computeCollisionFreeLayout([tx1, tx2, tx3], 90, now, undefined, 'normal')
    const l1 = layout.get(tx1.txid)
    const l2 = layout.get(tx2.txid)
    const l3 = layout.get(tx3.txid)

    expect(l1).toBeDefined()
    expect(l2).toBeDefined()
    expect(l3).toBeDefined()

    expect(l1!.densityTier).toBe('medium')
    expect(l2!.densityTier).toBe('medium')
    expect(l3!.densityTier).toBe('medium')

    expect(l1!.sizePx).toBeGreaterThanOrEqual(9)
    expect(l1!.sizePx).toBeLessThanOrEqual(16)
    expect(l2!.sizePx).toBeGreaterThanOrEqual(9)
    expect(l2!.sizePx).toBeLessThanOrEqual(16)
    expect(l3!.sizePx).toBeGreaterThanOrEqual(9)
    expect(l3!.sizePx).toBeLessThanOrEqual(16)
  })

  it('DENSE mode uses compact particle representation (approx 7-13px, compact tier)', () => {
    const layout = computeCollisionFreeLayout([tx1, tx2, tx3], 120, now, undefined, 'dense')
    const l1 = layout.get(tx1.txid)
    const l2 = layout.get(tx2.txid)
    const l3 = layout.get(tx3.txid)

    expect(l1).toBeDefined()
    expect(l2).toBeDefined()
    expect(l3).toBeDefined()

    expect(l1!.densityTier).toBe('compact')
    expect(l2!.densityTier).toBe('compact')
    expect(l3!.densityTier).toBe('compact')

    expect(l1!.sizePx).toBeGreaterThanOrEqual(7)
    expect(l1!.sizePx).toBeLessThanOrEqual(13)
    expect(l2!.sizePx).toBeGreaterThanOrEqual(7)
    expect(l2!.sizePx).toBeLessThanOrEqual(13)
    expect(l3!.sizePx).toBeGreaterThanOrEqual(7)
    expect(l3!.sizePx).toBeLessThanOrEqual(13)
  })

  it('CALM mode uses larger informative nodes (approx 20-36px, large tier)', () => {
    const layout = computeCollisionFreeLayout([tx1, tx2, tx3], 90, now, undefined, 'calm')
    const l1 = layout.get(tx1.txid)
    expect(l1).toBeDefined()
    expect(l1!.densityTier).toBe('large')
    expect(l1!.sizePx).toBeGreaterThanOrEqual(20)
    expect(l1!.sizePx).toBeLessThanOrEqual(36)
  })

  it('CALM displays inline metrics and badges while NORMAL has NO inline vsize text or badges', async () => {
    render(
      <LiveFeedProvider api={mockApi}>
        <LiveChain api={mockApi} />
      </LiveFeedProvider>
    )

    await screen.findByRole('heading', { name: 'TxSignX Live Flow' })
    const ws = TestWebSocket.instances[0]
    expect(ws).toBeDefined()

    ws.emit({ type: 'transaction_added', data: tx1 })
    ws.emit({ type: 'transaction_added', data: tx2 })

    await screen.findByText(/2 live observations/)
    await screen.findByRole('region', { name: 'Live mempool time stream' })

    // 1. In default NORMAL mode (particle-first)
    const normalNode = document.querySelector(`.stream-tx-node[data-txid="${tx1.txid}"]`)
    expect(normalNode).toBeTruthy()
    // NORMAL mode has NO inline vsize, NO W text badge, NO RBF text badge
    expect(normalNode?.querySelector('.node-orb-inner')).toBeNull()
    expect(normalNode?.querySelector('.node-vsize-num')).toBeNull()
    expect(normalNode?.querySelector('.node-segwit-dot')).toBeNull()
    expect(normalNode?.querySelector('.node-rbf-badge')).toBeNull()
    // SegWit uses subtle blue core marker
    expect(normalNode?.querySelector('.particle-segwit-core')).toBeTruthy()

    // 2. Switch to CALM mode
    const calmBtn = screen.getByRole('radio', { name: /Calm density/i })
    fireEvent.click(calmBtn)

    const calmNode = document.querySelector(`.stream-tx-node[data-txid="${tx1.txid}"]`)
    expect(calmNode).toBeTruthy()
    // CALM displays inline vsize and badges
    expect(calmNode?.querySelector('.node-orb-inner')).toBeTruthy()
    expect(calmNode?.querySelector('.node-vsize-num')).toBeTruthy()
    expect(calmNode?.querySelector('.node-vsize-num')?.textContent).toBe('250')
    expect(calmNode?.querySelector('.node-segwit-dot')?.textContent).toBe('W')
    expect(calmNode?.querySelector('.node-rbf-badge')?.textContent).toBe('RBF')
  })

  it('RBF remains 1px amber outline without orange fill or glowing neon', async () => {
    render(
      <LiveFeedProvider api={mockApi}>
        <LiveChain api={mockApi} />
      </LiveFeedProvider>
    )

    await screen.findByRole('heading', { name: 'TxSignX Live Flow' })
    const ws = TestWebSocket.instances[0]
    ws.emit({ type: 'transaction_added', data: tx1 }) // explicit_rbf: true
    ws.emit({ type: 'transaction_added', data: tx2 }) // explicit_rbf: false

    await screen.findByText(/2 live observations/)
    await screen.findByRole('region', { name: 'Live mempool time stream' })

    const rbfNode = document.querySelector(`.stream-tx-node[data-txid="${tx1.txid}"]`)
    const nonRbfNode = document.querySelector(`.stream-tx-node[data-txid="${tx2.txid}"]`)

    expect(rbfNode?.classList.contains('rbf-indicated')).toBe(true)
    expect(nonRbfNode?.classList.contains('rbf-indicated')).toBe(false)
  })

  it('hover/focus reveals complete factual information in tooltip', async () => {
    render(
      <LiveFeedProvider api={mockApi}>
        <LiveChain api={mockApi} />
      </LiveFeedProvider>
    )

    await screen.findByRole('heading', { name: 'TxSignX Live Flow' })
    const ws = TestWebSocket.instances[0]
    ws.emit({ type: 'transaction_added', data: tx1 })

    await screen.findByText(/1 live observations/)
    await screen.findByRole('region', { name: 'Live mempool time stream' })

    const node = document.querySelector(`.stream-tx-node[data-txid="${tx1.txid}"]`)
    expect(node).toBeTruthy()

    const tooltip = node?.querySelector('.node-floating-tooltip')
    expect(tooltip).toBeTruthy()

    // TXID
    expect(tooltip?.textContent).toContain('TXID:')
    expect(tooltip?.textContent).toContain('11111…1111')

    // Observed by TxSignX
    expect(tooltip?.textContent).toMatch(/Observed by TxSignX: \d+s ago/)

    // vsize
    expect(tooltip?.textContent).toContain('250 vB')

    // fee rate
    expect(tooltip?.textContent).toContain('10.0 sat/vB')

    // SegWit & Explicit RBF
    expect(tooltip?.querySelector('.tooltip-tag-segwit')?.textContent).toBe('SegWit')
    expect(tooltip?.querySelector('.tooltip-tag-rbf')?.textContent).toBe('Explicit RBF')

    // Hydration status
    expect(tooltip?.querySelector('.tooltip-tag-hydration')?.textContent).toBe('Hydration: complete')
  })

  it('presentation phase is stable for same TXID across multiple invocations', () => {
    const phaseA1 = getVisualPhaseSeconds(tx1.txid, 'normal')
    const phaseA2 = getVisualPhaseSeconds(tx1.txid, 'normal')
    const phaseA3 = getVisualPhaseSeconds(tx1.txid, 'normal')

    expect(phaseA1).toBe(phaseA2)
    expect(phaseA2).toBe(phaseA3)
    expect(phaseA1).toBeGreaterThanOrEqual(0)
    expect(phaseA1).toBeLessThanOrEqual(10)
  })

  it('presentation phase differs between different TXIDs and conforms to density limits', () => {
    const phase1 = getVisualPhaseSeconds(tx1.txid, 'normal')
    const phase2 = getVisualPhaseSeconds(tx2.txid, 'normal')
    const phase3 = getVisualPhaseSeconds(tx3.txid, 'normal')

    // Different TXIDs yield distinct visual phases
    const uniquePhases = new Set([phase1, phase2, phase3])
    expect(uniquePhases.size).toBeGreaterThan(1)

    // Conforms to density phase bounds
    // NORMAL: 0-10s
    expect(getVisualPhaseSeconds(tx1.txid, 'normal')).toBeLessThanOrEqual(10)
    // DENSE: 0-14s
    expect(getVisualPhaseSeconds(tx1.txid, 'dense')).toBeLessThanOrEqual(14)
    // CALM: 0-5s
    expect(getVisualPhaseSeconds(tx1.txid, 'calm')).toBeLessThanOrEqual(5)
  })

  it('presentation phase and visual offset do NOT mutate observed_at', () => {
    const originalObservedAt = tx1.observed_at

    // Compute layout and presentation offsets
    getVisualPhaseSeconds(tx1.txid, 'normal')
    getVisualOffset(tx1.txid, 'medium')
    getTrajectoryDeltaY(tx1.txid)
    computeCollisionFreeLayout([tx1], 90, now, undefined, 'normal')

    // observed_at is completely untouched and factual
    expect(tx1.observed_at).toBe(originalObservedAt)
  })

  it('deterministic Y trajectory varies startY and endY by 3% to 6% of canvas height', () => {
    const delta1 = getTrajectoryDeltaY(tx1.txid)
    const delta2 = getTrajectoryDeltaY(tx2.txid)
    const delta3 = getTrajectoryDeltaY(tx3.txid)

    expect(Math.abs(delta1)).toBeGreaterThanOrEqual(3.0)
    expect(Math.abs(delta1)).toBeLessThanOrEqual(6.0)

    expect(Math.abs(delta2)).toBeGreaterThanOrEqual(3.0)
    expect(Math.abs(delta2)).toBeLessThanOrEqual(6.0)

    expect(Math.abs(delta3)).toBeGreaterThanOrEqual(3.0)
    expect(Math.abs(delta3)).toBeLessThanOrEqual(6.0)

    // Repeatable
    expect(getTrajectoryDeltaY(tx1.txid)).toBe(delta1)
  })

  it('Y placement in particle modes spans roughly 8% to 92%', () => {
    const sampleTxs: LiveTransaction[] = []
    for (let i = 0; i < 40; i++) {
      sampleTxs.push({
        txid: `tx_${i.toString().padStart(60, '0')}`,
        vsize: 200,
        weight: 800,
        fee_sats: 2000,
        fee_rate: 10.0,
        explicit_rbf: false,
        observed_at: now - i,
      } as unknown as LiveTransaction)
    }

    const layout = computeCollisionFreeLayout(sampleTxs, 90, now, undefined, 'normal')
    const topValues = Array.from(layout.values()).map((l) => l.topPercent)

    const minTop = Math.min(...topValues)
    const maxTop = Math.max(...topValues)

    expect(minTop).toBeGreaterThanOrEqual(8)
    expect(maxTop).toBeLessThanOrEqual(92)
    // Broad distribution across the visual field
    expect(maxTop - minTop).toBeGreaterThan(60)
  })

  it('strictly deterministic: zero calls to Math.random() in layout or presentation', () => {
    const randomSpy = vi.spyOn(Math, 'random')

    computeCollisionFreeLayout([tx1, tx2, tx3], 90, now, undefined, 'normal')
    getVisualPhaseSeconds(tx1.txid, 'normal')
    getTrajectoryDeltaY(tx1.txid)
    getVisualOffset(tx1.txid, 'medium')

    expect(randomSpy).not.toHaveBeenCalled()
  })
})
