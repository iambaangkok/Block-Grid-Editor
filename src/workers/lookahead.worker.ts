import { Cancelled, runLookahead, type LookaheadProgress, type LookaheadRun } from '../model/lookahead'
import type { KeyPiece } from '../model/types'

// Runs a look-ahead off the main thread. Cancelling = the page terminates this worker.

export interface LookaheadRequest {
  target: KeyPiece
  fillers: KeyPiece[]
  pieces: KeyPiece[]
  cap: number
  depth: number
}

export type LookaheadMessage =
  | { type: 'progress'; progress: LookaheadProgress }
  | { type: 'done'; run: LookaheadRun }
  | { type: 'error'; message: string }

const post = (m: LookaheadMessage) => (self as unknown as { postMessage(m: LookaheadMessage): void }).postMessage(m)

self.onmessage = (e: MessageEvent<LookaheadRequest>) => {
  const { target, fillers, pieces, cap, depth } = e.data
  let last = 0
  try {
    const run = runLookahead(target, fillers, pieces, {
      cap,
      depth,
      onProgress: (progress) => {
        const now = Date.now()
        if (now - last < 100) return
        last = now
        post({ type: 'progress', progress })
      },
    })
    post({ type: 'done', run })
  } catch (err) {
    if (err instanceof Cancelled) return
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
