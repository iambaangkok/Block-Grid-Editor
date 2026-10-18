import { cellBounds, cellShape, worldCells } from '../model/geometry'
import type { AssemblyAnalysis } from '../model/analysis'
import { GRID_HALF, type Assembly, type CellKind, type Dir, type KeyPiece, type Placement } from '../model/types'

// Canvas 2D rendering. The context is set up so 1 unit = 1 grid cell with +y up; all
// coordinates passed here are world (cell) units.

export interface Camera {
  /** World point at the centre of the viewport. */
  x: number
  y: number
  /** Pixels per cell. */
  zoom: number
}

export const MIN_ZOOM = 4
export const MAX_ZOOM = 160

export function clampZoom(z: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))
}

export function screenToWorld(cam: Camera, w: number, h: number, sx: number, sy: number) {
  return { x: (sx - w / 2) / cam.zoom + cam.x, y: -(sy - h / 2) / cam.zoom + cam.y }
}

export function worldToScreen(cam: Camera, w: number, h: number, wx: number, wy: number) {
  return { x: (wx - cam.x) * cam.zoom + w / 2, y: h / 2 - (wy - cam.y) * cam.zoom }
}

/** Apply the world transform for a viewport of css size w × h at the given device ratio. */
export function applyCamera(ctx: CanvasRenderingContext2D, cam: Camera, w: number, h: number, dpr: number) {
  const z = cam.zoom * dpr
  ctx.setTransform(z, 0, 0, -z, dpr * (w / 2 - cam.x * cam.zoom), dpr * (h / 2 + cam.y * cam.zoom))
}

export const COLORS = {
  bg: '#ffffff',
  gridMinor: '#eef0f3',
  gridMajor: '#dfe3e8',
  axis: '#adb5bd',
  bounds: '#ced4da',
  outside: '#fafbfc',
  selection: '#4c6ef5',
  conflict: '#e03131',
  fit: '#2f9e44',
}

export function drawGrid(ctx: CanvasRenderingContext2D, cam: Camera, w: number, h: number) {
  const tl = screenToWorld(cam, w, h, 0, 0)
  const br = screenToWorld(cam, w, h, w, h)
  const x0 = Math.floor(tl.x) - 1
  const x1 = Math.ceil(br.x) + 1
  const y0 = Math.floor(br.y) - 1
  const y1 = Math.ceil(tl.y) + 1
  const px = 1 / cam.zoom

  // Shade outside the working bounds.
  ctx.fillStyle = COLORS.outside
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0)
  ctx.fillStyle = COLORS.bg
  ctx.fillRect(-GRID_HALF, -GRID_HALF, GRID_HALF * 2, GRID_HALF * 2)

  const step = cam.zoom < 8 ? 8 : 1
  const lines = (major: boolean) => {
    ctx.beginPath()
    for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) {
      if ((x % 8 === 0) !== major || x === 0) continue
      ctx.moveTo(x, y0)
      ctx.lineTo(x, y1)
    }
    for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) {
      if ((y % 8 === 0) !== major || y === 0) continue
      ctx.moveTo(x0, y)
      ctx.lineTo(x1, y)
    }
    ctx.stroke()
  }
  ctx.lineWidth = px
  if (step === 1) {
    ctx.strokeStyle = COLORS.gridMinor
    lines(false)
  }
  ctx.strokeStyle = COLORS.gridMajor
  lines(true)

  ctx.strokeStyle = COLORS.axis
  ctx.lineWidth = 1.5 * px
  ctx.beginPath()
  ctx.moveTo(0, y0)
  ctx.lineTo(0, y1)
  ctx.moveTo(x0, 0)
  ctx.lineTo(x1, 0)
  ctx.stroke()

  ctx.strokeStyle = COLORS.bounds
  ctx.lineWidth = 2 * px
  ctx.strokeRect(-GRID_HALF, -GRID_HALF, GRID_HALF * 2, GRID_HALF * 2)
}

export function tracePolygons(ctx: CanvasRenderingContext2D, kind: CellKind, dir: Dir, x: number, y: number) {
  for (const poly of cellShape(kind, dir)) {
    ctx.moveTo(x + poly[0][0], y + poly[0][1])
    for (let i = 1; i < poly.length; i++) ctx.lineTo(x + poly[i][0], y + poly[i][1])
    ctx.closePath()
  }
}

export interface CellStyle {
  fill: string
  border: string
  /** Stroke width in world units. */
  lineWidth: number
  alpha?: number
}

export function drawCells(
  ctx: CanvasRenderingContext2D,
  cells: readonly { x: number; y: number; kind: CellKind; dir: Dir }[],
  style: CellStyle,
) {
  ctx.save()
  ctx.globalAlpha = style.alpha ?? 1
  ctx.lineJoin = 'round'
  ctx.fillStyle = style.fill
  ctx.strokeStyle = style.border
  ctx.lineWidth = style.lineWidth
  for (const c of cells) {
    ctx.beginPath()
    tracePolygons(ctx, c.kind, c.dir, c.x, c.y)
    ctx.fill()
    ctx.stroke()
  }
  ctx.restore()
}

/** Border width that reads well at any zoom: ~2px, capped to a fraction of a cell. */
export function borderWidth(zoom: number) {
  return Math.min(2 / zoom, 0.08)
}

export interface AssemblyDrawOptions {
  selected?: ReadonlySet<string>
  hovered?: string | null
  /** Live offset for selected placements while dragging. */
  dragDelta?: { dx: number; dy: number } | null
  ghost?: { piece: KeyPiece; placement: Placement } | null
  analysis?: AssemblyAnalysis | null
  showAnalysis?: boolean
}

