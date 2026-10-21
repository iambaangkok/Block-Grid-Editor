import { cellKey, isFit, shapesOverlap } from './analysis'
import type { Concave } from './checks'
import { enclosedCells } from './shape'
import { worldCells } from './geometry'
import type { KeyPiece, Placement, Rot, UnitCell } from './types'

// Filling a concave's innermost notch — see CONTEXT.md "Fill candidates".
//
// Copies of the filler pieces (unlimited, any rotation/mirror) are placed statically around the
// fixed target piece. Every innermost-notch square must end up solid, no two cells may overlap
// under the grid's rules (only a seated spike/hole pair shares a square), and the result must not
// trap a gap — an empty square sealed off (edge-only) by the target and the copies. Only copies
// with a cell on the notch can help, so the candidate placements are finite; a backtracking
// search enumerates arrangements of them.

type Cell = Pick<UnitCell, 'kind' | 'dir'>

/** A square is solid when it holds a block, or a spike with its matching hole seated on it. */
export function isSolid(occupants: readonly Cell[]): boolean {
  if (occupants.some((c) => c.kind === 'block')) return true
  for (let i = 0; i < occupants.length; i++)
    for (let j = i + 1; j < occupants.length; j++) if (isFit(occupants[i], occupants[j])) return true
  return false
}

const ORIENTATIONS: { rot: Rot; mirror: boolean }[] = []
for (const mirror of [false, true]) for (const rot of [0, 1, 2, 3] as Rot[]) ORIENTATIONS.push({ rot, mirror })

interface Candidate {
  sig: string
  placement: Placement
  cells: { key: string; cell: Cell }[]
}

/** One way to fill the notch: copies of filler pieces (placement.pieceId names the piece). */
export interface FillArrangement {
  copies: Placement[]
}

export interface FillSearchResult {
  /** Fewest copies first. */
  arrangements: FillArrangement[]
  /** More arrangements exist beyond `max`. */
  limitReached: boolean
  /** The step budget ran out before the search finished. */
  budgetHit: boolean
}

export const FILL_BUDGET = 100_000

/** Arrangements shown per concave: 5 by default, up to 20. */
export const FILL_CAP_OPTIONS = [5, 10, 15, 20] as const

