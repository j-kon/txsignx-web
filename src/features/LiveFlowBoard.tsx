import {useMemo, useState} from 'react'
import type {LiveTransaction} from '../lib/api/schema'
import {formatRelativeTime} from './liveStreamLayout'

interface Props {
  transactions: LiveTransaction[]
  liveTxids: Set<string>
  now: number
  status: 'connecting' | 'connected' | 'reconnecting' | 'error'
  onSelect: (transaction: LiveTransaction) => void
}
const lanes = [
  {id: 'low', title: 'Below 5 sat/vB', description: 'Lower fee rates', test: (rate: number | undefined) => rate != null && rate < 5},
  {id: 'middle', title: '5–20 sat/vB', description: 'Middle fee rates', test: (rate: number | undefined) => rate != null && rate >= 5 && rate < 20},
  {id: 'high', title: '20+ sat/vB', description: 'Higher fee rates', test: (rate: number | undefined) => rate != null && rate >= 20},
  {id: 'unknown', title: 'Fee unavailable', description: 'No reported fee rate', test: (rate: number | undefined) => rate == null},
]

export function LiveFlowBoard({transactions, liveTxids, now, status, onSelect}: Props) {
  const [query, setQuery] = useState('')
  const [paused, setPaused] = useState<{transactions: LiveTransaction[]; ids: Set<string>; now: number} | null>(null)
  const [limit, setLimit] = useState(3)
  const displayed = paused?.transactions ?? transactions
  const displayedIds = paused?.ids ?? liveTxids
  const displayedNow = paused?.now ?? now
  const filtered = useMemo(() => displayed.filter(tx => tx.txid.toLowerCase().includes(query.trim().toLowerCase())), [displayed, query])
  const buckets = lanes.map(lane => ({...lane, transactions: filtered.filter(tx => lane.test(tx.fee_rate))}))
  const pausedIds = new Set(paused?.transactions.map(tx => tx.txid))
  const newCount = paused ? transactions.filter(tx => !pausedIds.has(tx.txid)).length : 0
  const priced = displayed.filter(tx => tx.fee_rate != null)
  const feeRates = priced.map(tx => tx.fee_rate!).sort((a, b) => a - b)
  const middle = Math.floor(feeRates.length / 2)
  const median = feeRates.length ? feeRates.length % 2 ? feeRates[middle] : (feeRates[middle - 1] + feeRates[middle]) / 2 : null
  const liveCount = displayed.filter(tx => displayedIds.has(tx.txid)).length
  const streaming = status === 'connected'
  return <div className={`flow-board ${paused ? 'is-paused' : ''}`}>
    <div className="flow-board-overview">
      <div className="flow-signal">
        <span className={`flow-signal-icon ${streaming && !paused ? 'is-receiving' : ''}`} aria-hidden="true"><i/><i/><i/><i/><i/></span>
        <div><strong>{paused ? 'Display paused' : streaming ? 'Receiving live data' : status === 'reconnecting' ? 'Reconnecting to the feed' : status === 'connecting' ? 'Connecting to the feed' : 'Waiting for the feed'}</strong><p>{paused ? 'Fetching continues in the background.' : 'A closer look at the transactions moving through Bitcoin.'}</p></div>
      </div>
      <button className="flow-pause" type="button" onClick={() => setPaused(paused ? null : {transactions: [...transactions], ids: new Set(liveTxids), now})}><span aria-hidden="true">{paused ? '▶' : 'Ⅱ'}</span>{paused ? 'Resume live' : 'Pause display'}</button>
    </div>

    <dl className="flow-board-stats">
      <div><dt>In this view</dt><dd>{displayed.length.toLocaleString()}<small>observations</small></dd></div>
      <div><dt>Recent live arrivals</dt><dd>{liveCount.toLocaleString()}<small>received by TxSignX</small></dd></div>
      <div><dt>Median fee rate</dt><dd>{median == null ? '—' : median.toFixed(1)}<small>sat/vB · known fees only</small></dd></div>
      <div className="flow-distribution"><dt>Fee distribution</dt><dd><div className="flow-distribution-bar" aria-hidden="true">{lanes.map(lane => <span key={lane.id} className={`lane-color-${lane.id}`} style={{flex: displayed.filter(tx => lane.test(tx.fee_rate)).length}}/>)}</div><small>Observed sample, not the full mempool</small></dd></div>
    </dl>

    {paused && <div className="flow-pause-notice" role="status"><span>View held at {new Date(paused.now * 1000).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit', second:'2-digit'})}.</span><strong>{newCount} new observation{newCount === 1 ? '' : 's'} available</strong><span>Resume to see current data.</span></div>}
    <div className="flow-board-toolbar">
      <div><h3>Transactions by fee rate</h3><p>Newest observations first in each lane.</p></div>
      <label className="flow-filter"><svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden="true"><circle cx="8" cy="8" r="5.5"/><path d="m12 12 5 5"/></svg><input type="search" aria-label="Filter flow transactions" placeholder="Filter by transaction ID" value={query} onChange={event => {setQuery(event.target.value); setLimit(3)}}/></label>
    </div>
    <div className="flow-board-caption"><span>{filtered.length} of {displayed.length} observations</span><span>Fee bands describe this sample; they do not predict confirmation.</span></div>
    {displayed.length === 0 ? <div className="flow-board-empty"><span aria-hidden="true">↔</span><h3>{streaming ? 'Ready for the next transaction' : 'No observations received yet'}</h3><p>{streaming ? 'New transactions will appear here automatically as the feed observes them.' : 'This board will populate when the configured API returns network data.'}</p></div> : filtered.length === 0 ? <div className="flow-board-empty"><h3>No matching transactions</h3><p>Try a different part of the transaction ID.</p><button className="button secondary" onClick={() => setQuery('')}>Clear filter</button></div> : <div className="flow-fee-lanes">
      {buckets.map(lane => <section key={lane.id} className={`flow-fee-lane fee-lane-${lane.id}`} aria-label={lane.title}>
        <header className="flow-lane-header"><div><span className={`flow-lane-dot lane-color-${lane.id}`} aria-hidden="true"/><h4>{lane.title}</h4><span className="flow-lane-count">{lane.transactions.length}</span></div><p>{lane.description}</p></header>
        <div className="flow-lane-cards">
          {lane.transactions.slice(0, limit).map(tx => <button key={tx.txid} type="button" className={`flow-transaction-card ${displayedIds.has(tx.txid) ? 'is-live-arrival' : ''}`} aria-label={`Inspect ${tx.txid}`} onClick={() => onSelect(tx)}>
            <span className="flow-card-top"><code>{tx.txid.slice(0, 6)}…{tx.txid.slice(-6)}</code><span className="flow-card-open" aria-hidden="true">↗</span></span>
            <span className="flow-card-fee">{tx.fee_rate == null ? <span className="flow-card-pending">{tx.hydration_status === 'pending' ? 'Details pending' : 'Fee unavailable'}</span> : <>{tx.fee_rate.toFixed(1)}<small>sat/vB</small></>}</span>
            <span className="flow-card-facts"><span>{tx.vsize == null ? 'Size unavailable' : `${tx.vsize.toLocaleString()} vB`}</span><span>{tx.fee_sats == null ? 'Fee unavailable' : `${tx.fee_sats.toLocaleString()} sats`}</span></span>
            <span className="flow-card-tags">{tx.explicit_rbf === true && <span className="flow-tag-rbf">RBF</span>}{tx.has_witness === true && <span>SegWit</span>}<span className={displayedIds.has(tx.txid) ? 'flow-tag-live' : 'flow-tag-recent'}>{displayedIds.has(tx.txid) ? 'Live arrival' : 'Recent observation'}</span></span>
            <span className="flow-card-age">{formatRelativeTime(tx.observed_at ?? tx.first_seen_at, displayedNow)}<span>Inspect transaction</span></span>
          </button>)}
          {lane.transactions.length === 0 && <p className="flow-lane-empty">No observations in this band</p>}
          {lane.transactions.length > limit && <span className="flow-lane-more">+{lane.transactions.length - limit} more in this band</span>}
        </div>
      </section>)}
    </div>}
    <footer className="flow-board-footer"><p><span className="flow-tag-rbf">RBF</span> signals explicit replaceability. Unknown fees remain in a separate lane.</p>{buckets.some(lane => lane.transactions.length > limit) && <button type="button" className="flow-show-more" onClick={() => setLimit(count => count + 6)}>Show more observations</button>}</footer>
  </div>
}
