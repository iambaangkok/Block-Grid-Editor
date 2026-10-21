import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AssemblyCanvas, type Ghost } from './components/AssemblyCanvas'
import { KeyPieceEditor } from './components/KeyPieceEditor'
import { Icon } from './components/Icon'
import { checkPiece } from './model/checks'
import { PieceSvg } from './components/PieceSvg'
import { analyzeAssembly } from './model/analysis'
import { cellBounds, rotateDir, transformPieceCells, worldCells } from './model/geometry'
import { exportAssembly, exportWorkspace, ImportError, parseImport } from './model/io'
import type { KeyPiece, Rot } from './model/types'
import {
  activeAssembly,
  addAssembly,
  addPiece,
  addPlacement,
  bringToFront,
  copyToClipboard,
  pasteClipboard,
  type Clipboard,
  cloneAssembly,
  copyPieceTo,
  deleteAssembly,
  deletePiece,
  deletePlacements,
  duplicatePlacements,
  makeAssembly,
  makePiece,
  movePlacements,
  newId,
  renameAssembly,
  setActiveAssembly,
  setCell,
  transformPlacements,
  updatePiece,
} from './model/workspace'
import { assemblyToPng, keyPiecesToPng, type Camera } from './render/draw'
import { downloadBlob, downloadText, pickFile, slug } from './lib/download'
import { store, useHistory } from './state/store'

const VERSION = 'v0.3.4'
const DEFAULT_CAMERA: Camera = { x: 0, y: 0, zoom: 36 }

// Key piece panel width: draggable, remembered across sessions.
const EDITOR_DEFAULT_WIDTH = 352
const EDITOR_WIDTH_KEY = 'block-grid-editor:editor-width'
function clampEditorWidth(w: number) {
  // Leave room for the assembly canvas on wide screens.
  const max = Math.max(320, (typeof window === 'undefined' ? 1600 : window.innerWidth) - 320)
  return Math.round(Math.min(max, Math.max(300, w)))
}
function loadEditorWidth() {
  const n = Number(typeof localStorage === 'undefined' ? NaN : localStorage.getItem(EDITOR_WIDTH_KEY))
  return Number.isFinite(n) && n > 0 ? clampEditorWidth(n) : EDITOR_DEFAULT_WIDTH
}
function saveEditorWidth(w: number) {
  try {
    localStorage.setItem(EDITOR_WIDTH_KEY, String(w))
  } catch {
    // storage unavailable — width resets next session
  }
}

const btn =
  'inline-flex items-center justify-center gap-1 rounded-md border border-neutral-200 bg-white px-2.5 py-1.5 text-xs text-neutral-700 hover:bg-neutral-50 active:bg-neutral-100 disabled:opacity-40 disabled:hover:bg-white'
const iconBtn =
  'inline-flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-sm text-neutral-700 hover:bg-neutral-100 active:bg-neutral-200 disabled:opacity-30 disabled:hover:bg-transparent'

function isTypingTarget(t: EventTarget | null) {
  return t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))
}

