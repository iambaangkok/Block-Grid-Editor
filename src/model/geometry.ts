import type { CellKind, Dir, KeyPiece, Placement, Rot, UnitCell, WorldCell } from './types'

export type Pt = readonly [number, number]
export type Polygon = readonly Pt[]

// ── Direction & cell transforms ────────────────────────────────────────────

export function rotateDir(dir: Dir, quarterTurnsCw: number): Dir {
  return ((((dir + quarterTurnsCw) % 4) + 4) % 4) as Dir
}

/** Mirror across the vertical axis: E ↔ W, N and S unchanged. */
export function mirrorDir(dir: Dir): Dir {
  return dir === 1 ? 3 : dir === 3 ? 1 : dir
}

/** Rotate an integer offset clockwise by quarter turns about the origin (+y up). */
export function rotateOffset(x: number, y: number, rot: number): [number, number] {
  const r = ((rot % 4) + 4) % 4
  let px = x
  let py = y
  for (let i = 0; i < r; i++) {
    const nx = py
    const ny = -px
    px = nx
    py = ny
  }
  // Avoid -0 leaking into keys/JSON.
  return [px + 0, py + 0]
}

/**
 * Transform a local cell into a placement's frame. A cell is a unit square whose
 * lower-left corner is (x, y); rotating that square about the origin moves its lower-left
 * corner, so we transform the cell centre and floor back.
 */
export function transformCell(cell: UnitCell, rot: number, mirror: boolean): UnitCell {
  let cx = cell.x + 0.5
  const cy = cell.y + 0.5
  let dir = cell.dir
  if (mirror) {
    cx = -cx
    dir = mirrorDir(dir)
  }
  const [rx, ry] = rotateOffset(cx, cy, rot)
  return {
    x: Math.floor(rx),
    y: Math.floor(ry),
    kind: cell.kind,
    dir: cell.kind === 'block' ? 0 : rotateDir(dir, rot),
  }
}

export function worldCells(piece: KeyPiece, p: Placement): WorldCell[] {
  return piece.cells.map((c) => {
    const t = transformCell(c, p.rot, p.mirror)
    return { ...t, x: t.x + p.x, y: t.y + p.y, placementId: p.id, pieceId: piece.id }
  })
}

export interface Bounds {
  minX: number
  minY: number
  maxX: number // exclusive (cell max + 1)
  maxY: number
}

export function cellBounds(cells: readonly { x: number; y: number }[]): Bounds | null {
  if (cells.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const c of cells) {
    minX = Math.min(minX, c.x)
    minY = Math.min(minY, c.y)
    maxX = Math.max(maxX, c.x + 1)
    maxY = Math.max(maxY, c.y + 1)
  }
  return { minX, minY, maxX, maxY }
}

/**
 * Apply a rotation/mirror to a placement while keeping its footprint roughly in place:
 * the bounding-box centre before and after stays within half a cell.
 */
export function transformPlacement(
  piece: KeyPiece,
  p: Placement,
  op: { rotCw?: number; mirror?: boolean },
): Placement {
  const before = cellBounds(worldCells(piece, p))
  // Mirroring after an existing rotation: mirror(rot(v)) = rot(-r)(mirror(v)).
  const mirror = op.mirror ? !p.mirror : p.mirror
  let rot = p.rot as number
  if (op.mirror) rot = -rot
  rot += op.rotCw ?? 0
  const next: Placement = { ...p, mirror, rot: (((rot % 4) + 4) % 4) as Rot }
  const after = cellBounds(worldCells(piece, { ...next, x: 0, y: 0 }))
  if (!before || !after) return next
  const bcx = (before.minX + before.maxX) / 2
  const bcy = (before.minY + before.maxY) / 2
  const acx = (after.minX + after.maxX) / 2
  const acy = (after.minY + after.maxY) / 2
  return { ...next, x: Math.round(bcx - acx), y: Math.round(bcy - acy) }
}

/**
 * Rotate/mirror several placements together as one rigid group about the centre of their
 * combined footprint, so their arrangement relative to each other is preserved.
 */
