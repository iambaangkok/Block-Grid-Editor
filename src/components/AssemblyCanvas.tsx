import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { analyzeAssembly, buildOccupancy, cellKey } from '../model/analysis'
import { cellBounds, ghostOrigin, worldCells } from '../model/geometry'
import type { Assembly, KeyPiece, Placement } from '../model/types'
import {
  applyCamera,
  clampZoom,
  COLORS,
  drawAssembly,
  drawGrid,
  effectivePlacements,
  screenToWorld,
  type Camera,
} from '../render/draw'
import { useCanvasSize } from './useCanvas'

// The assembly viewport: infinite pan/zoom grid with mouse + touch.
//
//   mouse:  left-drag a piece → move · left-drag empty → box select · middle/right-drag → pan
//           wheel → zoom at cursor · trackpad two-finger scroll → pan (ctrl/pinch → zoom)
//   touch:  drag a piece → move · drag empty → pan · pinch → zoom · tap → select / place
//   "Pan" tool or holding Space makes any drag pan.

export interface Ghost {
  piece: KeyPiece
  rot: Placement['rot']
  mirror: boolean
}

interface Props {
  assembly: Assembly
  selected: ReadonlySet<string>
  onSelect: (ids: Set<string>) => void
  onMove: (ids: ReadonlySet<string>, dx: number, dy: number) => void
  /** Place-mode: the piece being stamped (null when not placing). */
  ghost: Ghost | null
  onPlace: (x: number, y: number) => void
  panMode: boolean
  showAnalysis: boolean
  camera: Camera
  onCamera: (c: Camera) => void
  onCursor: (cell: { x: number; y: number } | null) => void
  onOpenPiece: (pieceId: string) => void
}

type Gesture =
  | { kind: 'none' }
  | { kind: 'pan'; sx: number; sy: number; cam: Camera }
  | { kind: 'pinch'; startDist: number; midWorld: { x: number; y: number }; cam: Camera }
  | { kind: 'move'; startCell: { x: number; y: number }; moved: boolean; ids: Set<string> }
  | { kind: 'box'; start: { x: number; y: number }; cur: { x: number; y: number }; additive: boolean }
  | { kind: 'tap'; sx: number; sy: number; additive: boolean; touch: boolean }

const TAP_SLOP = 6

