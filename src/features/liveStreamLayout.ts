import type { LiveTransaction } from '../lib/api/schema'

export interface AdaptiveTimeWindow {
  windowSeconds: number
  axisTicks: string[]
}

export function getAdaptiveTimeWindow(maxAgeSeconds: number): AdaptiveTimeWindow {
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
  // Expand dynamically in 30-minute steps to contain the oldest observed transaction
  const halfHours = Math.ceil(maxAgeSeconds / 1800)
  const windowSeconds = halfHours * 1800
  const hours = (windowSeconds / 3600).toFixed(windowSeconds % 3600 === 0 ? 0 : 1)
  const q1 = Math.round((windowSeconds * 0.75) / 60)
  const q2 = Math.round((windowSeconds * 0.5) / 60)
  const q3 = Math.round((windowSeconds * 0.25) / 60)
  return {
    windowSeconds,
    axisTicks: [
      `${hours}h ago`,
      q1 >= 60 ? `${(q1 / 60).toFixed(1)}h` : `${q1}m`,
      q2 >= 60 ? `${(q2 / 60).toFixed(1)}h` : `${q2}m`,
      q3 >= 60 ? `${(q3 / 60).toFixed(1)}h` : `${q3}m`,
      'NOW',
    ],
  }
}

export interface PlacedNodeLayout {
  txid: string
  leftPercent: number
  topPercent: number
  lane: number
  sizePx: number
  isOverflow: boolean
}

// 5 primary lanes + 1 overflow lane
export const LANE_PERCENTAGES = [10, 26, 42, 58, 74, 90]

export function computeCollisionFreeLayout(
  transactions: LiveTransaction[],
  windowSeconds: number,
  nowSeconds: number
): Map<string, PlacedNodeLayout> {
  const result = new Map<string, PlacedNodeLayout>()
  if (!transactions || transactions.length === 0) return result

  // Sort deterministically: newest first (highest first_seen_at), tie-break by txid
  const sorted = [...transactions].sort((a, b) => {
    const aTime = a.first_seen_at ?? 0
    const bTime = b.first_seen_at ?? 0
    if (bTime !== aTime) return bTime - aTime
    return a.txid.localeCompare(b.txid)
  })

  // Track placed nodes in each lane: [laneIndex] -> Array of placed items
  const lanes: Array<Array<{ txid: string; leftPercent: number; sizePx: number }>> = [
    [], // Lane 0 (top: 10%)
    [], // Lane 1 (top: 26%)
    [], // Lane 2 (top: 42%)
    [], // Lane 3 (top: 58%)
    [], // Lane 4 (top: 74%)
    [], // Lane 5 overflow (top: 90%)
  ]

  sorted.forEach((tx, txIndex) => {
    const firstSeen = tx.first_seen_at ?? nowSeconds
    const ageSeconds = Math.max(0, nowSeconds - firstSeen)
    const progress = Math.min(1.0, Math.max(0, ageSeconds / windowSeconds))
    // NOW at right (92%), window boundary at left (6%)
    const baseLeftPercent = (1 - progress) * 86 + 6

    // Sizing between 44px and 72px
    const sizePx = Math.min(72, Math.max(44, 44 + Math.round(((tx.vsize || 140) / 600) * 28)))

    // Dynamic horizontal clearance: based on node radius in percentage (assuming ~800px scene width)
    const clearancePercent = Math.max(7.0, (sizePx / 800) * 100 + 2.5)

    // Find first lane among 0..4 without horizontal collision
    let chosenLane = -1
    for (let l = 0; l < 5; l++) {
      const hasCollision = lanes[l].some(
        (placed) => Math.abs(placed.leftPercent - baseLeftPercent) < clearancePercent
      )
      if (!hasCollision) {
        chosenLane = l
        break
      }
    }

    let leftPercent = baseLeftPercent
    let isOverflow = false

    // If all 5 normal lanes have collision, check overflow lane (lane 5)
    if (chosenLane === -1) {
      const hasCollisionInOverflow = lanes[5].some(
        (placed) => Math.abs(placed.leftPercent - baseLeftPercent) < clearancePercent
      )
      if (!hasCollisionInOverflow) {
        chosenLane = 5
        isOverflow = true
      } else {
        // If even overflow lane collides, choose lane with greatest distance and apply deterministic stagger
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

    lanes[chosenLane].push({ txid: tx.txid, leftPercent, sizePx })
    result.set(tx.txid, {
      txid: tx.txid,
      leftPercent,
      topPercent: LANE_PERCENTAGES[chosenLane],
      lane: chosenLane,
      sizePx,
      isOverflow,
    })
  })

  return result
}
