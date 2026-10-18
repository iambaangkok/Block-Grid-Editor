import { exportAssembly, exportWorkspace, ImportError, parseImport, parseStoredWorkspace } from './io'
import {
  cloneAssembly,
  copyToClipboard,
  pasteClipboard,
  copyPieceTo,
  deletePiece,
  duplicatePlacements,
  setCell,
  starterWorkspace,
  transformPlacements,
} from './workspace'
import { WorkspaceStore } from '../state/store'

describe('workspace ops', () => {
  it('copying a key piece makes an independent duplicate in the target assembly', () => {
    let ws = starterWorkspace()
    const src = ws.assemblies[0]
    const other = cloneAssembly(src, 'Other')
    other.pieces = []
    other.placements = []
    ws = { ...ws, assemblies: [...ws.assemblies, other] }
    const { ws: next, newPieceId } = copyPieceTo(ws, src.id, src.pieces[0].id, other.id)
    const copied = next.assemblies[1].pieces[0]
    expect(copied.id).toBe(newPieceId)
    expect(copied.id).not.toBe(src.pieces[0].id)
    expect(copied.cells).toEqual(src.pieces[0].cells)
    expect(copied.cells).not.toBe(src.pieces[0].cells)
  })

  it('deleting a key piece removes its placements', () => {
    const ws = starterWorkspace()
    const a = ws.assemblies[0]
    const next = deletePiece(ws, a.id, a.pieces[0].id)
    expect(next.assemblies[0].placements.every((p) => p.pieceId !== a.pieces[0].id)).toBe(true)
  })

  it('setCell replaces, erases, and is a no-op when unchanged', () => {
    const piece = starterWorkspace().assemblies[0].pieces[0]
    expect(setCell(piece, 0, 0, { x: 0, y: 0, kind: 'block', dir: 0 })).toBe(piece)
    expect(setCell(piece, 0, 0, null).cells).toHaveLength(piece.cells.length - 1)
    expect(setCell(piece, 0, 0, { x: 0, y: 0, kind: 'hole', dir: 2 }).cells.find((c) => c.x === 0 && c.y === 0)?.kind).toBe('hole')
  })

  it('duplicate + rotate placements', () => {
    const ws = starterWorkspace()
    const a = ws.assemblies[0]
    const ids = new Set([a.placements[0].id])
    const { ws: dup, newIds } = duplicatePlacements(ws, a.id, ids)
    expect(dup.assemblies[0].placements).toHaveLength(a.placements.length + 1)
    const rotated = transformPlacements(dup, a.id, new Set(newIds), { rotCw: 1 })
    expect(rotated.assemblies[0].placements.find((p) => p.id === newIds[0])?.rot).toBe(1)
  })
})

describe('clipboard', () => {
  it('pastes into the same assembly linked to the existing key piece', () => {
    const ws = starterWorkspace()
    const a = ws.assemblies[0]
    const clip = copyToClipboard(a, new Set([a.placements[0].id]))!
    const { ws: next, newIds } = pasteClipboard(ws, a.id, clip, 2, 3)
    const pasted = next.assemblies[0].placements.find((p) => p.id === newIds[0])!
    expect(pasted.pieceId).toBe(a.placements[0].pieceId)
    expect([pasted.x, pasted.y]).toEqual([a.placements[0].x + 2, a.placements[0].y + 3])
    expect(next.assemblies[0].pieces).toHaveLength(a.pieces.length)
  })

  it('pasting into another assembly brings independent copies of the key pieces', () => {
    let ws = starterWorkspace()
    const a = ws.assemblies[0]
    const other = { ...cloneAssembly(a, 'Other'), pieces: [], placements: [] }
    ws = { ...ws, assemblies: [...ws.assemblies, other] }
    const clip = copyToClipboard(a, new Set(a.placements.map((p) => p.id)))!
    const { ws: next, newIds } = pasteClipboard(ws, other.id, clip, 0, 0)
    const target = next.assemblies[1]
    expect(newIds).toHaveLength(2)
    expect(target.pieces).toHaveLength(2)
    expect(target.pieces.every((p) => !a.pieces.some((q) => q.id === p.id))).toBe(true)
    expect(target.placements.every((pl) => target.pieces.some((p) => p.id === pl.pieceId))).toBe(true)
  })

  it('nothing selected → no clipboard', () => {
    expect(copyToClipboard(starterWorkspace().assemblies[0], new Set())).toBeNull()
  })
})

describe('JSON import/export', () => {
  it('round-trips a workspace with fresh ids and intact links', () => {
    const ws = starterWorkspace()
    const imported = parseImport(exportWorkspace(ws))
    expect(imported).toHaveLength(1)
    const a = imported[0]
    expect(a.id).not.toBe(ws.assemblies[0].id)
    expect(a.placements.every((p) => a.pieces.some((k) => k.id === p.pieceId))).toBe(true)
    expect(a.pieces.map((p) => p.cells)).toEqual(ws.assemblies[0].pieces.map((p) => p.cells))
  })

  it('imports a single assembly', () => {
    expect(parseImport(exportAssembly(starterWorkspace().assemblies[0]))).toHaveLength(1)
  })

  it('rejects junk with a readable error', () => {
    expect(() => parseImport('nope')).toThrow(ImportError)
    expect(() => parseImport('{"format":"other"}')).toThrow(/Not a block-grid-editor file/)
    const bad = JSON.parse(exportWorkspace(starterWorkspace()))
    bad.assemblies[0].pieces[0].cells[0].kind = 'triangle'
    expect(() => parseImport(JSON.stringify(bad))).toThrow(/unknown kind/)
  })

  it('restores persisted state and survives corruption', () => {
    const ws = starterWorkspace()
    expect(parseStoredWorkspace(JSON.stringify(ws))?.assemblies[0].name).toBe('Assembly 1')
    expect(parseStoredWorkspace('{bad')).toBeNull()
  })
})

describe('store', () => {
  it('undo/redo and merged commits', () => {
    const s = new WorkspaceStore(starterWorkspace(), null)
    const id = s.workspace.assemblies[0].id
    const rename = (name: string, mergeKey?: string) =>
      s.commit((w) => ({ ...w, assemblies: w.assemblies.map((a) => (a.id === id ? { ...a, name } : a)) }), { mergeKey })
    rename('A', 'typing')
    rename('AB', 'typing')
    rename('ABC', 'typing')
    expect(s.history.past).toHaveLength(1)
    rename('X')
    expect(s.history.past).toHaveLength(2)
    s.undo()
    expect(s.workspace.assemblies[0].name).toBe('ABC')
    s.undo()
    expect(s.workspace.assemblies[0].name).toBe('Assembly 1')
    s.redo()
    expect(s.workspace.assemblies[0].name).toBe('ABC')
  })
})
