// @vitest-environment jsdom
import '../test/setupDom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { LiveFeedProvider, useLiveFeed } from './LiveFeedContext'
import type { ApiClient } from '../lib/api/client'
import App from '../App'

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
  capabilities: vi.fn(async () => ({
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
  })),
  policies: vi.fn(async () => ({ rules: [] })),
} as unknown as ApiClient

class ControlledMockWebSocket {
  static instances: ControlledMockWebSocket[] = []
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  readyState = ControlledMockWebSocket.CONNECTING
  url: string

  constructor(url: string) {
    this.url = url
    ControlledMockWebSocket.instances.push(this)
  }

  open() {
    this.readyState = ControlledMockWebSocket.OPEN
    act(() => {
      this.onopen?.()
    })
  }

  send = vi.fn()
  close = vi.fn(() => {
    this.readyState = ControlledMockWebSocket.CLOSED
    act(() => {
      this.onclose?.()
    })
  })

  emit(data: unknown) {
    act(() => {
      this.onmessage?.({ data: JSON.stringify(data) })
    })
  }

  triggerError() {
    act(() => {
      this.onerror?.()
    })
  }

  triggerClose() {
    this.readyState = ControlledMockWebSocket.CLOSED
    act(() => {
      this.onclose?.()
    })
  }
}

function LiveFeedStatusConsumer() {
  const feed = useLiveFeed()
  return (
    <div data-testid="status-consumer">
      <span data-testid="status">{feed.connectionStatus}</span>
      <span data-testid="count">{feed.liveSessionTxids.size}</span>
      <span data-testid="txs-count">{feed.transactions.length}</span>
    </div>
  )
}

