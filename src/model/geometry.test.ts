import { cellBounds, mirrorDir, rotateDir, transformCell, transformPlacement, worldCells } from './geometry'
import type { KeyPiece, Placement } from './types'

const L: KeyPiece = {
  id: 'L',
  name: 'L',
  fill: '#fff',
  border: '#000',
  cells: [
    { x: 0, y: 0, kind: 'block', dir: 0 },
    { x: 0, y: 1, kind: 'block', dir: 0 },
    { x: 1, y: 0, kind: 'spike', dir: 1 },
  ],
}
const at = (p: Partial<Placement> = {}): Placement => ({ id: 'p', pieceId: 'L', x: 0, y: 0, rot: 0, mirror: false, ...p })
const key = (cs: { x: number; y: number; kind: string; dir: number }[]) =>
  cs.map((c) => `${c.x},${c.y},${c.kind},${c.dir}`).sort()

describe('directions', () => {
  it('rotates clockwise N→E→S→W', () => {
    expect(rotateDir(0, 1)).toBe(1)
    expect(rotateDir(3, 1)).toBe(0)
    expect(rotateDir(0, -1)).toBe(3)
  })
  it('mirrors E↔W only', () => {
    expect([0, 1, 2, 3].map((d) => mirrorDir(d as 0))).toEqual([0, 3, 2, 1])
  })
})

describe('transformCell', () => {
  it('rotates a cell about the origin clockwise, keeping cells on the grid', () => {
    // Cell (0,0) covers [0,1]²; a clockwise turn about the origin maps it to [0,1]×[-1,0].
    expect(transformCell({ x: 0, y: 0, kind: 'block', dir: 0 }, 1, false)).toMatchObject({ x: 0, y: -1 })
    expect(transformCell({ x: 1, y: 0, kind: 'spike', dir: 1 }, 1, false)).toMatchObject({ x: 0, y: -2, dir: 2 })
  })
  it('four quarter turns are the identity', () => {
    const c = { x: 3, y: -2, kind: 'hole' as const, dir: 1 as const }
    expect(transformCell(c, 4, false)).toEqual(c)
  })
  it('mirror flips x and E/W direction', () => {
    expect(transformCell({ x: 1, y: 0, kind: 'spike', dir: 1 }, 0, true)).toMatchObject({ x: -2, y: 0, dir: 3 })
  })
  it('blocks never gain a direction', () => {
    expect(transformCell({ x: 0, y: 0, kind: 'block', dir: 0 }, 3, true).dir).toBe(0)
  })
})

describe('transformPlacement', () => {
  it('rotating keeps the footprint centred in place', () => {
    const p = at({ x: 10, y: 10 })
    const before = cellBounds(worldCells(L, p))!
    const after = cellBounds(worldCells(L, transformPlacement(L, p, { rotCw: 1 })))!
    expect(Math.abs((before.minX + before.maxX) / 2 - (after.minX + after.maxX) / 2)).toBeLessThanOrEqual(0.5)
    expect(Math.abs((before.minY + before.maxY) / 2 - (after.minY + after.maxY) / 2)).toBeLessThanOrEqual(0.5)
  })
  it('mirroring twice restores the shape', () => {
    const p = at({ rot: 1 })
    const twice = transformPlacement(L, transformPlacement(L, p, { mirror: true }), { mirror: true })
    expect(key(worldCells(L, twice))).toEqual(key(worldCells(L, p)))
  })
  it('mirror after rotation mirrors the world shape (not the template)', () => {
    const p = at({ rot: 1 })
    const m = transformPlacement(L, p, { mirror: true })
    const mirroredWorld = worldCells(L, p).map((c) => ({ ...c, x: -c.x - 1, dir: mirrorDir(c.dir) }))
    const shift = <T extends { x: number; y: number }>(cs: T[]) => {
      const b = cellBounds(cs)!
      return cs.map((c) => ({ ...c, x: c.x - b.minX, y: c.y - b.minY }))
    }
    expect(key(shift(worldCells(L, m)))).toEqual(key(shift(mirroredWorld)))
  })
})
