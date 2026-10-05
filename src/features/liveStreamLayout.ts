import type { LiveTransaction } from '../lib/api/schema'

export interface AdaptiveTimeWindow {
  windowSeconds: number
  axisTicks: string[]
}

export function getAdaptiveTimeWindow(maxAgeSeconds: number, preferredWindow?: number): AdaptiveTimeWindow {
  if (preferredWindow === 30 && maxAgeSeconds <= 30) {
    return {
      windowSeconds: 30,
      axisTicks: ['30s ago', '20s', '10s', '5s', 'NOW'],
    }
  }
  if (preferredWindow === 90) {
    return {
      windowSeconds: 90,
      axisTicks: ['90s ago', '60s', '30s', 'NOW'],
    }
  }
  if (preferredWindow === 120) {
    return {
      windowSeconds: 120,
      axisTicks: ['2m ago', '90s', '60s', '30s', 'NOW'],
    }
  }
  if (maxAgeSeconds <= 60) {
    return {
      windowSeconds: 60,
      axisTicks: ['60s ago', '45s', '30s', '15s', 'NOW'],
    }
  }
  if (maxAgeSeconds <= 300) {
    return {
      windowSeconds: 300,
      axisTicks: ['5m ago', '3m45s', '2m30s', '1m15s', 'NOW'],
    }
  }
  if (maxAgeSeconds <= 900) {
    return {
      windowSeconds: 900,
      axisTicks: ['15m', '~11m', '~7m', '~3m', 'NOW'],
    }
  }
  if (maxAgeSeconds <= 3600) {
    return {
      windowSeconds: 3600,
      axisTicks: ['60m', '45m', '30m', '15m', 'NOW'],
    }
  }
  return {
    windowSeconds: 3600,
    axisTicks: ['60m', '45m', '30m', '15m', 'NOW'],
  }
}

export interface PlacedNodeLayout {
  txid: string
  leftPercent: number
  topPercent: number
  startY: number
  endY: number
  trajectoryDeltaY: number
  visualOffsetX: number
  visualOffsetY: number
  visualPhaseSeconds: number
  lane: number
  sizePx: number
  isOverflow: boolean
  densityTier: 'large' | 'medium' | 'compact'
  bobDuration: number
  bobDelay: number
}

// 6 primary lanes for large tier (CALM mode)
export const LANE_PERCENTAGES_LARGE = [10, 26, 42, 58, 74, 90]
// 10 lanes for medium tier
export const LANE_PERCENTAGES_MEDIUM = [8, 17, 26, 35, 44, 53, 62, 71, 80, 89]
// 18 lanes for compact tier
export const LANE_PERCENTAGES_COMPACT = [
  6, 11, 16, 21, 26, 31, 36, 41, 46, 51, 56, 61, 66, 71, 76, 81, 86, 91,
]

// Default export alias for backwards compatibility
export const LANE_PERCENTAGES = LANE_PERCENTAGES_LARGE

// Presentation phase is a deterministic visual staggering mechanism for simultaneous observations and is not Bitcoin timing metadata.
export function getVisualPhaseSeconds(
  txid: string,
  densityMode: 'calm' | 'normal' | 'dense' = 'normal'
): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < txid.length; i++) {
    hash = Math.imul(hash ^ txid.charCodeAt(i), 0x01000193)
  }
  const maxPhase = densityMode === 'dense' ? 14 : densityMode === 'calm' ? 5 : 10
  const norm = (Math.abs(hash) % 10000) / 10000
  return Number((norm * maxPhase).toFixed(2))
}

/**
 * Deterministic presentation-only vertical trajectory delta.
 * Produces a startY and endY differing by no more than approximately 3–6% of canvas height.
 * Broadly right -> left without curved network-path semantics or physical Bitcoin routing.
 */
export function getTrajectoryDeltaY(txid: string): number {
  let hash = 0x27d4eb2d
  for (let i = 0; i < txid.length; i++) {
    hash = Math.imul(hash ^ txid.charCodeAt(i), 0x165667b1)
  }
  const norm = ((Math.abs(hash) % 1000) / 1000) - 0.5
  const sign = norm >= 0 ? 1 : -1
  // Differ by 3.0% to 6.0% of canvas height
  const magnitude = 3.0 + (Math.abs(norm) * 2.0) * 3.0
  return Number((sign * magnitude).toFixed(2))
}

