import { findConcaves, type Concave } from './checks'
import { searchFills, type FillArrangement } from './fill'
import { worldCells } from './geometry'
import type { KeyPiece, Placement, UnitCell } from './types'

// Look-ahead dead-end elimination — see CONTEXT.md "Look-ahead". Based on the original
// fill-lookahead proposal (merge the target with a candidate, then search the merged shape).
//
// After placing a candidate, the combined shape must stay workable for N steps:
//   survives(shape, N) = every NEW-OR-CHANGED concave of `shape` has at least one fill f such
//                        that survives(shape + f, N − 1); survives(·, 0) = true.
// Concaves are examined one at a time. A dead end is only declared when proven; if a search
// runs out of budget (or branching is cut off) the verdict is "unknown".

/** Step budget for each sub-search. Runs are cancellable, so this can be generous. */
export const LOOKAHEAD_BUDGET = 200_000
/** Fills tried per concave when looking for one that keeps going (depth ≥ 2). */
export const LOOKAHEAD_BRANCH = 20
/** Raw candidates checked per concave, as a multiple of the cap. */
export const LOOKAHEAD_CEILING = 5
export const LOOKAHEAD_DEPTHS = [1, 2, 3] as const

/**
 * The target plus the copies as one shape, in the target's frame. Every cell is kept (a square
 * may hold several, e.g. a seated spike/hole pair or two unseated spikes on different edges), so
 * solidity and overlaps are judged exactly as in the fill search.
 */
export function mergeShape(target: KeyPiece, copies: readonly Placement[], pieces: ReadonlyMap<string, KeyPiece>): KeyPiece {
  const cells: UnitCell[] = [...target.cells]
  for (const p of copies) {
    const piece = pieces.get(p.pieceId)
    if (piece) for (const c of worldCells(piece, p)) cells.push({ x: c.x, y: c.y, kind: c.kind, dir: c.dir })
  }
  return { ...target, id: `${target.id}+merged`, cells }
}

/** Identity of a concave by its notches, used to tell which concaves a fill created or changed. */
export function concaveKey(c: Concave): string {
  const sig = (n: Concave['innermost']) => `${n.axis}:${n.line}:${n.from}-${n.to}`
  return `${sig(c.innermost)}|${c.notches.map(sig).sort().join(',')}`
}

export type Verdict =
  | { status: 'ok' }
  | {
      status: 'dead'
      /** The first-step concave (in the merged shape) that gets stuck. */
      concave: Concave
      /** 'nofill': nothing fills it. 'deadends': every fill dead-ends within `within` more steps. */
      reason: 'nofill' | 'deadends'
      within: number
    }
  | { status: 'unknown' }

/** Thrown to abort a run (the worker checks a flag between candidates). */
export class Cancelled extends Error {}

export interface LookaheadContext {
  fillers: readonly KeyPiece[]
  pieces: ReadonlyMap<string, KeyPiece>
  budget?: number
  branch?: number
}

const shapeSig = (s: KeyPiece) =>
  s.cells
    .map((c) => `${c.x},${c.y},${c.kind},${c.dir}`)
    .sort()
    .join(';')

/** Memoising evaluator for one run (shapes recur a lot across candidates and branches). */
export class Lookahead {
  private memo = new Map<string, Verdict>()
  private ctx: LookaheadContext
  constructor(ctx: LookaheadContext) {
    this.ctx = ctx
  }

