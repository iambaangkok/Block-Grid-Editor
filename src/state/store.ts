import { useSyncExternalStore } from 'react'
import { parseStoredWorkspace } from '../model/io'
import { starterWorkspace } from '../model/workspace'
import type { Workspace } from '../model/types'

// Workspace store with undo/redo and localStorage autosave.
//
// Mutations go through `commit(fn)`, where `fn` is a pure Workspace → Workspace op that runs
// exactly once (so ops that mint ids can report them back via closure). Commits sharing a
// `mergeKey` with the previous commit collapse into one undo step — used for drags, paint
// strokes and typing.

export const STORAGE_KEY = 'block-grid-editor:workspace:v1'
const HISTORY_LIMIT = 200

interface History {
  past: Workspace[]
  present: Workspace
  future: Workspace[]
  mergeKey: string | null
}

type Listener = () => void

export class WorkspaceStore {
  private h: History
  private listeners = new Set<Listener>()
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private storage: Storage | null

  constructor(initial: Workspace, storage: Storage | null) {
    this.h = { past: [], present: initial, future: [], mergeKey: null }
    this.storage = storage
  }

  get history(): History {
    return this.h
  }

  get workspace(): Workspace {
    return this.h.present
  }

  subscribe = (l: Listener) => {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }

  getSnapshot = () => this.h

  commit(fn: (ws: Workspace) => Workspace, opts: { mergeKey?: string } = {}) {
    const next = fn(this.h.present)
    if (next === this.h.present) return
    const merge = opts.mergeKey != null && opts.mergeKey === this.h.mergeKey
    this.set({
      past: merge ? this.h.past : [...this.h.past, this.h.present].slice(-HISTORY_LIMIT),
      present: next,
      future: [],
      mergeKey: opts.mergeKey ?? null,
    })
  }

  /** Stop the current merge run so the next commit starts a fresh undo step. */
  breakMerge() {
    this.h = { ...this.h, mergeKey: null }
  }

  undo() {
    const { past, present, future } = this.h
    if (past.length === 0) return
    this.set({
      past: past.slice(0, -1),
      present: past[past.length - 1],
      future: [present, ...future],
      mergeKey: null,
    })
  }

  redo() {
    const { past, present, future } = this.h
    if (future.length === 0) return
    this.set({ past: [...past, present], present: future[0], future: future.slice(1), mergeKey: null })
  }

  /** Replace everything (e.g. reset) as one undoable step. */
  replace(ws: Workspace) {
    this.commit(() => ws)
  }

  flush() {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.h.present))
    } catch {
      // Quota exceeded or storage unavailable — keep working in memory.
    }
  }

  private set(h: History) {
    const changed = h.present !== this.h.present
    this.h = h
    if (changed) this.scheduleSave()
    for (const l of this.listeners) l()
  }

  private scheduleSave() {
    if (!this.storage) return
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => this.flush(), 250)
  }
}

function loadInitial(storage: Storage | null): Workspace {
  const stored = parseStoredWorkspace(storage?.getItem(STORAGE_KEY) ?? null)
  return stored && stored.assemblies.length > 0 ? stored : starterWorkspace()
}

const storage = typeof localStorage === 'undefined' ? null : localStorage
export const store = new WorkspaceStore(loadInitial(storage), storage)

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => store.flush())
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') store.flush()
  })
}

export function useHistory(): History {
  return useSyncExternalStore(store.subscribe, store.getSnapshot)
}
