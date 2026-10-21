import { buildOccupancy, classifyCell } from './analysis'
import { findConcaves } from './checks'
import { isSolid, searchFills } from './fill'
import { enclosedCells } from './shape'
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

/** Independently verify an arrangement: no grid conflicts and every innermost square solid. */
function expectValid(target: KeyPiece, fillers: KeyPiece[], concaveIdx: number, copies: { pieceId: string }[]) {
  const concave = findConcaves(target.cells)[concaveIdx]
  const asm = {
    id: 'a',
    name: 'a',
    createdAt: 0,
    updatedAt: 0,
    pieces: [target, ...fillers.filter((f) => f.id !== target.id)],
    placements: [{ id: 'target', pieceId: target.id, x: 0, y: 0, rot: 0 as const, mirror: false }, ...(copies as never[])],
  }
  const occ = buildOccupancy(asm)
  for (const cells of occ.values()) expect(classifyCell(cells)).not.toBe('conflict')
  for (const sq of concave.innermost.cells) expect(isSolid(occ.get(`${sq.x},${sq.y}`) ?? [])).toBe(true)
  // No gaps: nothing sealed off by the target + copies.
  const squares = [...occ.keys()].map((k) => ({ x: Number(k.split(',')[0]), y: Number(k.split(',')[1]) }))
  expect(enclosedCells(squares)).toEqual([])
}

const slot2 = art('slot2', ['# . . #', '# # # #'])
const slot1 = art('slot1', ['# . #', '# # #'])
const dot = art('dot', ['#'])

describe('fill candidates', () => {
  it('concaves know where their mouth opens', () => {
    expect(findConcaves(slot1.cells)[0].opens).toBe(0) // N
    expect(findConcaves(art('c', ['# # #', '# . .', '# # #']).cells)[0].opens).toBe(1) // E
  })

  it('a 1-cell dot fills a 2-wide slot exactly one way, with two copies', () => {
    const r = searchFills(slot2, [dot], findConcaves(slot2.cells)[0], { max: 5 })
    expect(r.arrangements).toHaveLength(1)
    expect(r.arrangements[0].copies).toHaveLength(2)
    expect(r.limitReached).toBe(false)
    expectValid(slot2, [dot], 0, r.arrangements[0].copies)
  })

  it('a spike piece and a hole piece pair up: one arrangement per seating edge', () => {
    const spike = art('spike', ['s'], { s: ['spike', 0] })
    const hole = art('hole', ['h'], { h: ['hole', 0] })
    const r = searchFills(slot1, [spike, hole], findConcaves(slot1.cells)[0], { max: 20 })
    // Spike + matching hole in the slot, seated on any of the 4 edges; pair order is de-duplicated.
    expect(r.arrangements).toHaveLength(4)
    for (const a of r.arrangements) {
      expect(a.copies.map((c) => c.pieceId).sort()).toEqual(['hole', 'spike'])
      expectValid(slot1, [spike, hole], 0, a.copies)
    }
  })

  it('lists fewest copies first and respects the cap', () => {
    const domino = art('domino', ['# #'])
    const r = searchFills(slot2, [dot, domino], findConcaves(slot2.cells)[0], { max: 1 })
    expect(r.arrangements).toHaveLength(1)
    expect(r.arrangements[0].copies).toHaveLength(1) // the domino alone beats two dots
    expect(r.limitReached).toBe(true)
  })

  it('no fillers → no arrangements', () => {
    const r = searchFills(slot2, [], findConcaves(slot2.cells)[0], { max: 5 })
    expect(r).toEqual({ arrangements: [], limitReached: false, budgetHit: false })
  })

  it('every arrangement for a mixed set is valid and copy counts never decrease', () => {
    const u = art('u', ['# . #', '# # #'])
    const l = art('l', ['# .', '# #'])
    const fillers = [u, l, dot]
    const r = searchFills(slot2, fillers, findConcaves(slot2.cells)[0], { max: 20 })
    expect(r.arrangements.length).toBeGreaterThan(3)
    let prev = 0
    for (const a of r.arrangements) {
      expect(a.copies.length).toBeGreaterThanOrEqual(prev)
      prev = a.copies.length
      expectValid(slot2, fillers, 0, a.copies)
    }
  })

  it('rejects arrangements that trap a gap', () => {
    // A 2-wide, 2-deep U. A C-shaped filler can make the innermost row solid with its bottom
    // arm, but its body then seals the square above that arm against the U's wall.
    const u = art('u', ['# . . #', '# . . #', '# # # #'])
    const c = art('c', ['# #', '# .', '# #'])
    const concave = findConcaves(u.cells)[0]
    const withGaps = searchFills(u, [c], concave, { max: 20, allowGaps: true })
    expect(withGaps.arrangements.length).toBeGreaterThan(0)
    expect(searchFills(u, [c], concave, { max: 20 }).arrangements).toEqual([])
  })

  it('reports budget exhaustion but keeps what it found', () => {
    const u = art('u', ['# . #', '# # #'])
    const r = searchFills(slot2, [u, dot], findConcaves(slot2.cells)[0], { max: 20, budget: 5 })
    expect(r.budgetHit).toBe(true)
  })
})
