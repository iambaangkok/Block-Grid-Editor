import { analyzeAssembly, classifyCell, shapesOverlap } from './analysis'
import type { Assembly, CellKind, Dir, WorldCell } from './types'

const wc = (kind: CellKind, dir: Dir, placementId = 'a'): WorldCell => ({ x: 0, y: 0, kind, dir, placementId, pieceId: placementId })

describe('cell overlap', () => {
  it('a spike seats exactly into a hole on the same edge', () => {
    for (const d of [0, 1, 2, 3] as Dir[]) {
      expect(shapesOverlap(wc('spike', d), wc('hole', d))).toBe(false)
      expect(classifyCell([wc('spike', d, 'a'), wc('hole', d, 'b')])).toBe('fit')
    }
  })
  it('two spikes seat into a two-hole cell on the same edge', () => {
    expect(classifyCell([wc('spike2', 2, 'a'), wc('hole2', 2, 'b')])).toBe('fit')
  })
  it('mismatched edges or kinds conflict', () => {
    expect(classifyCell([wc('spike', 0, 'a'), wc('hole', 1, 'b')])).toBe('conflict')
    expect(classifyCell([wc('spike', 0, 'a'), wc('hole2', 0, 'b')])).toBe('conflict')
    expect(classifyCell([wc('spike2', 0, 'a'), wc('hole', 0, 'b')])).toBe('conflict')
    expect(classifyCell([wc('block', 0, 'a'), wc('block', 0, 'b')])).toBe('conflict')
    expect(classifyCell([wc('spike', 0, 'a'), wc('block', 0, 'b')])).toBe('conflict')
  })
  it('spikes on different edges of one cell can share it', () => {
    expect(classifyCell([wc('spike', 0, 'a'), wc('spike', 1, 'b')])).toBe('shared')
    expect(classifyCell([wc('spike', 0, 'a'), wc('spike', 2, 'b')])).toBe('shared')
    expect(classifyCell([wc('spike', 0, 'a'), wc('spike', 0, 'b')])).toBe('conflict')
  })
  it('a third piece in a fitted cell is still a conflict', () => {
    expect(classifyCell([wc('spike', 0, 'a'), wc('hole', 0, 'b'), wc('block', 0, 'c')])).toBe('conflict')
  })
})

describe('analyzeAssembly', () => {
  it('counts fits and conflicts across placements', () => {
    const asm: Assembly = {
      id: 'x',
      name: 'x',
      createdAt: 0,
      updatedAt: 0,
      pieces: [
        { id: 'key', name: 'key', fill: '', border: '', cells: [{ x: 0, y: 0, kind: 'block', dir: 0 }, { x: 1, y: 0, kind: 'spike', dir: 3 }] },
        { id: 'lock', name: 'lock', fill: '', border: '', cells: [{ x: 0, y: 0, kind: 'hole', dir: 3 }, { x: 1, y: 0, kind: 'block', dir: 0 }] },
      ],
      placements: [
        { id: 'k', pieceId: 'key', x: 0, y: 0, rot: 0, mirror: false },
        { id: 'l', pieceId: 'lock', x: 1, y: 0, rot: 0, mirror: false },
        { id: 'l2', pieceId: 'lock', x: 1, y: 0, rot: 0, mirror: false },
      ],
    }
    const a = analyzeAssembly(asm)
    // (1,0): spike + hole + hole → holes overlap → conflict; (2,0): block + block → conflict.
    expect(a.conflicts).toBe(2)
    expect(a.fits).toBe(0)
    const fitted = analyzeAssembly({ ...asm, placements: asm.placements.slice(0, 2) })
    expect(fitted.fits).toBe(1)
    expect(fitted.conflicts).toBe(0)
  })
})
