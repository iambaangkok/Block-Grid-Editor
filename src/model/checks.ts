import { cellKey } from './analysis'
import { searchFills } from './fill'
import type { Dir, KeyPiece, Placement } from './types'

// Key-piece validity checks — see CONTEXT.md "Key-piece checks".
//
// For the shape rules (connectivity, cavities, notches) every unit cell counts as a full
// square. Neighbourhood is by shared edges only.

export type CheckStatus = 'pass' | 'fail' | 'na' | 'unknown'

type XY = { x: number; y: number }

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

// ── Notches & concaves ─────────────────────────────────────────────────────

export interface Notch {
  axis: 'row' | 'col'
  /** The row's y (axis 'row') or the column's x (axis 'col'). */
  line: number
  /** Inclusive range along the line. */
  from: number
  to: number
  cells: XY[]
}

/** Maximal runs of empty cells in one row/column with the piece directly at both ends. */
export function findNotches(cells: readonly XY[]): Notch[] {
  if (cells.length === 0) return []
  const occ = new Set(cells.map((c) => cellKey(c.x, c.y)))
  const has = (x: number, y: number) => occ.has(cellKey(x, y))
  const minX = Math.min(...cells.map((c) => c.x))
  const maxX = Math.max(...cells.map((c) => c.x))
  const minY = Math.min(...cells.map((c) => c.y))
  const maxY = Math.max(...cells.map((c) => c.y))
  const out: Notch[] = []
  const scan = (axis: 'row' | 'col', line: number, lo: number, hi: number, at: (t: number) => boolean) => {
    let t = lo
    while (t <= hi) {
      if (at(t)) {
        t++
        continue
      }
      const from = t
      while (t <= hi && !at(t)) t++
      const to = t - 1
      if (from > lo && t <= hi && at(from - 1) && at(t)) {
        const run: XY[] = []
        for (let u = from; u <= to; u++) run.push(axis === 'row' ? { x: u, y: line } : { x: line, y: u })
        out.push({ axis, line, from, to, cells: run })
      }
    }
  }
  for (let y = minY; y <= maxY; y++) scan('row', y, minX, maxX, (x) => has(x, y))
  for (let x = minX; x <= maxX; x++) scan('col', x, minY, maxY, (y) => has(x, y))
  return out
}

export interface Concave {
  /** All notches of the stack. */
  notches: Notch[]
  /** The end backed by the piece — the one that must be filled. */
  innermost: Notch
  /** Direction the mouth opens towards (away from the backing side). */
  opens: Dir
}

/**
 * Concaves = stacks of parallel notches in consecutive lines that overlap. The innermost notch
 * of a stack is one whose whole far side (the line beyond it, across its span) is piece.
 */
export function findConcaves(cells: readonly XY[]): Concave[] {
  const occ = new Set(cells.map((c) => cellKey(c.x, c.y)))
  const notches = findNotches(cells)
  const overlaps = (a: Notch, b: Notch) =>
    a.axis === b.axis && Math.abs(a.line - b.line) === 1 && a.from <= b.to && b.from <= a.to
  const backedOn = (n: Notch, side: 1 | -1) =>
    n.cells.every((c) => occ.has(n.axis === 'row' ? cellKey(c.x, c.y + side) : cellKey(c.x + side, c.y)))

  const out: Concave[] = []
  for (const n of notches) {
    for (const side of [1, -1] as const) {
      if (!backedOn(n, side)) continue
      // Walk the stack away from the backing side.
      const stack = new Set<Notch>([n])
      const queue = [n]
      while (queue.length > 0) {
        const cur = queue.pop()!
        for (const m of notches) {
          if (stack.has(m) || !overlaps(cur, m)) continue
          if ((m.line - n.line) * -side < 0) continue
          stack.add(m)
          queue.push(m)
        }
      }
      // Row notch backed above (+y) opens S; backed below opens N. Column backed on +x opens W.
      const opens: Dir = n.axis === 'row' ? (side === 1 ? 2 : 0) : side === 1 ? 3 : 1
      out.push({ notches: [...stack], innermost: n, opens })
    }
  }
  // Stable reading order: top to bottom, then left to right, by the innermost notch.
  const topLeft = (c: Concave) => {
    const cs = c.innermost.cells
    return [-Math.max(...cs.map((q) => q.y)), Math.min(...cs.map((q) => q.x))]
  }
  return out.sort((a, b) => {
    const [ay, ax] = topLeft(a)
    const [by, bx] = topLeft(b)
    return ay - by || ax - bx || a.opens - b.opens
  })
}

// ── Self-fill search ───────────────────────────────────────────────────────

export { isSolid } from './fill'

export interface FillWitness {
  concave: Concave
  /** Copies of the piece (any rotation/mirror) that make every innermost-notch square solid. */
  copies: Placement[]
}

export const DEFAULT_SEARCH_BUDGET = 200_000

/**
 * Can copies of `piece` itself fill `concave`'s innermost notch? Returns a witness, null if
 * impossible, or 'unknown' if the search budget ran out. Same engine as the fill candidates.
 */
export function fillConcave(
  piece: KeyPiece,
  concave: Concave,
  budget = DEFAULT_SEARCH_BUDGET,
): FillWitness | null | 'unknown' {
  const r = searchFills(piece, [piece], concave, { max: 1, budget, probeMore: false })
  if (r.arrangements.length > 0) return { concave, copies: r.arrangements[0].copies }
  return r.budgetHit ? 'unknown' : null
}

// ── All checks for one piece ───────────────────────────────────────────────

export interface PieceChecks {
  connected: { status: CheckStatus; groups: XY[][] }
  cavity: { status: CheckStatus; cells: XY[] }
  concave: {
    status: CheckStatus
    concaves: Concave[]
    witness: FillWitness | null
    /** Concaves the search gave up on. */
    undecided: Concave[]
  }
  ok: boolean
}

const CACHE = new WeakMap<KeyPiece, PieceChecks>()

export function checkPiece(piece: KeyPiece): PieceChecks {
  const cached = CACHE.get(piece)
  if (cached) return cached

  const groups = connectedGroups(piece.cells)
  const connected = { status: (groups.length <= 1 ? 'pass' : 'fail') as CheckStatus, groups }
  const trapped = enclosedCells(piece.cells)
  const cavity = { status: (trapped.length === 0 ? 'pass' : 'fail') as CheckStatus, cells: trapped }

  let concave: PieceChecks['concave'] = { status: 'na', concaves: [], witness: null, undecided: [] }
  if (piece.cells.length > 0 && connected.status === 'pass' && cavity.status === 'pass') {
    const concaves = findConcaves(piece.cells)
    const undecided: Concave[] = []
    let witness: FillWitness | null = null
    for (const c of concaves) {
      const r = fillConcave(piece, c)
      if (r === 'unknown') undecided.push(c)
      else if (r) {
        witness = r
        break
      }
    }
    concave = {
      status: witness ? 'fail' : undecided.length > 0 ? 'unknown' : 'pass',
      concaves,
      witness,
      undecided,
    }
  }

  const result: PieceChecks = {
    connected,
    cavity,
    concave,
    ok: connected.status === 'pass' && cavity.status === 'pass' && concave.status !== 'fail' && concave.status !== 'unknown',
  }
  CACHE.set(piece, result)
  return result
}
