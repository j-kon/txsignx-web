import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { ApiClient } from '../lib/api/client'
import type { LiveSnapshot, LiveTransaction, RecentBlock, Report } from '../lib/api/schema'
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

  // Handle live incoming events
  const handleEvent = (event: { type: string; data?: unknown }) => {
    if (!event || typeof event !== 'object' || !activeRef.current) return

    switch (event.type) {
      case 'snapshot': {
        const snap = event.data as LiveSnapshot
        if (snap) {
          setSnapshot(snap)
          if (Array.isArray(snap.recent_blocks)) setBlocks(snap.recent_blocks)
          if (Array.isArray(snap.latest_transactions)) setTransactions(snap.latest_transactions)
        }
        break
      }
      case 'transaction_added': {
        const tx = event.data as LiveTransaction
        if (tx && tx.txid) {
          setTransactions(prev => {
            if (prev.some(t => t.txid === tx.txid)) return prev
            return [tx, ...prev].slice(0, 200)
          })
          setSnapshot(prev => (prev ? { ...prev, mempool_tx_count: prev.mempool_tx_count + 1 } : null))
        }
        break
      }
      case 'transaction_removed': {
        const payload = event.data as { txid: string }
        if (payload?.txid) {
          setTransactions(prev => prev.filter(t => t.txid !== payload.txid))
          setSnapshot(prev =>
            prev ? { ...prev, mempool_tx_count: Math.max(0, prev.mempool_tx_count - 1) } : null
          )
        }
        break
      }
      case 'transaction_confirmed': {
        const payload = event.data as { txid: string }
        if (payload?.txid) {
          setTransactions(prev => prev.filter(t => t.txid !== payload.txid))
        }
        break
      }
      case 'block_connected': {
        const block = event.data as RecentBlock
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
        setBlocks(snap.recent_blocks || [])
        setTransactions(snap.latest_transactions || [])
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
            handleEvent(parsed)
          } catch {
            // ignore non-json
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

  // Universal TXID search
  const handleSearch = async (e: FormEvent) => {
    e.preventDefault()
    setSearchError('')
    const clean = searchQuery.trim()
    if (!clean) return

    if (!/^[0-9a-fA-F]{64}$/.test(clean)) {
      setSearchError('Enter a valid 64-character hexadecimal transaction ID.')
      return
    }

    await inspectTxid(clean)
  }

  // Full inspection using existing Transaction Explorer
  const inspectTxid = async (txid: string) => {
    setReportLoading(true)
    setReportError('')
    try {
      const report = await api.inspectTxid(txid)
      setActiveReport(report)
      setSelectedTx(null)
    } catch (err: unknown) {
      setReportError(err instanceof Error ? err.message : 'Could not inspect transaction.')
    } finally {
      setReportLoading(false)
    }
  }

  // Graph calculation for Phase 11 (in-mempool parent/child relationships)
  const graphLinks = useMemo(() => {
    const txMap = new Map<string, LiveTransaction>()
    for (const tx of transactions) {
      txMap.set(tx.txid, tx)
    }
    const links: Array<{ from: string; to: string }> = []
    for (const tx of transactions) {
      if (Array.isArray(tx.depends)) {
        for (const parentTxid of tx.depends) {
          if (txMap.has(parentTxid)) {
            links.push({ from: parentTxid, to: tx.txid })
          }
        }
      }
    }
    return links
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
        <div className="report-navigation-bar">
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
            {reportLoading ? 'Inspecting…' : 'Inspect TXID'}
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
        {searchError && (
          <div className="search-error-banner" role="alert">
            {searchError}
          </div>
        )}
        {reportError && (
          <div className="search-error-banner" role="alert">
            {reportError}
          </div>
        )}
      </section>

      {/* Chain Status Bar (Phase 7) */}
      <section className="chain-status-bar" aria-label="Bitcoin network status">
        <div className="status-metric-card network-card">
          <span className="metric-label">Network</span>
          <span className="metric-val network-pill">
            <span className="network-dot" aria-hidden="true" />
            {snapshot?.network || 'regtest'}
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
            {snapshot ? snapshot.mempool_tx_count.toLocaleString() : '—'}
            {snapshot?.mempool_size_bytes !== undefined && snapshot.mempool_size_bytes !== null && (
              <span className="metric-subval">
                {' '}
                ({(snapshot.mempool_size_bytes / 1000).toFixed(1)} kB)
              </span>
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
        <section className="node-notice-banner" role="alert">
          <div className="notice-icon" aria-hidden="true">⚠️</div>
          <div className="notice-body">
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
        {blocks.length === 0 ? (
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

          {/* Mode Switcher: Flow vs Flow Graph (Phase 11) */}
          <div className="flow-mode-toggle" role="radiogroup" aria-label="Live flow display mode">
            <button
              type="button"
              className={`toggle-option ${viewMode === 'flow' ? 'active' : ''}`}
              onClick={() => setViewMode('flow')}
              role="radio"
              aria-checked={viewMode === 'flow'}
            >
              Live Flow
            </button>
            <button
              type="button"
              className={`toggle-option ${viewMode === 'graph' ? 'active' : ''}`}
              onClick={() => setViewMode('graph')}
              role="radio"
              aria-checked={viewMode === 'graph'}
            >
              Transaction Flow Graph {graphLinks.length > 0 && `(${graphLinks.length} links)`}
            </button>
          </div>
        </div>

        {/* Visual Legend (Phase 8) */}
        <div className="flow-legend" aria-label="Visual properties legend">
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
        {transactions.length === 0 ? (
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
              // Node visual encoding
              const isLarge = tx.vsize > 300
              const isRbf = tx.explicit_rbf
              const hasWitness = tx.has_witness
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
              <div className="graph-dag-canvas">
                <svg className="graph-svg" width="100%" height="320">
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
                    const startX = 60 + (idx % 6) * 160
                    const startY = 60 + Math.floor(idx / 6) * 120
                    const endX = startX + 110
                    const endY = startY + 40
                    return (
                      <line
                        key={`${link.from}-${link.to}-${idx}`}
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
                <div className="graph-dag-nodes">
                  {transactions.slice(0, 30).map((tx) => (
                    <button
                      type="button"
                      key={tx.txid}
                      className={`graph-node-card ${selectedTx?.txid === tx.txid ? 'selected' : ''}`}
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
            className="transaction-preview-drawer"
            role="dialog"
            aria-label="Transaction Preview"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="drawer-header">
              <div className="drawer-title-group">
                <span className="drawer-pretitle">Transaction Preview</span>
                <h3 className="drawer-title">
                  <code>{truncateHash(selectedTx.txid, 8, 8)}</code>
                </h3>
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
              {/* Full TXID Card */}
              <div className="drawer-txid-card">
                <span className="sublabel">Full Transaction ID</span>
                <code className="mono txid-full-code">{selectedTx.txid}</code>
              </div>

              {/* Status */}
              <div className="drawer-metric-row">
                <span className="drawer-field-label">Confirmation Status</span>
                <span className="status-pill pill-mempool">In Mempool (0 confirmations)</span>
              </div>

              {/* Metrics Grid */}
              <div className="drawer-stats-grid">
                <div className="drawer-stat-item">
                  <span className="stat-label">Virtual Size</span>
                  <span className="stat-val mono">{selectedTx.vsize.toLocaleString()} vB</span>
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
                  <span className="stat-val mono">{selectedTx.input_count}</span>
                </div>
                <div className="drawer-stat-item">
                  <span className="stat-label">Outputs</span>
                  <span className="stat-val mono">{selectedTx.output_count}</span>
                </div>
              </div>

              {/* SegWit & RBF Badges */}
              <div className="drawer-badges-row">
                <div className="drawer-badge-group">
                  <span className="sublabel">SegWit Witness Data</span>
                  <span className={`status-pill ${selectedTx.has_witness ? 'pill-segwit' : 'pill-neutral'}`}>
                    {selectedTx.has_witness ? 'Yes (Witness Present)' : 'No'}
                  </span>
                </div>
                <div className="drawer-badge-group">
                  <span className="sublabel">BIP 125 Replace-By-Fee</span>
                  <span className={`status-pill ${selectedTx.explicit_rbf ? 'pill-rbf' : 'pill-neutral'}`}>
                    {selectedTx.explicit_rbf ? 'Explicit RBF Enabled' : 'No'}
                  </span>
                </div>
              </div>

              {selectedTx.wtxid && (
                <div className="drawer-txid-card">
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
