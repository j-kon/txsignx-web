// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import App from '../App'
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
  network: 'regtest',
  tip_height: 101,
  tip_hash: '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f',
  recent_blocks: [],
  mempool_tx_count: 0,
  mempool_size_bytes: 0,
  latest_transactions: [],
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
    }, 5)
  }

  send = vi.fn()
  close = vi.fn(() => {
    this.readyState = 3
    this.onclose?.()
  })
}

describe('Section 23: Home Routing & Logo Navigation Tests', () => {
  beforeEach(() => {
    window.location.hash = ''
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
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('empty hash renders Home', async () => {
    window.location.hash = ''
    render(<App />)

    expect(window.location.hash).toBe('#home')
    expect(
      await screen.findByRole('heading', {
        name: 'Bitcoin transaction security before signing.',
      })
    ).toBeTruthy()
    expect(screen.getByText('Not another wallet.')).toBeTruthy()
  })

  it('#home renders Home', async () => {
    window.location.hash = '#home'
    render(<App />)

    expect(window.location.hash).toBe('#home')
    expect(
      await screen.findByRole('heading', {
        name: 'Bitcoin transaction security before signing.',
      })
    ).toBeTruthy()
  })

  it('#about normalizes to #home', async () => {
    window.location.hash = '#about'
    render(<App />)

    expect(window.location.hash).toBe('#home')
    expect(
      await screen.findByRole('heading', {
        name: 'Bitcoin transaction security before signing.',
      })
    ).toBeTruthy()
  })

  it('logo href is #home with aria-label TxSignX Home', async () => {
    window.location.hash = '#live'
    render(<App />)

    const logo = screen.getByLabelText('TxSignX Home')
    expect(logo).toBeTruthy()
    expect(logo.getAttribute('href')).toBe('#home')
  })

  it('clicking logo from #live displays Home', async () => {
    window.location.hash = '#live'
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Live Bitcoin Chain & Mempool' })).toBeTruthy()

    const logo = screen.getByLabelText('TxSignX Home')
    fireEvent.click(logo)

    expect(window.location.hash).toBe('#home')
    expect(
      await screen.findByRole('heading', {
        name: 'Bitcoin transaction security before signing.',
      })
    ).toBeTruthy()
  })

  it('clicking logo from #inspector displays Home', async () => {
    window.location.hash = '#inspector'
    render(<App />)

    expect(await screen.findByLabelText('PSBT base64')).toBeTruthy()

    const logo = screen.getByLabelText('TxSignX Home')
    fireEvent.click(logo)

    expect(window.location.hash).toBe('#home')
    expect(
      await screen.findByRole('heading', {
        name: 'Bitcoin transaction security before signing.',
      })
    ).toBeTruthy()
  })

  it('clicking logo from #policies displays Home', async () => {
    window.location.hash = '#policies'
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Policy rules' })).toBeTruthy()

    const logo = screen.getByLabelText('TxSignX Home')
    fireEvent.click(logo)

    expect(window.location.hash).toBe('#home')
    expect(
      await screen.findByRole('heading', {
        name: 'Bitcoin transaction security before signing.',
      })
    ).toBeTruthy()
  })

  it('Live Chain nav still opens #live', async () => {
    window.location.hash = '#home'
    render(<App />)

    expect(
      await screen.findByRole('heading', {
        name: 'Bitcoin transaction security before signing.',
      })
    ).toBeTruthy()

    const liveLink = screen.getByRole('link', { name: 'Live Chain' })
    fireEvent.click(liveLink)

    expect(window.location.hash).toBe('#live')
    expect(await screen.findByRole('heading', { name: 'Live Bitcoin Chain & Mempool' })).toBeTruthy()
  })

  it('browser Back returns to previous route', async () => {
    window.location.hash = '#home'
    render(<App />)

    expect(
      await screen.findByRole('heading', {
        name: 'Bitcoin transaction security before signing.',
      })
    ).toBeTruthy()

    // Navigate to #live
    const liveLink = screen.getByRole('link', { name: 'Live Chain' })
    fireEvent.click(liveLink)
    expect(window.location.hash).toBe('#live')
    expect(await screen.findByRole('heading', { name: 'Live Bitcoin Chain & Mempool' })).toBeTruthy()

    // Simulate browser Back (popstate / hashchange)
    window.location.hash = '#home'
    window.dispatchEvent(new HashChangeEvent('hashchange'))

    await waitFor(() => {
      expect(
        screen.getByRole('heading', {
          name: 'Bitcoin transaction security before signing.',
        })
      ).toBeTruthy()
    })
  })

  it('clicking logo while on Home scrolls top without reload', async () => {
    const scrollToMock = vi.fn()
    window.scrollTo = scrollToMock

    window.location.hash = '#home'
    render(<App />)

    expect(
      await screen.findByRole('heading', {
        name: 'Bitcoin transaction security before signing.',
      })
    ).toBeTruthy()

    const logo = screen.getByLabelText('TxSignX Home')
    fireEvent.click(logo)

    expect(scrollToMock).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
    expect(window.location.hash).toBe('#home')
  })

  it('clicking logo while on Home uses behavior auto when reduced motion is preferred', async () => {
    const scrollToMock = vi.fn()
    window.scrollTo = scrollToMock

    const originalMatchMedia = window.matchMedia
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('prefers-reduced-motion: reduce'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))

    try {
      window.location.hash = '#home'
      render(<App />)

      expect(
        await screen.findByRole('heading', {
          name: 'Bitcoin transaction security before signing.',
        })
      ).toBeTruthy()

      const logo = screen.getByLabelText('TxSignX Home')
      fireEvent.click(logo)

      expect(scrollToMock).toHaveBeenCalledWith({ top: 0, behavior: 'auto' })
      expect(window.location.hash).toBe('#home')
    } finally {
      window.matchMedia = originalMatchMedia
    }
  })

  it('Home hero CTA order has Explore Live Bitcoin as primary and Open Inspector as secondary', async () => {
    window.location.hash = '#home'
    render(<App />)

    await screen.findByRole('heading', {
      name: 'Bitcoin transaction security before signing.',
    })

    const heroPrimaryCta = document.querySelector('.hero .button.primary.hero-cta') as HTMLAnchorElement
    expect(heroPrimaryCta).toBeTruthy()
    expect(heroPrimaryCta.getAttribute('href')).toBe('#live')
    expect(heroPrimaryCta.textContent).toContain('Explore Live Bitcoin')

    const heroSecondaryCta = document.querySelector('.hero .button.secondary') as HTMLAnchorElement
    expect(heroSecondaryCta).toBeTruthy()
    expect(heroSecondaryCta.getAttribute('href')).toBe('#inspector')
    expect(heroSecondaryCta.textContent).toContain('Open Inspector')
  })
})
