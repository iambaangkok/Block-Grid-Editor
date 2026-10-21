// Domain model — see CONTEXT.md for the ubiquitous language.
//
// Coordinates: integer grid cells, +x right, +y up. Cell (x, y) covers the world square
// [x, x+1] × [y, y+1]. Directions name a cell edge: N (+y), E (+x), S (−y), W (−x), numbered
// clockwise so a clockwise quarter turn is `dir + 1`.

export const CELL_KINDS = [
  'block',
  'spike',
  'hole',
  'spike2',
  'hole2',
  'spike3',
  'hole3',
  'spike4',
  'hole4',
] as const
export type CellKind = (typeof CELL_KINDS)[number]

/** 0 = N, 1 = E, 2 = S, 3 = W. */
export type Dir = 0 | 1 | 2 | 3

/** Number of clockwise quarter turns. */
export type Rot = 0 | 1 | 2 | 3

export interface UnitCell {
  x: number
  y: number
  kind: CellKind
  /** Edge the spike/notch sits on. Ignored (always 0) for `block`. */
  dir: Dir
}

export interface KeyPiece {
  id: string
  name: string
  border: string
  fill: string
  /** Local offsets; at most one cell per (x, y). */
  cells: UnitCell[]
  /** Offered as a filler when searching fill candidates. Absent = true. */
  filler?: boolean
}

export interface Placement {
  id: string
  pieceId: string
  /** World position of the piece's local origin. */
  x: number
  y: number
  rot: Rot
  /** Mirror across the vertical axis, applied before rotation. */
  mirror: boolean
}

export interface Assembly {
  id: string
  name: string
  /** Key pieces owned by this assembly. */
  pieces: KeyPiece[]
  /** Draw order: later placements are on top. */
  placements: Placement[]
  createdAt: number
  updatedAt: number
}

export interface Workspace {
  assemblies: Assembly[]
  activeAssemblyId: string | null
}

/** A unit cell resolved into world space for one placement. */
export interface WorldCell {
  x: number
  y: number
  kind: CellKind
  dir: Dir
  placementId: string
  pieceId: string
}

export const GRID_HALF = 64 // working bounds: x, y ∈ [-64, 63] (128 × 128)

export const KIND_LABEL: Record<CellKind, string> = {
  block: 'Block',
  spike: 'Spike',
  hole: 'Hole',
  spike2: 'Two spikes',
  hole2: 'Two holes',
  spike3: 'Three spikes',
  hole3: 'Three holes',
  spike4: 'Four spikes',
  hole4: 'Four holes',
}

/** Spikes / notches on the cell's edge: 0 for a block. */
export function featureCount(kind: CellKind): number {
  return kind === 'block' ? 0 : kind.endsWith('2') ? 2 : kind.endsWith('3') ? 3 : kind.endsWith('4') ? 4 : 1
}

export const isSpike = (kind: CellKind) => kind.startsWith('spike')
export const isHole = (kind: CellKind) => kind.startsWith('hole')

export const DIR_LABEL = ['N', 'E', 'S', 'W'] as const