/**
 * PRESENTATION-ONLY visual offset geometry.
 *
 * NOTE: This is purely visual presentation geometry to prevent same-second
 * batch arrivals from forming a rigid vertical barcode line.
 * It is NOT Bitcoin metadata, does NOT modify `observed_at` or `first_seen_at`,
 * and is NEVER shown in tooltips, reports, or factual displays.
 */
export function getVisualOffset(
  txid: string,
  densityTier: 'large' | 'medium' | 'compact' = 'large'
): {
  offsetXPercent: number
  offsetYPercent: number
  bobDuration: number
  bobDelay: number
} {
  let h1 = 0xdeadbeef
  let h2 = 0x41c64e6d
  for (let i = 0; i < txid.length; i++) {
    const ch = txid.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)

  // Density-aware deterministic dispersion:
  // compact: up to ±3.0%
  // medium: up to ±2.2%
  // large / default: ±1.8%
  const maxSpread = densityTier === 'compact' ? 3.0 : densityTier === 'medium' ? 2.2 : 1.8
  const normX = ((h1 >>> 0) % 1000) / 1000
  const offsetXPercent = (normX - 0.5) * (maxSpread * 2)

  // Deterministic vertical micro-spread within [-2.0%, +2.0%]
  const normY = ((h2 >>> 0) % 1000) / 1000
  const offsetYPercent = (normY - 0.5) * 4.0

  // Secondary atmospheric bobbing: duration 3.6s - 5.8s, phase delay 0s - 3.8s
  const bobDuration = 3.6 + (((h1 >>> 4) % 22) * 0.1)
  const bobDelay = ((h2 >>> 4) % 38) * 0.1

  return {
    offsetXPercent,
    offsetYPercent,
    bobDuration,
    bobDelay,
  }
}

