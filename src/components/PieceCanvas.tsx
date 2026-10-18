import { useLayoutEffect, useRef, useState } from 'react'
import { cellBounds } from '../model/geometry'
import type { CellKind, Dir, KeyPiece } from '../model/types'
import { applyCamera, borderWidth, COLORS, drawCells, screenToWorld, type Camera } from '../render/draw'
import { useCanvasSize } from './useCanvas'

// Key Piece editor grid. Paint with the active brush (drag to paint a stroke), tap a cell that
// already has the brush's kind to rotate it, erase with the eraser or right mouse button.
// The view auto-fits the piece but is frozen during a stroke so cells don't slide under the pen.

export type Brush = { tool: 'paint'; kind: CellKind; dir: Dir } | { tool: 'erase' }

interface Props {
  piece: KeyPiece
  brush: Brush
  /** One stroke = one undo step; `strokeId` identifies it. */
  onPaint: (x: number, y: number, op: 'paint' | 'erase' | 'rotate', strokeId: string) => void
}

const MIN_SPAN = 9

function fitView(piece: KeyPiece, w: number, h: number): Camera {
  const b = cellBounds(piece.cells) ?? { minX: 0, minY: 0, maxX: 1, maxY: 1 }
  const minX = Math.min(b.minX, 0) - 2
  const maxX = Math.max(b.maxX, 1) + 2
  const minY = Math.min(b.minY, 0) - 2
  const maxY = Math.max(b.maxY, 1) + 2
  const span = Math.max(MIN_SPAN, maxX - minX, maxY - minY)
  const zoom = Math.max(4, Math.floor(Math.min(w, h) / span))
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2, zoom }
}

export function PieceCanvas({ piece, brush, onPaint }: Props) {
  const { ref, w, h, dpr } = useCanvasSize()
  const [frozen, setFrozen] = useState<Camera | null>(null)
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null)
  const stroke = useRef<{
    id: string
    erase: boolean
    last: string
    start: { x: number; y: number }
    moved: boolean
    /** The first cell already had the brush's kind: tap → rotate, drag → repaint. */
    deferred: boolean
  } | null>(null)
  const cam = frozen ?? fitView(piece, w || 1, h || 1)

  useLayoutEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx || w === 0) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = COLORS.bg
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    applyCamera(ctx, cam, w, h, dpr)
    const tl = screenToWorld(cam, w, h, 0, 0)
    const br = screenToWorld(cam, w, h, w, h)
    const x0 = Math.floor(tl.x)
    const x1 = Math.ceil(br.x)
    const y0 = Math.floor(br.y)
    const y1 = Math.ceil(tl.y)
    ctx.lineWidth = 1 / cam.zoom
    ctx.strokeStyle = COLORS.gridMajor
    ctx.beginPath()
    for (let x = x0; x <= x1; x++) {
      ctx.moveTo(x, y0)
      ctx.lineTo(x, y1)
    }
    for (let y = y0; y <= y1; y++) {
      ctx.moveTo(x0, y)
      ctx.lineTo(x1, y)
    }
    ctx.stroke()

    // Origin: the anchor cell the placement position refers to.
    ctx.strokeStyle = COLORS.axis
    ctx.setLineDash([4 / cam.zoom, 3 / cam.zoom])
    ctx.lineWidth = 1.5 / cam.zoom
    ctx.strokeRect(0, 0, 1, 1)
    ctx.setLineDash([])

    drawCells(ctx, piece.cells, { fill: piece.fill, border: piece.border, lineWidth: borderWidth(cam.zoom) * 1.3 })

    if (hover) {
      if (brush.tool === 'paint') {
        drawCells(ctx, [{ ...hover, kind: brush.kind, dir: brush.dir }], {
          fill: piece.fill,
          border: piece.border,
          lineWidth: borderWidth(cam.zoom),
          alpha: 0.4,
        })
      }
      ctx.strokeStyle = brush.tool === 'erase' ? COLORS.conflict : COLORS.selection
      ctx.lineWidth = 2 / cam.zoom
      ctx.strokeRect(hover.x, hover.y, 1, 1)
    }
  }, [ref, w, h, dpr, cam, piece, hover, brush])

  const cellAt = (e: React.PointerEvent) => {
    const rect = ref.current!.getBoundingClientRect()
    const p = screenToWorld(cam, w, h, e.clientX - rect.left, e.clientY - rect.top)
    return { x: Math.floor(p.x), y: Math.floor(p.y) }
  }

  const apply = (c: { x: number; y: number }, erase: boolean, id: string) => {
    onPaint(c.x, c.y, erase ? 'erase' : 'paint', id)
  }

  return (
    <canvas
      ref={ref}
      className="block aspect-square w-full touch-none select-none rounded-md border border-neutral-200"
      style={{ cursor: brush.tool === 'erase' ? 'cell' : 'crosshair' }}
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={(e) => {
        if (e.button !== 0 && e.button !== 2) return
        e.currentTarget.setPointerCapture(e.pointerId)
        setFrozen(cam)
        const c = cellAt(e)
        const key = `${c.x},${c.y}`
        const erase = brush.tool === 'erase' || e.button === 2
        const id = `stroke:${piece.id}:${Date.now()}:${Math.random()}`
        const existing = piece.cells.find((x) => x.x === c.x && x.y === c.y)
        const deferred = !erase && brush.tool === 'paint' && existing?.kind === brush.kind
        stroke.current = { id, erase, last: key, start: c, moved: false, deferred }
        if (!deferred) apply(c, erase, id)
      }}
      onPointerMove={(e) => {
        const c = cellAt(e)
        setHover((prev) => (prev && prev.x === c.x && prev.y === c.y ? prev : c))
        const s = stroke.current
        if (!s) return
        const key = `${c.x},${c.y}`
        if (key === s.last) return
        s.last = key
        if (!s.moved) {
          s.moved = true
          // The stroke left its first cell: paint that cell too if it was deferred.
          if (s.deferred) apply(s.start, false, s.id)
        }
        apply(c, s.erase, s.id)
      }}
      onPointerUp={() => {
        const s = stroke.current
        stroke.current = null
        setFrozen(null)
        if (s?.deferred && !s.moved) onPaint(s.start.x, s.start.y, 'rotate', s.id)
      }}
      onPointerCancel={() => {
        stroke.current = null
        setFrozen(null)
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === 'mouse' && !stroke.current) setHover(null)
      }}
    />
  )
}