export function AssemblyCanvas(props: Props) {
  const {
    assembly,
    selected,
    onSelect,
    onMove,
    ghost,
    onPlace,
    panMode,
    showAnalysis,
    camera,
    onCamera,
    onCursor,
    onOpenPiece,
  } = props
  const { ref, w, h, dpr } = useCanvasSize()
  const [hoverCell, setHoverCell] = useState<{ x: number; y: number } | null>(null)
  const [dragDelta, setDragDelta] = useState<{ dx: number; dy: number } | null>(null)
  const [box, setBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const [spaceDown, setSpaceDown] = useState(false)
  const gesture = useRef<Gesture>({ kind: 'none' })
  const tapOnEmpty = useRef<{ sx: number; sy: number } | null>(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const camRef = useRef(camera)
  useLayoutEffect(() => {
    camRef.current = camera
  }, [camera])

  const pieces = useMemo(() => new Map(assembly.pieces.map((p) => [p.id, p])), [assembly.pieces])

  // Analysis reflects an in-progress drag so overlap warnings update live.
  const liveAssembly = useMemo(
    () =>
      dragDelta
        ? { ...assembly, placements: effectivePlacements(assembly.placements, selected, dragDelta) }
        : assembly,
    [assembly, selected, dragDelta],
  )
  const analysis = useMemo(() => analyzeAssembly(liveAssembly), [liveAssembly])
  const occupancy = useMemo(() => buildOccupancy(assembly), [assembly])

  /** Topmost placement covering a cell. */
  const hitTest = useCallback(
    (cx: number, cy: number): Placement | null => {
      const cells = occupancy.get(cellKey(cx, cy))
      if (!cells) return null
      const ids = new Set(cells.map((c) => c.placementId))
      for (let i = assembly.placements.length - 1; i >= 0; i--) {
        if (ids.has(assembly.placements[i].id)) return assembly.placements[i]
      }
      return null
    },
    [occupancy, assembly.placements],
  )

  const hovered = useMemo(() => {
    if (!hoverCell || ghost) return null
    return hitTest(hoverCell.x, hoverCell.y)?.id ?? null
  }, [hoverCell, ghost, hitTest])

  const ghostPlacement = useMemo(() => {
    if (!ghost || !hoverCell) return null
    return {
      piece: ghost.piece,
      placement: { ...ghostOrigin(ghost, hoverCell), id: '__ghost', pieceId: ghost.piece.id },
    }
  }, [ghost, hoverCell])

  // ── Draw ──
  useLayoutEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx || w === 0) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = COLORS.bg
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    applyCamera(ctx, camera, w, h, dpr)
    drawGrid(ctx, camera, w, h)
    drawAssembly(ctx, assembly, camera.zoom, {
      selected,
      hovered,
      dragDelta,
      ghost: ghostPlacement,
      analysis,
      showAnalysis,
    })
    if (box) {
      ctx.save()
      ctx.fillStyle = 'rgba(76, 110, 245, 0.08)'
      ctx.strokeStyle = COLORS.selection
      ctx.lineWidth = 1 / camera.zoom
      const x = Math.min(box.x0, box.x1)
      const y = Math.min(box.y0, box.y1)
      ctx.fillRect(x, y, Math.abs(box.x1 - box.x0), Math.abs(box.y1 - box.y0))
      ctx.strokeRect(x, y, Math.abs(box.x1 - box.x0), Math.abs(box.y1 - box.y0))
      ctx.restore()
    }
  }, [ref, w, h, dpr, camera, assembly, selected, hovered, dragDelta, ghostPlacement, analysis, showAnalysis, box])

  // ── Coordinates ──
  const localPoint = (e: { clientX: number; clientY: number }) => {
    const rect = ref.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }
  const toWorld = (sx: number, sy: number) => screenToWorld(camRef.current, w, h, sx, sy)
  const toCell = (sx: number, sy: number) => {
    const p = toWorld(sx, sy)
    return { x: Math.floor(p.x), y: Math.floor(p.y) }
  }

  // ── Wheel (non-passive so we can preventDefault) ──
  // Zoom eases toward a target over a few frames, keeping the world point under the cursor
  // fixed. Mouse-wheel notches step ~8%; trackpad pinch (ctrl + small deltas) is finer still.
  const zoomAnim = useRef<{ target: number; sx: number; sy: number; raf: number } | null>(null)
  const stopZoomAnim = () => {
    if (zoomAnim.current) cancelAnimationFrame(zoomAnim.current.raf)
    zoomAnim.current = null
  }

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return

    const zoomAt = (zoom: number, sx: number, sy: number) => {
      const rect = canvas.getBoundingClientRect()
      const cam = camRef.current
      const before = screenToWorld(cam, rect.width, rect.height, sx, sy)
      const after = screenToWorld({ ...cam, zoom }, rect.width, rect.height, sx, sy)
      const next = { zoom, x: cam.x + before.x - after.x, y: cam.y + before.y - after.y }
      camRef.current = next
      onCamera(next)
    }

    const step = () => {
      const a = zoomAnim.current
      if (!a) return
      const cur = camRef.current.zoom
      const gap = Math.log(a.target / cur)
      if (Math.abs(gap) < 0.002) {
        zoomAt(a.target, a.sx, a.sy)
        zoomAnim.current = null
        return
      }
      zoomAt(cur * Math.exp(gap * 0.35), a.sx, a.sy)
      a.raf = requestAnimationFrame(step)
    }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = canvas.getBoundingClientRect()
      const sx = e.clientX - rect.left
      const sy = e.clientY - rect.top
      const lineMode = e.deltaMode !== 0
      const mouseWheel = lineMode || (e.deltaX === 0 && Math.abs(e.deltaY) >= 50 && Number.isInteger(e.deltaY))
      if (e.ctrlKey || e.metaKey || mouseWheel) {
        const dy = lineMode ? e.deltaY * 33 : e.deltaY
        // ~8% per 100px notch (capped so a fast flick can't jump wildly); pinch deltas are tiny
        // and frequent, so they get a gentler per-unit rate.
        const pinch = !mouseWheel && Math.abs(dy) < 50
        const amount = pinch ? -dy * 0.006 : -Math.sign(dy) * Math.min(Math.abs(dy), 300) * 0.0008
        const base = zoomAnim.current?.target ?? camRef.current.zoom
        const target = clampZoom(base * Math.exp(amount))
        if (zoomAnim.current) {
          Object.assign(zoomAnim.current, { target, sx, sy })
        } else {
          zoomAnim.current = { target, sx, sy, raf: requestAnimationFrame(step) }
        }
      } else {
        stopZoomAnim()
        const cam = camRef.current
        const next = { ...cam, x: cam.x + e.deltaX / cam.zoom, y: cam.y - e.deltaY / cam.zoom }
        camRef.current = next
        onCamera(next)
      }
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      canvas.removeEventListener('wheel', onWheel)
      stopZoomAnim()
    }
  }, [ref, onCamera])

  // ── Space-to-pan ──
  useEffect(() => {
    const isTyping = (t: EventTarget | null) =>
      t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isTyping(e.target)) {
        e.preventDefault()
        setSpaceDown(true)
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpaceDown(false)
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  const startPinch = () => {
    const pts = [...pointers.current.values()]
    if (pts.length < 2) return
    const [a, b] = pts
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    gesture.current = {
      kind: 'pinch',
      startDist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      midWorld: toWorld(mid.x, mid.y),
      cam: camRef.current,
    }
    setDragDelta(null)
    setBox(null)
  }

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    stopZoomAnim()
    const p = localPoint(e)
    e.currentTarget.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, p)
    if (pointers.current.size >= 2) return startPinch()

    const touch = e.pointerType !== 'mouse'
    if (!touch) setHoverCell(toCell(p.x, p.y))
    if (e.button === 1 || e.button === 2 || panMode || spaceDown) {
      gesture.current = { kind: 'pan', sx: p.x, sy: p.y, cam: camRef.current }
      return
    }
    if (e.button !== 0) return

    if (ghost) {
      gesture.current = { kind: 'tap', sx: p.x, sy: p.y, additive: false, touch }
      return
    }
    const cell = toCell(p.x, p.y)
    const hit = hitTest(cell.x, cell.y)
    const additive = e.shiftKey || e.metaKey || e.ctrlKey
    if (hit) {
      let ids: Set<string>
      if (additive) {
        ids = new Set(selected)
        if (ids.has(hit.id)) ids.delete(hit.id)
        else ids.add(hit.id)
        onSelect(ids)
        if (!ids.has(hit.id)) return
      } else if (selected.has(hit.id)) {
        ids = new Set(selected)
      } else {
        ids = new Set([hit.id])
        onSelect(ids)
      }
      gesture.current = { kind: 'move', startCell: cell, moved: false, ids }
      return
    }
    if (touch) {
      gesture.current = { kind: 'pan', sx: p.x, sy: p.y, cam: camRef.current }
      // A tap (no drag) on empty space still clears the selection — handled on up.
      tapOnEmpty.current = { sx: p.x, sy: p.y }
      return
    }
    const wp = toWorld(p.x, p.y)
    gesture.current = { kind: 'box', start: wp, cur: wp, additive }
  }
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = localPoint(e)
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, p)
    const g = gesture.current

    if (g.kind === 'pinch') {
      const pts = [...pointers.current.values()]
      if (pts.length < 2) return
      const [a, b] = pts
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      const zoom = clampZoom((g.cam.zoom * dist) / g.startDist)
      // Keep the world point that started under the fingers' midpoint under it now.
      const probe = screenToWorld({ ...g.cam, zoom }, w, h, mid.x, mid.y)
      onCamera({ zoom, x: g.cam.x + g.midWorld.x - probe.x, y: g.cam.y + g.midWorld.y - probe.y })
      return
    }

    const cell = toCell(p.x, p.y)
    if (e.pointerType === 'mouse' || g.kind !== 'none') {
      setHoverCell((prev) => (prev && prev.x === cell.x && prev.y === cell.y ? prev : cell))
      onCursor(cell)
    }

    if (g.kind === 'pan') {
      const z = g.cam.zoom
      onCamera({ ...g.cam, x: g.cam.x - (p.x - g.sx) / z, y: g.cam.y + (p.y - g.sy) / z })
      if (tapOnEmpty.current && Math.hypot(p.x - tapOnEmpty.current.sx, p.y - tapOnEmpty.current.sy) > TAP_SLOP)
        tapOnEmpty.current = null
    } else if (g.kind === 'move') {
      const dx = cell.x - g.startCell.x
      const dy = cell.y - g.startCell.y
      if (dx !== 0 || dy !== 0) g.moved = true
      if (g.moved) setDragDelta((prev) => (prev && prev.dx === dx && prev.dy === dy ? prev : { dx, dy }))
    } else if (g.kind === 'box') {
      g.cur = toWorld(p.x, p.y)
      setBox({ x0: g.start.x, y0: g.start.y, x1: g.cur.x, y1: g.cur.y })
    }
  }

  const finish = (e: React.PointerEvent<HTMLCanvasElement>, cancelled: boolean) => {
    const p = localPoint(e)
    pointers.current.delete(e.pointerId)
    const g = gesture.current

    if (g.kind === 'pinch') {
      // Lifting one finger of a pinch ends the gesture; the other finger doesn't start a new one.
      if (pointers.current.size === 0) gesture.current = { kind: 'none' }
      return
    }
    gesture.current = { kind: 'none' }
    if (cancelled) {
      setDragDelta(null)
      setBox(null)
      return
    }

    if (g.kind === 'tap') {
      if (Math.hypot(p.x - g.sx, p.y - g.sy) <= TAP_SLOP * (g.touch ? 2 : 1)) {
        const cell = toCell(p.x, p.y)
        if (ghost) {
          const o = ghostOrigin(ghost, cell)
          onPlace(o.x, o.y)
        }
      }
    } else if (g.kind === 'move') {
      if (g.moved && dragDelta) onMove(g.ids, dragDelta.dx, dragDelta.dy)
      setDragDelta(null)
    } else if (g.kind === 'box') {
      const x0 = Math.min(g.start.x, g.cur.x)
      const x1 = Math.max(g.start.x, g.cur.x)
      const y0 = Math.min(g.start.y, g.cur.y)
      const y1 = Math.max(g.start.y, g.cur.y)
      const tiny = (x1 - x0) * camRef.current.zoom < TAP_SLOP && (y1 - y0) * camRef.current.zoom < TAP_SLOP
      const ids = new Set(g.additive ? selected : [])
      if (!tiny) {
        for (const pl of assembly.placements) {
          const piece = pieces.get(pl.pieceId)
          if (!piece) continue
          const b = cellBounds(worldCells(piece, pl))
          // Select pieces the box touches.
          if (b && b.maxX > x0 && b.minX < x1 && b.maxY > y0 && b.minY < y1) ids.add(pl.id)
        }
      }
      onSelect(ids)
      setBox(null)
    } else if (g.kind === 'pan' && tapOnEmpty.current) {
      onSelect(new Set())
    }
    tapOnEmpty.current = null
  }

  const onDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const p = localPoint(e)
    const cell = toCell(p.x, p.y)
    const hit = hitTest(cell.x, cell.y)
    if (hit) onOpenPiece(hit.pieceId)
  }

  const cursor =
    panMode || spaceDown
      ? 'grab'
      : ghost
        ? 'copy'
        : hovered
          ? dragDelta
            ? 'grabbing'
            : 'move'
          : 'default'

  return (
    <canvas
      ref={ref}
      className="block h-full w-full touch-none select-none"
      style={{ cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => finish(e, false)}
      onPointerCancel={(e) => finish(e, true)}
      onPointerLeave={(e) => {
        if (e.pointerType === 'mouse' && gesture.current.kind === 'none') {
          setHoverCell(null)
          onCursor(null)
        }
      }}
      onDoubleClick={onDoubleClick}
      onContextMenu={(e) => e.preventDefault()}
    />
  )
}
