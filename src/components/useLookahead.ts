import { useCallback, useEffect, useRef, useState } from 'react'
import type { LookaheadProgress, LookaheadRun } from '../model/lookahead'
import type { LookaheadMessage, LookaheadRequest } from '../workers/lookahead.worker'

export interface LookaheadState {
  /** A run in progress (null when idle). */
  running: { depth: number; progress: LookaheadProgress | null } | null
  /** The last finished run; `sig` identifies its inputs so edits mark it out of date. */
  result: { run: LookaheadRun; sig: string } | null
  error: string | null
}

/** Start / cancel look-ahead runs in a Web Worker; one at a time. Cancelling keeps the last result. */
export function useLookahead() {
  const [state, setState] = useState<LookaheadState>({ running: null, result: null, error: null })
  const worker = useRef<Worker | null>(null)

  const stop = useCallback(() => {
    worker.current?.terminate()
    worker.current = null
  }, [])

  const start = useCallback(
    (request: LookaheadRequest, sig: string) => {
      stop()
      const w = new Worker(new URL('../workers/lookahead.worker.ts', import.meta.url), { type: 'module' })
      worker.current = w
      setState((s) => ({ ...s, running: { depth: request.depth, progress: null }, error: null }))
      const fail = (message: string) => {
        stop()
        setState((s) => ({ ...s, running: null, error: message }))
      }
      w.onmessage = (e: MessageEvent<LookaheadMessage>) => {
        const m = e.data
        if (m.type === 'progress')
          setState((s) => (s.running ? { ...s, running: { ...s.running, progress: m.progress } } : s))
        else if (m.type === 'done') {
          stop()
          setState({ running: null, result: { run: m.run, sig }, error: null })
        } else fail(m.message)
      }
      w.onerror = (e) => fail(e.message || 'Look-ahead failed')
      w.postMessage(request)
    },
    [stop],
  )

  const cancel = useCallback(() => {
    stop()
    setState((s) => ({ ...s, running: null }))
  }, [stop])

  useEffect(() => stop, [stop])

  return { state, start, cancel }
}
