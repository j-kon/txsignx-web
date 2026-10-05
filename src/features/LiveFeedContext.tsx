/* oxlint-disable react/only-export-components */
import React, { createContext, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { ApiClient } from '../lib/api/client'
import {
  type LiveEvent,
  type LiveSnapshot,
  type LiveTransaction,
  type RecentBlock,
  liveEventSchema,
} from '../lib/api/schema'
import { FRONTEND_WORKING_SET_LIMIT } from './liveStreamLayout'

export interface LiveFeedState {
  api: ApiClient
  snapshot: LiveSnapshot | null
  lastUpdatedAt: number | null
  refreshing: boolean
  refresh: () => void
  blocks: RecentBlock[]
  transactions: LiveTransaction[]
  connectionStatus: 'connecting' | 'connected' | 'reconnecting' | 'error'
  errorMessage: string
  liveSessionTxids: Set<string>
  newTxids: Set<string>
  confirmedTxids: Set<string>
  removedTxids: Set<string>
  newlyConnectedBlockHash: string | null
  nowSeconds: number
  streamReferenceTime: number
  removeLiveSessionTxid: (txid: string) => void
  setLiveSessionTxids: React.Dispatch<React.SetStateAction<Set<string>>>
  setTransactions: React.Dispatch<React.SetStateAction<LiveTransaction[]>>
  setConfirmedTxids: React.Dispatch<React.SetStateAction<Set<string>>>
  setRemovedTxids: React.Dispatch<React.SetStateAction<Set<string>>>
  setNewlyConnectedBlockHash: React.Dispatch<React.SetStateAction<string | null>>
  setSnapshot: React.Dispatch<React.SetStateAction<LiveSnapshot | null>>
  setBlocks: React.Dispatch<React.SetStateAction<RecentBlock[]>>
  setConnectionStatus: React.Dispatch<React.SetStateAction<'connecting' | 'connected' | 'reconnecting' | 'error'>>
  setErrorMessage: React.Dispatch<React.SetStateAction<string>>
}

const LiveFeedContext = createContext<LiveFeedState | null>(null)

export interface LiveFeedProviderProps {
  api: ApiClient
  children: ReactNode
}

/**
 * In-memory persistent LiveFeedProvider mounted above page routing in App.tsx.
 *
 * Maintains the live Bitcoin WebSocket connection, snapshot cache, 350-item working set,
 * and active liveSessionTxids continuously in memory across route changes (#live, #home,
 * #inspector, #policies).
 *
 * NOTE: Strictly in-memory. Does NOT use localStorage, sessionStorage, or IndexedDB.
 */
export function LiveFeedProvider({ api, children }: LiveFeedProviderProps) {
  const [snapshot, setSnapshot] = useState<LiveSnapshot | null>(null)
  const [blocks, setBlocks] = useState<RecentBlock[]>([])
  const [transactions, setTransactions] = useState<LiveTransaction[]>([])
  const [connectionStatus, setConnectionStatus] = useState<
    'connecting' | 'connected' | 'reconnecting' | 'error'
  >('connecting')
  const [errorMessage, setErrorMessage] = useState('')
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const refreshRef = useRef<() => void>(() => {})

  // Animated TIP flash state when new block connects
  const [newlyConnectedBlockHash, setNewlyConnectedBlockHash] = useState<string | null>(null)

  // Clock tick for textual relative-time updates (ticks every 1s; does NOT mutate CSS animation timing)
  const [nowSeconds, setNowSeconds] = useState(() => Math.floor(Date.now() / 1000))

  // Reference time for stream coordinate calculations; updated when transaction sets arrive
  const [streamReferenceTime, setStreamReferenceTime] = useState(() => Math.floor(Date.now() / 1000))

  // Bounded live-session transactions set: strictly populated via WebSocket transaction_added
  const [liveSessionTxids, setLiveSessionTxids] = useState<Set<string>>(() => new Set())

  // Track new txids for one-time arrival animation
  const [newTxids, setNewTxids] = useState<Set<string>>(new Set())
  const [confirmedTxids, setConfirmedTxids] = useState<Set<string>>(new Set())
  const [removedTxids, setRemovedTxids] = useState<Set<string>>(new Set())

  // Eager activation for #home, #live, or initial load; deferred if directly testing isolated routes
  const [hasActivated, setHasActivated] = useState(() => {
    const hash = typeof window !== 'undefined' ? window.location.hash : ''
    return hash !== '#inspector' && hash !== '#policies'
  })

  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash
      if (hash === '' || hash === '#home' || hash === '#live') {
        setHasActivated(true)
      }
    }
    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])

  const activeRef = useRef(true)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<number | undefined>(undefined)

  const transactionsRef = useRef(transactions)
  useEffect(() => {
    transactionsRef.current = transactions
  }, [transactions])

  // 1-second textual relative-time tick & periodic expiry cleanup
  // Prunes expired IDs (>120s or evicted from transactions working set);
  // runs continuously once activated (even while on #home / #inspector).
  useEffect(() => {
    if (!hasActivated) return
    const timer = setInterval(() => {
      const now = Math.floor(Date.now() / 1000)
      setNowSeconds(now)
      setLiveSessionTxids((prev) => {
        if (prev.size === 0) return prev
        const currentTxs = transactionsRef.current
        const txMap = new Map(currentTxs.map((t) => [t.txid, t]))
        let changed = false
        const next = new Set<string>()
        for (const id of prev) {
          const tx = txMap.get(id)
          if (!tx) {
            changed = true
            continue
          }
          const time = tx.observed_at ?? tx.first_seen_at
          if (time !== undefined && time !== null && now - time > 120) {
            changed = true
            continue
          }
          next.add(id)
        }
        return changed ? next : prev
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [hasActivated])

  // Presentation removal callback triggered when drift animation ends
  const removeLiveSessionTxid = (txid: string) => {
    setLiveSessionTxids((prev) => {
      if (!prev.has(txid)) return prev
      const next = new Set(prev)
      next.delete(txid)
      return next
    })
  }

  // Handle validated live incoming events
  const handleEvent = (event: LiveEvent) => {
    if (!activeRef.current) return
    setLastUpdatedAt(Math.floor(Date.now() / 1000))

    switch (event.type) {
      case 'snapshot': {
        const snap = event.data
        if (snap) {
          setSnapshot(snap)
          setStreamReferenceTime(Math.floor(Date.now() / 1000))
          if (snap.recent_blocks !== undefined && snap.recent_blocks !== null) {
            setBlocks(snap.recent_blocks)
          }
          if (snap.latest_transactions !== undefined && snap.latest_transactions !== null) {
            const nextTxs = snap.latest_transactions.slice(0, FRONTEND_WORKING_SET_LIMIT)
            setTransactions(nextTxs)
            // Intersect liveSessionTxids with transactions still present and inside the active live window (<= 120s)
            const now = Math.floor(Date.now() / 1000)
            const presentTxMap = new Map(nextTxs.map((t) => [t.txid, t]))
            setLiveSessionTxids((prev) => {
              if (prev.size === 0) return prev
              const next = new Set<string>()
              for (const id of prev) {
                const tx = presentTxMap.get(id)
                if (tx) {
                  const time = tx.observed_at ?? tx.first_seen_at
                  if (time === undefined || now - time <= 120) {
                    next.add(id)
                  }
                }
              }
              return next.size === prev.size ? prev : next
            })
          }
        }
        break
      }
      case 'transaction_added': {
        const tx = event.data
        if (tx && tx.txid) {
          setStreamReferenceTime(Math.floor(Date.now() / 1000))
          setNewTxids((prev) => new Set(prev).add(tx.txid))
          setLiveSessionTxids((prev) => new Set(prev).add(tx.txid))
          setTransactions((prev) => {
            if (prev.some((t) => t.txid === tx.txid)) {
              return prev.map((t) => (t.txid === tx.txid ? { ...t, ...tx } : t))
            }
            return [tx, ...prev].slice(0, FRONTEND_WORKING_SET_LIMIT)
          })
          // Remove arrival highlight tag after 600ms
          setTimeout(() => {
            if (activeRef.current) {
              setNewTxids((prev) => {
                const updated = new Set(prev)
                updated.delete(tx.txid)
                return updated
              })
            }
          }, 600)
        }
        break
      }
      case 'transaction_updated': {
        const updatedTx = event.data
        if (updatedTx && updatedTx.txid) {
          setTransactions((prev) =>
            prev.map((t) => (t.txid === updatedTx.txid ? { ...t, ...updatedTx } : t))
          )
        }
        break
      }
      case 'transaction_removed': {
        const payload = event.data
        if (payload?.txid) {
          setRemovedTxids((prev) => new Set(prev).add(payload.txid))
          setTimeout(() => {
            if (activeRef.current) {
              setTransactions((prev) => prev.filter((t) => t.txid !== payload.txid))
              setLiveSessionTxids((prev) => {
                const next = new Set(prev)
                next.delete(payload.txid)
                return next
              })
              setRemovedTxids((prev) => {
                const next = new Set(prev)
                next.delete(payload.txid)
                return next
              })
            }
          }, 400)
        }
        break
      }
      case 'transaction_confirmed': {
        const payload = event.data
        if (payload?.txid) {
          setConfirmedTxids((prev) => new Set(prev).add(payload.txid))
          setTimeout(() => {
            if (activeRef.current) {
              setTransactions((prev) => prev.filter((t) => t.txid !== payload.txid))
              setLiveSessionTxids((prev) => {
                const next = new Set(prev)
                next.delete(payload.txid)
                return next
              })
              setConfirmedTxids((prev) => {
                const next = new Set(prev)
                next.delete(payload.txid)
                return next
              })
            }
          }, 400)
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

  // Load initial snapshot and maintain continuous WebSocket connection in memory
  useEffect(() => {
    if (!hasActivated) return
    activeRef.current = true

    // Each effect owns its requests so a late response from a previous mount
    // (including React StrictMode) cannot update the current feed.
    let disposed = false
    let pending = false
    let openedOnce = false
    let pendingEvents: LiveEvent[] = []
    const loadSnapshot = async () => {
      if (disposed || pending) return
      pending = true
      setRefreshing(true)
      pendingEvents = []
      try {
        const snap = await api.liveSnapshot()
        if (disposed) return
        // Replay events received during this request over the HTTP baseline.
        // This preserves startup metadata without reverting newer chain state.
        let current = snap
        for (const event of pendingEvents) {
          switch (event.type) {
            case 'snapshot': current = event.data; break
            case 'transaction_added':
            case 'transaction_updated': {
              const txs = current.latest_transactions ?? []
              const exists = txs.some(tx => tx.txid === event.data.txid)
              current = {...current, latest_transactions: exists
                ? txs.map(tx => tx.txid === event.data.txid ? {...tx, ...event.data} : tx)
                : event.type === 'transaction_added' ? [event.data, ...txs].slice(0, FRONTEND_WORKING_SET_LIMIT) : txs}
              break
            }
            case 'transaction_removed':
            case 'transaction_confirmed':
              current = {...current, latest_transactions: current.latest_transactions?.filter(tx => tx.txid !== event.data.txid)}
              break
            case 'block_connected':
              current = {...current, tip_height: event.data.height, tip_hash: event.data.hash,
                recent_blocks: [event.data, ...(current.recent_blocks ?? []).filter(block => block.height !== event.data.height)].slice(0, 6)}
              break
            case 'mempool_updated':
              current = {...current, mempool: event.data, mempool_tx_count: event.data.tx_count, mempool_size_bytes: event.data.size_bytes}
              break
          }
        }
        handleEventRef.current({type: 'snapshot', data: current})
        setErrorMessage('')
      } catch (err: unknown) {
        if (disposed || pendingEvents.some(event => event.type === 'snapshot')) return
        setErrorMessage(err instanceof Error ? err.message : 'Could not refresh live data.')
        if (wsRef.current?.readyState !== 1) setConnectionStatus('error')
      } finally {
        pending = false
        pendingEvents = []
        if (!disposed) setRefreshing(false)
      }
    }
    refreshRef.current = () => { void loadSnapshot() }

    const scheduleReconnect = (delayMs: number) => {
      if (!activeRef.current) return
      if (reconnectTimeoutRef.current !== undefined) return

      reconnectTimeoutRef.current = window.setTimeout(() => {
        reconnectTimeoutRef.current = undefined
        connectWs()
      }, delayMs)
    }

    const connectWs = () => {
      if (!activeRef.current) return
      // Guard against duplicate sockets: refuse if existing socket is CONNECTING (0) or OPEN (1)
      const readyState = wsRef.current?.readyState
      if (readyState === 0 || readyState === 1) {
        return
      }

      try {
        const url = api.liveStreamUrl()
        const ws = new WebSocket(url)
        wsRef.current = ws

        ws.onopen = () => {
          if (!activeRef.current) return
          if (wsRef.current !== ws) return
          // Clear any pending reconnect timer on successful open
          if (reconnectTimeoutRef.current !== undefined) {
            window.clearTimeout(reconnectTimeoutRef.current)
            reconnectTimeoutRef.current = undefined
          }
          setConnectionStatus('connected')
          setErrorMessage('')
          if (openedOnce) void loadSnapshot()
          openedOnce = true
        }

        ws.onmessage = (e) => {
          if (!activeRef.current) return
          if (wsRef.current !== ws) return
          try {
            const parsed = JSON.parse(e.data)
            const event = liveEventSchema.parse(parsed)
            if (event) {
              if (pending) pendingEvents.push(event)
              setErrorMessage('')
              handleEventRef.current(event)
            }
          } catch {
            // safely ignore non-json or malformed payloads
          }
        }

        ws.onclose = () => {
          if (!activeRef.current) return
          if (wsRef.current !== ws) return
          wsRef.current = null
          setConnectionStatus('reconnecting')
          scheduleReconnect(2000)
        }

        ws.onerror = () => {
          if (!activeRef.current) return
          if (wsRef.current !== ws) return
          setConnectionStatus('error')
          try {
            ws.close()
          } catch {
            // ignore close error
          }
          scheduleReconnect(2000)
        }
      } catch {
        if (!activeRef.current) return
        setConnectionStatus('error')
        scheduleReconnect(3000)
      }
    }

    void loadSnapshot()
    connectWs()
    // HTTP recovery remains available when WebSockets are blocked or interrupted.
    const refreshTimer = window.setInterval(() => { void loadSnapshot() }, 15000)
    const resume = () => {
      if (document.visibilityState !== 'hidden') {
        void loadSnapshot()
        connectWs()
      }
    }
    window.addEventListener('online', resume)
    document.addEventListener('visibilitychange', resume)

    return () => {
      disposed = true
      refreshRef.current = () => {}
      window.clearInterval(refreshTimer)
      window.removeEventListener('online', resume)
      document.removeEventListener('visibilitychange', resume)
      activeRef.current = false
      if (reconnectTimeoutRef.current !== undefined) {
        window.clearTimeout(reconnectTimeoutRef.current)
        reconnectTimeoutRef.current = undefined
      }
      if (wsRef.current) {
        wsRef.current.onopen = null
        wsRef.current.onmessage = null
        wsRef.current.onclose = null
        wsRef.current.onerror = null
        try {
          wsRef.current.close()
        } catch {
          // ignore close error
        }
        wsRef.current = null
      }
    }
  }, [api, hasActivated])

  const contextValue: LiveFeedState = {
    api,
    snapshot,
    lastUpdatedAt,
    refreshing,
    refresh: () => refreshRef.current(),
    blocks,
    transactions,
    connectionStatus,
    errorMessage,
    liveSessionTxids,
    newTxids,
    confirmedTxids,
    removedTxids,
    newlyConnectedBlockHash,
    nowSeconds,
    streamReferenceTime,
    removeLiveSessionTxid,
    setLiveSessionTxids,
    setTransactions,
    setConfirmedTxids,
    setRemovedTxids,
    setNewlyConnectedBlockHash,
    setSnapshot,
    setBlocks,
    setConnectionStatus,
    setErrorMessage,
  }

  return (
    <LiveFeedContext.Provider value={contextValue}>
      {children}
    </LiveFeedContext.Provider>
  )
}

/**
 * Access the persistent LiveFeedContext.
 * Throws an error if used outside a LiveFeedProvider.
 */
export function useLiveFeed(): LiveFeedState {
  const context = useContext(LiveFeedContext)
  if (!context) {
    throw new Error('useLiveFeed must be used within a LiveFeedProvider')
  }
  return context
}

/**
 * Access the persistent LiveFeedContext optionally, returning null if outside a provider.
 */
export function useLiveFeedOptional(): LiveFeedState | null {
  return useContext(LiveFeedContext)
}