/** Placements with any in-progress drag applied. */
export function effectivePlacements(
  placements: Placement[],
  selected: ReadonlySet<string> | undefined,
  dragDelta: { dx: number; dy: number } | null | undefined,
): Placement[] {
  if (!dragDelta || !selected || selected.size === 0) return placements
  return placements.map((p) =>
    selected.has(p.id) ? { ...p, x: p.x + dragDelta.dx, y: p.y + dragDelta.dy } : p,
  )
}

export function drawAssembly(
  ctx: CanvasRenderingContext2D,
  asm: Assembly,
  zoom: number,
  opts: AssemblyDrawOptions = {},
) {
  const pieces = new Map(asm.pieces.map((p) => [p.id, p]))
  const lw = borderWidth(zoom)
  const placements = effectivePlacements(asm.placements, opts.selected, opts.dragDelta)

  for (const pl of placements) {
    const piece = pieces.get(pl.pieceId)
    if (!piece) continue
    drawCells(ctx, worldCells(piece, pl), { fill: piece.fill, border: piece.border, lineWidth: lw })
  }

  if (opts.showAnalysis !== false && opts.analysis) drawAnalysis(ctx, opts.analysis, zoom)

  for (const pl of placements) {
    const isSel = opts.selected?.has(pl.id)
    const isHover = opts.hovered === pl.id
    if (!isSel && !isHover) continue
    const piece = pieces.get(pl.pieceId)
    if (!piece) continue
    const cells = worldCells(piece, pl)
    ctx.save()
    ctx.strokeStyle = COLORS.selection
    ctx.globalAlpha = isSel ? 1 : 0.45
    ctx.lineWidth = (isSel ? 2 : 1.5) / zoom
    ctx.beginPath()
    for (const c of cells) ctx.rect(c.x, c.y, 1, 1)
    ctx.stroke()
    if (isSel) {
      const b = cellBounds(cells)
      if (b) {
        const pad = 4 / zoom
        ctx.setLineDash([4 / zoom, 3 / zoom])
        ctx.lineWidth = 1 / zoom
        ctx.strokeRect(b.minX - pad, b.minY - pad, b.maxX - b.minX + 2 * pad, b.maxY - b.minY + 2 * pad)
      }
    }
    ctx.restore()
  }

  if (opts.ghost) {
    const { piece, placement } = opts.ghost
    drawCells(ctx, worldCells(piece, placement), {
      fill: piece.fill,
      border: piece.border,
      lineWidth: lw,
      alpha: 0.55,
    })
  }
}

export function drawAnalysis(ctx: CanvasRenderingContext2D, analysis: AssemblyAnalysis, zoom: number) {
  ctx.save()
  for (const r of analysis.reports) {
    if (r.status === 'conflict') {
      ctx.fillStyle = 'rgba(224, 49, 49, 0.28)'
      ctx.fillRect(r.x, r.y, 1, 1)
      ctx.strokeStyle = COLORS.conflict
      ctx.lineWidth = 2 / zoom
      ctx.strokeRect(r.x + 1 / zoom, r.y + 1 / zoom, 1 - 2 / zoom, 1 - 2 / zoom)
      // Hatch "×" so the warning reads without colour too.
      ctx.beginPath()
      ctx.moveTo(r.x + 0.2, r.y + 0.2)
      ctx.lineTo(r.x + 0.8, r.y + 0.8)
      ctx.moveTo(r.x + 0.8, r.y + 0.2)
      ctx.lineTo(r.x + 0.2, r.y + 0.8)
      ctx.stroke()
    } else if (r.status === 'fit') {
      ctx.strokeStyle = COLORS.fit
      ctx.fillStyle = '#ffffff'
      ctx.lineWidth = 2 / zoom
      ctx.beginPath()
      ctx.arc(r.x + 0.5, r.y + 0.5, Math.max(0.12, 4 / zoom), 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    }
  }
  ctx.restore()
}

/** Render a whole assembly to a PNG blob (white background, no grid chrome). */
export async function assemblyToPng(asm: Assembly, pxPerCell = 40): Promise<Blob | null> {
  const pieces = new Map(asm.pieces.map((p) => [p.id, p]))
  const all = asm.placements.flatMap((pl) => {
    const piece = pieces.get(pl.pieceId)
    return piece ? worldCells(piece, pl) : []
  })
  const b = cellBounds(all) ?? { minX: 0, minY: 0, maxX: 1, maxY: 1 }
  const pad = 1
  const wCells = b.maxX - b.minX + pad * 2
  const hCells = b.maxY - b.minY + pad * 2
  const canvas = document.createElement('canvas')
  canvas.width = wCells * pxPerCell
  canvas.height = hCells * pxPerCell
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.setTransform(pxPerCell, 0, 0, -pxPerCell, (pad - b.minX) * pxPerCell, (b.maxY + pad) * pxPerCell)
  ctx.strokeStyle = COLORS.gridMinor
  ctx.lineWidth = 1 / pxPerCell
  ctx.beginPath()
  for (let x = b.minX - pad; x <= b.maxX + pad; x++) {
    ctx.moveTo(x, b.minY - pad)
    ctx.lineTo(x, b.maxY + pad)
  }
  for (let y = b.minY - pad; y <= b.maxY + pad; y++) {
    ctx.moveTo(b.minX - pad, y)
    ctx.lineTo(b.maxX + pad, y)
  }
  ctx.stroke()
  drawAssembly(ctx, asm, pxPerCell, { showAnalysis: false })
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
}
