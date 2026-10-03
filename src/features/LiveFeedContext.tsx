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

    const loadInitialSnapshot = async () => {
      try {
        const snap = await api.liveSnapshot()
        if (!activeRef.current) return
        setSnapshot(snap)
        setStreamReferenceTime(Math.floor(Date.now() / 1000))
        if (snap.recent_blocks !== undefined && snap.recent_blocks !== null) {
          setBlocks(snap.recent_blocks)
        }
        if (snap.latest_transactions !== undefined && snap.latest_transactions !== null) {
          const latestTxs = snap.latest_transactions
          setTransactions((prev) => {
            const map = new Map<string, LiveTransaction>()
            prev.forEach((t) => map.set(t.txid, t))
            latestTxs.forEach((t: LiveTransaction) => {
              if (!map.has(t.txid)) map.set(t.txid, t)
            })
            return Array.from(map.values()).slice(0, FRONTEND_WORKING_SET_LIMIT)
          })
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
          setConnectionStatus('error')
          try {
            ws.close()
          } catch {
            // ignore close error
          }
          reconnectTimeoutRef.current = window.setTimeout(connectWs, 3000)
        }
      } catch {
        if (!activeRef.current) return
        setConnectionStatus('error')
        reconnectTimeoutRef.current = window.setTimeout(connectWs, 3000)
      }
    }

    loadInitialSnapshot()
    connectWs()

    return () => {
      activeRef.current = false
      if (reconnectTimeoutRef.current !== undefined) {
        window.clearTimeout(reconnectTimeoutRef.current)
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
