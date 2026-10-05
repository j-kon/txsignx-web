// @vitest-environment jsdom
import '../test/setupDom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import App from '../App'

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

const mockSnapshot = {
  network: 'bitcoin',
  tip_height: 890000,
  tip_hash: '00000000000000000001a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
  recent_blocks: [],
  mempool_tx_count: 81593,
  mempool_size_bytes: 65000000,
  latest_transactions: [
    {
      txid: 'snap_boot_111111111111111111111111111111111111111111111111111111111111',
      vsize: 220,
      weight: 880,
      fee_sats: 4400,
      fee_rate: 20.0,
      explicit_rbf: true,
      has_witness: true,
      observed_at: Math.floor(Date.now() / 1000) - 200, // 200s ago (snapshot item)
    },
  ],
}

class PersistentMockWebSocket {
  static instances: PersistentMockWebSocket[] = []
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  readyState = 0
  url: string

  constructor(url: string) {
    this.url = url
    PersistentMockWebSocket.instances.push(this)
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

describe('LiveFeedProvider In-Memory Route Persistence (Section 14)', () => {
  beforeEach(() => {
    window.location.hash = '#live'
    PersistentMockWebSocket.instances = []
    vi.stubGlobal('WebSocket', PersistentMockWebSocket)
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
        if (url.endsWith('policies')) {
          return new Response(JSON.stringify({ rules: [] }), {
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
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('LiveFeedProvider remains mounted across route changes', async () => {
    render(<App />)
    await screen.findByRole('heading', { name: 'TxSignX Live Flow' })
    fireEvent.click(screen.getByRole('radio', {name: 'Live Flow'}))

    // Verify WebSocket connected once
    expect(PersistentMockWebSocket.instances.length).toBe(1)
    const ws = PersistentMockWebSocket.instances[0]

    // Navigate to #home
    window.location.hash = '#home'
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    await screen.findByRole('heading', { name: 'Bitcoin transaction security before signing.' })

    // Provider remained mounted, WS was not closed
    expect(ws.close).not.toHaveBeenCalled()
    expect(PersistentMockWebSocket.instances.length).toBe(1)

    // Navigate to #inspector
    window.location.hash = '#inspector'
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    await screen.findByLabelText(/PSBT base64/i)

    // Provider remained mounted, WS still not closed
    expect(ws.close).not.toHaveBeenCalled()
    expect(PersistentMockWebSocket.instances.length).toBe(1)
  })

  it('WebSocket is not recreated unnecessarily on every page route', async () => {
    render(<App />)
    await screen.findByRole('heading', { name: 'TxSignX Live Flow' })
    fireEvent.click(screen.getByRole('radio', {name: 'Live Flow'}))
    expect(PersistentMockWebSocket.instances.length).toBe(1)

    // Cycle routes #live -> #home -> #inspector -> #policies -> #live
    const routes = ['#home', '#inspector', '#policies', '#live']
    for (const route of routes) {
      window.location.hash = route
      window.dispatchEvent(new HashChangeEvent('hashchange'))
      await waitFor(() => {
        expect(window.location.hash).toBe(route)
      })
    }

    // Still exactly 1 WebSocket instance created
    expect(PersistentMockWebSocket.instances.length).toBe(1)
  })

  it('live transactions continue accumulating while Home renders', async () => {
    render(<App />)
    await screen.findByRole('heading', { name: 'TxSignX Live Flow' })
    fireEvent.click(screen.getByRole('radio', {name: 'Live Flow'}))
    const ws = PersistentMockWebSocket.instances[0]

    // Add 2 transactions on #live
    const now = Math.floor(Date.now() / 1000)
    ws.emit({
      type: 'transaction_added',
      data: {
        txid: 'feed_tx_live_111111111111111111111111111111111111111111111111111111111',
        vsize: 150,
        weight: 600,
        fee_sats: 1500,
        fee_rate: 10.0,
        explicit_rbf: false,
        observed_at: now,
      },
    })
    ws.emit({
      type: 'transaction_added',
      data: {
        txid: 'feed_tx_live_222222222222222222222222222222222222222222222222222222222',
        vsize: 180,
        weight: 720,
        fee_sats: 1800,
        fee_rate: 10.0,
        explicit_rbf: false,
        observed_at: now,
      },
    })

    await screen.findByText(/2 live observations/)

    // Switch to Home
    window.location.hash = '#home'
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    await screen.findByRole('heading', { name: 'Bitcoin transaction security before signing.' })

    // Emit 3 more live transactions while on Home
    ws.emit({
      type: 'transaction_added',
      data: {
        txid: 'feed_tx_home_333333333333333333333333333333333333333333333333333333333',
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
        txid: 'feed_tx_home_444444444444444444444444444444444444444444444444444444444',
        vsize: 210,
        weight: 840,
        fee_sats: 2100,
        fee_rate: 10.0,
        explicit_rbf: false,
        observed_at: now,
      },
    })
    ws.emit({
      type: 'transaction_added',
      data: {
        txid: 'feed_tx_home_555555555555555555555555555555555555555555555555555555555',
        vsize: 220,
        weight: 880,
        fee_sats: 2200,
        fee_rate: 10.0,
        explicit_rbf: false,
        observed_at: now,
      },
    })

    // Return to #live
    window.location.hash = '#live'
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    await screen.findByRole('heading', { name: 'TxSignX Live Flow' })
    fireEvent.click(screen.getByRole('radio', {name: 'Live Flow'}))

    // All 5 transactions are present! Stream did NOT reset to 0
    await screen.findByText(/5 live observations/)
    expect(screen.queryByText(/Listening for new Bitcoin transactions…/)).toBeNull()
  })

  it('returning #home -> #live preserves active live transactions without warm-up reset', async () => {
    render(<App />)
    await screen.findByRole('heading', { name: 'TxSignX Live Flow' })
    fireEvent.click(screen.getByRole('radio', {name: 'Live Flow'}))
    const ws = PersistentMockWebSocket.instances[0]

    const now = Math.floor(Date.now() / 1000)
    const liveTxids: string[] = []
    for (let i = 0; i < 25; i++) {
      const txid = `batch_tx_${i.toString().padStart(50, '0')}000000000`
      liveTxids.push(txid)
      ws.emit({
        type: 'transaction_added',
        data: {
          txid,
          vsize: 150 + i,
          weight: 600 + i * 4,
          fee_sats: 1500,
          fee_rate: 10.0,
          explicit_rbf: false,
          observed_at: now,
        },
      })
    }

    await screen.findByText(/25 live observations/)

    // Click logo to go to Home
    const logo = screen.getByLabelText('TxSignX Home')
    fireEvent.click(logo)
    await screen.findByRole('heading', { name: 'Bitcoin transaction security before signing.' })

    // Click Explore Live Bitcoin on Home
    const exploreBtn = screen.getAllByRole('link', { name: /Explore Live Bitcoin/i })[0]
    fireEvent.click(exploreBtn)
    await screen.findByRole('heading', { name: 'TxSignX Live Flow' })
    fireEvent.click(screen.getByRole('radio', {name: 'Live Flow'}))

    // All 25 active transactions remain!
    expect(screen.getByText(/25 live observations/)).toBeTruthy()
    expect(screen.queryByText(/Listening for new Bitcoin transactions…/)).toBeNull()
  })

  it('expired transactions are still pruned while user is on Home', async () => {
    render(<App />)
    await screen.findByRole('heading', { name: 'TxSignX Live Flow' })
    fireEvent.click(screen.getByRole('radio', {name: 'Live Flow'}))
    const ws = PersistentMockWebSocket.instances[0]

    const now = Math.floor(Date.now() / 1000)
    // Add transaction that was observed 88 seconds ago (within 90s window)
    const expiringTxid = 'expiring_tx_0000000000000000000000000000000000000000000000000001'
    ws.emit({
      type: 'transaction_added',
      data: {
        txid: expiringTxid,
        vsize: 160,
        weight: 640,
        fee_sats: 1600,
        fee_rate: 10.0,
        explicit_rbf: false,
        observed_at: now - 88, // 88s old (inside 90s active window)
      },
    })

    await screen.findByText(/1 live observations/)

    // Navigate to Home
    window.location.hash = '#home'
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    await screen.findByRole('heading', { name: 'Bitcoin transaction security before signing.' })

    // Wait 3000ms in real time so 88 + 3 = 91s > 90s active window limit
    await new Promise((resolve) => setTimeout(resolve, 3000))

    // Return to #live
    window.location.hash = '#live'
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    await screen.findByRole('heading', { name: 'TxSignX Live Flow' })
    fireEvent.click(screen.getByRole('radio', {name: 'Live Flow'}))

    // Expired transaction was pruned while on Home!
    expect(screen.queryByText(/1 live observations/)).toBeNull()
  })

  it('snapshot items are never promoted into live session set', async () => {
    render(<App />)
    await screen.findByRole('heading', { name: 'TxSignX Live Flow' })
    fireEvent.click(screen.getByRole('radio', {name: 'Live Flow'}))

    // Snapshot item snap_boot_111... was in snapshot, never transaction_added
    expect(document.querySelector('.time-stream-scene [data-txid="snap_boot_111111111111111111111111111111111111111111111111111111111111"]')).toBeNull()

    // It is in recent observations cached tray, not live flow
    expect(screen.queryByText(/1 live observations/)).toBeNull()
    expect(screen.getByText(/1 recent observations cached/)).toBeTruthy()
  })

  it('strictly in-memory: no localStorage, no sessionStorage, no IndexedDB', async () => {
    const localGetSpy = vi.spyOn(Storage.prototype, 'getItem')
    const localSetSpy = vi.spyOn(Storage.prototype, 'setItem')
    const sessionGetSpy = vi.spyOn(sessionStorage, 'getItem')
    const sessionSetSpy = vi.spyOn(sessionStorage, 'setItem')

    render(<App />)
    await screen.findByRole('heading', { name: 'TxSignX Live Flow' })
    fireEvent.click(screen.getByRole('radio', {name: 'Live Flow'}))
    const ws = PersistentMockWebSocket.instances[0]

    // Route around
    window.location.hash = '#home'
    window.dispatchEvent(new HashChangeEvent('hashchange'))

    ws.emit({
      type: 'transaction_added',
      data: {
        txid: 'no_storage_tx_00000000000000000000000000000000000000000000000000000',
        vsize: 150,
        weight: 600,
        fee_sats: 1500,
        fee_rate: 10.0,
        explicit_rbf: false,
        observed_at: Math.floor(Date.now() / 1000),
      },
    })

    window.location.hash = '#live'
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    await screen.findByRole('heading', { name: 'TxSignX Live Flow' })
    fireEvent.click(screen.getByRole('radio', {name: 'Live Flow'}))

    expect(localSetSpy).not.toHaveBeenCalled()
    expect(localGetSpy).not.toHaveBeenCalled()
    expect(sessionSetSpy).not.toHaveBeenCalled()
    expect(sessionGetSpy).not.toHaveBeenCalled()
  })
})
