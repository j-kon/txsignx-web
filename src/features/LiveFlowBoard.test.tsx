// @vitest-environment jsdom
import {afterEach, expect, it, vi} from 'vitest'
import {cleanup, fireEvent, render, screen, within} from '@testing-library/react'
import {LiveFlowBoard} from './LiveFlowBoard'
import {liveTransactionSchema, type LiveTransaction} from '../lib/api/schema'

afterEach(cleanup)
const tx = (id: string, rate?: number): LiveTransaction => liveTransactionSchema({txid: id.repeat(64), fee_rate: rate, vsize: 180, observed_at: 1000})
const defaults = {transactions: [tx('a', 1), tx('b', 8), tx('c', 30), tx('d')], liveTxids: new Set(['a'.repeat(64)]), now: 1005, status: 'connected' as const, onSelect: vi.fn()}

it('groups actual fee rates and keeps missing fees out of priced lanes', () => {
  render(<LiveFlowBoard {...defaults}/>)
  expect(within(screen.getByRole('region', {name:'Below 5 sat/vB'})).getByRole('button', {name:/Inspect aaaaaa/})).toBeTruthy()
  expect(within(screen.getByRole('region', {name:'5–20 sat/vB'})).getByRole('button', {name:/Inspect bbbbbb/})).toBeTruthy()
  expect(within(screen.getByRole('region', {name:'20+ sat/vB'})).getByRole('button', {name:/Inspect cccccc/})).toBeTruthy()
  expect(within(screen.getByRole('region', {name:'Fee unavailable'})).getByRole('button', {name:/Inspect dddddd/})).toBeTruthy()
})

it('holds visible transactions while paused and catches up on resume', () => {
  const {rerender} = render(<LiveFlowBoard {...defaults}/>)
  fireEvent.click(screen.getByRole('button', {name:'Pause display'}))
  rerender(<LiveFlowBoard {...defaults} transactions={[tx('e', 2), ...defaults.transactions]} now={1020}/>)
  expect(screen.queryByRole('button', {name:/Inspect eeeeee/})).toBeNull()
  expect(screen.getByText(/1 new observation/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', {name:'Resume live'}))
  expect(screen.getByRole('button', {name:/Inspect eeeeee/})).toBeTruthy()
})

it('opens a card with the received data and labels only actual live arrivals', () => {
  const onSelect = vi.fn()
  render(<LiveFlowBoard {...defaults} onSelect={onSelect}/>)
  fireEvent.click(screen.getByRole('button', {name:/Inspect bbbbbb/}))
  expect(onSelect).toHaveBeenCalledWith(defaults.transactions[1])
  expect(screen.getAllByText('Live arrival')).toHaveLength(1)
})

it('filters transaction IDs without treating the filtered count as the network total', () => {
  render(<LiveFlowBoard {...defaults}/>)
  fireEvent.change(screen.getByRole('searchbox', {name:'Filter flow transactions'}), {target:{value:'bbbbbb'}})
  expect(screen.getByRole('button', {name:/Inspect bbbbbb/})).toBeTruthy()
  expect(screen.queryByRole('button', {name:/Inspect aaaaaa/})).toBeNull()
  expect(screen.getByText('1 of 4 observations')).toBeTruthy()
})

it('shows a disconnected empty state instead of claiming to be live', () => {
  render(<LiveFlowBoard {...defaults} transactions={[]} status="error"/>)
  expect(screen.getByText('Waiting for the feed')).toBeTruthy()
  expect(screen.queryByText('Receiving live data')).toBeNull()
})


it('places fee boundaries correctly and includes a reported zero in the median', () => {
  render(<LiveFlowBoard {...defaults} transactions={[tx('a', 0), tx('b', 5), tx('c', 20), tx('d', 100)]}/>)
  expect(within(screen.getByRole('region', {name:'Below 5 sat/vB'})).getByRole('button', {name:/Inspect aaaaaa/}).textContent).toContain('0.0')
  expect(within(screen.getByRole('region', {name:'5–20 sat/vB'})).getByRole('button', {name:/Inspect bbbbbb/})).toBeTruthy()
  expect(within(screen.getByRole('region', {name:'20+ sat/vB'})).getAllByRole('button')).toHaveLength(2)
  expect(screen.getByText('Median fee rate').nextElementSibling?.textContent).toContain('12.5')
})
