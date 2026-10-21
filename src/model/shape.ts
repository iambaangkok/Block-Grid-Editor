import { cellKey } from './analysis'

// Whole-square shape rules shared by the key-piece checks and the fill search: every cell counts
// as a full square, and neighbourhood is by shared edges only.

export type XY = { x: number; y: number }

const N4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const

// ── Connectivity ───────────────────────────────────────────────────────────

/** Edge-connected groups of the piece's cells, largest first. */
export function connectedGroups(cells: readonly XY[]): XY[][] {
  const left = new Map(cells.map((c) => [cellKey(c.x, c.y), c]))
  const groups: XY[][] = []
  while (left.size > 0) {
    const [startKey, start] = left.entries().next().value!
    left.delete(startKey)
    const group: XY[] = [start]
    for (let i = 0; i < group.length; i++) {
      for (const [dx, dy] of N4) {
        const k = cellKey(group[i].x + dx, group[i].y + dy)
        const n = left.get(k)
        if (n) {
          left.delete(k)
          group.push(n)
        }
      }
    }
    groups.push(group)
  }
  return groups.sort((a, b) => b.length - a.length)
}

// ── Enclosed cavities ──────────────────────────────────────────────────────

/** Empty cells inside the bounding box that can't reach the outside through edges. */
export function enclosedCells(cells: readonly XY[]): XY[] {
  if (cells.length === 0) return []
  const occ = new Set(cells.map((c) => cellKey(c.x, c.y)))
  const minX = Math.min(...cells.map((c) => c.x)) - 1
  const maxX = Math.max(...cells.map((c) => c.x)) + 1
  const minY = Math.min(...cells.map((c) => c.y)) - 1
  const maxY = Math.max(...cells.map((c) => c.y)) + 1
  // Flood the empty space from a corner of the padded box; the padding ring is all empty
  // and connected, so this reaches everything outside the piece.
  const seen = new Set<string>([cellKey(minX, minY)])
  const queue: XY[] = [{ x: minX, y: minY }]
  while (queue.length > 0) {
    const c = queue.pop()!
    for (const [dx, dy] of N4) {
      const x = c.x + dx
      const y = c.y + dy
      if (x < minX || x > maxX || y < minY || y > maxY) continue
      const k = cellKey(x, y)
      if (seen.has(k) || occ.has(k)) continue
      seen.add(k)
      queue.push({ x, y })
    }
  }
  const trapped: XY[] = []
  for (let y = minY + 1; y < maxY; y++)
    for (let x = minX + 1; x < maxX; x++) {
      const k = cellKey(x, y)
      if (!occ.has(k) && !seen.has(k)) trapped.push({ x, y })
    }
  return trapped
}