export function searchFills(
  target: KeyPiece,
  fillers: readonly KeyPiece[],
  concave: Concave,
  /**
   * `probeMore: false` skips looking for one extra arrangement (limitReached is then false).
   * `allowGaps` keeps arrangements that trap empty squares (off normally; for tests).
   */
  opts: { max: number; budget?: number; probeMore?: boolean; allowGaps?: boolean },
): FillSearchResult {
  const budget = opts.budget ?? FILL_BUDGET
  const squares = concave.innermost.cells.map((c) => cellKey(c.x, c.y))
  const squareSet = new Set(squares)

  // Occupancy: the target piece, then copies as they're placed.
  const occ = new Map<string, Cell[]>()
  for (const c of target.cells) occ.set(cellKey(c.x, c.y), [c])
  const fits = (key: string, cell: Cell) => (occ.get(key) ?? []).every((o) => !shapesOverlap(o, cell))

  // Candidates: each filler × orientation, anchored with each of its cells on each notch square,
  // minus those that already clash with the target. Identical cell sets of the same piece (from
  // symmetric orientations) collapse into one.
  const candidates = new Map<string, Candidate>()
  for (const piece of fillers) {
    for (const o of ORIENTATIONS) {
      const base = worldCells(piece, { id: '', pieceId: piece.id, x: 0, y: 0, ...o })
      for (const t of concave.innermost.cells) {
        for (const anchor of base) {
          const dx = t.x - anchor.x
          const dy = t.y - anchor.y
          const cells = base.map((c) => ({ key: cellKey(c.x + dx, c.y + dy), cell: { kind: c.kind, dir: c.dir } }))
          const sig =
            piece.id +
            '#' +
            cells
              .map((c) => `${c.key}:${c.cell.kind}:${c.cell.dir}`)
              .sort()
              .join('|')
          if (candidates.has(sig)) continue
          if (!cells.every((c) => fits(c.key, c.cell))) continue
          candidates.set(sig, { sig, placement: { id: sig, pieceId: piece.id, x: dx, y: dy, ...o }, cells })
        }
      }
    }
  }
  const bySquare = new Map<string, { cand: Candidate; cell: Cell }[]>()
  for (const cand of candidates.values())
    for (const c of cand.cells)
      if (squareSet.has(c.key)) {
        const list = bySquare.get(c.key) ?? []
        list.push({ cand, cell: c.cell })
        bySquare.set(c.key, list)
      }

  const placed: Candidate[] = []
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

  /** No gaps: the target plus the copies must not seal off any empty square (edge-only). */
  const trapsGap = () =>
    enclosedCells([...occ.keys()].map((k) => {
      const [x, y] = k.split(',').map(Number)
      return { x, y }
    })).length > 0

  const found = new Map<string, FillArrangement>()
  const want = opts.probeMore === false ? opts.max : opts.max + 1 // one extra tells us whether the limit was reached
  let steps = 0
  let budgetHit = false

  // Depth-limited DFS, run with increasing depth so arrangements come out fewest copies first.
  // Always branch on the first square that isn't solid yet; a square holding a lone spike/hole
  // only accepts its exact match. A spike/hole pair can be reached in either order, so finished
  // arrangements are de-duplicated by their set of placements.
  const dfs = (depth: number): void => {
    if (found.size >= want || budgetHit) return
    if (++steps > budget) {
      budgetHit = true
      return
    }
    const square = squares.find((k) => !isSolid(occ.get(k) ?? []))
    if (!square) {
      if (placed.length !== depth) return // found at a shallower depth already
      if (!opts.allowGaps && trapsGap()) return
      const key = placed
        .map((c) => c.sig)
        .sort()
        .join('||')
      if (!found.has(key)) found.set(key, { copies: placed.map((c) => c.placement) })
      return
    }
    if (placed.length >= depth) return
    const here = (occ.get(square) ?? []).filter((c) => c.kind !== 'block')
    for (const { cand, cell } of bySquare.get(square) ?? []) {
      if (here.length > 0 && !here.some((h) => isFit(h, cell))) continue
      if (!cand.cells.every((c) => fits(c.key, c.cell))) continue
      place(cand)
      dfs(depth)
      unplace(cand)
      if (found.size >= want || budgetHit) return
    }
  }

  // Each square is made solid by at most two copies, which bounds the depth.
  for (let depth = 1; depth <= squares.length * 2 && found.size < want && !budgetHit; depth++) dfs(depth)

  const arrangements = [...found.values()]
  return {
    arrangements: arrangements.slice(0, opts.max),
    limitReached: arrangements.length > opts.max,
    budgetHit,
  }
}

/** Pieces offered as fillers (the toggle defaults to on). */
export const isFiller = (p: KeyPiece) => p.filler !== false

/** "Key A ×2 + Lock B" — pieces in first-use order with counts. */
export function arrangementLabel(copies: { pieceId: string }[], names: ReadonlyMap<string, string>) {
  const counts = new Map<string, number>()
  for (const c of copies) counts.set(c.pieceId, (counts.get(c.pieceId) ?? 0) + 1)
  return [...counts]
    .map(([id, n]) => `${names.get(id) ?? 'Unknown'}${n > 1 ? ` ×${n}` : ''}`)
    .join(' + ')
}

// ── Cached search for every concave of a piece ─────────────────────────────

export interface ConcaveFillsResult {
  concave: Concave
  result: FillSearchResult
}

const FILLS_CACHE = new Map<string, ConcaveFillsResult[]>()
const FILLS_CACHE_LIMIT = 64

/**
 * Fill candidates for each concave of `target`. Cached on the geometry that matters (target
 * cells, each filler's id + cells, the cap), so renames and recolours don't re-run the search.
 */
export function fillsForPiece(
  target: KeyPiece,
  concaves: Concave[],
  fillers: readonly KeyPiece[],
  max: number,
): ConcaveFillsResult[] {
  const sig = JSON.stringify([target.cells, fillers.map((f) => [f.id, f.cells]), max])
  const hit = FILLS_CACHE.get(sig)
  if (hit) return hit
  const out = concaves.map((concave) => ({ concave, result: searchFills(target, fillers, concave, { max }) }))
  if (FILLS_CACHE.size >= FILLS_CACHE_LIMIT) FILLS_CACHE.delete(FILLS_CACHE.keys().next().value!)
  FILLS_CACHE.set(sig, out)
  return out
}
