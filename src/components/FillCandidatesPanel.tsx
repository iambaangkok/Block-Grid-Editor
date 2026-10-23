import type { Concave } from '../model/checks'
import { arrangementLabel, FILL_CAP_OPTIONS, type ConcaveFillsResult, type FillArrangement } from '../model/fill'
import { concaveKey, LOOKAHEAD_DEPTHS, type ConcaveLookahead, type Verdict } from '../model/lookahead'
import { DIR_LABEL, type KeyPiece, type Placement } from '../model/types'
import type { LookaheadState } from './useLookahead'

/** What the editor grid should show for a hovered / pinned row. */
export interface FillPreview {
  key: string
  concave: Concave
  copies: Placement[]
  /** For an eliminated row: the concave that gets stuck. */
  dead?: Concave
}

interface LookaheadControls {
  state: LookaheadState
  depth: number
  onDepth: (d: number) => void
  onRun: () => void
  onCancel: () => void
  /** The finished result no longer matches the piece / fillers / cap / depth. */
  stale: boolean
}

const steps = (n: number) => `${n} step${n === 1 ? '' : 's'}`
const cells = (c: Concave) => `${c.innermost.cells.length} cell${c.innermost.cells.length === 1 ? '' : 's'}`

function deadReason(v: Extract<Verdict, { status: 'dead' }>) {
  const what = `new concave · opens ${DIR_LABEL[v.concave.opens]} · ${cells(v.concave)}`
  return v.reason === 'nofill' ? `${what}: no fill` : `${what}: every fill dead-ends within ${steps(v.within)}`
}

