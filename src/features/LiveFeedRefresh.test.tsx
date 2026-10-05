// @vitest-environment jsdom
import '../test/setupDom'
import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {act, cleanup, render, screen} from '@testing-library/react'
import {ApiClient} from '../lib/api/client'
import {LiveFeedProvider, useLiveFeed} from './LiveFeedContext'

class Socket {
  static instances: Socket[] = []
  readyState = 0
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((event: {data: string}) => void) | null = null
  constructor() { Socket.instances.push(this) }
  open() { this.readyState = 1; this.onopen?.() }
  close() { this.readyState = 3; this.onclose?.() }
  emit(data: unknown) { this.onmessage?.({data: JSON.stringify(data)}) }
}
const base = {network: 'bitcoin', tip_height: 900000, tip_hash: 'a'.repeat(64), recent_blocks: [], latest_transactions: []}
const json = (data: unknown) => new Response(JSON.stringify(data), {headers: {'Content-Type': 'application/json'}})
function Consumer() {
  const feed = useLiveFeed()
  return <><output aria-label="Height">{feed.snapshot?.tip_height}</output><output aria-label="Transactions">{feed.transactions.map(t => t.txid).join(',')}</output><output aria-label="Updated">{feed.lastUpdatedAt ?? 'never'}</output><output aria-label="Error">{feed.errorMessage}</output><output aria-label="Status">{feed.connectionStatus}</output></>
}
const mount = (api = new ApiClient()) => render(<LiveFeedProvider api={api}><Consumer/></LiveFeedProvider>)
beforeEach(() => {
  vi.useFakeTimers()
  window.location.hash = '#live'
  Socket.instances = []
  vi.stubGlobal('WebSocket', Socket)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers() })

it('refreshes fetched data while the socket is unavailable', async () => {
  let height = 900000
  vi.stubGlobal('fetch', vi.fn(async () => json({...base, tip_height: height})))
  mount()
  await act(async () => {})
  expect(screen.getByLabelText('Height').textContent).toBe('900000')
  height = 900001
  await act(async () => { await vi.advanceTimersByTimeAsync(15000) })
  expect(screen.getByLabelText('Height').textContent).toBe('900001')
  expect(screen.getByLabelText('Updated').textContent).not.toBe('never')
})

it('resyncs immediately when the stream reconnects', async () => {
  let height = 900000
  vi.stubGlobal('fetch', vi.fn(async () => json({...base, tip_height: height})))
  mount()
  await act(async () => { Socket.instances[0].open() })
  act(() => Socket.instances[0].close())
  height = 900002
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); Socket.instances[1].open() })
  expect(screen.getByLabelText('Height').textContent).toBe('900002')
})

it('does not let an older HTTP response overwrite a newer stream snapshot', async () => {
  let resolve!: (value: Response) => void
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(done => { resolve = done })))
  mount()
  act(() => {
    Socket.instances[0].open()
    Socket.instances[0].emit({type: 'snapshot', data: {...base, tip_height: 900010}})
  })
  await act(async () => { resolve(json(base)) })
  expect(screen.getByLabelText('Height').textContent).toBe('900010')
})

it('recovers from an initial HTTP failure without reloading the page', async () => {
  let online = false
  vi.stubGlobal('fetch', vi.fn(async () => { if (!online) throw new Error('offline'); return json(base) }))
  mount()
  await act(async () => {})
  expect(screen.getByLabelText('Error').textContent).not.toBe('')
  online = true
  await act(async () => { await vi.advanceTimersByTimeAsync(15000) })
  expect(screen.getByLabelText('Height').textContent).toBe('900000')
  expect(screen.getByLabelText('Error').textContent).toBe('')
})

it('does not resurrect a transaction removed while a snapshot was fetching', async () => {
  const tx = {txid: 'b'.repeat(64), vsize: 150}
  let resolve!: (value: Response) => void
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(done => { resolve = done })))
  mount()
  act(() => {
    Socket.instances[0].open()
    Socket.instances[0].emit({type: 'transaction_added', data: tx})
    Socket.instances[0].emit({type: 'transaction_removed', data: {txid: tx.txid}})
  })
  await act(async () => { await vi.advanceTimersByTimeAsync(500); resolve(json({...base, latest_transactions: [tx]})) })
  expect(screen.getByLabelText('Transactions').textContent).toBe('')
})