export function transformGroup(
  pieces: ReadonlyMap<string, KeyPiece>,
  placements: Placement[],
  op: { rotCw?: number; mirror?: boolean },
): Placement[] {
  const all = placements.flatMap((pl) => {
    const piece = pieces.get(pl.pieceId)
    return piece ? worldCells(piece, pl) : []
  })
  const b = cellBounds(all)
  if (!b) return placements
  // Cell centres only land back on cell centres when the pivot's x and y are both integers or
  // both half-integers; nudge y by half a cell if needed.
  const cx = (b.minX + b.maxX) / 2
  let cy = (b.minY + b.maxY) / 2
  if (!Number.isInteger(cx - cy)) cy += 0.5
  const rotCw = op.rotCw ?? 0

  return placements.map((pl) => {
    const piece = pieces.get(pl.pieceId)
    const anchor = piece?.cells[0]
    if (!piece || !anchor) return pl
    let rot = pl.rot as number
    if (op.mirror) rot = -rot
    rot += rotCw
    const next: Placement = { ...pl, mirror: op.mirror ? !pl.mirror : pl.mirror, rot: (((rot % 4) + 4) % 4) as Rot }
    // Where the anchor cell's centre must end up after the group transform…
    const before = transformCell(anchor, pl.rot, pl.mirror)
    let wx = pl.x + before.x + 0.5
    const wy = pl.y + before.y + 0.5
    if (op.mirror) wx = 2 * cx - wx
    const [rx, ry] = rotateOffset(wx - cx, wy - cy, rotCw)
    // …and where it sits relative to the origin with the new orientation.
    const after = transformCell(anchor, next.rot, next.mirror)
    return {
      ...next,
      x: Math.round(cx + rx - (after.x + 0.5)),
      y: Math.round(cy + ry - (after.y + 0.5)),
    }
  })
}

/** Rotate/mirror the template itself (Key Piece editor), re-normalising nothing. */
export function transformPieceCells(cells: UnitCell[], rotCw: number, mirror: boolean): UnitCell[] {
  return cells.map((c) => transformCell(c, rotCw, mirror))
}

/** Placement origin that puts the ghost piece's bounding box centred on the pointer cell. */
export function ghostOrigin(
  ghost: { piece: KeyPiece; rot: Rot; mirror: boolean },
  cell: { x: number; y: number },
) {
  const probe: Placement = { id: '', pieceId: ghost.piece.id, x: 0, y: 0, rot: ghost.rot, mirror: ghost.mirror }
  const b = cellBounds(worldCells(ghost.piece, probe)) ?? { minX: 0, minY: 0, maxX: 1, maxY: 1 }
  const ox = Math.floor((b.minX + b.maxX - 1) / 2)
  const oy = Math.floor((b.minY + b.maxY - 1) / 2)
  return { x: cell.x - ox, y: cell.y - oy, rot: ghost.rot, mirror: ghost.mirror }
}

// ── Cell shapes ────────────────────────────────────────────────────────────
// Unit-square local coords: (0,0) lower-left, (1,1) upper-right, +y up. Defined for dir N and
// rotated about the centre.
//
// An edge holding n spikes is split into n equal slots; each spike's base is inset from its
// slot's ends (so spikes never span a full edge — four single spikes don't tile a square), and
// its depth is min(½, 1/n) so many-spike cells stay proportionate. A hole is the block with
// exactly those triangles cut out, so a spike seats into the hole of the same count.

const SPIKE_INSET = 0.15 // fraction of a slot left bare on each side of a spike's base

function spikeTriangles(n: number): Polygon[] {
  const slot = 1 / n
  const depth = Math.min(0.5, slot)
  const tris: Polygon[] = []
  for (let i = 0; i < n; i++) {
    const a = i * slot + slot * SPIKE_INSET
    const b = (i + 1) * slot - slot * SPIKE_INSET
    tris.push([
      [a, 1],
      [(a + b) / 2, 1 - depth],
      [b, 1],
    ])
  }
  return tris
}

function holePolygon(n: number): Polygon {
  const top: Pt[] = []
  // Walk the top edge right → left so the outline stays a simple polygon.
  for (const [a, apex, b] of spikeTriangles(n).reverse()) top.push(b, apex, a)
  return [[0, 0], [1, 0], [1, 1], ...top, [0, 1]]
}

const N_SHAPES: Record<CellKind, Polygon[]> = {
  block: [
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
  ],
  spike: spikeTriangles(1),
  hole: [holePolygon(1)],
  spike2: spikeTriangles(2),
  hole2: [holePolygon(2)],
  spike3: spikeTriangles(3),
  hole3: [holePolygon(3)],
  spike4: spikeTriangles(4),
  hole4: [holePolygon(4)],
}

function rotatePtCw([x, y]: Pt, q: number): Pt {
  let u = x - 0.5
  let v = y - 0.5
  for (let i = 0; i < q; i++) {
    const nu = v
    const nv = -u
    u = nu
    v = nv
  }
  return [u + 0.5, v + 0.5]
}

const SHAPE_CACHE = new Map<string, Polygon[]>()

/** Solid regions of a cell in unit-square coords. */
export function cellShape(kind: CellKind, dir: Dir): Polygon[] {
  const key = `${kind}:${kind === 'block' ? 0 : dir}`
  let s = SHAPE_CACHE.get(key)
  if (!s) {
    s = N_SHAPES[kind].map((poly) => poly.map((p) => rotatePtCw(p, kind === 'block' ? 0 : dir)))
    SHAPE_CACHE.set(key, s)
  }
  return s
}

export function isRotatable(kind: CellKind): boolean {
  return kind !== 'block'
}
