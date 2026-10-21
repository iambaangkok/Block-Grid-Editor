import type { Concave, PieceChecks } from '../model/checks'
import type { KeyPiece, Placement } from '../model/types'
import type { PieceOverlay } from './PieceCanvas'

/** Evidence to draw for the failing (or undecided) checks. */
export function checksOverlay(piece: KeyPiece, checks: PieceChecks): PieceOverlay | null {
  const overlay: PieceOverlay = {}
  if (checks.connected.status === 'fail') overlay.bad = checks.connected.groups.slice(1).flat()
  if (checks.cavity.status === 'fail') overlay.bad = [...(overlay.bad ?? []), ...checks.cavity.cells]
  const shown = checks.concave.witness?.concave ?? checks.concave.undecided[0]
  if (shown) {
    overlay.concave = shown.notches.flatMap((n) => n.cells)
    overlay.innermost = shown.innermost.cells
    overlay.ghosts = checks.concave.witness?.copies.map((placement) => ({ piece, placement }))
  }
  return Object.keys(overlay).length > 0 ? overlay : null
}

/** Outline a concave, optionally with a previewed fill arrangement. */
export function concaveOverlay(
  concave: Concave,
  ghosts?: { piece: KeyPiece; placement: Placement }[],
): PieceOverlay {
  return {
    concave: concave.notches.flatMap((n) => n.cells),
    innermost: concave.innermost.cells,
    ghosts,
  }
}
