import { cellShape, worldCells, type Polygon } from './geometry'
import type { Assembly, CellKind, Dir, KeyPiece, WorldCell } from './types'

// Overlap & fit classification — a pure function over the assembly model.
//
// Each cell kind/dir is rasterised into a sample mask over the unit square. Samples on a
// shape's boundary belong to no shape, so shapes that merely touch (a spike seated in its
// notch, or spikes on different edges of the same cell) never count as overlapping.

const RES = 24
const EPS = 1e-9

function onSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const cross = (bx - ax) * (py - ay) - (by - ay) * (px - ax)
  if (Math.abs(cross) > EPS) return false
  return (
    px >= Math.min(ax, bx) - EPS &&
    px <= Math.max(ax, bx) + EPS &&
    py >= Math.min(ay, by) - EPS &&
    py <= Math.max(ay, by) + EPS
  )
}

/** Strict interior test: points on an edge are outside. */
function insidePolygon(px: number, py: number, poly: Polygon): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (onSegment(px, py, xi, yi, xj, yj)) return false
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

const MASKS = new Map<string, Uint8Array>()

export function cellMask(kind: CellKind, dir: Dir): Uint8Array {
  const key = `${kind}:${kind === 'block' ? 0 : dir}`
  let m = MASKS.get(key)
  if (!m) {
    m = new Uint8Array(RES * RES)
    const polys = cellShape(kind, dir)
    // Samples that land exactly on a 45° edge are excluded by the strict test, so the
    // spike/notch pair partitions the samples cleanly.
    for (let j = 0; j < RES; j++) {
      for (let i = 0; i < RES; i++) {
        const px = (i + 0.5) / RES
        const py = (j + 0.5) / RES
        if (polys.some((p) => insidePolygon(px, py, p))) m[j * RES + i] = 1
      }
    }
    MASKS.set(key, m)
  }
  return m
}

export function shapesOverlap(a: { kind: CellKind; dir: Dir }, b: { kind: CellKind; dir: Dir }) {
  const ma = cellMask(a.kind, a.dir)
  const mb = cellMask(b.kind, b.dir)
  for (let i = 0; i < ma.length; i++) if (ma[i] && mb[i]) return true
  return false
}

/** A spike seated in its matching notch. */
export function isFit(a: { kind: CellKind; dir: Dir }, b: { kind: CellKind; dir: Dir }) {
  const pair = (s: CellKind, h: CellKind) =>
    (a.kind === s && b.kind === h) || (a.kind === h && b.kind === s)
  return a.dir === b.dir && (pair('spike', 'hole') || pair('spike2', 'hole2'))
}

export type CellStatus = 'conflict' | 'fit' | 'shared'

export interface CellReport {
  x: number
  y: number
  status: CellStatus
  cells: WorldCell[]
}

export interface AssemblyAnalysis {
  /** Every world cell, keyed `${x},${y}` — the occupancy index later analyses build on. */
  occupancy: Map<string, WorldCell[]>
  /** Only cells occupied by more than one placement. */
  reports: CellReport[]
  conflicts: number
  fits: number
}

export const cellKey = (x: number, y: number) => `${x},${y}`

export function buildOccupancy(assembly: Assembly): Map<string, WorldCell[]> {
  const byId = new Map<string, KeyPiece>(assembly.pieces.map((p) => [p.id, p]))
  const occ = new Map<string, WorldCell[]>()
  for (const pl of assembly.placements) {
    const piece = byId.get(pl.pieceId)
    if (!piece) continue
    for (const wc of worldCells(piece, pl)) {
      const k = cellKey(wc.x, wc.y)
      const list = occ.get(k)
      if (list) list.push(wc)
      else occ.set(k, [wc])
    }
  }
  return occ
}

export function classifyCell(cells: WorldCell[]): CellStatus {
  let fit = false
  for (let i = 0; i < cells.length; i++) {
    for (let j = i + 1; j < cells.length; j++) {
      if (shapesOverlap(cells[i], cells[j])) return 'conflict'
      if (isFit(cells[i], cells[j])) fit = true
    }
  }
  return fit ? 'fit' : 'shared'
}

export function analyzeAssembly(assembly: Assembly): AssemblyAnalysis {
  const occupancy = buildOccupancy(assembly)
  const reports: CellReport[] = []
  let conflicts = 0
  let fits = 0
  for (const cells of occupancy.values()) {
    if (cells.length < 2) continue
    const status = classifyCell(cells)
    if (status === 'conflict') conflicts++
    if (status === 'fit') fits++
    reports.push({ x: cells[0].x, y: cells[0].y, status, cells })
  }
  return { occupancy, reports, conflicts, fits }
}
