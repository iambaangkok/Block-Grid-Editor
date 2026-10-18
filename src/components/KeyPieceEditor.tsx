import { useState } from 'react'
import { isRotatable, rotateDir } from '../model/geometry'
import { CELL_KINDS, DIR_LABEL, KIND_LABEL, type Assembly, type CellKind, type Dir, type KeyPiece } from '../model/types'
import { Icon } from './Icon'
import { CellIcon } from './PieceSvg'
import { ColorPicker } from './ColorPicker'
import { PieceCanvas, type Brush } from './PieceCanvas'

interface Props {
  piece: KeyPiece
  assembly: Assembly
  otherAssemblies: Assembly[]
  onChange: (fn: (p: KeyPiece) => KeyPiece, mergeKey?: string) => void
  onPaint: (x: number, y: number, op: 'paint' | 'erase' | 'rotate', strokeId: string, brush: Brush) => void
  onTransform: (rotCw: number, mirror: boolean) => void
  onPlace: () => void
  onDuplicate: () => void
  onCopyTo: (asmId: string) => void
  onDelete: () => void
  onClose: () => void
}

const btn =
  'inline-flex items-center justify-center gap-1 rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-50 active:bg-neutral-100 disabled:opacity-40'

export function KeyPieceEditor(props: Props) {
  const { piece, assembly, otherAssemblies, onChange, onPaint, onTransform } = props
  const [kind, setKind] = useState<CellKind>('block')
  const [dir, setDir] = useState<Dir>(0)
  const [erase, setErase] = useState(false)
  const brush: Brush = erase ? { tool: 'erase' } : { tool: 'paint', kind, dir }
  const uses = assembly.placements.filter((p) => p.pieceId === piece.id).length

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-neutral-200 px-3 py-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">Key piece</span>
        <input
          value={piece.name}
          onChange={(e) => onChange((p) => ({ ...p, name: e.target.value }), `name:${piece.id}`)}
          className="min-w-0 flex-1 rounded-md border border-transparent px-1.5 py-0.5 text-sm font-medium hover:border-neutral-200 focus:border-indigo-400 focus:outline-none"
          aria-label="Key piece name"
        />
        <button type="button" onClick={props.onClose} className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700" aria-label="Close editor" title="Close (Esc)">
          <Icon name="close" />
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-3">
        <PieceCanvas
          piece={piece}
          brush={brush}
          onPaint={(x, y, op, id) => onPaint(x, y, op, id, brush)}
        />
        <p className="-mt-2 text-[11px] leading-snug text-neutral-500">
          Drag to paint · tap a cell of the same kind to rotate it · right-click or eraser to remove. The dashed cell is the
          piece origin.
        </p>

        <section>
          <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-neutral-500">Unit cell</div>
          <div className="flex flex-wrap gap-1.5">
            {CELL_KINDS.map((k) => (
              <button
                key={k}
                type="button"
                title={KIND_LABEL[k]}
                onClick={() => {
                  setKind(k)
                  setErase(false)
                }}
                className={`flex flex-col items-center rounded-lg border px-1.5 pt-1 pb-0.5 text-[10px] ${
                  !erase && kind === k ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : 'border-neutral-200 text-neutral-600 hover:bg-neutral-50'
                }`}
              >
                <CellIcon kind={k} dir={dir} fill={piece.fill} border={piece.border} />
                {KIND_LABEL[k]}
              </button>
            ))}
            <button
              type="button"
              title="Eraser"
              onClick={() => setErase((v) => !v)}
              className={`flex flex-col items-center justify-center rounded-lg border px-2 text-[10px] ${
                erase ? 'border-red-400 bg-red-50 text-red-700' : 'border-neutral-200 text-neutral-600 hover:bg-neutral-50'
              }`}
            >
              <span className="flex h-7 items-center"><Icon name="eraser" size={20} /></span>
              Eraser
            </button>
          </div>
          <div className="mt-2 flex items-center gap-1.5">
            <span className="text-xs text-neutral-500">Facing</span>
            {([0, 1, 2, 3] as Dir[]).map((d) => (
              <button
                key={d}
                type="button"
                disabled={!isRotatable(kind)}
                onClick={() => setDir(d)}
                className={`h-7 w-7 rounded-md border text-xs ${
                  dir === d && isRotatable(kind) ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : 'border-neutral-200 text-neutral-600'
                } disabled:opacity-40`}
              >
                {DIR_LABEL[d]}
              </button>
            ))}
            <button type="button" className={btn} disabled={!isRotatable(kind)} onClick={() => setDir(rotateDir(dir, 1))} title="Rotate brush 90°">
              <Icon name="rotCw" size={13} /> 90°
            </button>
          </div>
        </section>

        <section>
          <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-neutral-500">Whole piece</div>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" className={btn} onClick={() => onTransform(-1, false)}><Icon name="rotCcw" size={13} /> 90°</button>
            <button type="button" className={btn} onClick={() => onTransform(1, false)}><Icon name="rotCw" size={13} /> 90°</button>
            <button type="button" className={btn} onClick={() => onTransform(2, false)}>180°</button>
            <button type="button" className={btn} onClick={() => onTransform(0, true)}><Icon name="mirror" size={13} /> Mirror</button>
          </div>
        </section>

        <section>
          <ColorPicker
            fill={piece.fill}
            border={piece.border}
            onChange={(c) => onChange((p) => ({ ...p, ...c }))}
          />
        </section>

        <section className="space-y-2 border-t border-neutral-200 pt-3">
          <div className="text-xs text-neutral-500">
            {piece.cells.length} cell{piece.cells.length === 1 ? '' : 's'} · placed {uses}×
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" className={`${btn} border-indigo-300 bg-indigo-50 text-indigo-700`} onClick={props.onPlace} disabled={piece.cells.length === 0}>
              <Icon name="plus" size={13} /> Place on assembly
            </button>
            <button type="button" className={btn} onClick={props.onDuplicate}>Duplicate</button>
            <select
              className={btn}
              value=""
              disabled={otherAssemblies.length === 0}
              onChange={(e) => e.target.value && props.onCopyTo(e.target.value)}
              aria-label="Copy to assembly"
            >
              <option value="">Copy to…</option>
              {otherAssemblies.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <button type="button" className={`${btn} text-red-600 hover:bg-red-50`} onClick={props.onDelete}>
              Delete
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}
