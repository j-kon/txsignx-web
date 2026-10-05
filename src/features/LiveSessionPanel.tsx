import {useState} from 'react'
import type {LiveTransaction} from '../lib/api/schema'
import {useLiveFeedOptional} from './LiveFeedContext'
import {formatRelativeTime} from './liveStreamLayout'

interface Props {
  transactions: LiveTransaction[]
  liveTxids: Set<string>
  now: number
  onSelect: (transaction: LiveTransaction) => void
}

/** A readable view of actual fetched observations, independent of animation lifetime. */
export function LiveSessionPanel({transactions, liveTxids, now, onSelect}: Props) {
  const feed = useLiveFeedOptional()
  const [expanded, setExpanded] = useState(false)
  const lastUpdated = feed?.lastUpdatedAt
  const stale = lastUpdated != null && now - lastUpdated > 45
  const connected = feed?.connectionStatus === 'connected'
  const status = stale ? 'Updates delayed' : connected ? 'Streaming' : lastUpdated != null ? 'Auto-refreshing' : feed?.errorMessage ? 'Waiting for connection' : 'Connecting'
  const rows = transactions.slice(0, expanded ? 50 : 8)
  return <section className="session-panel" aria-labelledby="session-heading">
    <div className="session-heading-row">
      <div><h2 id="session-heading">Live session</h2><p>Latest transactions received from your configured feed.</p></div>
      <div className="session-actions">
        <span className={`session-status ${connected && !stale ? 'is-streaming' : ''}`}><i aria-hidden="true"/>{status}</span>
        {feed && <button type="button" className="button secondary session-refresh" onClick={feed.refresh} disabled={feed.refreshing}>{feed.refreshing ? 'Refreshing…' : 'Refresh data'}</button>}
      </div>
    </div>
    <div className="session-meta">
      <span>{transactions.length.toLocaleString()} recent observations</span>
      <span>{lastUpdated != null ? `Last received ${formatRelativeTime(lastUpdated, now)}` : 'Waiting for the first update'}</span>
      <span>Auto-refresh every 15 seconds</span>
    </div>
    {feed?.errorMessage && <p className="session-warning" role="status">{transactions.length > 0 ? 'Showing previously received data. ' : ''}The latest refresh failed. Retrying automatically.</p>}
    {stale && !feed?.errorMessage && <p className="session-warning" role="status">No fresh data received recently. Showing the last available observations.</p>}
    {rows.length > 0 ? <>
      <table className="session-table">
        <caption className="sr-only">Recent transactions fetched from the live feed. Select a transaction to see its details.</caption>
        <thead><tr><th scope="col">Transaction</th><th scope="col">Fee rate</th><th scope="col">Virtual size</th><th scope="col">Observed</th><th scope="col">Arrival</th></tr></thead>
        <tbody>{rows.map(tx => <tr key={tx.txid}>
          <td><button type="button" className="session-tx-link" title={tx.txid} aria-label={`View details for ${tx.txid}`} onClick={() => onSelect(tx)}><span aria-hidden="true" className="session-tx-icon">↗</span><code>{tx.txid.slice(0, 14)}…{tx.txid.slice(-8)}</code></button></td>
          <td data-label="Fee rate">{tx.fee_rate == null ? '—' : <>{tx.fee_rate.toFixed(1)} <small>sat/vB</small></>}</td>
          <td data-label="Virtual size">{tx.vsize == null ? '—' : <>{tx.vsize.toLocaleString()} <small>vB</small></>}</td>
          <td data-label="Observed">{(tx.observed_at ?? tx.first_seen_at) == null ? 'Unavailable' : formatRelativeTime(tx.observed_at ?? tx.first_seen_at, now)}</td>
          <td data-label="Arrival"><span className={`arrival-tag ${liveTxids.has(tx.txid) ? 'is-new' : ''}`}>{liveTxids.has(tx.txid) ? 'Live arrival' : 'Recent'}</span></td>
        </tr>)}</tbody>
      </table>
      {transactions.length > 8 && <button className="session-expand" type="button" onClick={() => setExpanded(value => !value)}>{expanded ? 'Show fewer transactions' : `Show more transactions (${Math.min(transactions.length, 50)})`}</button>}
    </> : <div className="session-empty"><span aria-hidden="true">⇄</span><h3>{feed?.errorMessage ? 'Your feed is not available yet' : 'Listening for transactions'}</h3><p>{feed?.errorMessage ? 'Check that the TxSignX API and its Bitcoin data source are running. This view will update when the connection recovers.' : 'Transactions will appear here as soon as the feed returns data.'}</p></div>}
  </section>
}