  /** Does `shape` survive `depth` steps, counting only concaves not in `previous`? */
  survives(shape: KeyPiece, previous: ReadonlySet<string>, depth: number): Verdict {
    if (depth <= 0) return { status: 'ok' }
    const concaves = findConcaves(shape.cells).filter((c) => !previous.has(concaveKey(c)))
    if (concaves.length === 0) return { status: 'ok' }
    const memoKey = `${depth}#${shapeSig(shape)}#${concaves.map(concaveKey).sort().join('/')}`
    const hit = this.memo.get(memoKey)
    if (hit) return hit

    const budget = this.ctx.budget ?? LOOKAHEAD_BUDGET
    const branch = this.ctx.branch ?? LOOKAHEAD_BRANCH
    const here = new Set(findConcaves(shape.cells).map(concaveKey))
    let unknown = false
    let verdict: Verdict | null = null

    for (const concave of concaves) {
      if (depth === 1) {
        const r = searchFills(shape, this.ctx.fillers, concave, { max: 1, budget, probeMore: false })
        if (r.arrangements.length > 0) continue
        if (r.budgetHit) {
          unknown = true
          continue
        }
        verdict = { status: 'dead', concave, reason: 'nofill', within: 0 }
        break
      }
      const r = searchFills(shape, this.ctx.fillers, concave, { max: branch, budget })
      if (r.arrangements.length === 0) {
        if (r.budgetHit) {
          unknown = true
          continue
        }
        verdict = { status: 'dead', concave, reason: 'nofill', within: 0 }
        break
      }
      let good = false
      let sawUnknown = r.budgetHit || r.limitReached
      for (const a of r.arrangements) {
        const v = this.survives(mergeShape(shape, a.copies, this.ctx.pieces), here, depth - 1)
        if (v.status === 'ok') {
          good = true
          break
        }
        if (v.status === 'unknown') sawUnknown = true
      }
      if (good) continue
      if (sawUnknown) {
        unknown = true
        continue
      }
      verdict = { status: 'dead', concave, reason: 'deadends', within: depth - 1 }
      break
    }

    const result: Verdict = verdict ?? (unknown ? { status: 'unknown' } : { status: 'ok' })
    this.memo.set(memoKey, result)
    return result
  }

  /** Verdict for placing `arrangement` into `target`, looking `depth` steps ahead. */
  candidate(target: KeyPiece, arrangement: FillArrangement, depth: number): Verdict {
    const before = new Set(findConcaves(target.cells).map(concaveKey))
    return this.survives(mergeShape(target, arrangement.copies, this.ctx.pieces), before, depth)
  }
}

// ── A whole run for one target piece ───────────────────────────────────────

export interface LookaheadRow {
  arrangement: FillArrangement
  verdict: Verdict
}

export interface ConcaveLookahead {
  concave: Concave
  /** Up to `cap` non-eliminated candidates ('ok' or 'unknown'), fewest copies first. */
  survivors: LookaheadRow[]
  /** Proven dead ends, in the order checked. */
  eliminated: LookaheadRow[]
  /** More candidates exist that weren't checked. */
  limitReached: boolean
  /** The underlying candidate search ran out of budget. */
  budgetHit: boolean
}

export interface LookaheadRun {
  depth: number
  concaves: ConcaveLookahead[]
}

export interface LookaheadProgress {
  concave: number
  concaves: number
  checked: number
  total: number
}

/**
 * Check candidates for every concave of `target`, fewest copies first, until `cap` survivors are
 * found or LOOKAHEAD_CEILING × cap candidates have been checked.
 */
export function runLookahead(
  target: KeyPiece,
  fillers: readonly KeyPiece[],
  pieces: readonly KeyPiece[],
  opts: {
    cap: number
    depth: number
    budget?: number
    branch?: number
    onProgress?: (p: LookaheadProgress) => void
    shouldCancel?: () => boolean
  },
): LookaheadRun {
  const byId = new Map(pieces.map((p) => [p.id, p]))
  const la = new Lookahead({ fillers, pieces: byId, budget: opts.budget, branch: opts.branch })
  const concaves = findConcaves(target.cells)
  const out: ConcaveLookahead[] = []
  concaves.forEach((concave, ci) => {
    const raw = searchFills(target, fillers, concave, { max: opts.cap * LOOKAHEAD_CEILING, budget: opts.budget })
    const survivors: LookaheadRow[] = []
    const eliminated: LookaheadRow[] = []
    let checked = 0
    for (const arrangement of raw.arrangements) {
      if (survivors.length >= opts.cap) break
      if (opts.shouldCancel?.()) throw new Cancelled()
      opts.onProgress?.({ concave: ci, concaves: concaves.length, checked, total: raw.arrangements.length })
      const verdict = la.candidate(target, arrangement, opts.depth)
      checked++
      if (verdict.status === 'dead') eliminated.push({ arrangement, verdict })
      else survivors.push({ arrangement, verdict })
    }
    out.push({
      concave,
      survivors,
      eliminated,
      limitReached: checked < raw.arrangements.length || raw.limitReached,
      budgetHit: raw.budgetHit,
    })
  })
  return { depth: opts.depth, concaves: out }
}
