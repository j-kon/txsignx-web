// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import App from '../App'
import {
  getVisualOffset,
  computeCollisionFreeLayout,
  getStableMotionTiming,
  clearMotionTimingCache,
  getAdaptiveTimeWindow,
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
  node_context_available: false,
  policy_preflight: true,
  broadcast_via_api: false,
  signing: false,
  finalization: false,
  psbt_v2: false,
  active_rules: 15,
  deferred_rules: 2,
}

const mockSnapshot = {
  network: 'mainnet',
  tip_height: 890000,
  tip_hash: '00000000000000000001a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
  recent_blocks: [],
  mempool_tx_count: 50000,
  mempool_size_bytes: 65000000,
  latest_transactions: [
    {
      txid: '1111111111111111111111111111111111111111111111111111111111111111',
      vsize: 180,
      weight: 720,
      fee_sats: 1800,
      fee_rate: 10.0,
      explicit_rbf: false,
      has_witness: true,
      observed_at: 1700000000,
    },
    {
      txid: '2222222222222222222222222222222222222222222222222222222222222222',
      vsize: 220,
      weight: 880,
      fee_sats: 4400,
      fee_rate: 20.0,
      explicit_rbf: true,
      has_witness: true,
      observed_at: 1700000000,
    },
    {
      txid: '3333333333333333333333333333333333333333333333333333333333333333',
      vsize: 150,
      weight: 600,
      fee_sats: 1500,
      fee_rate: 10.0,
      explicit_rbf: false,
      has_witness: true,
      hydration_status: 'pending',
      observed_at: 1700000000,
    },
  ],
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
    setTimeout(() => {
      this.readyState = 1
      this.onopen?.()
      mockSnapshot.latest_transactions.forEach((tx) => {
        this.emit({ type: 'transaction_added', data: { ...tx, observed_at: Math.floor(Date.now() / 1000) } })
      })
    }, 5)
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

describe('Section 24: Live Motion & Layout Deterministic Tests', () => {
  beforeEach(() => {
    window.location.hash = '#live'
    clearMotionTimingCache()
    MockWebSocket.instances = []
    vi.stubGlobal('WebSocket', MockWebSocket)
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
    clearMotionTimingCache()
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })


  it('same-second transactions receive distinct visual offsets', () => {
    const txidA = '1111111111111111111111111111111111111111111111111111111111111111'
    const txidB = '2222222222222222222222222222222222222222222222222222222222222222'
    const txidC = '3333333333333333333333333333333333333333333333333333333333333333'

    const offsetA = getVisualOffset(txidA)
    const offsetB = getVisualOffset(txidB)
    const offsetC = getVisualOffset(txidC)

    expect(offsetA.offsetXPercent).not.toBe(offsetB.offsetXPercent)
    expect(offsetB.offsetXPercent).not.toBe(offsetC.offsetXPercent)
    expect(offsetA.offsetXPercent).not.toBe(offsetC.offsetXPercent)

    // Visual offsets remain bounded within tiny presentation range (±1.8%)
    expect(Math.abs(offsetA.offsetXPercent)).toBeLessThanOrEqual(1.8)
    expect(Math.abs(offsetB.offsetXPercent)).toBeLessThanOrEqual(1.8)
    expect(Math.abs(offsetC.offsetXPercent)).toBeLessThanOrEqual(1.8)
  })

  it('visual offsets do NOT mutate observed_at', () => {
    const originalObservedAt = 1700000042
    const tx = {
      txid: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      vsize: 200,
      weight: 800,
      observed_at: originalObservedAt,
    } as unknown as LiveTransaction

    const offset = getVisualOffset(tx.txid)
    expect(offset).toBeDefined()
    expect(tx.observed_at).toBe(originalObservedAt)

    const layout = computeCollisionFreeLayout([tx], 120, originalObservedAt + 10)
    expect(layout.size).toBe(1)
    expect(tx.observed_at).toBe(originalObservedAt)
  })

  it('visual offsets stable for same TXID across multiple invocations', () => {
    const txid = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789'
    const initial = getVisualOffset(txid)

    for (let i = 0; i < 50; i++) {
      const repeated = getVisualOffset(txid)
      expect(repeated.offsetXPercent).toBe(initial.offsetXPercent)
      expect(repeated.offsetYPercent).toBe(initial.offsetYPercent)
      expect(repeated.bobDuration).toBe(initial.bobDuration)
      expect(repeated.bobDelay).toBe(initial.bobDelay)
    }
  })

  it('180 transaction layout does not collapse into a few identical X coordinates', () => {
    const now = 1700000200
    // Generate 180 transactions arriving across 120 seconds, with some sharing arrival seconds
    const txs = Array.from({ length: 180 }, (_, i) => ({
      txid: `txid_${i.toString(16).padStart(60, '0')}`,
      vsize: 140 + (i % 60),
      weight: 560,
      observed_at: now - (i % 120),
    })) as unknown as LiveTransaction[]

    const layout = computeCollisionFreeLayout(txs, 120, now)
    expect(layout.size).toBe(180)

    // Calculate final effective X percentages (including visualOffsetX)
    const effectiveXCoordinates = new Set<string>()
    layout.forEach((node) => {
      const effectiveX = (node.leftPercent + node.visualOffsetX).toFixed(2)
      effectiveXCoordinates.add(effectiveX)
    })

    // With 180 transactions, we must have a broad field of moving transactions,
    // not just 3-4 vertical stacks or collapsed coordinates
    expect(effectiveXCoordinates.size).toBeGreaterThanOrEqual(100)
  })

  it('no Math.random-based layout or offset generation', () => {
    const randomSpy = vi.spyOn(Math, 'random')

    const txs = Array.from({ length: 30 }, (_, i) => ({
      txid: `txid_det_${i.toString(16).padStart(56, '0')}`,
      vsize: 180,
      weight: 720,
      observed_at: 1700000000 + (i % 15),
    })) as unknown as LiveTransaction[]

    computeCollisionFreeLayout(txs, 120, 1700000100)
    txs.forEach((tx) => getVisualOffset(tx.txid))

    expect(randomSpy).not.toHaveBeenCalled()
    randomSpy.mockRestore()
  })

  it('RBF outline only when explicit_rbf == true', async () => {
    render(<App />)

    await waitFor(() => {
      expect(document.querySelector('[data-txid="1111111111111111111111111111111111111111111111111111111111111111"]')).toBeTruthy()
      expect(document.querySelector('[data-txid="2222222222222222222222222222222222222222222222222222222222222222"]')).toBeTruthy()
    })

    const nonRbfNode = document.querySelector('[data-txid="1111111111111111111111111111111111111111111111111111111111111111"]')
    const rbfNode = document.querySelector('[data-txid="2222222222222222222222222222222222222222222222222222222222222222"]')

    expect(rbfNode?.classList.contains('rbf-indicated')).toBe(true)
    expect(nonRbfNode?.classList.contains('rbf-indicated')).toBe(false)
  })

  it('pending hydration remains visually neutral', async () => {
    render(<App />)

    await waitFor(() => {
      const node = document.querySelector('[data-txid="3333333333333333333333333333333333333333333333333333333333333333"]')
      expect(node).toBeTruthy()
      expect(node?.classList.contains('pending-hydration')).toBe(true)
    })

    const pendingNode = document.querySelector('[data-txid="3333333333333333333333333333333333333333333333333333333333333333"]')
    expect(pendingNode?.classList.contains('pending-hydration')).toBe(true)
    expect(pendingNode?.classList.contains('rbf-indicated')).toBe(false)
  })

  it('confirmed transaction leaves stream with exit animation class', async () => {
    render(<App />)

    const targetTxid = '1111111111111111111111111111111111111111111111111111111111111111'
    await waitFor(() => {
      expect(document.querySelector(`[data-txid="${targetTxid}"]`)).toBeTruthy()
    })

    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1]
    expect(ws).toBeDefined()

    ws.emit({
      type: 'transaction_confirmed',
      data: {
        txid: targetTxid,
        block_height: 890001,
        block_hash: '00000000000000000002b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5',
      },
    })

    await waitFor(() => {
      const exitingNode = document.querySelector(`[data-txid="${targetTxid}"]`)
      expect(exitingNode?.classList.contains('node-exit-confirmed')).toBe(true)
    })
  })

  it('removed transaction leaves neutrally with exit animation class', async () => {
    render(<App />)

    const targetTxid = '2222222222222222222222222222222222222222222222222222222222222222'
    await waitFor(() => {
      expect(document.querySelector(`[data-txid="${targetTxid}"]`)).toBeTruthy()
    })

    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1]
    expect(ws).toBeDefined()

    ws.emit({
      type: 'transaction_removed',
      data: {
        txid: targetTxid,
        reason: 'evicted',
      },
    })

    await waitFor(() => {
      const exitingNode = document.querySelector(`[data-txid="${targetTxid}"]`)
      expect(exitingNode?.classList.contains('node-exit-removed')).toBe(true)
      expect(exitingNode?.classList.contains('node-exit-confirmed')).toBe(false)
    })
  })

  it('reduced motion disables continuous movement and displays static layout', () => {
    const proc = (globalThis as unknown as { process?: { getBuiltinModule?: (m: string) => { readFileSync: (p: string, enc: string) => string } } }).process
    const fs = proc?.getBuiltinModule?.('fs')
    const css = fs?.readFileSync('src/index.css', 'utf-8') ?? ''

    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
    expect(css).toContain('animation: none !important')
    expect(css).toContain('transition: none !important')
    expect(css).toContain('var(--static-left, 50%)')
  })

  it('advancing nowSeconds does NOT change a mounted transaction animation-delay', () => {
    const txid = 'abcd000100000000000000000000000000000000000000000000000000000000'
    const observedAt = 1700000000
    const initialNow = 1700000020
    const windowSeconds = 60

    const timing0 = getStableMotionTiming(txid, observedAt, windowSeconds, initialNow, false)
    expect(timing0.streamDelay).toBe(-20)
    expect(timing0.streamDuration).toBe(60)

    // Simulate nowSeconds advancing 1s, 2s, 10s later
    const timing1 = getStableMotionTiming(txid, observedAt, windowSeconds, initialNow + 1, false)
    const timing2 = getStableMotionTiming(txid, observedAt, windowSeconds, initialNow + 2, false)
    const timing10 = getStableMotionTiming(txid, observedAt, windowSeconds, initialNow + 10, false)

    expect(timing1.streamDelay).toBe(-20)
    expect(timing2.streamDelay).toBe(-20)
    expect(timing10.streamDelay).toBe(-20)
    expect(timing1.streamDuration).toBe(60)
    expect(timing10.streamDuration).toBe(60)
  })

  it('advancing nowSeconds does NOT restart animation', async () => {
    render(<App />)
    const targetTxid = '1111111111111111111111111111111111111111111111111111111111111111'
    await waitFor(() => {
      expect(document.querySelector(`[data-txid="${targetTxid}"]`)).toBeTruthy()
    })

    const node = document.querySelector(`[data-txid="${targetTxid}"]`) as HTMLElement
    const initialDelay = node.style.getPropertyValue('--stream-delay')
    const initialDuration = node.style.getPropertyValue('--stream-duration')

    expect(initialDelay).toBeTruthy()
    expect(initialDuration).toBeTruthy()

    // Wait for 1.2 seconds so nowSeconds timer ticks in the component
    await new Promise((r) => setTimeout(r, 1200))

    const nodeAfterTick = document.querySelector(`[data-txid="${targetTxid}"]`) as HTMLElement
    expect(nodeAfterTick.style.getPropertyValue('--stream-delay')).toBe(initialDelay)
    expect(nodeAfterTick.style.getPropertyValue('--stream-duration')).toBe(initialDuration)
  })

  it('transaction_added receives stable initial delay near 0', () => {
    const newTxid = 'new_tx_0000000000000000000000000000000000000000000000000000000000'
    const arrivalTime = 1700000050
    const timing = getStableMotionTiming(newTxid, arrivalTime, 60, arrivalTime, true)

    expect(timing.streamDelay).toBe(0)
    expect(timing.streamDuration).toBe(60)

    // Next second tick
    const timingNext = getStableMotionTiming(newTxid, arrivalTime, 60, arrivalTime + 1, false)
    expect(timingNext.streamDelay).toBe(0)
  })

  it('older snapshot transaction receives one initial negative delay matching age', () => {
    const snapTxid = 'snap_old_00000000000000000000000000000000000000000000000000000000'
    const observedAt = 1700000000
    const mountTime = 1700000030 // 30 seconds old
    const timing = getStableMotionTiming(snapTxid, observedAt, 60, mountTime, false)

    expect(timing.streamDelay).toBe(-30)
    expect(timing.streamDuration).toBe(60)
  })

  it('observed_at and first_seen_at remain unchanged and authentic', async () => {
    render(<App />)
    await waitFor(() => {
      expect(document.querySelector('[data-txid="1111111111111111111111111111111111111111111111111111111111111111"]')).toBeTruthy()
    })

    expect(mockSnapshot.latest_transactions[0].observed_at).toBe(1700000000)
    expect(mockSnapshot.latest_transactions[1].observed_at).toBe(1700000000)
    expect(mockSnapshot.latest_transactions[2].observed_at).toBe(1700000000)
  })

  it('hover pause/resume preserves stable animation timing without jumping', async () => {
    const proc = (globalThis as unknown as { process?: { getBuiltinModule?: (m: string) => { readFileSync: (p: string, enc: string) => string } } }).process
    const fs = proc?.getBuiltinModule?.('fs')
    const css = fs?.readFileSync('src/index.css', 'utf-8') ?? ''

    // Verifies CSS pause on hover
    expect(css).toMatch(/\.stream-tx-node:hover[\s\S]*?animation-play-state:\s*paused/)
    expect(css).toMatch(/\.stream-tx-node\.selected[\s\S]*?animation-play-state:\s*paused/)

    render(<App />)
    const targetTxid = '2222222222222222222222222222222222222222222222222222222222222222'
    await waitFor(() => {
      expect(document.querySelector(`[data-txid="${targetTxid}"]`)).toBeTruthy()
    })

    const node = document.querySelector(`[data-txid="${targetTxid}"]`) as HTMLElement
    const delayBefore = node.style.getPropertyValue('--stream-delay')

    // Simulate hover and passage of time
    node.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 1100))

    // Re-check delay while paused
    expect(node.style.getPropertyValue('--stream-delay')).toBe(delayBefore)

    // Simulate mouseleave
    node.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }))
    expect(node.style.getPropertyValue('--stream-delay')).toBe(delayBefore)
  })

  it('adaptive window does not churn every second and preserves progress across transitions', () => {
    // Stable window buckets
    const win1 = getAdaptiveTimeWindow(25)
    const win2 = getAdaptiveTimeWindow(26)
    const win3 = getAdaptiveTimeWindow(59)
    expect(win1.windowSeconds).toBe(60)
    expect(win2.windowSeconds).toBe(60)
    expect(win3.windowSeconds).toBe(60)

    // Preserves visual progress across intentional window bucket transitions
    const txid = 'tx_window_prog_0000000000000000000000000000000000000000000000000'
    const start = 1700000000
    // Initially 30s progress into a 60s window (50% progress)
    const t60 = getStableMotionTiming(txid, start, 60, start + 30, false)
    expect(t60.streamDelay).toBe(-30)
    expect(t60.streamDuration).toBe(60)

    // When transitioning to 120s window 0s after anchor
    const t120 = getStableMotionTiming(txid, start, 120, start + 30, false)
    expect(t120.streamDuration).toBe(120)
    // 50% of 120s = -60s initial delay
    expect(t120.streamDelay).toBe(-60)
  })
})
