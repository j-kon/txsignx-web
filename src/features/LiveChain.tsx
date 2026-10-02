import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { ApiClient } from '../lib/api/client'
import {
  type BlockDetails,
  type BlockTransactionItem,
  type LiveEvent,
  type LiveSnapshot,
  type LiveTransaction,
  type RecentBlock,
  type Report,
  liveEventSchema,
} from '../lib/api/schema'
import { ReportView } from './ReportView'
import { getAdaptiveTimeWindow, computeCollisionFreeLayout } from './liveStreamLayout'

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

function formatUtcTime(timestamp?: number): string {
  if (!timestamp) return 'Unavailable'
  const date = new Date(timestamp * 1000)
  return date.toISOString().replace('T', ' ').replace('.000Z', ' UTC')
}

function truncateHash(hash: string, start = 8, end = 8): string {
  if (!hash || hash.length <= start + end) return hash
  return `${hash.slice(0, start)}…${hash.slice(-end)}`
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fallback
  }
  try {
    const el = document.createElement('textarea')
    el.value = text
    el.setAttribute('readonly', '')
    el.style.position = 'absolute'
    el.style.left = '-9999px'
    document.body.appendChild(el)
    el.select()
    const success = document.execCommand('copy')
    document.body.removeChild(el)
    return success
  } catch {
    return false
  }
}