export function computeCollisionFreeLayout(
  transactions: LiveTransaction[],
  windowSeconds: number,
  nowSeconds: number,
  existingLayout?: Map<string, PlacedNodeLayout>,
  densityMode?: 'calm' | 'normal' | 'dense'
): Map<string, PlacedNodeLayout> {
  const result = new Map<string, PlacedNodeLayout>()
  if (!transactions || transactions.length === 0) return result

  const hasExplicitMode = densityMode !== undefined
  const isDense = densityMode === 'dense'
  const isCalm = densityMode === 'calm'
  const count = transactions.length

  // CALM uses larger informative nodes ('large').
  // When count > 120 or DENSE, compact particle-first nodes ('compact').
  // NORMAL uses compact particle-first nodes ('medium').
  const densityTier: 'large' | 'medium' | 'compact' = hasExplicitMode
    ? isDense || count > 120
      ? 'compact'
      : isCalm
      ? 'large'
      : 'medium'
    : count > 120
    ? 'compact'
    : count <= 40
    ? 'large'
    : count <= 80
    ? 'medium'
    : 'compact'

  const laneTops =
    densityTier === 'large'
      ? LANE_PERCENTAGES_LARGE
      : densityTier === 'medium'
      ? LANE_PERCENTAGES_MEDIUM
      : LANE_PERCENTAGES_COMPACT

  // Sort deterministically: newest first (highest observed_at or first_seen_at), tie-break by txid
  const sorted = [...transactions].sort((a, b) => {
    const aTime = a.observed_at ?? a.first_seen_at ?? 0
    const bTime = b.observed_at ?? b.first_seen_at ?? 0
    if (bTime !== aTime) return bTime - aTime
    return a.txid.localeCompare(b.txid)
  })

  // Track placed nodes in each lane: [laneIndex] -> Array of placed items
  const lanes: Array<Array<{ txid: string; leftPercent: number; topPercent: number; sizePx: number }>> = Array.from(
    { length: laneTops.length },
    () => []
  )

  sorted.forEach((tx, txIndex) => {
    const observedTime = tx.observed_at ?? tx.first_seen_at ?? nowSeconds
    const ageSeconds = Math.max(0, nowSeconds - observedTime)
    const phaseSeconds = hasExplicitMode ? getVisualPhaseSeconds(tx.txid, densityMode) : 0
    const presentationAge = ageSeconds + phaseSeconds
    const progress = Math.min(1.0, Math.max(0, presentationAge / windowSeconds))
    // NOW at right (92%), window boundary at left (6%)
    const baseLeftPercent = (1 - progress) * 86 + 6

    const visualOffset = getVisualOffset(tx.txid, densityTier)

    let sizePx: number
    let clearancePercent: number

    const hasVsize = tx.vsize !== undefined && tx.vsize !== null
    const isPending = !hasVsize || tx.hydration_status === 'pending'
    const actualVsize = tx.vsize ?? 0

    if (densityTier === 'compact') {
      // DENSE: approximately 7-13px
      sizePx = isPending
        ? 10
        : Math.min(13, Math.max(7, 7 + Math.round((actualVsize / 300) * 6)))
      clearancePercent = Math.max(1.5, (sizePx / 800) * 100 + 0.6)
    } else if (densityTier === 'medium') {
      // NORMAL: approximately 9-16px
      sizePx = isPending
        ? 12
        : Math.min(16, Math.max(9, 9 + Math.round((actualVsize / 800) * 7)))
      clearancePercent = Math.max(2.2, (sizePx / 800) * 100 + 0.8)
    } else {
      // CALM: informative larger nodes ~20-36px
      sizePx = isPending
        ? 24
        : Math.min(36, Math.max(20, 20 + Math.round((actualVsize / 600) * 16)))
      clearancePercent = Math.max(4.5, (sizePx / 800) * 100 + 1.8)
    }

    let chosenLane = -1
    let leftPercent = baseLeftPercent
    let topPercent = 50
    let isOverflow = false

    const prevPlaced = existingLayout?.get(tx.txid)
    if (
      prevPlaced &&
      prevPlaced.densityTier === densityTier &&
      prevPlaced.lane >= 0 &&
      prevPlaced.lane < laneTops.length
    ) {
      chosenLane = prevPlaced.lane
      topPercent = prevPlaced.topPercent
      isOverflow = prevPlaced.isOverflow
    } else if (densityTier === 'large') {
      // CALM: use organized discrete lanes
      for (let l = 0; l < 5; l++) {
        const hasCollision = lanes[l].some(
          (placed) => Math.abs(placed.leftPercent - baseLeftPercent) < clearancePercent
        )
        if (!hasCollision) {
          chosenLane = l
          break
        }
      }

      if (chosenLane === -1) {
        const hasCollisionInOverflow = lanes[5].some(
          (placed) => Math.abs(placed.leftPercent - baseLeftPercent) < clearancePercent
        )
        if (!hasCollisionInOverflow) {
          chosenLane = 5
          isOverflow = true
        } else {
          let bestLane = 0
          let maxDistance = -1
          for (let l = 0; l < 6; l++) {
            const minDistInLane = lanes[l].reduce((minD, placed) => {
              return Math.min(minD, Math.abs(placed.leftPercent - baseLeftPercent))
            }, 999)
            if (minDistInLane > maxDistance) {
              maxDistance = minDistInLane
              bestLane = l
            }
          }
          chosenLane = bestLane
          isOverflow = chosenLane === 5
          const staggerDirection = txIndex % 2 === 0 ? 1 : -1
          const staggerAmount = (((txIndex % 4) + 1) * 2.5) * staggerDirection
          leftPercent = Math.min(94, Math.max(4, baseLeftPercent + staggerAmount))
        }
      }
      topPercent = laneTops[chosenLane]
    } else {
      // NORMAL & DENSE: span roughly 8% - 92% of canvas height with continuous TXID distribution
      let hash = 0x811c9dc5
      for (let i = 0; i < tx.txid.length; i++) {
        hash = Math.imul(hash ^ tx.txid.charCodeAt(i), 0x01000193)
      }
      const normY = ((Math.abs(hash) % 10000) / 10000)
      topPercent = 8 + normY * 84 // Spans roughly 8% to 92%

      // Lightweight collision-relaxation pass against nearby placed nodes
      const allPlacedInWindow = lanes.flat()
      const minSpacingY = densityTier === 'compact' ? 5.0 : 7.0
      for (const placed of allPlacedInWindow) {
        const dx = Math.abs(placed.leftPercent - baseLeftPercent)
        const dy = Math.abs(placed.topPercent - topPercent)
        if (dx < clearancePercent && dy < minSpacingY) {
          const shift = (minSpacingY - dy) * (topPercent >= placed.topPercent ? 1 : -1)
          topPercent = Math.min(92, Math.max(8, topPercent + shift))
        }
      }
      chosenLane = Math.min(laneTops.length - 1, Math.floor(((topPercent - 8) / 84) * laneTops.length))
    }

    // Trajectory startY and endY differing by 3%–6% of canvas height
    let trajectoryDeltaY = getTrajectoryDeltaY(tx.txid)
    let endY = topPercent + trajectoryDeltaY
    if (endY < 8) {
      trajectoryDeltaY = Math.abs(trajectoryDeltaY)
      endY = topPercent + trajectoryDeltaY
    } else if (endY > 92) {
      trajectoryDeltaY = -Math.abs(trajectoryDeltaY)
      endY = topPercent + trajectoryDeltaY
    }
    const startY = topPercent

    lanes[chosenLane].push({ txid: tx.txid, leftPercent, topPercent, sizePx })
    const placedLayout: PlacedNodeLayout = {
      txid: tx.txid,
      leftPercent,
      topPercent,
      startY,
      endY,
      trajectoryDeltaY,
      visualOffsetX: visualOffset.offsetXPercent,
      visualOffsetY: visualOffset.offsetYPercent,
      visualPhaseSeconds: phaseSeconds,
      lane: chosenLane,
      sizePx,
      isOverflow,
      densityTier,
      bobDuration: visualOffset.bobDuration,
      bobDelay: visualOffset.bobDelay,
    }
    result.set(tx.txid, placedLayout)
  })

  return result
}

