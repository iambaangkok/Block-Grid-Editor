import { cellKey, isFit } from './analysis'
import { isHole, type UnitCell } from './types'

// Shape rules shared by the key-piece checks and the fill search. Neighbourhood is by shared
// edges only. Connectivity treats every cell as a full square; cavities also look at the empty
// space left inside unseated spike and hole cells.

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

// ── Solid squares ──────────────────────────────────────────────────────────

type Cell = Pick<UnitCell, 'kind' | 'dir'>

/** A square is solid when it holds a block, or a spike with its matching hole seated on it. */
export function isSolid(occupants: readonly Cell[]): boolean {
  if (occupants.some((c) => c.kind === 'block')) return true
  for (let i = 0; i < occupants.length; i++)
    for (let j = i + 1; j < occupants.length; j++) if (isFit(occupants[i], occupants[j])) return true
  return false
}

// ── Enclosed cavities ──────────────────────────────────────────────────────
//
// Empty space is tracked per square, including the space left inside occupied squares:
//   empty square            → open on all 4 edges
//   solid square            → no empty space
//   lone hole (hole…hole4)  → its unfilled notch, open only on the notch's edge
//   unseated spike(s)       → the space around the triangles, open on all 4 edges (spike bases
//                             are inset, so even the base edge has open strips)
// Space crosses between neighbouring squares only where both sides are open on the shared edge.
// A cavity is any square whose empty space can't reach the outside that way.

const ALL_EDGES = [true, true, true, true] as const
const NO_EDGES = [false, false, false, false] as const

/** Which edges (N, E, S, W) a square's empty space is open on. */
export function openEdges(occupants: readonly Cell[]): readonly boolean[] {
  if (occupants.length === 0) return ALL_EDGES
  if (isSolid(occupants)) return NO_EDGES
  if (occupants.every((c) => isHole(c.kind))) {
    const open = [false, false, false, false]
    for (const h of occupants) open[h.dir] = true
    return open
  }
  return ALL_EDGES
}

// Step across edge d (0 = N, 1 = E, 2 = S, 3 = W).
const STEP = [
  [0, 1],
  [1, 0],
  [0, -1],
  [-1, 0],
] as const

/** Squares (inside the bounding box) whose empty space is sealed off from the outside. */
export function enclosedSquares(occ: ReadonlyMap<string, readonly Cell[]>): XY[] {
  if (occ.size === 0) return []
  const xy = [...occ.keys()].map((k) => k.split(',').map(Number))
  const minX = Math.min(...xy.map((p) => p[0])) - 1
  const maxX = Math.max(...xy.map((p) => p[0])) + 1
  const minY = Math.min(...xy.map((p) => p[1])) - 1
  const maxY = Math.max(...xy.map((p) => p[1])) + 1
  const edges = (x: number, y: number) => openEdges(occ.get(cellKey(x, y)) ?? [])
  // Flood from a corner of the padded box; the padding ring is empty and connected, so this
  // reaches everything outside.
  const seen = new Set<string>([cellKey(minX, minY)])
  const queue: XY[] = [{ x: minX, y: minY }]
  while (queue.length > 0) {
    const c = queue.pop()!
    const from = edges(c.x, c.y)
    for (let d = 0; d < 4; d++) {
      if (!from[d]) continue
      const x = c.x + STEP[d][0]
      const y = c.y + STEP[d][1]
      if (x < minX || x > maxX || y < minY || y > maxY) continue
      const k = cellKey(x, y)
      if (seen.has(k) || !edges(x, y)[(d + 2) % 4]) continue
      seen.add(k)
      queue.push({ x, y })
    }
  }
  const trapped: XY[] = []
  for (let y = minY + 1; y < maxY; y++)
    for (let x = minX + 1; x < maxX; x++) {
      if (seen.has(cellKey(x, y))) continue
      if (edges(x, y).some(Boolean)) trapped.push({ x, y })
    }
  return trapped
}

/** Enclosed cavities of a single piece (see enclosedSquares). */
export function enclosedCells(cells: readonly (XY & Cell)[]): XY[] {
  const occ = new Map<string, Cell[]>()
  for (const c of cells) {
    const k = cellKey(c.x, c.y)
    const list = occ.get(k)
    if (list) list.push(c)
    else occ.set(k, [c])
  }
  return enclosedSquares(occ)
}