describe('LiveFeed WebSocket Reliability & Reconnect Hardening', () => {
  beforeEach(() => {
    window.location.hash = '#live'
    ControlledMockWebSocket.instances = []
    vi.stubGlobal('WebSocket', ControlledMockWebSocket)
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('1. onerror followed by onclose creates exactly ONE reconnect timer', () => {
    vi.useFakeTimers()
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout')

    render(
      <LiveFeedProvider api={mockApi}>
        <LiveFeedStatusConsumer />
      </LiveFeedProvider>
    )

    expect(ControlledMockWebSocket.instances.length).toBe(1)
    const ws1 = ControlledMockWebSocket.instances[0]
    ws1.open()

    setTimeoutSpy.mockClear()

    // Trigger error. onerror calls ws.close(), which synchronously triggers onclose()
    ws1.triggerError()

    // Both onerror and onclose were hit, but scheduleReconnect deduplicates via reconnectTimeoutRef
    // exactly one reconnect timeout was scheduled
    const reconnectTimeouts = setTimeoutSpy.mock.calls.filter(
      ([, delay]) => delay === 2000 || delay === 3000
    )
    expect(reconnectTimeouts.length).toBe(1)

    // Advance time by 2000ms: exactly one new replacement WebSocket is created
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(ControlledMockWebSocket.instances.length).toBe(2)

    // Advance further: no secondary reconnect timer fires
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(ControlledMockWebSocket.instances.length).toBe(2)
  })

  it('2. one reconnect creates exactly ONE replacement WebSocket', () => {
    vi.useFakeTimers()
    render(
      <LiveFeedProvider api={mockApi}>
        <LiveFeedStatusConsumer />
      </LiveFeedProvider>
    )

    expect(ControlledMockWebSocket.instances.length).toBe(1)
    const ws1 = ControlledMockWebSocket.instances[0]
    ws1.open()

    // Normal server-initiated close
    ws1.triggerClose()
    expect(ControlledMockWebSocket.instances.length).toBe(1)

    // Fast-forward to reconnect
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(ControlledMockWebSocket.instances.length).toBe(2)

    // Ensure it does not spawn runaway duplicates
    act(() => {
      vi.advanceTimersByTime(10000)
    })
    expect(ControlledMockWebSocket.instances.length).toBe(2)
  })

  it('3. connectWs refuses duplicate OPEN socket', () => {
    render(
      <LiveFeedProvider api={mockApi}>
        <LiveFeedStatusConsumer />
      </LiveFeedProvider>
    )

    expect(ControlledMockWebSocket.instances.length).toBe(1)
    const ws = ControlledMockWebSocket.instances[0]
    ws.open()
    expect(ws.readyState).toBe(ControlledMockWebSocket.OPEN)

    // Triggering hash change or re-render should not create another socket
    window.location.hash = '#live'
    window.dispatchEvent(new HashChangeEvent('hashchange'))

    expect(ControlledMockWebSocket.instances.length).toBe(1)
  })

  it('4. connectWs refuses duplicate CONNECTING socket', () => {
    render(
      <LiveFeedProvider api={mockApi}>
        <LiveFeedStatusConsumer />
      </LiveFeedProvider>
    )

    expect(ControlledMockWebSocket.instances.length).toBe(1)
    const ws = ControlledMockWebSocket.instances[0]
    expect(ws.readyState).toBe(ControlledMockWebSocket.CONNECTING)

    // Trigger hashchange while still in CONNECTING state
    window.location.hash = '#live'
    window.dispatchEvent(new HashChangeEvent('hashchange'))

    expect(ControlledMockWebSocket.instances.length).toBe(1)
  })

  it('5. stale socket onmessage is ignored after replacement', () => {
    vi.useFakeTimers()
    render(
      <LiveFeedProvider api={mockApi}>
        <LiveFeedStatusConsumer />
      </LiveFeedProvider>
    )

    const ws1 = ControlledMockWebSocket.instances[0]
    ws1.open()

    // Disconnect ws1 and reconnect to ws2
    ws1.triggerClose()
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(ControlledMockWebSocket.instances.length).toBe(2)
    const ws2 = ControlledMockWebSocket.instances[1]
    ws2.open()

    // Late message arrives from stale ws1
    ws1.emit({
      type: 'transaction_added',
      data: {
        txid: 'stale_tx_11111111111111111111111111111111111111111111111111111111111',
        vsize: 150,
        weight: 600,
        fee_sats: 1500,
        fee_rate: 10.0,
        explicit_rbf: false,
        observed_at: Math.floor(Date.now() / 1000),
      },
    })

    // Stale message was completely ignored
    expect(screen.getByTestId('count').textContent).toBe('0')
    expect(screen.getByTestId('txs-count').textContent).toBe('0')

    // Legitimate message arrives on active ws2
    ws2.emit({
      type: 'transaction_added',
      data: {
        txid: 'valid_tx_22222222222222222222222222222222222222222222222222222222222',
        vsize: 180,
        weight: 720,
        fee_sats: 1800,
        fee_rate: 10.0,
        explicit_rbf: false,
        observed_at: Math.floor(Date.now() / 1000),
      },
    })

    // Active message is processed
    expect(screen.getByTestId('count').textContent).toBe('1')
    expect(screen.getByTestId('txs-count').textContent).toBe('1')
  })

  it('6. stale socket onclose cannot schedule an extra reconnect', () => {
    vi.useFakeTimers()
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout')

    render(
      <LiveFeedProvider api={mockApi}>
        <LiveFeedStatusConsumer />
      </LiveFeedProvider>
    )

    const ws1 = ControlledMockWebSocket.instances[0]
    ws1.open()

    // Trigger disconnect and advance to ws2
    ws1.triggerClose()
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(ControlledMockWebSocket.instances.length).toBe(2)
    const ws2 = ControlledMockWebSocket.instances[1]
    ws2.open()

    setTimeoutSpy.mockClear()

    // Stale ws1 fires onclose again (e.g. delayed native event)
    ws1.triggerClose()

    // No timer was scheduled by stale socket
    const reconnectCalls = setTimeoutSpy.mock.calls.filter(
      ([, delay]) => delay === 2000 || delay === 3000
    )
    expect(reconnectCalls.length).toBe(0)
  })

  it('7. successful reconnect returns status to connected and clears error', () => {
    vi.useFakeTimers()
    render(
      <LiveFeedProvider api={mockApi}>
        <LiveFeedStatusConsumer />
      </LiveFeedProvider>
    )

    const ws1 = ControlledMockWebSocket.instances[0]
    ws1.open()
    expect(screen.getByTestId('status').textContent).toBe('connected')

    // Disconnect
    ws1.triggerError()
    expect(screen.getByTestId('status').textContent).toBe('reconnecting')

    // Reconnect fires
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    const ws2 = ControlledMockWebSocket.instances[1]
    expect(ws2).toBeDefined()

    // ws2 connects
    ws2.open()
    expect(screen.getByTestId('status').textContent).toBe('connected')
  })

  it('8. route changes do not recreate WebSocket', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('capabilities')) {
          return new Response(JSON.stringify(await mockApi.capabilities()), {
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
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      })
    )

    render(<App />)
    expect(ControlledMockWebSocket.instances.length).toBe(1)
    const ws = ControlledMockWebSocket.instances[0]
    ws.open()

    // Navigate to #home
    window.location.hash = '#home'
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    expect(ControlledMockWebSocket.instances.length).toBe(1)
    expect(ws.close).not.toHaveBeenCalled()

    // Navigate to #inspector
    window.location.hash = '#inspector'
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    expect(ControlledMockWebSocket.instances.length).toBe(1)
    expect(ws.close).not.toHaveBeenCalled()

    // Navigate back to #live
    window.location.hash = '#live'
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    expect(ControlledMockWebSocket.instances.length).toBe(1)
  })

  it('9. feed and session state survives reconnect', () => {
    vi.useFakeTimers()
    render(
      <LiveFeedProvider api={mockApi}>
        <LiveFeedStatusConsumer />
      </LiveFeedProvider>
    )

    const ws1 = ControlledMockWebSocket.instances[0]
    ws1.open()

    // Emit 2 live transactions on ws1
    ws1.emit({
      type: 'transaction_added',
      data: {
        txid: 'persist_tx_111111111111111111111111111111111111111111111111111111111',
        vsize: 200,
        weight: 800,
        fee_sats: 2000,
        fee_rate: 10.0,
        explicit_rbf: false,
        observed_at: Math.floor(Date.now() / 1000),
      },
    })
    ws1.emit({
      type: 'transaction_added',
      data: {
        txid: 'persist_tx_222222222222222222222222222222222222222222222222222222222',
        vsize: 210,
        weight: 840,
        fee_sats: 2100,
        fee_rate: 10.0,
        explicit_rbf: false,
        observed_at: Math.floor(Date.now() / 1000),
      },
    })

    expect(screen.getByTestId('count').textContent).toBe('2')
    expect(screen.getByTestId('txs-count').textContent).toBe('2')

    // Disconnect and reconnect
    ws1.triggerClose()
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    const ws2 = ControlledMockWebSocket.instances[1]
    ws2.open()

    // State is preserved!
    expect(screen.getByTestId('count').textContent).toBe('2')
    expect(screen.getByTestId('txs-count').textContent).toBe('2')

    // ws2 can continue adding transactions
    ws2.emit({
      type: 'transaction_added',
      data: {
        txid: 'persist_tx_333333333333333333333333333333333333333333333333333333333',
        vsize: 220,
        weight: 880,
        fee_sats: 2200,
        fee_rate: 10.0,
        explicit_rbf: false,
        observed_at: Math.floor(Date.now() / 1000),
      },
    })

    expect(screen.getByTestId('count').textContent).toBe('3')
    expect(screen.getByTestId('txs-count').textContent).toBe('3')
  })

  it('10. cleanup clears reconnect timer', () => {
    vi.useFakeTimers()
    const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout')

    const { unmount } = render(
      <LiveFeedProvider api={mockApi}>
        <LiveFeedStatusConsumer />
      </LiveFeedProvider>
    )

    const ws1 = ControlledMockWebSocket.instances[0]
    ws1.open()

    // Trigger close to schedule reconnect timer
    ws1.triggerClose()

    // Unmount while timer is pending
    unmount()

    expect(clearTimeoutSpy).toHaveBeenCalled()

    // Fast forward time: no replacement socket is created
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(ControlledMockWebSocket.instances.length).toBe(1)
  })

  it('11. cleanup closes active socket and nulls handlers', () => {
    const { unmount } = render(
      <LiveFeedProvider api={mockApi}>
        <LiveFeedStatusConsumer />
      </LiveFeedProvider>
    )

    const ws = ControlledMockWebSocket.instances[0]
    ws.open()

    unmount()

    expect(ws.close).toHaveBeenCalled()
    expect(ws.onopen).toBeNull()
    expect(ws.onmessage).toBeNull()
    expect(ws.onclose).toBeNull()
    expect(ws.onerror).toBeNull()
  })
})
