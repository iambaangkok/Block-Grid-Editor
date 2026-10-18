import { nanoid } from 'nanoid'
import { transformPieceCells, transformPlacement } from './geometry'
import { presetAt } from './palette'
import type { Assembly, KeyPiece, Placement, UnitCell, Workspace } from './types'

// Pure workspace operations. Every function returns a new Workspace (or the same one when
// nothing changed) so the store can keep immutable undo history.

export const newId = () => nanoid(10)

// ── Assemblies ─────────────────────────────────────────────────────────────

export function makeAssembly(name: string, now = Date.now()): Assembly {
  return { id: newId(), name, pieces: [], placements: [], createdAt: now, updatedAt: now }
}

export function activeAssembly(ws: Workspace): Assembly | undefined {
  return ws.assemblies.find((a) => a.id === ws.activeAssemblyId) ?? ws.assemblies[0]
}

export function updateAssembly(
  ws: Workspace,
  id: string,
  fn: (a: Assembly) => Assembly,
): Workspace {
  let changed = false
  const assemblies = ws.assemblies.map((a) => {
    if (a.id !== id) return a
    const next = fn(a)
    if (next === a) return a
    changed = true
    return { ...next, updatedAt: Date.now() }
  })
  return changed ? { ...ws, assemblies } : ws
}

export function addAssembly(ws: Workspace, asm: Assembly): Workspace {
  return { assemblies: [...ws.assemblies, asm], activeAssemblyId: asm.id }
}

export function renameAssembly(ws: Workspace, id: string, name: string): Workspace {
  return updateAssembly(ws, id, (a) => (a.name === name ? a : { ...a, name }))
}

export function deleteAssembly(ws: Workspace, id: string): Workspace {
  const idx = ws.assemblies.findIndex((a) => a.id === id)
  if (idx < 0) return ws
  const assemblies = ws.assemblies.filter((a) => a.id !== id)
  const activeAssemblyId =
    ws.activeAssemblyId === id
      ? (assemblies[Math.min(idx, assemblies.length - 1)]?.id ?? null)
      : ws.activeAssemblyId
  return { assemblies, activeAssemblyId }
}

/** Deep copy with fresh ids (pieces and placements re-linked). */
export function cloneAssembly(a: Assembly, name = a.name): Assembly {
  const now = Date.now()
  const idMap = new Map<string, string>()
  const pieces = a.pieces.map((p) => {
    const id = newId()
    idMap.set(p.id, id)
    return { ...p, id, cells: p.cells.map((c) => ({ ...c })) }
  })
  const placements = a.placements
    .filter((pl) => idMap.has(pl.pieceId))
    .map((pl) => ({ ...pl, id: newId(), pieceId: idMap.get(pl.pieceId)! }))
  return { ...a, id: newId(), name, pieces, placements, createdAt: now, updatedAt: now }
}

export function setActiveAssembly(ws: Workspace, id: string): Workspace {
  return ws.activeAssemblyId === id ? ws : { ...ws, activeAssemblyId: id }
}

// ── Key pieces ─────────────────────────────────────────────────────────────

export function makePiece(name: string, colorIndex: number): KeyPiece {
  const preset = presetAt(colorIndex)
  return {
    id: newId(),
    name,
    fill: preset.fill,
    border: preset.border,
    cells: [{ x: 0, y: 0, kind: 'block', dir: 0 }],
  }
}

export function addPiece(ws: Workspace, asmId: string, piece: KeyPiece): Workspace {
  return updateAssembly(ws, asmId, (a) => ({ ...a, pieces: [...a.pieces, piece] }))
}

export function updatePiece(
  ws: Workspace,
  asmId: string,
  pieceId: string,
  fn: (p: KeyPiece) => KeyPiece,
): Workspace {
  return updateAssembly(ws, asmId, (a) => {
    let changed = false
    const pieces = a.pieces.map((p) => {
      if (p.id !== pieceId) return p
      const next = fn(p)
      if (next !== p) changed = true
      return next
    })
    return changed ? { ...a, pieces } : a
  })
}

export function deletePiece(ws: Workspace, asmId: string, pieceId: string): Workspace {
  return updateAssembly(ws, asmId, (a) => ({
    ...a,
    pieces: a.pieces.filter((p) => p.id !== pieceId),
    placements: a.placements.filter((pl) => pl.pieceId !== pieceId),
  }))
}

export function clonePiece(p: KeyPiece, name: string): KeyPiece {
  return { ...p, id: newId(), name, cells: p.cells.map((c) => ({ ...c })) }
}

/** Copy a key piece (independent duplicate) into another — or the same — assembly. */
export function copyPieceTo(
  ws: Workspace,
  fromAsmId: string,
  pieceId: string,
  toAsmId: string,
): { ws: Workspace; newPieceId: string | null } {
  const from = ws.assemblies.find((a) => a.id === fromAsmId)
  const piece = from?.pieces.find((p) => p.id === pieceId)
  if (!piece) return { ws, newPieceId: null }
  const copy = clonePiece(piece, fromAsmId === toAsmId ? `${piece.name} copy` : piece.name)
  return { ws: addPiece(ws, toAsmId, copy), newPieceId: copy.id }
}

