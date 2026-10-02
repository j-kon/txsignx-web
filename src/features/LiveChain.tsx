import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { ApiClient } from '../lib/api/client'
import {
  type LiveEvent,
  type LiveSnapshot,
  type LiveTransaction,
  type RecentBlock,
  type Report,
  liveEventSchema,
} from '../lib/api/schema'
import { ReportView } from './ReportView'

interface LiveChainProps {
  api: ApiClient
  onNavigateInspector?: () => void
}

function formatRelativeTime(timestamp?: number): string {
  if (!timestamp) return 'Unknown'
  const now = Math.floor(Date.now() / 1000)
  const diff = now - timestamp
  if (diff < 5) return 'Just now'
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  return `${Math.floor(diff / 3600)}h ago`
}

function truncateHash(hash: string, start = 8, end = 8): string {
  if (!hash || hash.length <= start + end) return hash
  return `${hash.slice(0, start)}…${hash.slice(-end)}`
}

export function LiveChain({ api, onNavigateInspector }: LiveChainProps) {
  const [snapshot, setSnapshot] = useState<LiveSnapshot | null>(null)
  const [blocks, setBlocks] = useState<RecentBlock[]>([])
  const [transactions, setTransactions] = useState<LiveTransaction[]>([])
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'reconnecting' | 'error'>('connecting')
  const [errorMessage, setErrorMessage] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchError, setSearchError] = useState('')
  const [viewMode, setViewMode] = useState<'flow' | 'graph'>('flow')
  const [selectedTx, setSelectedTx] = useState<LiveTransaction | null>(null)
  const [activeReport, setActiveReport] = useState<Report | null>(null)
  const [reportLoading, setReportLoading] = useState(false)
  const [reportError, setReportError] = useState('')

  const activeRef = useRef(true)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<number | undefined>(undefined)

  // Handle validated live incoming events
  const handleEvent = (event: LiveEvent) => {
    if (!activeRef.current) return

    switch (event.type) {
      case 'snapshot': {
        const snap = event.data
        if (snap) {
          setSnapshot(snap)
          if (snap.recent_blocks !== undefined && snap.recent_blocks !== null) {
            setBlocks(snap.recent_blocks)
          }
          if (snap.latest_transactions !== undefined && snap.latest_transactions !== null) {
            setTransactions(snap.latest_transactions)
          }
        }
        break
      }
      case 'transaction_added': {
        const tx = event.data
        if (tx && tx.txid) {
          setTransactions(prev => {
            if (prev.some(t => t.txid === tx.txid)) return prev
            return [tx, ...prev].slice(0, 200)
          })
        }
        break
      }
      case 'transaction_removed': {
        const payload = event.data
        if (payload?.txid) {
          setTransactions(prev => prev.filter(t => t.txid !== payload.txid))
        }
        break
      }
      case 'transaction_confirmed': {
        const payload = event.data
        if (payload?.txid) {
          setTransactions(prev => prev.filter(t => t.txid !== payload.txid))
        }
        break
      }
      case 'block_connected': {
        const block = event.data
        if (block && block.height !== undefined) {
          setBlocks(prev => {
            if (prev.some(b => b.height === block.height)) return prev
            return [block, ...prev].slice(0, 6)
          })
          setSnapshot(prev =>
            prev ? { ...prev, tip_height: block.height, tip_hash: block.hash } : null
          )
        }
        break
      }
      case 'mempool_updated': {
        const mempool = event.data
        if (mempool) {
          setSnapshot(prev =>
            prev
              ? {
                  ...prev,
                  mempool,
                  mempool_tx_count: mempool.tx_count,
                  mempool_size_bytes: mempool.size_bytes,
                }
              : null
          )
        }
        break
      }
    }
  }

  // Load initial snapshot and maintain WebSocket connection
  useEffect(() => {
    activeRef.current = true

    const loadInitialSnapshot = async () => {
      try {
        const snap = await api.liveSnapshot()
        if (!activeRef.current) return
        setSnapshot(snap)
        if (snap.recent_blocks !== undefined && snap.recent_blocks !== null) {
          setBlocks(snap.recent_blocks)
        }
        if (snap.latest_transactions !== undefined && snap.latest_transactions !== null) {
          setTransactions(snap.latest_transactions)
        }
        setErrorMessage('')
      } catch (err: unknown) {
        if (!activeRef.current) return
        const msg = err instanceof Error ? err.message : 'Could not reach Bitcoin Core node.'
        setErrorMessage(msg)
        setConnectionStatus('error')
      }
    }

    const connectWs = () => {
      if (!activeRef.current) return
      try {
        const url = api.liveStreamUrl()
        const ws = new WebSocket(url)
        wsRef.current = ws

        ws.onopen = () => {
          if (!activeRef.current) return
          setConnectionStatus('connected')
          setErrorMessage('')
        }

        ws.onmessage = (e) => {
          if (!activeRef.current) return
          try {
            const parsed = JSON.parse(e.data)
            // Strict runtime validation of WebSocket payload
            const event = liveEventSchema.parse(parsed)
            if (event) {
              handleEvent(event)
            }
          } catch {
            // safely ignore non-json or malformed payloads without crashing
          }
        }

        ws.onclose = () => {
          if (!activeRef.current) return
          setConnectionStatus('reconnecting')
          reconnectTimeoutRef.current = window.setTimeout(connectWs, 2000)
        }

        ws.onerror = () => {
          if (!activeRef.current) return
          setConnectionStatus('reconnecting')
        }
      } catch {
        if (activeRef.current) {
          setConnectionStatus('reconnecting')
          reconnectTimeoutRef.current = window.setTimeout(connectWs, 3000)
        }
      }
    }

    loadInitialSnapshot()
    connectWs()

    return () => {
      activeRef.current = false
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current)
      if (wsRef.current) wsRef.current.close()
    }
  }, [api])

  // Handle universal TXID search
  const handleSearch = async (e: FormEvent) => {
    e.preventDefault()
    const trimmed = searchQuery.trim()
    if (!trimmed) {
      setSearchError('Please enter a 64-character transaction ID.')
      return
    }
    if (!/^[0-9a-fA-F]{64}$/.test(trimmed)) {
      setSearchError('Invalid transaction ID: must be a 64-character hexadecimal string.')
      return
    }
    setSearchError('')
    inspectTxid(trimmed)
  }

  // Inspect TXID in full Transaction Explorer
  const inspectTxid = async (txid: string) => {
    setReportLoading(true)
    setReportError('')
    try {
      const report = await api.inspectTxid(txid)
      if (!activeRef.current) return
      setActiveReport(report)
      setSelectedTx(null)
    } catch (err: unknown) {
      if (!activeRef.current) return
      const msg = err instanceof Error ? err.message : 'Failed to inspect transaction via connected node.'
      setReportError(msg)
    } finally {
      setReportLoading(false)
    }
  }

  // Graph calculation for Phase 11 (in-mempool parent/child relationships)
  const { graphLinks, dagLayout, graphNodes } = useMemo(() => {
    const txMap = new Map<string, LiveTransaction>()
    for (const tx of transactions) {
      txMap.set(tx.txid, tx)
    }
    const links: Array<{ from: string; to: string }> = []
    const involvedTxids = new Set<string>()

    for (const tx of transactions) {
      if (Array.isArray(tx.depends)) {
        for (const parentTxid of tx.depends) {
          if (txMap.has(parentTxid)) {
            links.push({ from: parentTxid, to: tx.txid })
            involvedTxids.add(parentTxid)
            involvedTxids.add(tx.txid)
          }
        }
      }
    }

    // Deterministic DAG layout coordinates
    const layout = new Map<string, { x: number; y: number }>()
    const parents = Array.from(new Set(links.map(l => l.from)))
    const children = Array.from(new Set(links.map(l => l.to).filter(id => !parents.includes(id))))

    // Col 1: Parents (X = 40)
    parents.forEach((pid, idx) => {
      layout.set(pid, { x: 40, y: 30 + idx * 90 })
    })

    // Col 2: Children (X = 360)
    children.forEach((cid, idx) => {
      layout.set(cid, { x: 360, y: 30 + idx * 90 })
    })

    const nodes = Array.from(involvedTxids).map(id => txMap.get(id)!).filter(Boolean)

    return { graphLinks: links, dagLayout: layout, graphNodes: nodes }
  }, [transactions])

  // Close drawer on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedTx(null)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // If viewing full report, display ReportView with back button
  if (activeReport) {
    return (
      <div className="live-chain-report-wrapper">
        <div className="report-back-bar">
          <button
            type="button"
            className="button secondary back-to-live-btn"
            onClick={() => setActiveReport(null)}
          >
            ← Back to Live Chain
          </button>
          <span className="report-nav-tag">Transaction Explorer</span>
        </div>
        <ReportView report={activeReport} onClear={() => setActiveReport(null)} />
      </div>
    )
  }

  return (
    <div className="live-chain-page">
      <header className="live-chain-page-header">
        <h1 className="live-chain-title">Live Bitcoin Chain & Mempool</h1>
        <p className="live-chain-subtitle">
          Real-time Bitcoin block and mempool observability. Inspect transactions before signing.
        </p>
      </header>

      {/* Universal Search & Quick Navigation Header */}
      <section className="live-chain-search-section" aria-label="Universal transaction search">
        <form className="universal-search-form" onSubmit={handleSearch}>
          <div className="search-input-wrapper">
            <svg
              className="search-icon"
              viewBox="0 0 20 20"
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              aria-hidden="true"
            >
              <circle cx="9" cy="9" r="6" strokeWidth="2" />
              <path d="M13.5 13.5L18 18" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <input
              type="text"
              className="universal-search-input"
              placeholder="Search transaction ID (64-char hex)..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value)
                setSearchError('')
              }}
              aria-label="Search transaction ID"
            />
            {searchQuery && (
              <button
                type="button"
                className="search-clear-btn"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search input"
              >
                ×
              </button>
            )}
          </div>
          <button type="submit" className="button primary search-submit-btn" disabled={reportLoading}>
            Inspect TXID
          </button>
          {onNavigateInspector && (
            <button
              type="button"
              className="button secondary inspect-manually-btn"
              onClick={onNavigateInspector}
            >
              Inspect manually
            </button>
          )}
        </form>
        {searchError && <p className="search-error-msg">{searchError}</p>}
        {reportError && <p className="search-error-msg">{reportError}</p>}
      </section>

      {/* Chain Status Bar (Phase 7) */}
      <section className="chain-status-bar" aria-label="Bitcoin network status">
        <div className="status-metric-card network-card">
          <span className="metric-label">Network</span>
          <span className="metric-val network-pill">
            <span className="network-dot" aria-hidden="true" />
            {snapshot?.network || '—'}
          </span>
        </div>
        <div className="status-metric-card height-card">
          <span className="metric-label">Current Height</span>
          <span className="metric-val mono">
            {snapshot ? `#${snapshot.tip_height.toLocaleString()}` : '—'}
          </span>
        </div>
        <div className="status-metric-card mempool-card">
          <span className="metric-label">Mempool Transactions</span>
          <span className="metric-val mono">
            {snapshot ? (
              snapshot.mempool !== undefined && snapshot.mempool !== null ? (
                <>
                  {snapshot.mempool.tx_count.toLocaleString()}
                  {snapshot.mempool.size_bytes !== undefined && snapshot.mempool.size_bytes !== null && (
                    <span className="metric-subval">
                      {' '}
                      ({(snapshot.mempool.size_bytes / 1000).toFixed(1)} kB)
                    </span>
                  )}
                </>
              ) : snapshot.mempool_tx_count !== undefined && snapshot.mempool_tx_count !== null ? (
                <>
                  {snapshot.mempool_tx_count.toLocaleString()}
                  {snapshot.mempool_size_bytes !== undefined && snapshot.mempool_size_bytes !== null && (
                    <span className="metric-subval">
                      {' '}
                      ({(snapshot.mempool_size_bytes / 1000).toFixed(1)} kB)
                    </span>
                  )}
                </>
              ) : (
                <span className="metric-unavailable">Unavailable</span>
              )
            ) : (
              '—'
            )}
          </span>
        </div>
        <div className="status-metric-card block-card">
          <span className="metric-label">Latest Block Hash</span>
          <span className="metric-val mono hash-truncate" title={snapshot?.tip_hash}>
            {snapshot?.tip_hash ? truncateHash(snapshot.tip_hash, 8, 8) : '—'}
          </span>
        </div>
        <div className="status-metric-card stream-card">
          <span className="metric-label">Stream Status</span>
          <span
            className={`status-pill pill-${
              connectionStatus === 'connected'
                ? 'live'
                : connectionStatus === 'reconnecting'
                ? 'reconnecting'
                : 'offline'
            }`}
          >
            <span className="pulse-indicator" aria-hidden="true" />
            {connectionStatus === 'connected'
              ? 'Live (streaming)'
              : connectionStatus === 'reconnecting'
              ? 'Reconnecting…'
              : 'Offline'}
          </span>
        </div>
      </section>

      {/* Node Warning / Unavailable Banner */}
      {errorMessage && (
        <section className="node-warning-banner" role="alert">
          <span className="notice-icon" aria-hidden="true">⚠️</span>
          <div>
            <strong>Bitcoin Core Node Observation Notice:</strong> {errorMessage}
            <span className="notice-sub">
              Check that your Bitcoin Core daemon is running with RPC and configured on the TxSignX API.
            </span>
          </div>
        </section>
      )}

      {/* Recent Blocks Section (Phase 7) */}
      <section className="recent-blocks-section" aria-labelledby="recent-blocks-heading">
        <div className="section-title-row">
          <h2 id="recent-blocks-heading" className="section-title">
            Recent Blocks
          </h2>
          <span className="blocks-count-pill">{blocks.length} confirmed</span>
        </div>
        {(snapshot?.recent_blocks === undefined || snapshot?.recent_blocks === null) && blocks.length === 0 ? (
          <div className="empty-blocks-state">
            <span className="muted">Recent block data unavailable from node.</span>
          </div>
        ) : blocks.length === 0 ? (
          <div className="empty-blocks-state">
            <span className="muted">No blocks observed yet. Waiting for chain updates…</span>
          </div>
        ) : (
          <div className="recent-blocks-track" role="region" aria-label="Recent blocks horizontal list">
            {blocks.slice(0, 6).map((block) => (
              <div key={block.hash} className="recent-block-card">
                <div className="block-header-row">
                  <span className="block-height-tag">#{block.height}</span>
                  <span className="block-time-ago">{formatRelativeTime(block.timestamp)}</span>
                </div>
                <div className="block-hash-row" title={block.hash}>
                  <code>{truncateHash(block.hash, 6, 6)}</code>
                </div>
                <div className="block-metrics-row">
                  <div className="block-metric">
                    <span className="sublabel">Transactions</span>
                    <span className="mono">{block.tx_count.toLocaleString()}</span>
                  </div>
                  {block.weight !== undefined && block.weight !== null && (
                    <div className="block-metric">
                      <span className="sublabel">Weight</span>
                      <span className="mono">{(block.weight / 1000).toFixed(0)} kWU</span>
                    </div>
                  )}
                  {block.size !== undefined && block.size !== null && (
                    <div className="block-metric">
                      <span className="sublabel">Size</span>
                      <span className="mono">{(block.size / 1000).toFixed(1)} kB</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* TxSignX Live Flow Section (Phase 8 & 11) */}
      <section className="live-flow-section" aria-labelledby="live-flow-heading">
        <div className="live-flow-header">
          <div className="flow-title-group">
            <h2 id="live-flow-heading" className="section-title">
              TxSignX Live Flow
            </h2>
            <span className="live-count-badge">
              {transactions.length} mempool {transactions.length === 1 ? 'entry' : 'entries'}
            </span>
          </div>

          {/* View mode toggle: Flow vs Graph (Phase 11) */}
          <div className="view-mode-toggle" role="radiogroup" aria-label="View display mode">
            <label className={`toggle-option ${viewMode === 'flow' ? 'active' : ''}`}>
              <input
                type="radio"
                name="viewMode"
                value="flow"
                checked={viewMode === 'flow'}
                onChange={() => setViewMode('flow')}
              />
              Live Flow
            </label>
            <label className={`toggle-option ${viewMode === 'graph' ? 'active' : ''}`}>
              <input
                type="radio"
                name="viewMode"
                value="graph"
                checked={viewMode === 'graph'}
                onChange={() => setViewMode('graph')}
              />
              Transaction Flow Graph {graphLinks.length > 0 && `(${graphLinks.length} links)`}
            </label>
          </div>
        </div>

        {/* Visual Encoding Legend */}
        <div className="flow-legend-bar" aria-label="Visual encoding legend">
          <span className="legend-label">Encoding Legend:</span>
          <span className="legend-item">
            <span className="legend-swatch size-swatch" aria-hidden="true" />
            Node width/size = Virtual Size (vB)
          </span>
          <span className="legend-item">
            <span className="legend-swatch rbf-swatch" aria-hidden="true" />
            Amber outline = BIP 125 Explicit RBF
          </span>
          <span className="legend-item">
            <span className="legend-badge segwit-sample">SegWit</span>
            SegWit witness data present
          </span>
          <span className="legend-item">
            <span className="legend-pill fee-sample">X sat/vB</span>
            Numeric fee rate
          </span>
        </div>

        {/* Flow Visual Area */}
        {(snapshot?.latest_transactions === undefined || snapshot?.latest_transactions === null) && transactions.length === 0 ? (
          <div className="empty-flow-panel">
            <h3>Mempool transaction data unavailable</h3>
            <p className="muted">
              Could not retrieve mempool transactions from the connected node.
            </p>
          </div>
        ) : transactions.length === 0 ? (
          <div className="empty-flow-panel">
            <div className="empty-flow-icon" aria-hidden="true">
              <svg viewBox="0 0 48 48" width="48" height="48" fill="none">
                <circle cx="24" cy="24" r="22" stroke="#243041" strokeWidth="2" strokeDasharray="4 4" />
                <path d="M16 24H32M24 16V32" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
            <h3>Mempool is currently empty on this node</h3>
            <p className="muted">
              Listening for new unconfirmed transactions via the connected TxSignX live stream…
            </p>
          </div>
        ) : viewMode === 'flow' ? (
          <div className="flow-nodes-grid" role="region" aria-label="Live mempool transactions">
            {transactions.map((tx) => {
              const isLarge = tx.vsize > 300
              const isRbf = tx.explicit_rbf === true
              const hasWitness = tx.has_witness === true
              const isSelected = selectedTx?.txid === tx.txid

              return (
                <button
                  type="button"
                  key={tx.txid}
                  className={`live-tx-node ${isLarge ? 'node-large' : 'node-normal'} ${
                    isRbf ? 'rbf-indicated' : ''
                  } ${isSelected ? 'selected' : ''}`}
                  onClick={() => setSelectedTx(tx)}
                  aria-label={`Transaction ${truncateHash(tx.txid, 6, 6)}, ${tx.vsize} vB, fee rate ${
                    tx.fee_rate !== undefined && tx.fee_rate !== null ? tx.fee_rate.toFixed(1) : '—'
                  } sat per vB`}
                >
                  <div className="node-top-row">
                    <span className="node-txid-short">
                      <code>{truncateHash(tx.txid, 5, 4)}</code>
                    </span>
                    {hasWitness && <span className="node-segwit-badge">W</span>}
                  </div>
                  <div className="node-metrics-row">
                    <span className="node-vsize">{tx.vsize} vB</span>
                    <span className="node-feerate">
                      {tx.fee_rate !== undefined && tx.fee_rate !== null ? `${tx.fee_rate.toFixed(1)} s/vB` : '—'}
                    </span>
                  </div>
                  {isRbf && <span className="node-rbf-indicator" title="BIP 125 Explicit RBF">RBF</span>}
                </button>
              )
            })}
          </div>
        ) : (
          /* Transaction Flow Graph Mode (Phase 11) */
          <div className="transaction-flow-graph-container" role="region" aria-label="Transaction Flow Graph">
            <div className="graph-banner">
              <span>
                Bounded in-mempool relationship graph. Links show unconfirmed child transactions spending outputs from parent transactions inside the visible dataset.
              </span>
            </div>
            {graphLinks.length === 0 ? (
              <div className="graph-empty-links">
                <span className="muted">
                  No unconfirmed parent/child dependencies among currently visible mempool transactions. Each transaction is spending confirmed previous outputs.
                </span>
                <div className="graph-standalone-grid">
                  {transactions.slice(0, 40).map((tx) => (
                    <button
                      type="button"
                      key={tx.txid}
                      className="standalone-graph-node"
                      onClick={() => setSelectedTx(tx)}
                    >
                      <code>{truncateHash(tx.txid, 6, 4)}</code>
                      <span className="sub-vsize">{tx.vsize} vB</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="graph-dag-canvas" style={{ position: 'relative', minHeight: '320px' }}>
                {/* SVG connection lines matching exact node coordinates */}
                <svg
                  className="graph-svg"
                  width="100%"
                  height={Math.max(320, (graphNodes.length + 1) * 90)}
                  style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}
                >
                  <defs>
                    <marker
                      id="arrowhead"
                      markerWidth="10"
                      markerHeight="7"
                      refX="9"
                      refY="3.5"
                      orient="auto"
                    >
                      <polygon points="0 0, 10 3.5, 0 7" fill="#f7931a" />
                    </marker>
                  </defs>
                  {graphLinks.map((link, idx) => {
                    const parentPos = dagLayout.get(link.from) || { x: 40, y: 30 + idx * 90 }
                    const childPos = dagLayout.get(link.to) || { x: 360, y: 30 + idx * 90 }
                    const startX = parentPos.x + 200
                    const startY = parentPos.y + 34
                    const endX = childPos.x
                    const endY = childPos.y + 34
                    return (
                      <line
                        key={`${link.from}-${link.to}-${idx}`}
                        className="graph-link-line"
                        x1={startX}
                        y1={startY}
                        x2={endX}
                        y2={endY}
                        stroke="#f7931a"
                        strokeWidth="2"
                        strokeDasharray="4 2"
                        markerEnd="url(#arrowhead)"
                      />
                    )
                  })}
                </svg>

                {/* Deterministic positioned node cards */}
                <div className="graph-dag-nodes" style={{ position: 'relative', minHeight: '320px' }}>
                  {graphNodes.map((tx) => {
                    const pos = dagLayout.get(tx.txid) || { x: 40, y: 30 }
                    return (
                      <button
                        type="button"
                        key={tx.txid}
                        className={`graph-node-card ${selectedTx?.txid === tx.txid ? 'selected' : ''}`}
                        style={{ position: 'absolute', left: `${pos.x}px`, top: `${pos.y}px`, width: '200px' }}
                        onClick={() => setSelectedTx(tx)}
                      >
                        <div className="node-card-id">
                          <code>{truncateHash(tx.txid, 6, 4)}</code>
                        </div>
                        <div className="node-card-sub">
                          <span>{tx.vsize} vB</span>
                          <span>{tx.fee_rate !== undefined && tx.fee_rate !== null ? `${tx.fee_rate.toFixed(1)} s/vB` : '—'}</span>
                        </div>
                      </button>
                    )
                  })}
                </div>

                {/* Explicit Parent -> Child Relationship Summary List */}
                <div className="graph-relationship-list" style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid #243041' }}>
                  <h4 style={{ margin: '0 0 10px 0', fontSize: '13px', color: '#94a3b8' }}>Observed In-Mempool Dependencies</h4>
                  {graphLinks.map((link, idx) => (
                    <div key={`${link.from}->${link.to}-${idx}`} className="dag-edge-row" style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '6px', fontSize: '13px' }}>
                      <span className="mono" style={{ color: '#60a5fa' }}>Parent {truncateHash(link.from, 6, 4)}</span>
                      <span style={{ color: '#f7931a' }}>→</span>
                      <span className="mono" style={{ color: '#34d399' }}>Child {truncateHash(link.to, 6, 4)}</span>
                      <span style={{ color: '#64748b', fontSize: '11px' }}>(Spends unconfirmed parent output)</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Transaction Preview Side Drawer (Phase 9) */}
      {selectedTx && (
        <div className="drawer-overlay" onClick={() => setSelectedTx(null)}>
          <aside
            className="drawer-panel"
            role="dialog"
            aria-label="Transaction Preview"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="drawer-header">
              <div className="drawer-title-group">
                <span className="drawer-badge">Live Mempool Entry</span>
                <h3 className="drawer-title">Transaction Preview</h3>
              </div>
              <button
                type="button"
                className="drawer-close-btn"
                onClick={() => setSelectedTx(null)}
                aria-label="Close preview drawer"
              >
                ×
              </button>
            </div>

            <div className="drawer-content">
              {/* TXID Display */}
              <div className="drawer-txid-card">
                <span className="sublabel">Transaction ID (TXID)</span>
                <code className="mono txid-full-code">{selectedTx.txid}</code>
              </div>

              {/* Status */}
              <div className="drawer-stat-item status-item">
                <span className="stat-label">Confirmation Status</span>
                <span className="status-pill pill-mempool">In Mempool (0 confirmations)</span>
              </div>

              {/* Numerical facts */}
              <div className="drawer-stats-grid">
                <div className="drawer-stat-item">
                  <span className="stat-label">Virtual Size</span>
                  <span className="stat-val mono">{selectedTx.vsize} vB</span>
                </div>
                <div className="drawer-stat-item">
                  <span className="stat-label">Weight</span>
                  <span className="stat-val mono">{selectedTx.weight.toLocaleString()} WU</span>
                </div>
                <div className="drawer-stat-item">
                  <span className="stat-label">Fee</span>
                  <span className="stat-val mono">
                    {selectedTx.fee_sats !== undefined && selectedTx.fee_sats !== null
                      ? `${selectedTx.fee_sats.toLocaleString()} sats`
                      : 'Unavailable'}
                  </span>
                </div>
                <div className="drawer-stat-item">
                  <span className="stat-label">Fee Rate</span>
                  <span className="stat-val mono">
                    {selectedTx.fee_rate !== undefined && selectedTx.fee_rate !== null
                      ? `${selectedTx.fee_rate.toFixed(1)} sat/vB`
                      : 'Unavailable'}
                  </span>
                </div>
                <div className="drawer-stat-item">
                  <span className="stat-label">Inputs</span>
                  <span className="stat-val mono">
                    {selectedTx.input_count !== undefined && selectedTx.input_count !== null
                      ? selectedTx.input_count
                      : 'Unavailable'}
                  </span>
                </div>
                <div className="drawer-stat-item">
                  <span className="stat-label">Outputs</span>
                  <span className="stat-val mono">
                    {selectedTx.output_count !== undefined && selectedTx.output_count !== null
                      ? selectedTx.output_count
                      : 'Unavailable'}
                  </span>
                </div>
              </div>

              {/* SegWit & RBF Badges */}
              <div className="drawer-badges-row">
                <div className="drawer-badge-group">
                  <span className="sublabel">SegWit Witness Data</span>
                  <span
                    className={`status-pill ${
                      selectedTx.has_witness === true
                        ? 'pill-segwit'
                        : selectedTx.has_witness === false
                        ? 'pill-neutral'
                        : 'pill-unavailable'
                    }`}
                  >
                    {selectedTx.has_witness === true
                      ? 'Yes (Witness Present)'
                      : selectedTx.has_witness === false
                      ? 'No'
                      : 'Unavailable'}
                  </span>
                </div>
                <div className="drawer-badge-group">
                  <span className="sublabel">BIP 125 Explicit RBF</span>
                  <span
                    className={`status-pill ${
                      selectedTx.explicit_rbf === true
                        ? 'pill-rbf'
                        : selectedTx.explicit_rbf === false
                        ? 'pill-neutral'
                        : 'pill-unavailable'
                    }`}
                  >
                    {selectedTx.explicit_rbf === true
                      ? 'Explicit RBF Enabled'
                      : selectedTx.explicit_rbf === false
                      ? 'No'
                      : 'Unavailable'}
                  </span>
                </div>
              </div>

              {selectedTx.mempool_replaceable !== undefined && selectedTx.mempool_replaceable !== null && (
                <div className="drawer-stat-item" style={{ marginTop: '12px' }}>
                  <span className="sublabel">Mempool Replaceability (Node Policy)</span>
                  <span className="stat-val mono" style={{ fontSize: '13px' }}>
                    {selectedTx.mempool_replaceable ? 'Yes (Mempool Policy)' : 'No'}
                  </span>
                </div>
              )}

              {selectedTx.wtxid && (
                <div className="drawer-txid-card" style={{ marginTop: '12px' }}>
                  <span className="sublabel">Witness Transaction ID (wTXID)</span>
                  <code className="mono txid-full-code">{selectedTx.wtxid}</code>
                </div>
              )}

              {/* CTA Button: Explore Transaction */}
              <div className="drawer-actions">
                <button
                  type="button"
                  className="button primary explore-tx-btn"
                  onClick={() => inspectTxid(selectedTx.txid)}
                  disabled={reportLoading}
                >
                  {reportLoading ? 'Loading Explorer Report…' : 'Explore Transaction →'}
                </button>
              </div>
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}