export const FRONTEND_WORKING_SET_LIMIT = 350

export function formatBlockWeight(weight: number | null | undefined): string {
  if (weight === null || weight === undefined) return '—'
  const kwu = Math.round(weight / 1000)
  return `${kwu.toLocaleString()} kWU`
}

export function formatBlockSize(size: number | null | undefined): string {
  if (size === null || size === undefined) return '—'
  const kb = size / 1000
  return `${kb.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kB`
}

export function formatRelativeTime(
  timestamp?: number,
  nowSec = Math.floor(Date.now() / 1000)
): string {
  if (!timestamp) return 'Unknown'
  const diff = Math.max(0, nowSec - timestamp)
  if (diff < 5) return 'Just now'
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  return `${Math.floor(diff / 3600)}h ago`
}

export interface StableMotionTiming {
  streamDelay: number
  streamDuration: number
  anchorWallClock: number
}

// Module-scoped stable motion memoization cache keyed by (txid, observed_at, windowBucket, densityMode)
export const motionTimingCache = new Map<string, StableMotionTiming>()

export function clearMotionTimingCache(): void {
  motionTimingCache.clear()
}

export function getStableMotionTiming(
  txid: string,
  observedAt: number | undefined,
  windowSeconds: number,
  referenceNow: number,
  isNew = false,
  densityMode?: 'calm' | 'normal' | 'dense'
): StableMotionTiming {
  const cacheKey = `${txid}:${observedAt ?? 0}:${windowSeconds}:${densityMode ?? 'default'}`
  const existing = motionTimingCache.get(cacheKey)
  if (existing) {
    return existing
  }

  // Presentation phase offset staggers simultaneous batch arrivals
  const phaseOffset = densityMode ? getVisualPhaseSeconds(txid, densityMode) : 0

  let priorAnchor: StableMotionTiming | undefined
  for (const [key, entry] of motionTimingCache.entries()) {
    if (key.startsWith(`${txid}:`)) {
      priorAnchor = entry
      break
    }
  }

  let initialDelay: number
  if (priorAnchor && priorAnchor.streamDuration !== windowSeconds) {
    const elapsed = Math.max(0, referenceNow - priorAnchor.anchorWallClock - priorAnchor.streamDelay)
    const progress = Math.min(1.0, Math.max(0, elapsed / priorAnchor.streamDuration))
    initialDelay = -Math.min(windowSeconds, progress * windowSeconds)
  } else if (isNew) {
    initialDelay = 0
  } else {
    const ageSeconds = Math.max(0, referenceNow - (observedAt ?? referenceNow))
    initialDelay = -Math.min(windowSeconds, ageSeconds + phaseOffset)
  }

  const timing: StableMotionTiming = {
    streamDelay: initialDelay,
    streamDuration: windowSeconds,
    anchorWallClock: referenceNow,
  }
  motionTimingCache.set(cacheKey, timing)

  if (motionTimingCache.size > 2000) {
    const keysToDelete = Array.from(motionTimingCache.keys()).slice(0, 500)
    for (const k of keysToDelete) {
      motionTimingCache.delete(k)
    }
  }

  return timing
}