export default function App() {
  const hist = useHistory()
  const ws = hist.present
  const asm = activeAssembly(ws)

  const [selection, setSelection] = useState<Set<string>>(new Set())
  const [editingPieceId, setEditingPieceId] = useState<string | null>(null)
  const [placing, setPlacing] = useState<{ pieceId: string; rot: Rot; mirror: boolean } | null>(null)
  const [panMode, setPanMode] = useState(false)
  const [showAnalysis, setShowAnalysis] = useState(true)
  const [cameras, setCameras] = useState<Record<string, Camera>>({})
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)
  const clipboard = useRef<{ clip: Clipboard; pastes: number } | null>(null)
  const [toast, setToast] = useState<{ text: string; tone: 'info' | 'error' } | null>(null)
  const [leftOpen, setLeftOpen] = useState(true)
  const [exportOpen, setExportOpen] = useState(false)
  const [editorWidth, setEditorWidth] = useState(loadEditorWidth)
  const resizeStart = useRef<{ x: number; width: number } | null>(null)

  const asmId = asm?.id ?? ''
  const camera = cameras[asmId] ?? DEFAULT_CAMERA
  const setCamera = useCallback((c: Camera) => setCameras((m) => ({ ...m, [asmId]: c })), [asmId])

  // Drop UI references to things that no longer exist (after undo, delete, switching assembly).
  const placementIds = useMemo(() => new Set(asm?.placements.map((p) => p.id)), [asm])
  const liveSelection = useMemo(
    () => new Set([...selection].filter((id) => placementIds.has(id))),
    [selection, placementIds],
  )
  const editingPiece = asm?.pieces.find((p) => p.id === editingPieceId) ?? null
  const placingPiece = asm?.pieces.find((p) => p.id === placing?.pieceId) ?? null
  const ghost: Ghost | null =
    placing && placingPiece ? { piece: placingPiece, rot: placing.rot, mirror: placing.mirror } : null

  const analysis = useMemo(() => (asm ? analyzeAssembly(asm) : null), [asm])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3200)
    return () => clearTimeout(t)
  }, [toast])

  // ── Actions ──────────────────────────────────────────────────────────────

  const commit = store.commit.bind(store)

  const switchAssembly = (id: string) => {
    commit((w) => setActiveAssembly(w, id))
    setSelection(new Set())
    setEditingPieceId(null)
    setPlacing(null)
  }

  const newAssembly = () => {
    const a = makeAssembly(`Assembly ${ws.assemblies.length + 1}`)
    commit((w) => addAssembly(w, a))
    setSelection(new Set())
    setEditingPieceId(null)
    setPlacing(null)
  }

  const duplicateAssembly = () => {
    if (!asm) return
    const copy = cloneAssembly(asm, `${asm.name} copy`)
    commit((w) => addAssembly(w, copy))
    setCameras((m) => ({ ...m, [copy.id]: camera }))
    setSelection(new Set())
    setEditingPieceId(null)
  }

  const removeAssembly = () => {
    if (!asm) return
    if (!window.confirm(`Delete assembly “${asm.name}” and its ${asm.pieces.length} key piece(s)? You can undo this.`)) return
    commit((w) => {
      const next = deleteAssembly(w, asm.id)
      return next.assemblies.length > 0 ? next : addAssembly(next, makeAssembly('Assembly 1'))
    })
    setSelection(new Set())
    setEditingPieceId(null)
    setPlacing(null)
  }

  const newPiece = () => {
    if (!asm) return
    const piece = makePiece(`Key piece ${asm.pieces.length + 1}`, asm.pieces.length)
    commit((w) => addPiece(w, asm.id, piece))
    setEditingPieceId(piece.id)
  }

  const changePiece = (pieceId: string, fn: (p: KeyPiece) => KeyPiece, mergeKey?: string) => {
    if (!asm) return
    commit((w) => updatePiece(w, asm.id, pieceId, fn), { mergeKey })
  }

  const toggleFiller = (piece: KeyPiece) => {
    if (!asm) return
    commit((w) =>
      updatePiece(w, asm.id, piece.id, (p) => {
        if (p.filler === false) {
          const next = { ...p }
          delete next.filler
          return next
        }
        return { ...p, filler: false }
      }),
    )
  }

  const startPlacing = (pieceId: string) => {
    setPlacing({ pieceId, rot: 0, mirror: false })
    setSelection(new Set())
    setPanMode(false)
  }

  const place = (x: number, y: number, keepPlacing: boolean) => {
    if (!asm || !placing) return
    const id = newId()
    commit((w) => addPlacement(w, asm.id, { id, pieceId: placing.pieceId, x, y, rot: placing.rot, mirror: placing.mirror }))
    if (!keepPlacing) {
      setPlacing(null)
      setSelection(new Set([id]))
    }
  }

  const rotateSelection = (rotCw: number) => {
    if (!asm) return
    if (placing) return setPlacing({ ...placing, rot: ((((placing.rot + rotCw) % 4) + 4) % 4) as Rot })
    commit((w) => transformPlacements(w, asm.id, liveSelection, { rotCw }))
  }

  const mirrorSelection = () => {
    if (!asm) return
    if (placing) return setPlacing({ ...placing, mirror: !placing.mirror, rot: ((4 - placing.rot) % 4) as Rot })
    commit((w) => transformPlacements(w, asm.id, liveSelection, { mirror: true }))
  }

  const copySelection = () => {
    if (!asm) return false
    const clip = copyToClipboard(asm, liveSelection)
    if (!clip) return false
    clipboard.current = { clip, pastes: 0 }
    setToast({ text: `Copied ${clip.placements.length} piece${clip.placements.length === 1 ? '' : 's'}`, tone: 'info' })
    return true
  }

  /** Paste centred on the pointer when it's over the grid, otherwise stepped off the originals. */
  const paste = () => {
    if (!asm || !clipboard.current) return
    const entry = clipboard.current
    const { clip } = entry
    let dx: number
    let dy: number
    const pieces = new Map(clip.pieces.map((p) => [p.id, p]))
    const cells = clip.placements.flatMap((pl) => {
      const piece = pieces.get(pl.pieceId)
      return piece ? worldCells(piece, pl) : []
    })
    const b = cellBounds(cells)
    if (cursor && b) {
      dx = cursor.x - Math.floor((b.minX + b.maxX - 1) / 2)
      dy = cursor.y - Math.floor((b.minY + b.maxY - 1) / 2)
    } else {
      entry.pastes++
      dx = entry.pastes
      dy = -entry.pastes
    }
    let ids: string[] = []
    commit((w) => {
      const r = pasteClipboard(w, asm.id, clip, dx, dy)
      ids = r.newIds
      return r.ws
    })
    setPlacing(null)
    setSelection(new Set(ids))
  }

  const duplicateSelection = () => {
    if (!asm || liveSelection.size === 0) return
    let ids: string[] = []
    commit((w) => {
      const r = duplicatePlacements(w, asm.id, liveSelection)
      ids = r.newIds
      return r.ws
    })
    setSelection(new Set(ids))
  }

  const deleteSelection = () => {
    if (!asm || liveSelection.size === 0) return
    commit((w) => deletePlacements(w, asm.id, liveSelection))
    setSelection(new Set())
  }

  const moveSelection = (ids: ReadonlySet<string>, dx: number, dy: number, mergeKey?: string) => {
    if (!asm) return
    commit((w) => movePlacements(w, asm.id, ids, dx, dy), { mergeKey })
  }

  const removePiece = (piece: KeyPiece) => {
    if (!asm) return
    const uses = asm.placements.filter((p) => p.pieceId === piece.id).length
    if (uses > 0 && !window.confirm(`“${piece.name}” is placed ${uses}× on this assembly. Delete it and its placements?`)) return
    commit((w) => deletePiece(w, asm.id, piece.id))
    if (editingPieceId === piece.id) setEditingPieceId(null)
    if (placing?.pieceId === piece.id) setPlacing(null)
  }

  const duplicatePiece = (piece: KeyPiece) => {
    if (!asm) return
    let id: string | null = null
    commit((w) => {
      const r = copyPieceTo(w, asm.id, piece.id, asm.id)
      id = r.newPieceId
      return r.ws
    })
    if (id) setEditingPieceId(id)
  }

  const copyPieceToAssembly = (piece: KeyPiece, toId: string) => {
    if (!asm) return
    commit((w) => copyPieceTo(w, asm.id, piece.id, toId).ws)
    const target = ws.assemblies.find((a) => a.id === toId)
    setToast({ text: `Copied “${piece.name}” to ${target?.name ?? 'assembly'}`, tone: 'info' })
  }

  const exportJson = (which: 'assembly' | 'workspace') => {
    setExportOpen(false)
    if (which === 'assembly' && asm) downloadText(`${slug(asm.name)}.json`, exportAssembly(asm))
    else downloadText(`block-grid-editor-workspace.json`, exportWorkspace(ws))
  }

  const exportPiecesPng = async () => {
    setExportOpen(false)
    if (!asm) return
    const blob = await keyPiecesToPng(asm.pieces)
    if (blob) downloadBlob(`${slug(asm.name)}-key-pieces.png`, blob)
    else setToast({ text: 'No key pieces with cells to export', tone: 'error' })
  }

  const exportPng = async () => {
    setExportOpen(false)
    if (!asm) return
    const blob = await assemblyToPng(asm)
    if (blob) downloadBlob(`${slug(asm.name)}.png`, blob)
  }

  const importJson = async () => {
    const file = await pickFile('application/json,.json')
    if (!file) return
    try {
      const imported = parseImport(await file.text())
      if (imported.length === 0) throw new ImportError('File contains no assemblies')
      commit((w) => imported.reduce<typeof w>((acc, a) => addAssembly(acc, a), w))
      setSelection(new Set())
      setEditingPieceId(null)
      setPlacing(null)
      setToast({ text: `Imported ${imported.length} assembl${imported.length === 1 ? 'y' : 'ies'}`, tone: 'info' })
    } catch (err) {
      setToast({ text: err instanceof ImportError ? `Import failed — ${err.message}` : 'Import failed', tone: 'error' })
    }
  }

  const fitView = () => {
    if (!asm || asm.placements.length === 0) return setCamera(DEFAULT_CAMERA)
    const xs: number[] = []
    const ys: number[] = []
    const a = analysis
    for (const cells of a?.occupancy.values() ?? []) {
      xs.push(cells[0].x)
      ys.push(cells[0].y)
    }
    if (xs.length === 0) return setCamera(DEFAULT_CAMERA)
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs) + 1
    const minY = Math.min(...ys)
    const maxY = Math.max(...ys) + 1
    const el = document.getElementById('assembly-viewport')
    const w = el?.clientWidth ?? 800
    const h = el?.clientHeight ?? 600
    const zoom = Math.max(4, Math.min(80, Math.min(w / (maxX - minX + 4), h / (maxY - minY + 4))))
    setCamera({ x: (minX + maxX) / 2, y: (minY + maxY) / 2, zoom })
  }

  // ── Keyboard ─────────────────────────────────────────────────────────────

  const keyHandler = useRef<(e: KeyboardEvent) => void>(() => {})
  const onKeyDown = (e: KeyboardEvent) => {
    if (isTypingTarget(e.target)) return
    const mod = e.ctrlKey || e.metaKey
    const k = e.key.toLowerCase()
    if (mod && k === 'z') {
      e.preventDefault()
      if (e.shiftKey) store.redo()
      else store.undo()
    } else if (mod && k === 'y') {
      e.preventDefault()
      store.redo()
    } else if (mod && k === 'd') {
      e.preventDefault()
      duplicateSelection()
    } else if (mod && k === 'c') {
      if (copySelection()) e.preventDefault()
    } else if (mod && k === 'x') {
      if (copySelection()) {
        e.preventDefault()
        deleteSelection()
      }
    } else if (mod && k === 'v') {
      e.preventDefault()
      paste()
    } else if (mod && k === 'a') {
      e.preventDefault()
      if (asm) setSelection(new Set(asm.placements.map((p) => p.id)))
    } else if (mod) {
      return
    } else if (k === 'r') {
      rotateSelection(e.shiftKey ? -1 : 1)
    } else if (k === 'f') {
      mirrorSelection()
    } else if (k === 'delete' || k === 'backspace') {
      deleteSelection()
    } else if (k === 'escape') {
      if (placing) setPlacing(null)
      else if (liveSelection.size > 0) setSelection(new Set())
      else setEditingPieceId(null)
    } else if (k === 'h') {
      setPanMode((v) => !v)
    } else if (k === 'v') {
      setPanMode(false)
    } else if (k === '0') {
      fitView()
    } else if (e.key.startsWith('Arrow') && e.shiftKey) {
      // Shift+Arrow nudges the selection one cell.
      if (liveSelection.size === 0) return
      e.preventDefault()
      const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key]
      if (d) moveSelection(liveSelection, d[0], d[1], 'nudge')
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      // ← / → rotate the selection (or the piece being placed) 90° counter-clockwise / clockwise.
      if (liveSelection.size === 0 && !placing) return
      e.preventDefault()
      rotateSelection(e.key === 'ArrowRight' ? 1 : -1)
    }
  }
  useLayoutEffect(() => {
    keyHandler.current = onKeyDown
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyHandler.current(e)
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key.startsWith('Arrow')) store.breakMerge()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [])

  if (!asm) return null
  const otherAssemblies = ws.assemblies.filter((a) => a.id !== asm.id)
  const selectedPieceIds = new Set(asm.placements.filter((p) => liveSelection.has(p.id)).map((p) => p.pieceId))

  return (
    <div className="flex h-dvh flex-col bg-white text-neutral-900">
      {/* ── Top bar ── */}
      <header className="flex flex-wrap items-center gap-2 border-b border-neutral-200 px-3 py-2">
        <button type="button" className={iconBtn} onClick={() => setLeftOpen((v) => !v)} aria-label="Toggle key piece list" title="Toggle key pieces">
          <Icon name="menu" />
        </button>
        <div className="flex items-baseline gap-1.5 pr-2">
          <span className="font-semibold tracking-tight">block-grid-editor</span>
          <span className="text-[9px] text-neutral-400">{VERSION}</span>
        </div>

        <div className="flex items-center gap-1 rounded-lg border border-neutral-200 p-0.5">
          <select
            value={asm.id}
            onChange={(e) => switchAssembly(e.target.value)}
            className="max-w-36 rounded-md bg-transparent px-1.5 py-1 text-xs text-neutral-500 hover:bg-neutral-50"
            aria-label="Switch assembly"
            title="Switch assembly"
          >
            {ws.assemblies.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name || 'Untitled'}
              </option>
            ))}
          </select>
          <input
            value={asm.name}
            onChange={(e) => commit((w) => renameAssembly(w, asm.id, e.target.value), { mergeKey: `asm-name:${asm.id}` })}
            className="w-40 rounded-md border border-transparent px-1.5 py-1 text-sm font-medium hover:border-neutral-200 focus:border-indigo-400 focus:outline-none"
            aria-label="Assembly name"
          />
          <button type="button" className={iconBtn} onClick={newAssembly} title="New assembly" aria-label="New assembly"><Icon name="plus" /></button>
          <button type="button" className={iconBtn} onClick={duplicateAssembly} title="Duplicate assembly" aria-label="Duplicate assembly"><Icon name="copy" /></button>
          <button type="button" className={`${iconBtn} hover:text-red-600`} onClick={removeAssembly} title="Delete assembly" aria-label="Delete assembly"><Icon name="trash" /></button>
        </div>

        <div className="flex items-center gap-0.5">
          <button type="button" className={iconBtn} onClick={() => store.undo()} disabled={hist.past.length === 0} title="Undo (Ctrl+Z)" aria-label="Undo"><Icon name="undo" /></button>
          <button type="button" className={iconBtn} onClick={() => store.redo()} disabled={hist.future.length === 0} title="Redo (Ctrl+Shift+Z)" aria-label="Redo"><Icon name="redo" /></button>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <span className="hidden text-[11px] text-neutral-400 sm:inline">Autosaved locally</span>
          <button type="button" className={btn} onClick={importJson}>Import</button>
          <div className="relative">
            <button type="button" className={btn} onClick={() => setExportOpen((v) => !v)}>Export <Icon name="chevron" size={12} /></button>
            {exportOpen && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setExportOpen(false)} />
                <div className="absolute right-0 z-30 mt-1 w-52 overflow-hidden rounded-lg border border-neutral-200 bg-white py-1 text-sm shadow-lg">
                  <button type="button" className="block w-full px-3 py-1.5 text-left hover:bg-neutral-50" onClick={() => exportJson('assembly')}>This assembly (.json)</button>
                  <button type="button" className="block w-full px-3 py-1.5 text-left hover:bg-neutral-50" onClick={() => exportJson('workspace')}>All assemblies (.json)</button>
                  <button type="button" className="block w-full px-3 py-1.5 text-left hover:bg-neutral-50" onClick={exportPng}>This assembly (.png)</button>
                  <button type="button" className="block w-full px-3 py-1.5 text-left hover:bg-neutral-50" onClick={exportPiecesPng}>Key pieces in a row (.png)</button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        {/* ── Key pieces ── */}
        {leftOpen && (
          <aside className="absolute inset-y-0 left-0 z-10 flex w-60 flex-col border-r border-neutral-200 bg-white md:static">
            <div className="flex items-center justify-between px-3 pt-3 pb-2">
              <span className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">Key pieces</span>
              <button type="button" className={btn} onClick={newPiece}><Icon name="plus" size={13} /> New</button>
            </div>
            <ul className="flex-1 space-y-1 overflow-y-auto px-2 pb-3">
              {asm.pieces.length === 0 && (
                <li className="rounded-lg border border-dashed border-neutral-300 p-3 text-xs leading-relaxed text-neutral-500">
                  No key pieces yet. Create one, paint its unit cells, then place it on the grid.
                </li>
              )}
              {asm.pieces.map((p) => {
                const uses = asm.placements.filter((pl) => pl.pieceId === p.id).length
                const active = editingPieceId === p.id
                return (
                  <li
                    key={p.id}
                    className={`group flex items-center gap-2 rounded-lg border px-2 py-1.5 ${
                      active ? 'border-indigo-300 bg-indigo-50/60' : selectedPieceIds.has(p.id) ? 'border-indigo-200' : 'border-transparent hover:bg-neutral-50'
                    }`}
                  >
                    <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setEditingPieceId(p.id)} title="Edit key piece">
                      <PieceSvg piece={p} size={36} />
                      <span className="min-w-0">
                        <span className="flex items-center gap-1">
                          <span className="truncate text-sm">{p.name || 'Untitled'}</span>
                          <CheckBadge piece={p} />
                        </span>
                        <span className="block text-[11px] text-neutral-400">
                          {p.cells.length} cell{p.cells.length === 1 ? '' : 's'} · {uses}× placed
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleFiller(p)}
                      aria-pressed={p.filler !== false}
                      aria-label={`Use ${p.name || 'piece'} as filler`}
                      title={p.filler !== false ? 'Used as a filler in fill candidates — click to exclude' : 'Excluded from fill candidates — click to include'}
                      className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border ${
                        p.filler !== false
                          ? 'border-indigo-200 bg-indigo-50 text-indigo-600'
                          : 'border-neutral-200 text-neutral-300 hover:text-neutral-500'
                      }`}
                    >
                      <Icon name={p.filler !== false ? 'key' : 'keyOff'} size={14} />
                    </button>
                    <button
                      type="button"
                      className={`${btn} px-2 py-1 ${placing?.pieceId === p.id ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : ''}`}
                      onClick={() => (placing?.pieceId === p.id ? setPlacing(null) : startPlacing(p.id))}
                      disabled={p.cells.length === 0}
                      title="Place on the grid"
                    >
                      Place
                    </button>
                  </li>
                )
              })}
            </ul>
          </aside>
        )}

        {/* ── Viewport ── */}
        <main id="assembly-viewport" className="relative min-w-0 flex-1">
          <AssemblyCanvas
            assembly={asm}
            selected={liveSelection}
            onSelect={setSelection}
            onMove={(ids, dx, dy) => moveSelection(ids, dx, dy)}
            ghost={ghost}
            onPlace={(x, y) => place(x, y, false)}
            panMode={panMode}
            showAnalysis={showAnalysis}
            camera={camera}
            onCamera={setCamera}
            onCursor={setCursor}
            onOpenPiece={setEditingPieceId}
          />

          {/* Tool strip */}
          <div className="absolute top-3 left-3 flex flex-col gap-0.5 rounded-xl border border-neutral-200 bg-white/95 p-1 shadow-sm">
            <button type="button" className={`${iconBtn} ${!panMode ? 'bg-indigo-50 text-indigo-700' : ''}`} onClick={() => setPanMode(false)} title="Select (V)" aria-label="Select tool"><Icon name="pointer" /></button>
            <button type="button" className={`${iconBtn} ${panMode ? 'bg-indigo-50 text-indigo-700' : ''}`} onClick={() => setPanMode(true)} title="Pan (H, or hold Space)" aria-label="Pan tool"><Icon name="hand" /></button>
            <div className="mx-1 my-0.5 h-px bg-neutral-200" />
            <button type="button" className={iconBtn} onClick={() => setCamera({ ...camera, zoom: Math.min(160, camera.zoom * 1.25) })} title="Zoom in" aria-label="Zoom in"><Icon name="plus" /></button>
            <button type="button" className={iconBtn} onClick={() => setCamera({ ...camera, zoom: Math.max(4, camera.zoom / 1.25) })} title="Zoom out" aria-label="Zoom out"><Icon name="minus" /></button>
            <button type="button" className={iconBtn} onClick={fitView} title="Fit to pieces (0)" aria-label="Fit view"><Icon name="fit" /></button>
            <button type="button" className={iconBtn} onClick={() => setCamera(DEFAULT_CAMERA)} title="Go to origin" aria-label="Go to origin"><Icon name="origin" /></button>
          </div>

          {/* Selection / placing bar */}
          {(liveSelection.size > 0 || ghost) && (
            <div className="absolute top-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-neutral-200 bg-white/95 p-1 text-xs shadow-sm">
              {ghost ? (
                <span className="px-2 text-neutral-600">
                  Placing <b>{ghost.piece.name}</b> — tap the grid
                </span>
              ) : (
                <span className="px-2 whitespace-nowrap text-neutral-600">{liveSelection.size} selected</span>
              )}
              <button type="button" className={iconBtn} onClick={() => rotateSelection(-1)} title="Rotate 90° counter-clockwise (← or Shift+R)"><Icon name="rotCcw" /></button>
              <button type="button" className={iconBtn} onClick={() => rotateSelection(1)} title="Rotate 90° clockwise (→ or R)"><Icon name="rotCw" /></button>
              <button type="button" className={iconBtn} onClick={mirrorSelection} title="Mirror (F)"><Icon name="mirror" /></button>
              {ghost ? (
                <button type="button" className={iconBtn} onClick={() => setPlacing(null)} title="Cancel (Esc)"><Icon name="close" /></button>
              ) : (
                <>
                  <button type="button" className={iconBtn} onClick={duplicateSelection} title="Duplicate (Ctrl+D)"><Icon name="copy" /></button>
                  <button type="button" className={iconBtn} onClick={() => commit((w) => bringToFront(w, asm.id, liveSelection))} title="Bring to front"><Icon name="front" /></button>
                  {selectedPieceIds.size === 1 && (
                    <button type="button" className={iconBtn} onClick={() => setEditingPieceId([...selectedPieceIds][0])} title="Edit key piece"><Icon name="edit" /></button>
                  )}
                  <button type="button" className={`${iconBtn} hover:text-red-600`} onClick={deleteSelection} title="Delete (Del)"><Icon name="trash" /></button>
                </>
              )}
            </div>
          )}

          {/* Status bar */}
          <div className="pointer-events-none absolute right-3 bottom-3 left-3 flex flex-wrap items-end justify-between gap-2 text-[11px]">
            <div className="pointer-events-auto flex items-center gap-2 rounded-lg border border-neutral-200 bg-white/95 px-2 py-1 text-neutral-500 shadow-sm">
              <span className="font-mono tabular-nums">{cursor ? `${cursor.x}, ${cursor.y}` : '–, –'}</span>
              <span className="text-neutral-300">|</span>
              <span className="font-mono tabular-nums">{Math.round((camera.zoom / DEFAULT_CAMERA.zoom) * 100)}%</span>
            </div>
            <div className="pointer-events-auto flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white/95 px-2 py-1 shadow-sm">
              <span className={`rounded px-1.5 py-0.5 font-medium ${analysis && analysis.conflicts > 0 ? 'bg-red-50 text-red-700' : 'text-neutral-400'}`}>
                {analysis?.conflicts ?? 0} overlap{analysis?.conflicts === 1 ? '' : 's'}
              </span>
              <span className={`rounded px-1.5 py-0.5 font-medium ${analysis && analysis.fits > 0 ? 'bg-green-50 text-green-700' : 'text-neutral-400'}`}>
                {analysis?.fits ?? 0} fit{analysis?.fits === 1 ? '' : 's'}
              </span>
              <label className="flex items-center gap-1 text-neutral-500">
                <input type="checkbox" checked={showAnalysis} onChange={(e) => setShowAnalysis(e.target.checked)} />
                show
              </label>
            </div>
          </div>

          {toast && (
            <div
              role="status"
              className={`absolute bottom-14 left-1/2 -translate-x-1/2 rounded-lg px-3 py-2 text-sm shadow-lg ${
                toast.tone === 'error' ? 'bg-red-600 text-white' : 'bg-neutral-900 text-white'
              }`}
            >
              {toast.text}
            </div>
          )}
        </main>

        {/* ── Key piece editor ── */}
        {editingPiece && (
          <aside
            className="absolute inset-y-0 right-0 z-10 shrink-0 border-l border-neutral-200 bg-white shadow-xl md:relative md:shadow-none"
            style={{ width: `min(${editorWidth}px, 100%)` }}
          >
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize key piece panel"
              title="Drag to resize · double-click to reset"
              className="absolute inset-y-0 -left-1 z-20 w-2 cursor-col-resize touch-none hover:bg-indigo-300/60 active:bg-indigo-400/60"
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId)
                resizeStart.current = { x: e.clientX, width: editorWidth }
              }}
              onPointerMove={(e) => {
                if (!resizeStart.current) return
                setEditorWidth(clampEditorWidth(resizeStart.current.width + resizeStart.current.x - e.clientX))
              }}
              onPointerUp={() => {
                resizeStart.current = null
                saveEditorWidth(editorWidth)
              }}
              onPointerCancel={() => (resizeStart.current = null)}
              onDoubleClick={() => {
                setEditorWidth(EDITOR_DEFAULT_WIDTH)
                saveEditorWidth(EDITOR_DEFAULT_WIDTH)
              }}
            />
            <KeyPieceEditor
              key={editingPiece.id}
              piece={editingPiece}
              assembly={asm}
              otherAssemblies={otherAssemblies}
              onChange={(fn, mergeKey) => changePiece(editingPiece.id, fn, mergeKey)}
              onPaint={(x, y, op, strokeId, brush) =>
                changePiece(
                  editingPiece.id,
                  (p) => {
                    if (op === 'erase') return setCell(p, x, y, null)
                    const existing = p.cells.find((c) => c.x === x && c.y === y)
                    if (op === 'rotate')
                      return existing && existing.kind !== 'block'
                        ? setCell(p, x, y, { ...existing, dir: rotateDir(existing.dir, 1) })
                        : p
                    if (brush.tool !== 'paint') return p
                    return setCell(p, x, y, { x, y, kind: brush.kind, dir: brush.kind === 'block' ? 0 : brush.dir })
                  },
                  strokeId,
                )
              }
              onTransform={(rotCw, mirror) =>
                changePiece(editingPiece.id, (p) => ({ ...p, cells: transformPieceCells(p.cells, rotCw, mirror) }))
              }
              onPlace={() => startPlacing(editingPiece.id)}
              onDuplicate={() => duplicatePiece(editingPiece)}
              onCopyTo={(toId) => copyPieceToAssembly(editingPiece, toId)}
              onDelete={() => removePiece(editingPiece)}
              onClose={() => setEditingPieceId(null)}
            />
          </aside>
        )}
      </div>
    </div>
  )
}


/** Small marker on a key piece that fails a check (or couldn't be decided). */
function CheckBadge({ piece }: { piece: KeyPiece }) {
  const c = checkPiece(piece)
  if (c.ok) return null
  const failed = [
    c.connected.status === 'fail' && 'not edge-connected',
    c.cavity.status === 'fail' && 'enclosed cavity',
    c.concave.status === 'fail' && 'can fill its own concave',
    c.concave.status === 'unknown' && 'concave check undecided',
  ].filter(Boolean)
  const unknownOnly = failed.length === 1 && c.concave.status === 'unknown'
  return (
    <span
      title={failed.join(' · ')}
      className={`shrink-0 rounded px-1 text-[10px] font-bold ${unknownOnly ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}
    >
      {unknownOnly ? '?' : '!'}
    </span>
  )
}
