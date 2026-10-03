// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import App from '../App'
import {
  formatBlockWeight,
  formatBlockSize,
  FRONTEND_WORKING_SET_LIMIT,
  computeCollisionFreeLayout,
} from './liveStreamLayout'
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
  recent_blocks: [
    {
      height: 890000,
      hash: '00000000000000000001a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
      tx_count: 6882,
      weight: 3998000,
      size: 1551500,
      timestamp: 1700000000,
    },
  ],
  mempool_tx_count: 75698,
  mempool_size_bytes: 85000000,
  latest_transactions: [
    {
      txid: 'aaaa1111222233334444555566667777888899990000aaaabbbbccccddddeeee',
      vsize: 180,
      weight: 720,
      fee_sats: 1800,
      fee_rate: 10.0,
      explicit_rbf: false,
      has_witness: true,
      observed_at: 1700000000,
    },
    {
      txid: 'bbbb222233334444555566667777888899990000aaaabbbbccccddddeeeeffff',
      vsize: 250,
      weight: 1000,
      fee_sats: 5000,
      fee_rate: 20.0,
      explicit_rbf: true,
      has_witness: true,
      observed_at: 1700000005,
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
        this.emit({ type: 'transaction_added', data: tx })
      })
    }, 10)
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

describe('Section 16: Live Chain Presentation & Correctness Polish Tests', () => {
  beforeEach(() => {
    window.location.hash = '#live'
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
        if (url.endsWith('blocks/recent')) {
          return new Response(JSON.stringify(mockSnapshot.recent_blocks), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        if (url.endsWith('mempool/summary')) {
          return new Response(
            JSON.stringify({
              tx_count: mockSnapshot.mempool_tx_count,
              size_bytes: mockSnapshot.mempool_size_bytes,
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }
          )
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

  describe('Block Unit Formatters', () => {
    it('formats block weight accurately in kWU without altering raw value', () => {
      expect(formatBlockWeight(undefined)).toBe('—')
      expect(formatBlockWeight(null as unknown as undefined)).toBe('—')
      expect(formatBlockWeight(3998000)).toBe('3,998 kWU')
      expect(formatBlockWeight(4000000)).toBe('4,000 kWU')
    })

    it('formats block size accurately in kB without altering raw value', () => {
      expect(formatBlockSize(undefined)).toBe('—')
      expect(formatBlockSize(null as unknown as undefined)).toBe('—')
      expect(formatBlockSize(1551500)).toBe('1,551.5 kB')
      expect(formatBlockSize(2000000)).toBe('2,000.0 kB')
    })
  })

  describe('Semantics: "X shown · Y recently observed" vs Total Mempool', () => {
    it('separates authoritative Bitcoin mempool total from TxSignX recent-observation set', async () => {
      render(<App />)

      // Total mempool count in status strip
      const mempoolStrip = await screen.findByLabelText('Bitcoin network status')
      expect(mempoolStrip).toBeTruthy()
      expect(screen.getByText('75,698')).toBeTruthy()

      // TxSignX Live Flow counter badge
      expect(await screen.findByText(/2 live observations/)).toBeTruthy()
      expect(screen.getByText(/recent observations cached/)).toBeTruthy()
      // Never display old misleading copy
      expect(screen.queryByText(/mempool entries/i)).toBeNull()
    })
  })

  describe('Block Metric Layout', () => {
    it('renders block metrics in distinct semantic cells with thousands separators and units', async () => {
      render(<App />)

      const blockCard = await screen.findByRole('button', { name: /Explore block #890000/i })
      expect(blockCard).toBeTruthy()

      // TXs
      expect(screen.getByText('6,882')).toBeTruthy()
      // Weight formatted as kWU with comma
      expect(screen.getByText('3,998 kWU')).toBeTruthy()
      // Size formatted as kB with decimal
      expect(screen.getByText('1,551.5 kB')).toBeTruthy()
    })
  })

  describe('Pending Hydration Presentation & Factual Semantics', () => {
    it('displays neutral fallback without claiming fake vsize for unhydrated incoming transactions', async () => {
      render(<App />)

      await screen.findByText(/2 live observations/)
      const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1]
      expect(ws).toBeDefined()

      const unhydratedTxid = 'cccc33334444555566667777888899990000aaaabbbbccccddddeeeeffff0000'

      // Emit new unhydrated transaction from WebSocket (vsize and fee are absent)
      ws.emit({
        type: 'transaction_added',
        data: {
          txid: unhydratedTxid,
          observed_at: Math.floor(Date.now() / 1000),
          hydration_status: 'pending',
        },
      })

      // Working set increases to 3 live observations
      expect(await screen.findByText(/3 live observations/)).toBeTruthy()

      // The unhydrated node should have pending hydration marker
      const pendingNode = await screen.findByLabelText(/vsize: Pending/i)
      expect(pendingNode).toBeTruthy()
      expect(pendingNode.className).toContain('pending-hydration')

      // Click node to open Transaction Preview Drawer
      fireEvent.click(pendingNode)
      expect(await screen.findByRole('heading', { name: 'Transaction Preview' })).toBeTruthy()

      // Virtual Size, Weight, Fee, Fee Rate must state 'Pending hydration' instead of a fabricated number
      const pendingLabels = screen.getAllByText('Pending hydration')
      expect(pendingLabels.length).toBeGreaterThanOrEqual(4)
    })

    it('updates node geometry and removes pending marker when transaction_updated arrives', async () => {
      render(<App />)

      await screen.findByText(/2 live observations/)
      const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1]
      expect(ws).toBeDefined()

      const newTxid = 'dddd4444555566667777888899990000aaaabbbbccccddddeeeeffff00001111'

      // Initial unhydrated event
      ws.emit({
        type: 'transaction_added',
        data: {
          txid: newTxid,
          observed_at: Math.floor(Date.now() / 1000),
          hydration_status: 'pending',
        },
      })

      const pendingNode = await screen.findByLabelText(/vsize: Pending/i)
      expect(pendingNode.className).toContain('pending-hydration')

      // Hydration event arrives
      ws.emit({
        type: 'transaction_updated',
        data: {
          txid: newTxid,
          vsize: 320,
          weight: 1280,
          fee_sats: 6400,
          fee_rate: 20.0,
          input_count: 2,
          output_count: 2,
          has_witness: true,
          explicit_rbf: false,
          hydration_status: 'hydrated',
          observed_at: Math.floor(Date.now() / 1000),
        },
      })

      // The pending-hydration class must be removed once hydrated
      const hydratedNode = await screen.findByLabelText(/320 vB/i)
      expect(hydratedNode.className).not.toContain('pending-hydration')
    })
  })

  describe('RBF Semantics & Visual Indicators', () => {
    it('applies rbf-indicated ONLY to explicit RBF transactions and describes it factually', async () => {
      render(<App />)

      await screen.findByText(/2 live observations/)

      const nonRbfNode = screen.getByLabelText(/Transaction aaaa11/i)
      const rbfNode = screen.getByLabelText(/Transaction bbbb22/i)

      expect(nonRbfNode.className).not.toContain('rbf-indicated')
      expect(rbfNode.className).toContain('rbf-indicated')

      // Verify legend text describes signals replaceability without danger words
      const legendText = screen.getByText('RBF = Signals replaceability (BIP 125)')
      expect(legendText).toBeTruthy()
      expect(screen.queryByText(/danger|risk|warning/i)).toBeNull()
    })
  })

  describe('Working Set and Density Bounds', () => {
    it('respects frontend working set limit constant and density limits', () => {
      expect(FRONTEND_WORKING_SET_LIMIT).toBe(350)

      // Test layout calculation with pending hydration
      const pendingTx = {
        txid: 'test_pending',
        observed_at: 1000,
      } as Parameters<typeof computeCollisionFreeLayout>[0][number]
      const layout = computeCollisionFreeLayout([pendingTx], 1000, 30)
      const nodeLayout = layout.get('test_pending')
      expect(nodeLayout).toBeDefined()
      // Should assign valid non-zero visual fallback geometry
      expect(nodeLayout?.sizePx).toBeGreaterThanOrEqual(12)
    })
  })
})
