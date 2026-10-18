import { cellBounds, cellShape } from '../model/geometry'
import type { CellKind, Dir, KeyPiece } from '../model/types'

// SVG previews share the canvas renderer's cell shapes. SVG is +y down, so rows are flipped.

function cellPaths(cells: readonly { x: number; y: number; kind: CellKind; dir: Dir }[], flipY: number) {
  return cells.flatMap((c) =>
    cellShape(c.kind, c.dir).map((poly) =>
      poly.map(([px, py], i) => `${i ? 'L' : 'M'}${c.x + px} ${flipY - (c.y + py)}`).join(' ') + 'Z',
    ),
  )
}

export function PieceSvg({ piece, size = 40 }: { piece: KeyPiece; size?: number }) {
  const b = cellBounds(piece.cells) ?? { minX: 0, minY: 0, maxX: 1, maxY: 1 }
  const span = Math.max(b.maxX - b.minX, b.maxY - b.minY) + 0.4
  const cx = (b.minX + b.maxX) / 2
  const cy = (b.minY + b.maxY) / 2
  const vb = `${cx - span / 2} ${-cy - span / 2} ${span} ${span}`
  return (
    <svg width={size} height={size} viewBox={vb} aria-hidden className="shrink-0">
      {cellPaths(piece.cells, 0).map((d, i) => (
        <path
          key={i}
          d={d}
          fill={piece.fill}
          stroke={piece.border}
          strokeWidth={Math.max(0.06, span / 40)}
          strokeLinejoin="round"
        />
      ))}
    </svg>
  )
}

export function CellIcon({
  kind,
  dir,
  size = 28,
  fill = '#ffd43b',
  border = '#1e1e1e',
}: {
  kind: CellKind
  dir: Dir
  size?: number
  fill?: string
  border?: string
}) {
  return (
    <svg width={size} height={size} viewBox="-0.15 -0.15 1.3 1.3" aria-hidden>
      <rect x={0} y={0} width={1} height={1} fill="none" stroke="#dee2e6" strokeWidth={0.03} strokeDasharray="0.08 0.06" />
      {cellPaths([{ x: 0, y: 0, kind, dir }], 1).map((d, i) => (
        <path key={i} d={d} fill={fill} stroke={border} strokeWidth={0.07} strokeLinejoin="round" />
      ))}
    </svg>
  )
}