export function LiveChain({ api, onNavigateInspector }: LiveChainProps) {
  const [snapshot, setSnapshot] = useState<LiveSnapshot | null>(null)
  const [blocks, setBlocks] = useState<RecentBlock[]>([])
  const [transactions, setTransactions] = useState<LiveTransaction[]>([])
  const [connectionStatus, setConnectionStatus] = useState<
    'connecting' | 'connected' | 'reconnecting' | 'error'
  >('connecting')
  const [errorMessage, setErrorMessage] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchError, setSearchError] = useState('')
  const [viewMode, setViewMode] = useState<'flow' | 'graph'>('flow')

  // Selected mempool transaction for preview drawer
  const [selectedTx, setSelectedTx] = useState<LiveTransaction | null>(null)
  const [copiedField, setCopiedField] = useState<string | null>(null)

  // Selected block for block detail drawer
  const [selectedBlock, setSelectedBlock] = useState<{
    hash: string
    height?: number
  } | null>(null)
  const [blockDetailsData, setBlockDetailsData] = useState<BlockDetails | null>(null)
  const [blockDetailsLoading, setBlockDetailsLoading] = useState(false)
  const [blockDetailsLoadingMore, setBlockDetailsLoadingMore] = useState(false)
  const [blockDetailsError, setBlockDetailsError] = useState('')

  // Track navigation origin for breadcrumb when opening full Transaction Explorer
  const [navigatedFromBlock, setNavigatedFromBlock] = useState<{
    hash: string
    height: number
  } | null>(null)

  // Full Transaction Explorer report view
  const [activeReport, setActiveReport] = useState<Report | null>(null)
  const [reportLoading, setReportLoading] = useState(false)
  const [reportError, setReportError] = useState('')

  // Animated TIP flash state when new block connects
  const [newlyConnectedBlockHash, setNewlyConnectedBlockHash] = useState<string | null>(null)

  // Clock tick for Live Flow time stream positioning (ticks every 1s)
  const [nowSeconds, setNowSeconds] = useState(() => Math.floor(Date.now() / 1000))

  // Track new txids for one-time arrival animation
  const [newTxids, setNewTxids] = useState<Set<string>>(new Set())

  const activeRef = useRef(true)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<number | undefined>(undefined)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const triggerElementRef = useRef<HTMLElement | null>(null)
  const railContainerRef = useRef<HTMLDivElement | null>(null)
  const tipCardRef = useRef<HTMLButtonElement | null>(null)
  const initialScrollDoneRef = useRef(false)
  const userScrolledHistoricalRef = useRef(false)
  const isAutoScrollingRef = useRef(false)

  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches

  const scrollToTip = useCallback((smooth = true) => {
    if (!tipCardRef.current) return
    isAutoScrollingRef.current = true
    const behavior = !smooth || prefersReducedMotion ? 'auto' : 'smooth'
    if (typeof tipCardRef.current.scrollIntoView === 'function') {
      tipCardRef.current.scrollIntoView({
        behavior,
        inline: 'end',
        block: 'nearest',
      })
    }
    setTimeout(() => {
      isAutoScrollingRef.current = false
    }, 50)
  }, [prefersReducedMotion])

  const handleRailScroll = () => {
    if (isAutoScrollingRef.current) return
    const container = railContainerRef.current
    if (!container) return
    const maxScrollLeft = container.scrollWidth - container.clientWidth
    if (container.scrollLeft < maxScrollLeft - 40) {
      userScrolledHistoricalRef.current = true
    } else {
      userScrolledHistoricalRef.current = false
    }
  }

  // Clock tick timer
  useEffect(() => {
    const timer = setInterval(() => {
      setNowSeconds(Math.floor(Date.now() / 1000))
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  // Keyboard shortcut: Cmd+K / Ctrl+K to focus search input
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        searchInputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

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
          setNewTxids((prev) => new Set(prev).add(tx.txid))
          setTransactions((prev) => {
            if (prev.some((t) => t.txid === tx.txid)) return prev
            return [tx, ...prev].slice(0, 200)
          })
          // Remove new pulse tag after 2.5s
          setTimeout(() => {
            if (activeRef.current) {
              setNewTxids((prev) => {
                const updated = new Set(prev)
                updated.delete(tx.txid)
                return updated
              })
            }
          }, 2500)
        }
        break
      }
      case 'transaction_removed': {
        const payload = event.data
        if (payload?.txid) {
          setTransactions((prev) => prev.filter((t) => t.txid !== payload.txid))
        }
        break
      }
      case 'transaction_confirmed': {
        const payload = event.data
        if (payload?.txid) {
          setTransactions((prev) => prev.filter((t) => t.txid !== payload.txid))
        }
        break
      }
      case 'block_connected': {
        const block = event.data
        if (block && block.height !== undefined) {
          setNewlyConnectedBlockHash(block.hash)
          setBlocks((prev) => {
            if (prev.some((b) => b.height === block.height)) return prev
            return [block, ...prev].slice(0, 6)
          })
          setSnapshot((prev) =>
            prev ? { ...prev, tip_height: block.height, tip_hash: block.hash } : null
          )
          // Smoothly scroll to new tip if user is not inspecting older blocks
          if (!userScrolledHistoricalRef.current) {
            setTimeout(() => {
              scrollToTip(true)
            }, 50)
          }
          // Soft flash for 2.5s on new tip
          setTimeout(() => {
            if (activeRef.current) {
              setNewlyConnectedBlockHash(null)
            }
          }, 2500)
        }
        break
      }
      case 'mempool_updated': {
        const mempool = event.data
        if (mempool) {
          setSnapshot((prev) =>
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

  const handleEventRef = useRef(handleEvent)
  useEffect(() => {
    handleEventRef.current = handleEvent
  })

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
            const event = liveEventSchema.parse(parsed)
            if (event) {
              handleEventRef.current(event)
            }
          } catch {
            // safely ignore non-json or malformed payloads
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
  const inspectTxid = async (txid: string, fromBlock?: { hash: string; height: number }) => {
    setReportLoading(true)
    setReportError('')
    if (fromBlock) {
      setNavigatedFromBlock(fromBlock)
    } else {
      setNavigatedFromBlock(null)
    }
    try {
      const report = await api.inspectTxid(txid)
      if (!activeRef.current) return
      setActiveReport(report)
      setSelectedTx(null)
      setSelectedBlock(null)
    } catch (err: unknown) {
      if (!activeRef.current) return
      const msg =
        err instanceof Error ? err.message : 'Failed to inspect transaction via connected node.'
      setReportError(msg)
    } finally {
      setReportLoading(false)
    }
  }

  // Open Block Details Drawer
  const openBlockDrawer = async (hash: string, heightHint?: number) => {
    triggerElementRef.current = document.activeElement as HTMLElement
    setSelectedBlock({ hash, height: heightHint })
    setBlockDetailsLoading(true)
    setBlockDetailsError('')
    setBlockDetailsData(null)
    try {
      const details = await api.blockDetails(hash, 0, 50)
      if (!activeRef.current) return
      setBlockDetailsData(details)
      setSelectedBlock({ hash: details.hash, height: details.height })
    } catch (err: unknown) {
      if (!activeRef.current) return
      const msg = err instanceof Error ? err.message : 'Failed to retrieve block details.'
      setBlockDetailsError(msg)
    } finally {
      setBlockDetailsLoading(false)
    }
  }

  // Load more transactions in Block Details Drawer
  const loadMoreBlockTransactions = async () => {
    if (!blockDetailsData || !blockDetailsData.transactions.has_more || blockDetailsLoadingMore) return
    setBlockDetailsLoadingMore(true)
    const nextOffset =
      blockDetailsData.transactions.offset + blockDetailsData.transactions.items.length
    try {
      const nextBatch = await api.blockDetails(blockDetailsData.hash, nextOffset, 50)
      if (!activeRef.current) return
      setBlockDetailsData((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          transactions: {
            ...nextBatch.transactions,
            items: [...prev.transactions.items, ...nextBatch.transactions.items],
          },
        }
      })
    } catch (err: unknown) {
      if (!activeRef.current) return
      const msg =
        err instanceof Error ? err.message : 'Failed to load additional transactions.'
      setBlockDetailsError(msg)
    } finally {
      setBlockDetailsLoadingMore(false)
    }
  }

  // Close Block Details Drawer with focus restoration
  const closeBlockDrawer = () => {
    setSelectedBlock(null)
    setBlockDetailsData(null)
    setBlockDetailsError('')
    if (triggerElementRef.current) {
      triggerElementRef.current.focus()
    }
  }

  // Close Transaction Preview Drawer with focus restoration
  const closeTxDrawer = () => {
    setSelectedTx(null)
    setCopiedField(null)
    if (triggerElementRef.current) {
      triggerElementRef.current.focus()
    }
  }

  // Copy helper
  const handleCopy = async (field: string, text: string) => {
    const ok = await copyToClipboard(text)
    if (ok) {
      setCopiedField(field)
      setTimeout(() => {
        if (activeRef.current) setCopiedField(null)
      }, 2000)
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

    // Deterministic compact DAG layout coordinates
    const layout = new Map<string, { x: number; y: number }>()
    const parents = Array.from(new Set(links.map((l) => l.from)))
    const children = Array.from(new Set(links.map((l) => l.to).filter((id) => !parents.includes(id))))

    // Col 1: Parents (X = 40)
    parents.forEach((pid, idx) => {
      layout.set(pid, { x: 40, y: 30 + idx * 90 })
    })

    // Col 2: Children (X = 360)
    children.forEach((cid, idx) => {
      layout.set(cid, { x: 360, y: 30 + idx * 90 })
    })

    const nodes = Array.from(involvedTxids)
      .map((id) => txMap.get(id)!)
      .filter(Boolean)

    return { graphLinks: links, dagLayout: layout, graphNodes: nodes }
  }, [transactions])

  // Ordered blocks for Chain Rail: Older blocks on left -> Tip block on right
  const railBlocks = useMemo(() => {
    if (!blocks || blocks.length === 0) return []
    // Take up to 6 blocks and sort ascending by height (older on left, tip on right)
    return [...blocks].slice(0, 6).sort((a, b) => a.height - b.height)
  }, [blocks])

  // Tip block is the one with highest height
  const tipBlock = railBlocks.length > 0 ? railBlocks[railBlocks.length - 1] : null

  // Auto-scroll current tip into view on initial block load
  useEffect(() => {
    if (railBlocks.length > 0 && !initialScrollDoneRef.current) {
      initialScrollDoneRef.current = true
      const timer = setTimeout(() => {
        scrollToTip(false)
      }, 50)
      return () => clearTimeout(timer)
    }
  }, [railBlocks.length, scrollToTip])

  // Escape key closes open drawers
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (selectedBlock) {
          closeBlockDrawer()
        } else if (selectedTx) {
          closeTxDrawer()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedBlock, selectedTx])

  // Animated stream nodes: bounded to 100 most recent transactions
  const visibleTransactions = useMemo(() => transactions.slice(0, 100), [transactions])
  const timeStampedTxs = useMemo(
    () => visibleTransactions.filter(
      (tx) => tx.first_seen_at !== undefined && tx.first_seen_at !== null
    ),
    [visibleTransactions]
  )
  const unstampedTxs = useMemo(
    () => visibleTransactions.filter(
      (tx) => tx.first_seen_at === undefined || tx.first_seen_at === null
    ),
    [visibleTransactions]
  )

  const maxTxAge = useMemo(() => {
    if (timeStampedTxs.length === 0) return 0
    return Math.max(
      ...timeStampedTxs.map((t) => Math.max(0, nowSeconds - (t.first_seen_at ?? nowSeconds)))
    )
  }, [timeStampedTxs, nowSeconds])

  const adaptiveWindow = useMemo(() => {
    return getAdaptiveTimeWindow(maxTxAge)
  }, [maxTxAge])

  const layoutMap = useMemo(() => {
    return computeCollisionFreeLayout(timeStampedTxs, adaptiveWindow.windowSeconds, nowSeconds)
  }, [timeStampedTxs, adaptiveWindow.windowSeconds, nowSeconds])

  // If viewing full report, display ReportView with breadcrumb bar
  if (activeReport) {
    return (
      <div className="live-chain-report-wrapper">
        <div className="report-back-bar">
          {navigatedFromBlock ? (
            <div className="report-back-group">
              <button
                type="button"
                className="button secondary back-to-block-btn"
                onClick={() => {
                  setActiveReport(null)
                  // Re-open block drawer for the originating block
                  openBlockDrawer(navigatedFromBlock.hash, navigatedFromBlock.height)
                }}
              >
                ← Back to Block #{navigatedFromBlock.height}
              </button>
              <button
                type="button"
                className="button secondary back-to-live-btn"
                onClick={() => {
                  setActiveReport(null)
                  setSelectedBlock(null)
                  setNavigatedFromBlock(null)
                }}
              >
                ← Back to Live Chain
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="button secondary back-to-live-btn"
              onClick={() => setActiveReport(null)}
            >
              ← Back to Live Chain
            </button>
          )}
          <span className="report-nav-tag">Transaction Explorer</span>
        </div>
        <ReportView
          report={activeReport}
          onClear={() => {
            setActiveReport(null)
            setSelectedBlock(null)
            setNavigatedFromBlock(null)
          }}
        />
      </div>
    )
  }

  return (
    <div className="live-chain-page">
      {/* Background Ambience Layer */}
      <div className="live-ambient-atmosphere" aria-hidden="true" />
      <div className="live-grid-overlay" aria-hidden="true" />

      <header className="live-chain-page-header">
        <h1 className="live-chain-title">Live Bitcoin Chain & Mempool</h1>
        <p className="live-chain-subtitle">
          Real-time Bitcoin block and mempool observability. Inspect transactions before signing.
        </p>
      </header>

      {/* Unified Integrated Network Status Strip (Section 14) */}
      <section className="live-status-strip" aria-label="Bitcoin network status">
        <div className="strip-item network-item">
          <span className="live-dot pulse-green" aria-hidden="true" />
          <span className="strip-label">NETWORK</span>
          <span className="strip-value uppercase font-semibold">
            {snapshot?.network || '—'}
          </span>
        </div>

        <div className="strip-divider" aria-hidden="true" />

        <div className="strip-item height-item">
          <span className="strip-label">HEIGHT</span>
          <span className="strip-value mono">
            {snapshot ? `#${snapshot.tip_height.toLocaleString()}` : '—'}
          </span>
        </div>

        <div className="strip-divider" aria-hidden="true" />

        <div className="strip-item block-item">
          <span className="strip-label">TIP BLOCK</span>
          <span className="strip-value mono" title={snapshot?.tip_hash}>
            {snapshot?.tip_hash ? truncateHash(snapshot.tip_hash, 6, 6) : '—'}
          </span>
        </div>

        <div className="strip-divider" aria-hidden="true" />

        <div className="strip-item mempool-item">
          <span className="strip-label">MEMPOOL</span>
          <span className="strip-value mono">
            {snapshot ? (
              snapshot.mempool !== undefined && snapshot.mempool !== null ? (
                <>
                  <span>{snapshot.mempool.tx_count.toLocaleString()}</span>
                  {' txs'}
                  {snapshot.mempool.size_bytes !== undefined &&
                    snapshot.mempool.size_bytes !== null && (
                      <span className="strip-subval">
                        {' '}
                        ({(snapshot.mempool.size_bytes / 1000).toFixed(1)} kB)
                      </span>
                    )}
                </>
              ) : snapshot.mempool_tx_count !== undefined &&
                snapshot.mempool_tx_count !== null ? (
                <>
                  <span>{snapshot.mempool_tx_count.toLocaleString()}</span>
                  {' txs'}
                  {snapshot.mempool_size_bytes !== undefined &&
                    snapshot.mempool_size_bytes !== null && (
                      <span className="strip-subval">
                        {' '}
                        ({(snapshot.mempool_size_bytes / 1000).toFixed(1)} kB)
                      </span>
                    )}
                </>
              ) : (
                <span className="strip-unavailable">Unavailable</span>
              )
            ) : (
              '—'
            )}
          </span>
        </div>

        <div className="strip-divider" aria-hidden="true" />

        <div className="strip-item stream-item">
          <span
            className={`live-dot ${
              connectionStatus === 'connected'
                ? 'pulse-blue'
                : connectionStatus === 'reconnecting'
                ? 'pulse-amber'
                : 'dot-offline'
            }`}
            aria-hidden="true"
          />
          <span className="strip-value uppercase font-semibold">
            {connectionStatus === 'connected'
              ? 'Live (streaming)'
              : connectionStatus === 'reconnecting'
              ? 'Reconnecting…'
              : 'Offline'}
          </span>
        </div>
      </section>

      {/* Command-Palette Style Universal Search (Section 15) */}
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
              ref={searchInputRef}
              type="text"
              className="universal-search-input"
              placeholder="Search transaction ID..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value)
                setSearchError('')
              }}
              aria-label="Search transaction ID"
            />
            <div className="search-right-affordances">
              {searchQuery ? (
                <button
                  type="button"
                  className="search-clear-btn"
                  onClick={() => setSearchQuery('')}
                  aria-label="Clear search input"
                >
                  ×
                </button>
              ) : (
                <kbd className="cmd-k-hint" aria-hidden="true">
                  ⌘ K
                </kbd>
              )}
            </div>
          </div>
          <button
            type="submit"
            className="button primary search-submit-btn"
            disabled={reportLoading}
          >
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

      {/* Node Warning / Unavailable Banner */}
      {errorMessage && (
        <section className="node-warning-banner" role="alert">
          <span className="notice-icon" aria-hidden="true">
            ⚠️
          </span>
          <div>
            <strong>Bitcoin Core Node Observation Notice:</strong> {errorMessage}
            <span className="notice-sub">
              Check that your Bitcoin Core daemon is running with RPC and configured on the TxSignX API.
            </span>
          </div>
        </section>
      )}

      {/* Redesigned Block Chain Rail (Sections 6, 8, 9) */}
      <section className="recent-blocks-section" aria-labelledby="recent-blocks-heading">
        <div className="section-title-row">
          <div className="section-title-group">
            <h2 id="recent-blocks-heading" className="section-title">
              Recent Blocks
            </h2>
            <span className="blocks-count-pill">{blocks.length} confirmed</span>
          </div>
          <div className="rail-direction-legend" aria-hidden="true">
            <span>OLDER</span>
            <span className="rail-arrow">──────────→</span>
            <span>CURRENT TIP</span>
          </div>
        </div>

        {(snapshot?.recent_blocks === undefined || snapshot?.recent_blocks === null) &&
        blocks.length === 0 ? (
          <div className="empty-blocks-state">
            <span className="muted">Recent block data unavailable from node.</span>
          </div>
        ) : blocks.length === 0 ? (
          <div className="empty-blocks-state">
            <span className="muted">No blocks observed yet. Waiting for chain updates…</span>
          </div>
        ) : (
          <div
            ref={railContainerRef}
            onScroll={handleRailScroll}
            className="chain-rail-container"
            role="region"
            aria-label="Recent blocks connected rail"
          >
            {/* The physical horizontal connecting chain rail */}
            <div className="chain-rail-connector-line" aria-hidden="true" />

            <div className="chain-rail-track">
              {railBlocks.map((block) => {
                const isTip = block.hash === tipBlock?.hash
                const isNewlyConnected = block.hash === newlyConnectedBlockHash

                return (
                  <button
                    ref={isTip ? tipCardRef : undefined}
                    data-tip={isTip ? 'true' : undefined}
                    type="button"
                    key={block.hash}
                    className={`recent-block-card chain-block-card ${isTip ? 'is-tip-block tip-card' : 'is-historical-block'} ${
                      isNewlyConnected ? 'new-tip-pulse' : ''
                    }`}
                    onClick={() => openBlockDrawer(block.hash, block.height)}
                    aria-label={`Explore block #${block.height}, ${block.tx_count} transactions`}
                    aria-haspopup="dialog"
                  >
                    <div className="block-header-row">
                      <div className="block-tag-group">
                        <span className="block-height-tag">#{block.height}</span>
                        {isTip && (
                          <span className="tip-badge">
                            <span className="tip-pulse-dot" aria-hidden="true" />
                            TIP
                          </span>
                        )}
                      </div>
                      <span className="block-time-ago">
                        {formatRelativeTime(block.timestamp)}
                      </span>
                    </div>

                    <div className="block-hash-row" title={block.hash}>
                      <code>{truncateHash(block.hash, 6, 6)}</code>
                    </div>

                    <div className="block-metrics-row">
                      <div className="block-metric">
                        <span className="sublabel">TXs</span>
                        <span className="mono font-semibold">
                          {block.tx_count.toLocaleString()}
                        </span>
                      </div>
                      {block.weight !== undefined && block.weight !== null && (
                        <div className="block-metric">
                          <span className="sublabel">Weight</span>
                          <span className="mono">
                            {(block.weight / 1000).toFixed(0)} kWU
                          </span>
                        </div>
                      )}
                      {block.size !== undefined && block.size !== null && (
                        <div className="block-metric">
                          <span className="sublabel">Size</span>
                          <span className="mono">
                            {(block.size / 1000).toFixed(1)} kB
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="block-explore-affordance" aria-hidden="true">
                      <span>Explore block →</span>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </section>

      {/* TxSignX Live Flow Section as True Time Stream (Sections 10, 11, 12, 16, 17) */}
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

          {/* Compact Segmented Control (Section 16) */}
          <div
            className="view-mode-segmented"
            role="radiogroup"
            aria-label="View display mode"
          >
            <button
              type="button"
              role="radio"
              aria-label="Live Flow"
              aria-checked={viewMode === 'flow'}
              className={`segmented-btn ${viewMode === 'flow' ? 'active' : ''}`}
              onClick={() => setViewMode('flow')}
            >
              Live Stream
            </button>
            <button
              type="button"
              role="radio"
              aria-label="Transaction Flow Graph"
              aria-checked={viewMode === 'graph'}
              className={`segmented-btn ${viewMode === 'graph' ? 'active' : ''}`}
              onClick={() => setViewMode('graph')}
            >
              Dependency Graph
              {graphLinks.length > 0 && (
                <span className="segmented-badge">{graphLinks.length}</span>
              )}
            </button>
          </div>
        </div>

        {/* Redesigned Compact Visual Encoding Legend (Section 11) */}
        <div className="compact-legend-strip flow-legend" aria-label="Visual encoding legend">
          <span className="legend-strip-title legend-label">Encoding Legend:</span>
          <div className="legend-chip">
            <span className="legend-chip-icon chip-size" aria-hidden="true" />
            <span>Size = vB</span>
            <span className="sr-only">Node width/size = Virtual Size (vB)</span>
          </div>
          <div className="legend-chip">
            <span className="legend-chip-icon chip-rbf" aria-hidden="true" />
            <span>RBF Outline</span>
            <span className="sr-only">Amber outline = BIP 125 Explicit RBF</span>
          </div>
          <div className="legend-chip">
            <span className="legend-chip-badge" aria-hidden="true">
              W
            </span>
            <span>SegWit</span>
            <span className="sr-only">SegWit witness data present</span>
          </div>
          <div className="legend-chip">
            <span className="legend-chip-pill" aria-hidden="true">
              sat/vB
            </span>
            <span>Fee Rate</span>
            <span className="sr-only">Numeric fee rate</span>
          </div>
        </div>

        {/* Empty States */}
        {(snapshot?.latest_transactions === undefined ||
          snapshot?.latest_transactions === null) &&
        transactions.length === 0 ? (
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
                <circle
                  cx="24"
                  cy="24"
                  r="22"
                  stroke="#243041"
                  strokeWidth="2"
                  strokeDasharray="4 4"
                />
                <path
                  d="M16 24H32M24 16V32"
                  stroke="#3b82f6"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </div>
            <h3>Mempool is currently empty on this node</h3>
            <p className="muted">
              Listening for new unconfirmed transactions via the connected TxSignX live stream…
            </p>
          </div>
        ) : viewMode === 'flow' ? (
          /* True Time Stream Visualization (Sections 10, 11, 12, 21) */
          <div className="time-stream-wrapper" role="region" aria-label="Live mempool time stream">
            {/* Time Axis Header */}
            <div className="time-stream-axis" aria-hidden="true">
              <span className="axis-marker marker-left">{adaptiveWindow.axisTicks[0]}</span>
              <span className="axis-marker marker-mid-left">{adaptiveWindow.axisTicks[1]}</span>
              <span className="axis-marker marker-mid">{adaptiveWindow.axisTicks[2]}</span>
              <span className="axis-marker marker-mid-right">{adaptiveWindow.axisTicks[3]}</span>
              <span className="axis-marker marker-right">{adaptiveWindow.axisTicks[4]} (Live)</span>
            </div>

            {/* Subtle explanation note: vertical position avoids overlap */}
            <div className="time-stream-helper-bar">
              <span className="stream-lane-hint">Vertical position is used only to avoid overlap.</span>
            </div>

            {/* Time Stream Scene */}
            <div className="time-stream-scene">
              {/* Subtle horizontal lane guides */}
              <div className="stream-lane-guide guide-lane-0" aria-hidden="true" />
              <div className="stream-lane-guide guide-lane-1" aria-hidden="true" />
              <div className="stream-lane-guide guide-lane-2" aria-hidden="true" />
              <div className="stream-lane-guide guide-lane-3" aria-hidden="true" />
              <div className="stream-lane-guide guide-lane-4" aria-hidden="true" />

              {/* Subtle vertical time grid lines */}
              <div className="stream-grid-line line-0" aria-hidden="true" />
              <div className="stream-grid-line line-25" aria-hidden="true" />
              <div className="stream-grid-line line-50" aria-hidden="true" />
              <div className="stream-grid-line line-75" aria-hidden="true" />
              <div className="stream-grid-line line-100" aria-hidden="true" />

              {/* Positioned Transaction Nodes (bounded to 100 max) */}
              {timeStampedTxs.map((tx) => {
                const layout = layoutMap.get(tx.txid) || {
                  leftPercent: 50,
                  topPercent: 50,
                  lane: 0,
                  sizePx: 48,
                  isOverflow: false,
                }
                const isRbf = tx.explicit_rbf === true
                const hasWitness = tx.has_witness === true
                const isSelected = selectedTx?.txid === tx.txid
                const isNew = newTxids.has(tx.txid)

                return (
                  <button
                    type="button"
                    key={tx.txid}
                    data-txid={tx.txid}
                    className={`stream-tx-node live-tx-node flow-node ${isRbf ? 'rbf-indicated' : ''} ${
                      isSelected ? 'selected' : ''
                    } ${isNew ? 'node-enter-now flow-pulse-inbound' : ''}`}
                    style={{
                      left: `${layout.leftPercent}%`,
                      top: `${layout.topPercent}%`,
                      width: `${layout.sizePx}px`,
                      height: `${layout.sizePx}px`,
                    }}
                    onClick={() => {
                      triggerElementRef.current = document.activeElement as HTMLElement
                      setSelectedTx(tx)
                    }}
                    aria-label={`Transaction ${truncateHash(tx.txid, 6, 6)}, ${tx.vsize} vB, fee rate ${
                      tx.fee_rate !== undefined && tx.fee_rate !== null
                        ? tx.fee_rate.toFixed(1)
                        : '—'
                    } sat per vB`}
                    title={`${truncateHash(tx.txid, 8, 8)} | ${tx.vsize} vB | ${
                      tx.fee_rate !== undefined && tx.fee_rate !== null
                        ? `${tx.fee_rate.toFixed(1)} sat/vB`
                        : 'No fee rate'
                    }`}
                  >
                    {/* Clean inner orb: only numeric vsize and tiny vB */}
                    <div className="node-orb-inner">
                      <span className="node-vsize-num">{tx.vsize}</span>
                      <span className="node-vsize-unit">vB</span>
                    </div>

                    {/* Outside badges: W = SegWit, RBF = explicit RBF */}
                    {hasWitness && (
                      <span className="node-segwit-dot" title="SegWit witness data present">
                        W
                      </span>
                    )}
                    {isRbf && (
                      <span className="node-rbf-badge" title="BIP 125 Explicit RBF">
                        RBF
                      </span>
                    )}

                    {/* Polished floating tooltip card on hover / focus */}
                    <div
                      className={`node-floating-tooltip ${
                        layout.lane <= 1 ? 'tooltip-open-down' : 'tooltip-open-up'
                      }`}
                      role="tooltip"
                    >
                      <div className="tooltip-txid-row">
                        <span className="tooltip-label">TXID:</span>{' '}
                        <code className="tooltip-txid-code">{truncateHash(tx.txid, 5, 4)}</code>
                      </div>
                      <div className="tooltip-metrics-row">
                        <span className="tooltip-vsize">{tx.vsize} vB</span>
                        <span className="tooltip-sep">·</span>
                        <span className="tooltip-feerate">
                          {tx.fee_rate !== undefined && tx.fee_rate !== null
                            ? `${tx.fee_rate.toFixed(1)} sat/vB`
                            : '—'}
                        </span>
                        <span className="sr-only">
                          {tx.fee_rate !== undefined && tx.fee_rate !== null
                            ? `${tx.fee_rate.toFixed(1)} s/vB`
                            : ''}
                        </span>
                      </div>
                      <div className="tooltip-tags-row">
                        {hasWitness && <span className="tooltip-tag-segwit">SegWit</span>}
                        {isRbf ? (
                          <span className="tooltip-tag-rbf">Explicit RBF</span>
                        ) : (
                          <span className="tooltip-tag-neutral">Non-RBF</span>
                        )}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>

            {/* Separated lane for transactions without first_seen_at timestamp */}
            {unstampedTxs.length > 0 && (
              <div className="unstamped-fallback-lane" aria-label="Transactions without timestamp">
                <span className="lane-header">Observed In Mempool (Exact arrival time unavailable):</span>
                <div className="unstamped-nodes-list">
                  {unstampedTxs.map((tx) => {
                    const isRbf = tx.explicit_rbf === true
                    const hasWitness = tx.has_witness === true
                    const isSelected = selectedTx?.txid === tx.txid

                    return (
                      <button
                        type="button"
                        key={tx.txid}
                        className={`unstamped-node-chip live-tx-node flow-node ${isRbf ? 'rbf-indicated' : ''} ${
                          isSelected ? 'selected' : ''
                        }`}
                        onClick={() => {
                          triggerElementRef.current = document.activeElement as HTMLElement
                          setSelectedTx(tx)
                        }}
                      >
                        <code>{truncateHash(tx.txid, 5, 4)}</code>
                        <span className="chip-vsize">{tx.vsize} vB</span>
                        {tx.fee_rate !== undefined && tx.fee_rate !== null && (
                          <span className="node-feerate">{tx.fee_rate.toFixed(1)} s/vB</span>
                        )}
                        {hasWitness && <span className="chip-w">W</span>}
                        {isRbf && <span className="chip-rbf-tag">RBF</span>}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Compact Centered DAG Dependency Graph (Section 17) */
          <div
            className="transaction-flow-graph-container"
            role="region"
            aria-label="Transaction Flow Graph"
          >
            <div className="graph-banner">
              <span>
                Bounded in-mempool relationship graph. Links show unconfirmed child transactions spending outputs from parent transactions inside the visible mempool.
              </span>
            </div>

            {graphLinks.length === 0 ? (
              <div className="graph-empty-links">
                <span className="muted">
                  No unconfirmed parent/child dependencies among currently visible mempool transactions. Each transaction is spending confirmed previous outputs.
                </span>
                <div className="graph-standalone-grid">
                  {transactions.slice(0, 30).map((tx) => (
                    <button
                      type="button"
                      key={tx.txid}
                      className="standalone-graph-node"
                      onClick={() => {
                        triggerElementRef.current = document.activeElement as HTMLElement
                        setSelectedTx(tx)
                      }}
                    >
                      <code>{truncateHash(tx.txid, 6, 4)}</code>
                      <span className="sub-vsize">{tx.vsize} vB</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="graph-dag-centered-wrapper">
                <div
                  className="graph-dag-canvas"
                  style={{
                    position: 'relative',
                    minHeight: `${Math.max(220, (graphNodes.length + 1) * 80)}px`,
                  }}
                >
                  {/* SVG Arrow Links */}
                  <svg
                    className="graph-svg"
                    width="100%"
                    height={Math.max(220, (graphNodes.length + 1) * 80)}
                    style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}
                  >
                    <defs>
                      <marker
                        id="arrowhead-orange"
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
                          strokeDasharray="4 3"
                          markerEnd="url(#arrowhead-orange)"
                        />
                      )
                    })}
                  </svg>

                  {/* Nodes positioned in centered layout */}
                  <div className="graph-dag-nodes">
                    {graphNodes.map((tx) => {
                      const pos = dagLayout.get(tx.txid) || { x: 40, y: 30 }
                      const isSelected = selectedTx?.txid === tx.txid

                      return (
                        <button
                          type="button"
                          key={tx.txid}
                          className={`graph-node-card ${isSelected ? 'selected' : ''}`}
                          style={{
                            position: 'absolute',
                            left: `${pos.x}px`,
                            top: `${pos.y}px`,
                            width: '200px',
                          }}
                          onClick={() => {
                            triggerElementRef.current = document.activeElement as HTMLElement
                            setSelectedTx(tx)
                          }}
                        >
                          <div className="node-card-id">
                            <code>{truncateHash(tx.txid, 6, 4)}</code>
                            {tx.has_witness && <span className="card-w-badge">W</span>}
                            {tx.explicit_rbf && <span className="card-rbf-badge">RBF</span>}
                          </div>
                          <div className="node-card-sub">
                            <span>{tx.vsize} vB</span>
                            <span>
                              {tx.fee_rate !== undefined && tx.fee_rate !== null
                                ? `${tx.fee_rate.toFixed(1)} sat/vB`
                                : '—'}
                            </span>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Textual Accessibility Fallback (Section 17) */}
                <div className="graph-relationship-list">
                  <h4 className="graph-relationship-title">Observed In-Mempool Dependencies</h4>
                  {graphLinks.map((link, idx) => (
                    <div
                      key={`${link.from}->${link.to}-${idx}`}
                      className="dag-edge-row"
                    >
                      <span className="mono text-blue">Parent {truncateHash(link.from, 6, 4)}</span>
                      <span className="text-orange">→</span>
                      <span className="mono text-green">Child {truncateHash(link.to, 6, 4)}</span>
                      <span className="text-muted">(Spends unconfirmed parent output)</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Block Detail Drawer (Sections 6 & 7) */}
      {selectedBlock && (
        <div className="drawer-overlay" onClick={closeBlockDrawer}>
          <aside
            className="drawer-panel block-drawer-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="block-drawer-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="drawer-header">
              <div className="drawer-title-group">
                <span className="drawer-badge badge-confirmed">Confirmed Block</span>
                <h3 id="block-drawer-title" className="drawer-title">
                  BLOCK #{selectedBlock.height !== undefined ? selectedBlock.height : '…'}
                </h3>
              </div>
              <button
                type="button"
                className="drawer-close-btn"
                onClick={closeBlockDrawer}
                aria-label="Close block details drawer"
              >
                ×
              </button>
            </div>

            <div className="drawer-content">
              {/* Block Hash Card with Copy */}
              <div className="drawer-txid-card">
                <div className="card-label-row">
                  <span className="sublabel">Block Hash</span>
                  <button
                    type="button"
                    className="copy-chip-btn"
                    onClick={() => handleCopy('block_hash', selectedBlock.hash)}
                    aria-label="Copy block hash"
                  >
                    {copiedField === 'block_hash' ? 'Copied ✓' : 'Copy'}
                  </button>
                </div>
                <code className="mono txid-full-code">{selectedBlock.hash}</code>
              </div>

              {blockDetailsLoading ? (
                <div className="drawer-loading-state">
                  <div className="loading-spinner" aria-hidden="true" />
                  <p>Loading block header and transaction data…</p>
                </div>
              ) : blockDetailsError ? (
                <div className="drawer-error-state" role="alert">
                  <p className="search-error-msg">{blockDetailsError}</p>
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => openBlockDrawer(selectedBlock.hash, selectedBlock.height)}
                  >
                    Retry
                  </button>
                </div>
              ) : blockDetailsData ? (
                <>
                  {/* Large Primary Facts (Section 7) */}
                  <div className="drawer-stats-grid block-primary-stats">
                    <div className="drawer-stat-item">
                      <span className="stat-label">Height</span>
                      <span className="stat-val mono">#{blockDetailsData.height}</span>
                    </div>
                    <div className="drawer-stat-item">
                      <span className="stat-label">Transactions</span>
                      <span className="stat-val mono">
                        {blockDetailsData.tx_count.toLocaleString()}
                      </span>
                    </div>
                    <div className="drawer-stat-item">
                      <span className="stat-label">Weight</span>
                      <span className="stat-val mono">
                        {blockDetailsData.weight !== undefined && blockDetailsData.weight !== null
                          ? `${blockDetailsData.weight.toLocaleString()} WU`
                          : 'Unavailable'}
                      </span>
                    </div>
                    <div className="drawer-stat-item">
                      <span className="stat-label">Size</span>
                      <span className="stat-val mono">
                        {blockDetailsData.size !== undefined && blockDetailsData.size !== null
                          ? `${blockDetailsData.size.toLocaleString()} B`
                          : 'Unavailable'}
                      </span>
                    </div>
                    <div className="drawer-stat-item col-span-2">
                      <span className="stat-label">Block Timestamp</span>
                      <span className="stat-val mono" style={{ fontSize: '13px' }}>
                        {formatUtcTime(blockDetailsData.timestamp)} ({formatRelativeTime(blockDetailsData.timestamp)})
                      </span>
                    </div>
                  </div>

                  {/* Secondary Blockchain Facts (Section 7) */}
                  <div className="drawer-secondary-facts">
                    <h4 className="secondary-facts-title">Blockchain Header Attributes</h4>
                    <dl className="facts-dl">
                      <div className="facts-row">
                        <dt>Merkle Root</dt>
                        <dd className="mono truncate-text" title={blockDetailsData.merkle_root || ''}>
                          {blockDetailsData.merkle_root || '—'}
                        </dd>
                      </div>
                      <div className="facts-row">
                        <dt>Previous Block</dt>
                        <dd>
                          {blockDetailsData.previous_block_hash ? (
                            <button
                              type="button"
                              className="text-link-button mono"
                              onClick={() =>
                                openBlockDrawer(blockDetailsData.previous_block_hash!, blockDetailsData.height - 1)
                              }
                            >
                              {truncateHash(blockDetailsData.previous_block_hash, 8, 8)}
                            </button>
                          ) : (
                            '—'
                          )}
                        </dd>
                      </div>
                      {blockDetailsData.next_block_hash && (
                        <div className="facts-row">
                          <dt>Next Block</dt>
                          <dd>
                            <button
                              type="button"
                              className="text-link-button mono"
                              onClick={() =>
                                openBlockDrawer(blockDetailsData.next_block_hash!, blockDetailsData.height + 1)
                              }
                            >
                              {truncateHash(blockDetailsData.next_block_hash, 8, 8)}
                            </button>
                          </dd>
                        </div>
                      )}
                      <div className="facts-row">
                        <dt>Version</dt>
                        <dd className="mono">
                          {blockDetailsData.version !== undefined && blockDetailsData.version !== null
                            ? `0x${blockDetailsData.version.toString(16)} (${blockDetailsData.version})`
                            : '—'}
                        </dd>
                      </div>
                      <div className="facts-row">
                        <dt>Bits</dt>
                        <dd className="mono">{blockDetailsData.bits || '—'}</dd>
                      </div>
                      <div className="facts-row">
                        <dt>Median Time</dt>
                        <dd className="mono">
                          {blockDetailsData.median_time !== undefined && blockDetailsData.median_time !== null
                            ? formatUtcTime(blockDetailsData.median_time)
                            : '—'}
                        </dd>
                      </div>
                      <div className="facts-row">
                        <dt>Difficulty</dt>
                        <dd className="mono">
                          {blockDetailsData.difficulty !== undefined && blockDetailsData.difficulty !== null
                            ? blockDetailsData.difficulty.toExponential(4)
                            : '—'}
                        </dd>
                      </div>
                    </dl>
                  </div>

                  {/* Transactions in This Block (Section 7) */}
                  <div className="drawer-block-txs-section">
                    <div className="block-txs-header">
                      <h4 className="block-txs-title">Transactions in Block ({blockDetailsData.transactions.total})</h4>
                      <span className="txs-count-badge">
                        Showing {blockDetailsData.transactions.items.length} of{' '}
                        {blockDetailsData.transactions.total}
                      </span>
                    </div>

                    <div className="block-txs-list">
                      {blockDetailsData.transactions.items.map((txItem: BlockTransactionItem) => (
                        <div key={`${txItem.index}-${txItem.txid}`} className="block-tx-row">
                          <div className="tx-index-col">
                            <span className="tx-index-num">#{txItem.index}</span>
                            {txItem.is_coinbase && (
                              <span className="coinbase-badge" title="Coinbase generation transaction">
                                Coinbase
                              </span>
                            )}
                          </div>

                          <div className="tx-id-col" title={txItem.txid}>
                            <code className="mono">{truncateHash(txItem.txid, 8, 8)}</code>
                            <button
                              type="button"
                              className="copy-mini-btn"
                              onClick={() => handleCopy(`tx_${txItem.index}`, txItem.txid)}
                              aria-label={`Copy transaction ID ${txItem.txid}`}
                            >
                              {copiedField === `tx_${txItem.index}` ? '✓' : 'Copy'}
                            </button>
                          </div>

                          <div className="tx-action-col">
                            <button
                              type="button"
                              className="button secondary explore-row-btn"
                              onClick={() =>
                                inspectTxid(txItem.txid, {
                                  hash: blockDetailsData.hash,
                                  height: blockDetailsData.height,
                                })
                              }
                              disabled={reportLoading}
                            >
                              Explore Transaction →
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>

                    {blockDetailsData.transactions.has_more && (
                      <div className="load-more-txs-row">
                        <button
                          type="button"
                          className="button secondary load-more-btn"
                          onClick={loadMoreBlockTransactions}
                          disabled={blockDetailsLoadingMore}
                        >
                          {blockDetailsLoadingMore
                            ? 'Loading more transactions…'
                            : `Load more transactions (${blockDetailsData.transactions.total - blockDetailsData.transactions.items.length} remaining)`}
                        </button>
                      </div>
                    )}
                  </div>
                </>
              ) : null}
            </div>
          </aside>
        </div>
      )}

      {/* Transaction Preview Side Drawer (Section 18) */}
      {selectedTx && (
        <div className="drawer-overlay" onClick={closeTxDrawer}>
          <aside
            className="drawer-panel"
            role="dialog"
            aria-modal="true"
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
                onClick={closeTxDrawer}
                aria-label="Close preview drawer"
              >
                ×
              </button>
            </div>

            <div className="drawer-content">
              {/* TXID Display with Copy */}
              <div className="drawer-txid-card">
                <div className="card-label-row">
                  <span className="sublabel">Transaction ID (TXID)</span>
                  <button
                    type="button"
                    className="copy-chip-btn"
                    onClick={() => handleCopy('txid', selectedTx.txid)}
                    aria-label="Copy TXID"
                  >
                    {copiedField === 'txid' ? 'Copied' : 'Copy'}
                  </button>
                </div>
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

              {/* SegWit & RBF Badges (Section 18) */}
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

              {selectedTx.mempool_replaceable !== undefined &&
                selectedTx.mempool_replaceable !== null && (
                  <div className="drawer-stat-item" style={{ marginTop: '12px' }}>
                    <span className="sublabel">Mempool Replaceability (Node Policy)</span>
                    <span className="stat-val mono" style={{ fontSize: '13px' }}>
                      {selectedTx.mempool_replaceable ? 'Yes (Mempool Policy)' : 'No'}
                    </span>
                  </div>
                )}

              {/* wTXID Display with Copy (Section 18) */}
              {selectedTx.wtxid && (
                <div className="drawer-txid-card" style={{ marginTop: '12px' }}>
                  <div className="card-label-row">
                    <span className="sublabel">Witness Transaction ID (wTXID)</span>
                    <button
                      type="button"
                      className="copy-chip-btn"
                      onClick={() => handleCopy('wtxid', selectedTx.wtxid!)}
                      aria-label="Copy wTXID"
                    >
                      {copiedField === 'wtxid' ? 'Copied' : 'Copy'}
                    </button>
                  </div>
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
