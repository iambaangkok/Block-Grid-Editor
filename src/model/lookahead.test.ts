import { findConcaves } from './checks'
import { isFiller, searchFills } from './fill'
import assembly2 from './fixtures/assembly2.json'
import { concaveKey, Lookahead, mergeShape, runLookahead } from './lookahead'
import type { CellKind, Dir, KeyPiece, UnitCell } from './types'

function art(id: string, rows: string[], legend: Record<string, [CellKind, Dir]> = {}): KeyPiece {
  const cells: UnitCell[] = []
  rows.forEach((row, i) => {
    const y = rows.length - 1 - i
    row
      .split(' ')
      .filter(Boolean)
      .forEach((ch, x) => {
        if (ch === '.') return
        const [kind, dir] = ch === '#' ? (['block', 0] as [CellKind, Dir]) : legend[ch]
        cells.push({ x, y, kind, dir })
      })
  })
  return { id, name: id, fill: '#fff', border: '#000', cells }
}
const byId = (...ps: KeyPiece[]) => new Map(ps.map((p) => [p.id, p]))

describe('mergeShape', () => {
  it('keeps every cell of a shared square (no spike is dropped)', () => {
    const a = art('a', ['s'], { s: ['spike', 0] })
    const b = art('b', ['s'], { s: ['spike', 1] })
    const merged = mergeShape(a, [{ id: 'c', pieceId: 'b', x: 0, y: 0, rot: 0, mirror: false }], byId(b))
    expect(merged.cells.map((c) => c.dir).sort()).toEqual([0, 1])
  })
})

describe('look-ahead verdicts', () => {
  // Concave A (1-wide slot at the left) can't be filled by a 2×2 square; concave B (2×2 pit) can.
  const target = art('t', ['# . # . . #', '# # # . . #', '# # # # # #'])
  const square = art('o', ['# #', '# #'])

  it('ignores concaves the candidate did not create or change', () => {
    const concaves = findConcaves(target.cells)
    const pit = concaves.find((c) => c.innermost.cells.length === 2)!
    const [fill] = searchFills(target, [square], pit, { max: 1 }).arrangements
    const la = new Lookahead({ fillers: [square], pieces: byId(square) })
    // The untouched 1-wide slot has no fill, but it isn't this candidate's doing.
    expect(la.candidate(target, fill, 1).status).toBe('ok')
    expect(la.candidate(target, fill, 3).status).toBe('ok')
  })

  it('flags a new concave that nothing can fill', () => {
    // A domino closing the bottom row of a 2-deep pit leaves a new 1-deep notch on top.
    const pit = art('pit', ['# . . #', '# . . #', '# # # #'])
    const domino = art('d', ['# #'])
    const concave = findConcaves(pit.cells)[0]
    const fills = searchFills(pit, [domino], concave, { max: 5 }).arrangements
    const la = new Lookahead({ fillers: [domino], pieces: byId(domino) })
    // A horizontal domino closes the bottom row; the new top notch is fillable by another domino.
    expect(fills.some((a) => la.candidate(pit, a, 1).status === 'ok')).toBe(true)
    // Without any filler able to close the new notch, it's a proven dead end.
    const tooBig = new Lookahead({ fillers: [], pieces: byId(domino) })
    const v = tooBig.candidate(pit, fills[0], 1)
    expect(v.status).toBe('dead')
    if (v.status === 'dead') expect(v.reason).toBe('nofill')
  })

  it('a pit closed step by step survives 2 and 3 steps', () => {
    const pit = art('pit', ['# . . #', '# . . #', '# # # #'])
    const domino = art('d', ['# #'])
    const la = new Lookahead({ fillers: [domino], pieces: byId(domino) })
    const fills = searchFills(pit, [domino], findConcaves(pit.cells)[0], { max: 20 }).arrangements
    expect(fills.length).toBeGreaterThan(0)
    for (const a of fills) for (const d of [1, 2, 3]) expect(la.candidate(pit, a, d).status).toBe('ok')
  })

  it('a run out of budget is "unknown", never a dead end', () => {
    const pit = art('pit', ['# . . #', '# . . #', '# # # #'])
    const domino = art('d', ['# #'])
    const [fill] = searchFills(pit, [domino], findConcaves(pit.cells)[0], { max: 1 }).arrangements
    const la = new Lookahead({ fillers: [domino], pieces: byId(domino), budget: 1 })
    expect(la.candidate(pit, fill, 2).status).toBe('unknown')
  })
})

describe('Assembly 2 fixture (from the original proposal)', () => {
  const pieces = assembly2.pieces as KeyPiece[]
  const fillers = pieces.filter(isFiller)
  const purply = pieces.find((p) => p.name === 'purply')!
  const darkBlue = pieces.find((p) => p.name === 'dark blue')!

  it('eliminates dark blue in purply concave 1 at depth 1', () => {
    const run = runLookahead(purply, fillers, pieces, { cap: 10, depth: 1 })
    const c1 = run.concaves[0]
    expect(c1.eliminated.map((r) => r.arrangement.copies.map((c) => c.pieceId))).toContainEqual([darkBlue.id])
    for (const r of c1.eliminated) expect(r.verdict.status).toBe('dead')
  })

  it('deeper look-ahead only removes more (survivors at depth 2 ⊆ depth 1)', () => {
    const d1 = runLookahead(purply, fillers, pieces, { cap: 5, depth: 1 })
    const d2 = runLookahead(purply, fillers, pieces, { cap: 5, depth: 2 })
    const key = (copies: { id: string }[]) => copies.map((c) => c.id).sort().join('|')
    d2.concaves.forEach((c, i) => {
      const dead1 = new Set(d1.concaves[i].eliminated.map((r) => key(r.arrangement.copies)))
      for (const r of c.survivors) expect(dead1.has(key(r.arrangement.copies))).toBe(false)
    })
  }, 60_000)
})

describe('runLookahead', () => {
  it('stops at the cap and reports the rest as unchecked', () => {
    const pit = art('pit', ['# . . #', '# # # #'])
    const dot = art('dot', ['#'])
    const domino = art('d', ['# #'])
    const l = art('l', ['# .', '# #'])
    const run = runLookahead(pit, [dot, domino, l], [dot, domino, l], { cap: 1, depth: 1 })
    expect(run.concaves[0].survivors).toHaveLength(1)
    expect(run.concaves[0].limitReached).toBe(true)
  })

  it('concave identity ignores order of notches', () => {
    const [c] = findConcaves(art('u', ['# . . #', '# . . #', '# # # #']).cells)
    expect(concaveKey({ ...c, notches: [...c.notches].reverse() })).toBe(concaveKey(c))
  })
})