/** Set (or replace) the cell at (x, y); passing `null` erases it. */
export function setCell(piece: KeyPiece, x: number, y: number, cell: UnitCell | null): KeyPiece {
  const existing = piece.cells.find((c) => c.x === x && c.y === y)
  if (!cell && !existing) return piece
  if (
    cell &&
    existing &&
    existing.kind === cell.kind &&
    (existing.dir === cell.dir || cell.kind === 'block')
  )
    return piece
  const rest = piece.cells.filter((c) => !(c.x === x && c.y === y))
  return { ...piece, cells: cell ? [...rest, { ...cell, x, y }] : rest }
}

export function transformPiece(piece: KeyPiece, rotCw: number, mirror: boolean): KeyPiece {
  return { ...piece, cells: transformPieceCells(piece.cells, rotCw, mirror) }
}

// ── Placements ─────────────────────────────────────────────────────────────

export function addPlacement(ws: Workspace, asmId: string, pl: Placement): Workspace {
  return updateAssembly(ws, asmId, (a) => ({ ...a, placements: [...a.placements, pl] }))
}

function mapPlacements(
  ws: Workspace,
  asmId: string,
  ids: ReadonlySet<string>,
  fn: (pl: Placement, a: Assembly) => Placement,
): Workspace {
  if (ids.size === 0) return ws
  return updateAssembly(ws, asmId, (a) => ({
    ...a,
    placements: a.placements.map((pl) => (ids.has(pl.id) ? fn(pl, a) : pl)),
  }))
}

export function movePlacements(
  ws: Workspace,
  asmId: string,
  ids: ReadonlySet<string>,
  dx: number,
  dy: number,
): Workspace {
  if (dx === 0 && dy === 0) return ws
  return mapPlacements(ws, asmId, ids, (pl) => ({ ...pl, x: pl.x + dx, y: pl.y + dy }))
}

export function transformPlacements(
  ws: Workspace,
  asmId: string,
  ids: ReadonlySet<string>,
  op: { rotCw?: number; mirror?: boolean },
): Workspace {
  return mapPlacements(ws, asmId, ids, (pl, a) => {
    const piece = a.pieces.find((p) => p.id === pl.pieceId)
    return piece ? transformPlacement(piece, pl, op) : pl
  })
}

export function deletePlacements(ws: Workspace, asmId: string, ids: ReadonlySet<string>): Workspace {
  if (ids.size === 0) return ws
  return updateAssembly(ws, asmId, (a) => ({
    ...a,
    placements: a.placements.filter((pl) => !ids.has(pl.id)),
  }))
}

export function duplicatePlacements(
  ws: Workspace,
  asmId: string,
  ids: ReadonlySet<string>,
  dx = 1,
  dy = -1,
): { ws: Workspace; newIds: string[] } {
  const asm = ws.assemblies.find((a) => a.id === asmId)
  if (!asm || ids.size === 0) return { ws, newIds: [] }
  const copies = asm.placements
    .filter((pl) => ids.has(pl.id))
    .map((pl) => ({ ...pl, id: newId(), x: pl.x + dx, y: pl.y + dy }))
  return {
    ws: updateAssembly(ws, asmId, (a) => ({ ...a, placements: [...a.placements, ...copies] })),
    newIds: copies.map((c) => c.id),
  }
}

export function bringToFront(ws: Workspace, asmId: string, ids: ReadonlySet<string>): Workspace {
  return updateAssembly(ws, asmId, (a) => {
    const front = a.placements.filter((pl) => ids.has(pl.id))
    if (front.length === 0) return a
    return { ...a, placements: [...a.placements.filter((pl) => !ids.has(pl.id)), ...front] }
  })
}

// ── Starter content ────────────────────────────────────────────────────────

/** A small demo: two pieces whose spike seats into the other's notch. */
export function starterWorkspace(): Workspace {
  const asm = makeAssembly('Assembly 1')
  const a: KeyPiece = {
    id: newId(),
    name: 'Key A',
    ...pick(0),
    cells: [
      { x: 0, y: 0, kind: 'block', dir: 0 },
      { x: 1, y: 0, kind: 'block', dir: 0 },
      { x: 2, y: 0, kind: 'spike', dir: 3 },
    ],
  }
  const b: KeyPiece = {
    id: newId(),
    name: 'Lock B',
    ...pick(4),
    cells: [
      { x: 0, y: 0, kind: 'hole', dir: 3 },
      { x: 1, y: 0, kind: 'block', dir: 0 },
      { x: 1, y: 1, kind: 'block', dir: 0 },
      { x: 0, y: 1, kind: 'hole2', dir: 3 },
    ],
  }
  asm.pieces = [a, b]
  asm.placements = [
    { id: newId(), pieceId: a.id, x: -3, y: 0, rot: 0, mirror: false },
    { id: newId(), pieceId: b.id, x: -1, y: 0, rot: 0, mirror: false },
  ]
  return { assemblies: [asm], activeAssemblyId: asm.id }
}

function pick(i: number) {
  const p = presetAt(i)
  return { fill: p.fill, border: p.border }
}
