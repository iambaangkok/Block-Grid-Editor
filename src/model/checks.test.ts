import { checkPiece, connectedGroups, enclosedCells, fillConcave, findConcaves, findNotches, isSolid } from './checks'
import { buildOccupancy, classifyCell } from './analysis'
import type { CellKind, Dir, KeyPiece, UnitCell } from './types'

/**
 * Build a piece from ASCII art (top row first). `#` block, `.` empty; other letters map via
 * `legend` to a cell kind + dir.
 */
function art(rows: string[], legend: Record<string, [CellKind, Dir]> = {}): KeyPiece {
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
  return { id: 'p', name: 'p', fill: '#fff', border: '#000', cells }
}

describe('connectivity', () => {
  it('passes an L, fails two islands', () => {
    expect(connectedGroups(art(['# .', '# #']).cells)).toHaveLength(1)
    expect(connectedGroups(art(['# . #']).cells)).toHaveLength(2)
  })
  it('corner contact does not connect', () => {
    expect(connectedGroups(art(['# .', '. #']).cells)).toHaveLength(2)
  })
})

describe('enclosed cavities', () => {
  it('a ring traps its inside', () => {
    expect(enclosedCells(art(['# # # #', '# . . #', '# . . #', '# # # #']).cells)).toHaveLength(4)
  })
  it('a diagonal corner gap does not let space escape', () => {
    expect(enclosedCells(art(['# # .', '# . #', '# # #']).cells)).toEqual([{ x: 1, y: 1 }])
  })
  it('a U has no cavity', () => {
    expect(enclosedCells(art(['# . #', '# # #']).cells)).toEqual([])
  })
})

describe('notches & concaves', () => {
  it('finds the row notches of a U and the innermost one', () => {
    const u = art(['# . . #', '# . . #', '# . . #', '# # # #'])
    expect(findNotches(u.cells).filter((n) => n.axis === 'row')).toHaveLength(3)
    const [c] = findConcaves(u.cells)
    expect(c.innermost).toMatchObject({ axis: 'row', line: 1, from: 1, to: 2 })
    expect(c.notches).toHaveLength(3)
  })
  it('a funnel narrows to a single innermost cell', () => {
    const f = art(['# . . . #', '# # . # #', '# # # # #'])
    const cs = findConcaves(f.cells)
    expect(cs).toHaveLength(1)
    expect(cs[0].innermost.cells).toEqual([{ x: 2, y: 1 }])
    expect(cs[0].notches).toHaveLength(2)
  })
  it('a single slot is a concave of depth one', () => {
    expect(findConcaves(art(['# . #', '# # #']).cells)).toHaveLength(1)
  })
  it('a C opening sideways gives column notches', () => {
    const [c] = findConcaves(art(['# # #', '# . .', '# # #']).cells)
    expect(c.innermost.axis).toBe('col')
  })
})

describe('solid squares', () => {
  it('block, or a seated spike/hole pair', () => {
    expect(isSolid([{ kind: 'block', dir: 0 }])).toBe(true)
    expect(isSolid([{ kind: 'spike', dir: 0 }])).toBe(false)
    expect(isSolid([{ kind: 'hole', dir: 0 }])).toBe(false)
    expect(isSolid([{ kind: 'spike', dir: 1 }, { kind: 'hole', dir: 1 }])).toBe(true)
    expect(isSolid([{ kind: 'spike2', dir: 1 }, { kind: 'hole', dir: 1 }])).toBe(false)
  })
})

describe('self-fill', () => {
  it('a small U fills its own slot with an arm', () => {
    const u = art(['# . #', '# # #'])
    const r = fillConcave(u, findConcaves(u.cells)[0])
    expect(r).not.toBeNull()
    expect(r).not.toBe('unknown')
    expect(checkPiece(u).concave.status).toBe('fail')
  })
  it('a piece of only hole cells can never make a square solid', () => {
    const h = art(['a . a', 'b b b'], { a: ['hole', 0], b: ['hole', 2] })
    expect(checkPiece(h).concave.status).toBe('pass')
  })
  it('every witness is independently valid (no grid conflicts, innermost squares solid)', () => {
    const pieces = [
      art(['# . #', '# # #']),
      art(['# . . #', '# # # #']),
      art(['# . . #', '# . . #', '# # # #']),
      art(['# . . . #', '# # . # #', '# # # # #']),
      art(['# . #', 's # #'], { s: ['spike', 3] }),
      art(['h . #', '# # s'], { h: ['hole', 1], s: ['spike', 0] }),
      art(['# # #', '# . .', '# # #']),
    ]
    let witnesses = 0
    for (const p of pieces) {
      const res = checkPiece(p)
      const w = res.concave.witness
      if (!w) continue
      witnesses++
      const asm = {
        id: 'a',
        name: 'a',
        createdAt: 0,
        updatedAt: 0,
        pieces: [p],
        placements: [{ id: 'orig', pieceId: p.id, x: 0, y: 0, rot: 0 as const, mirror: false }, ...w.copies],
      }
      const occ = buildOccupancy(asm)
      for (const cells of occ.values()) expect(classifyCell(cells)).not.toBe('conflict')
      for (const sq of w.concave.innermost.cells) expect(isSolid(occ.get(`${sq.x},${sq.y}`) ?? [])).toBe(true)
    }
    expect(witnesses).toBeGreaterThan(2)
  })
  it('checks are n/a until the piece is connected and cavity-free', () => {
    expect(checkPiece(art(['# . #'])).concave.status).toBe('na')
    expect(checkPiece(art(['# # #', '# . #', '# # #'])).concave.status).toBe('na')
  })
  it('a piece with no concave passes', () => {
    expect(checkPiece(art(['# # #'])).concave.status).toBe('pass')
  })
})