export function FillCandidatesPanel({
  fills,
  pieces,
  cap,
  onCap,
  selectedKey,
  onSelect,
  onHover,
  onHoverConcave,
  status,
  lookahead,
}: {
  fills: ConcaveFillsResult[]
  pieces: readonly KeyPiece[]
  cap: number
  onCap: (n: number) => void
  /** Key of the pinned preview. */
  selectedKey: string | null
  onSelect: (p: FillPreview | null) => void
  /** Pointer over a row: preview it until the pointer leaves. */
  onHover: (p: FillPreview | null) => void
  onHoverConcave: (index: number | null) => void
  /** Why there is nothing to search, if so. */
  status: string | null
  lookahead: LookaheadControls
}) {
  const names = new Map(pieces.map((p) => [p.id, p.name || 'Untitled']))
  const fillerCount = pieces.filter((p) => p.filler !== false).length
  const { state, stale } = lookahead
  const result = state.result
  const byKey = new Map((result?.run.concaves ?? []).map((c) => [concaveKey(c.concave), c]))
  const eliminatedTotal = result?.run.concaves.reduce((n, c) => n + c.eliminated.length, 0) ?? 0

  const row = (
    key: string,
    preview: FillPreview,
    index: number,
    arrangement: FillArrangement,
    badge?: { text: string; title: string; cls: string },
    struck?: string,
  ) => {
    const active = selectedKey === key
    return (
      <li key={key}>
        <button
          type="button"
          onClick={() => onSelect(active ? null : preview)}
          onPointerEnter={(e) => e.pointerType === 'mouse' && onHover(preview)}
          onPointerLeave={() => onHover(null)}
          className={`flex w-full items-baseline gap-1.5 rounded-md px-1.5 py-0.5 text-left text-[11px] ${
            active ? 'bg-indigo-50 text-indigo-700' : 'text-neutral-700 hover:bg-neutral-50'
          }`}
        >
          <span className="w-4 shrink-0 tabular-nums text-neutral-400">{index + 1}.</span>
          <span className="min-w-0 flex-1">
            <span className={struck ? 'text-neutral-400 line-through' : ''}>{arrangementLabel(arrangement.copies, names)}</span>
            {struck && <span className="block text-[10px] text-red-600/80">{struck}</span>}
          </span>
          {badge && (
            <span title={badge.title} className={`shrink-0 rounded px-1 text-[10px] font-semibold ${badge.cls}`}>
              {badge.text}
            </span>
          )}
          <span className="shrink-0 text-neutral-400">
            {arrangement.copies.length} cop{arrangement.copies.length === 1 ? 'y' : 'ies'}
          </span>
        </button>
      </li>
    )
  }

  const verdictBadge = (v: Verdict, depth: number) =>
    v.status === 'ok'
      ? { text: `✓ ${depth}`, title: `No dead end within ${steps(depth)}`, cls: 'bg-green-50 text-green-700' }
      : { text: '?', title: `Not proven within ${steps(depth)}: search limit reached`, cls: 'bg-amber-50 text-amber-700' }

  const lookaheadList = (ci: number, concave: Concave, la: ConcaveLookahead, depth: number) => (
    <div className={stale ? 'opacity-50' : ''}>
      <ol className="mt-1 space-y-0.5">
        {la.survivors.map((r, si) =>
          row(`L${ci}:${si}`, { key: `L${ci}:${si}`, concave, copies: r.arrangement.copies }, si, r.arrangement, verdictBadge(r.verdict, depth)),
        )}
      </ol>
      {la.survivors.length === 0 && !la.budgetHit && <div className="px-1.5 text-[11px] text-neutral-400">none survive</div>}
      {la.limitReached && <div className="px-1.5 text-[11px] text-neutral-400">… limit reached</div>}
      {la.budgetHit && <div className="px-1.5 text-[11px] text-amber-700">search limit reached</div>}
      {la.eliminated.length > 0 && (
        <details className="mt-0.5 px-1.5 text-[11px] text-neutral-500">
          <summary className="cursor-pointer select-none">{la.eliminated.length} eliminated (dead ends)</summary>
          <ol className="mt-0.5 space-y-0.5">
            {la.eliminated.map((r, ei) =>
              row(
                `E${ci}:${ei}`,
                {
                  key: `E${ci}:${ei}`,
                  concave,
                  copies: r.arrangement.copies,
                  dead: r.verdict.status === 'dead' ? r.verdict.concave : undefined,
                },
                ei,
                r.arrangement,
                undefined,
                r.verdict.status === 'dead' ? deadReason(r.verdict) : undefined,
              ),
            )}
          </ol>
        </details>
      )}
    </div>
  )

  return (
    <section>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">Fill candidates</span>
        <label className="flex items-center gap-1 text-[11px] text-neutral-500">
          show up to
          <select
            value={cap}
            onChange={(e) => onCap(Number(e.target.value))}
            className="rounded border border-neutral-200 bg-white px-1 py-0.5 text-[11px]"
            aria-label="Arrangements shown per concave"
          >
            {FILL_CAP_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="mb-2 text-[11px] leading-snug text-neutral-500">
        Arrangements of filler pieces ({fillerCount} enabled) that make each concave’s innermost notch solid. Hover one to
        preview it, click to keep it shown.
      </p>

      {!status && (
        <div className="mb-2.5 rounded-lg border border-neutral-200 bg-neutral-50/60 p-2">
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-neutral-600">
            <span className="font-medium text-neutral-800">Look-ahead</span>
            <select
              value={lookahead.depth}
              onChange={(e) => lookahead.onDepth(Number(e.target.value))}
              disabled={!!state.running}
              className="rounded border border-neutral-200 bg-white px-1 py-0.5 text-[11px]"
              aria-label="Look-ahead steps"
            >
              {LOOKAHEAD_DEPTHS.map((d) => (
                <option key={d} value={d}>
                  {steps(d)}
                </option>
              ))}
            </select>
            {state.running ? (
              <>
                <span className="min-w-0 flex-1 text-neutral-500">
                  {state.running.progress
                    ? `Checking concave ${state.running.progress.concave + 1}/${state.running.progress.concaves} · candidate ${
                        state.running.progress.checked + 1
                      }/${state.running.progress.total}…`
                    : 'Starting…'}
                </span>
                <button
                  type="button"
                  onClick={lookahead.onCancel}
                  className="rounded-md border border-neutral-200 bg-white px-2 py-0.5 text-[11px] hover:bg-neutral-100"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={lookahead.onRun}
                className="rounded-md border border-indigo-300 bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700 hover:bg-indigo-100"
              >
                {result ? 'Re-run' : 'Run'}
              </button>
            )}
          </div>
          <p className="mt-1.5 text-[10px] leading-snug text-neutral-500">
            Removes candidates that lead to a dead end: a new concave that nothing can fill within the chosen number of
            steps. Runs on demand and may take a while. The real puzzle might need more steps, but deeper searches take a
            long time, so look-ahead is limited to 3.
          </p>
          {state.error && <p className="mt-1 text-[11px] text-red-600">Look-ahead failed: {state.error}</p>}
          {result && !state.running && (
            <p className={`mt-1 text-[11px] ${stale ? 'text-amber-700' : 'text-neutral-600'}`}>
              {stale
                ? 'Out of date — the piece, fillers or settings changed. Re-run to update.'
                : `Checked ${steps(result.run.depth)} ahead · ${eliminatedTotal} eliminated`}
            </p>
          )}
        </div>
      )}

      {status ? (
        <p className="text-xs text-neutral-500">{status}</p>
      ) : (
        // ~10 rows tall with its own scrollbar when stacked; the whole column scrolls when side by side.
        <ul className="max-h-[13.5rem] space-y-2.5 overflow-y-auto pr-1 @2xl:max-h-none @2xl:overflow-visible">
          {fills.map(({ concave, result: live }, ci) => {
            const la = result ? byKey.get(concaveKey(concave)) : undefined
            return (
              <li key={ci} onMouseEnter={() => onHoverConcave(ci)} onMouseLeave={() => onHoverConcave(null)}>
                <div className="text-xs font-medium text-neutral-800">
                  Concave {ci + 1}
                  <span className="font-normal text-neutral-500">
                    {' '}
                    · opens {DIR_LABEL[concave.opens]} · innermost {cells(concave)}
                  </span>
                </div>
                {la && result ? (
                  lookaheadList(ci, concave, la, result.run.depth)
                ) : (
                  <>
                    <ol className="mt-1 space-y-0.5">
                      {live.arrangements.map((a, ai) =>
                        row(`${ci}:${ai}`, { key: `${ci}:${ai}`, concave, copies: a.copies }, ai, a),
                      )}
                    </ol>
                    {live.arrangements.length === 0 && !live.budgetHit && (
                      <div className="px-1.5 text-[11px] text-neutral-400">none</div>
                    )}
                    {live.limitReached && <div className="px-1.5 text-[11px] text-neutral-400">… limit reached</div>}
                    {live.budgetHit && <div className="px-1.5 text-[11px] text-amber-700">search limit reached</div>}
                  </>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
