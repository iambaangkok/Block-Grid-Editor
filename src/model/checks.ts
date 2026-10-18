import { shapesOverlap, isFit, cellKey } from './analysis'
import { worldCells } from './geometry'
import type { KeyPiece, Placement, Rot, UnitCell } from './types'

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
      out.push({ notches: [...stack], innermost: n })
    }
  }
  return out
}

// ── Self-fill search ───────────────────────────────────────────────────────

export interface FillWitness {
  concave: Concave
  /** Copies of the piece (any rotation/mirror) that make every innermost-notch square solid. */
  copies: Placement[]
}

const ORIENTATIONS: { rot: Rot; mirror: boolean }[] = []
for (const mirror of [false, true]) for (const rot of [0, 1, 2, 3] as Rot[]) ORIENTATIONS.push({ rot, mirror })

type Cell = Pick<UnitCell, 'kind' | 'dir'>

/** A square is solid when it holds a block, or a spike with its matching hole seated on it. */
export function isSolid(occupants: readonly Cell[]): boolean {
  if (occupants.some((c) => c.kind === 'block')) return true
  for (let i = 0; i < occupants.length; i++)
    for (let j = i + 1; j < occupants.length; j++) if (isFit(occupants[i], occupants[j])) return true
  return false
}

interface Candidate {
  placement: Placement
  cells: { key: string; cell: Cell }[]
}

export const DEFAULT_SEARCH_BUDGET = 200_000

/**
 * Can copies of `piece` make every square of `concave.innermost` solid, without overlapping the
 * piece or each other (grid overlap rules: only seated spike/hole pairs may share a square)?
 * Returns a witness, null if impossible, or 'unknown' if the search budget ran out.
 */
export function fillConcave(
  piece: KeyPiece,
  concave: Concave,
  budget = DEFAULT_SEARCH_BUDGET,
): FillWitness | null | 'unknown' {
  const target = concave.innermost.cells.map((c) => cellKey(c.x, c.y))
  const targetSet = new Set(target)

  // Occupancy: the original piece, then copies as they're placed.
  const occ = new Map<string, Cell[]>()
  for (const c of piece.cells) occ.set(cellKey(c.x, c.y), [c])
  const fits = (key: string, cell: Cell) => (occ.get(key) ?? []).every((o) => !shapesOverlap(o, cell))

  // Every copy that matters touches a target square: enumerate orientations × anchoring each
  // copy cell on each target square, dropping ones that already clash with the piece.
  const candidates = new Map<string, Candidate>()
  for (const o of ORIENTATIONS) {
    const base = worldCells(piece, { id: '', pieceId: piece.id, x: 0, y: 0, ...o })
    for (const t of concave.innermost.cells) {
      for (const anchor of base) {
        const dx = t.x - anchor.x
        const dy = t.y - anchor.y
        const cells = base.map((c) => ({ key: cellKey(c.x + dx, c.y + dy), cell: { kind: c.kind, dir: c.dir } }))
        const sig = cells
          .map((c) => `${c.key}:${c.cell.kind}:${c.cell.dir}`)
          .sort()
          .join('|')
        if (candidates.has(sig)) continue
        if (!cells.every((c) => fits(c.key, c.cell))) continue
        candidates.set(sig, {
          placement: { id: `copy-${candidates.size}`, pieceId: piece.id, x: dx, y: dy, ...o },
          cells,
        })
      }
    }
  }
  const bySquare = new Map<string, { cand: Candidate; cell: Cell }[]>()
  for (const cand of candidates.values())
    for (const c of cand.cells)
      if (targetSet.has(c.key)) {
        const list = bySquare.get(c.key) ?? []
        list.push({ cand, cell: c.cell })
        bySquare.set(c.key, list)
      }

  const placed: Candidate[] = []
  let steps = 0
  let exhausted = false

  const place = (cand: Candidate) => {
    for (const c of cand.cells) {
      const list = occ.get(c.key)
      if (list) list.push(c.cell)
      else occ.set(c.key, [c.cell])
    }
    placed.push(cand)
  }
  const unplace = (cand: Candidate) => {
    for (const c of cand.cells) {
      const list = occ.get(c.key)!
      list.pop()
      if (list.length === 0) occ.delete(c.key)
    }
    placed.pop()
  }

  const solve = (): boolean => {
    if (++steps > budget) {
      exhausted = true
      return false
    }
    const square = target.find((k) => !isSolid(occ.get(k) ?? []))
    if (!square) return true
    const here = (occ.get(square) ?? []).filter((c) => c.kind !== 'block')
    for (const { cand, cell } of bySquare.get(square) ?? []) {
      // An empty square takes anything; a square with a lone spike/hole needs its exact match.
      if (here.length > 0 && !here.some((h) => isFit(h, cell))) continue
      if (!cand.cells.every((c) => fits(c.key, c.cell))) continue
      place(cand)
      if (solve()) return true
      unplace(cand)
      if (exhausted) return false
    }
    return false
  }

  if (solve()) return { concave, copies: placed.map((c) => c.placement) }
  return exhausted ? 'unknown' : null
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
