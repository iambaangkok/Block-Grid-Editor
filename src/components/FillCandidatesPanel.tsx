import { arrangementLabel, FILL_CAP_OPTIONS, type ConcaveFillsResult } from '../model/fill'
import { DIR_LABEL, type KeyPiece } from '../model/types'

export function FillCandidatesPanel({
  fills,
  pieces,
  cap,
  onCap,
  selected,
  onSelect,
  onHoverConcave,
  onHoverArrangement,
  status,
}: {
  fills: ConcaveFillsResult[]
  pieces: readonly KeyPiece[]
  cap: number
  onCap: (n: number) => void
  /** `${concaveIndex}:${arrangementIndex}` of the previewed arrangement. */
  selected: string | null
  onSelect: (key: string | null) => void
  onHoverConcave: (index: number | null) => void
  /** Pointer over an arrangement row: preview it until the pointer leaves. */
  onHoverArrangement: (key: string | null) => void
  /** Why there is nothing to search, if so. */
  status: string | null
}) {
  const names = new Map(pieces.map((p) => [p.id, p.name || 'Untitled']))
  const fillerCount = pieces.filter((p) => p.filler !== false).length

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

      {status ? (
        <p className="text-xs text-neutral-500">{status}</p>
      ) : (
        // ~10 rows tall with its own scrollbar when stacked; the whole column scrolls when side by side.
        <ul className="max-h-[13.5rem] space-y-2.5 overflow-y-auto pr-1 @2xl:max-h-none @2xl:overflow-visible">
          {fills.map(({ concave, result }, ci) => (
            <li key={ci} onMouseEnter={() => onHoverConcave(ci)} onMouseLeave={() => onHoverConcave(null)}>
              <div className="text-xs font-medium text-neutral-800">
                Concave {ci + 1}
                <span className="font-normal text-neutral-500">
                  {' '}
                  · opens {DIR_LABEL[concave.opens]} · innermost {concave.innermost.cells.length} cell
                  {concave.innermost.cells.length === 1 ? '' : 's'}
                </span>
              </div>
              <ol className="mt-1 space-y-0.5">
                {result.arrangements.map((a, ai) => {
                  const key = `${ci}:${ai}`
                  const active = selected === key
                  return (
                    <li key={key}>
                      <button
                        type="button"
                        onClick={() => onSelect(active ? null : key)}
                        onPointerEnter={(e) => e.pointerType === 'mouse' && onHoverArrangement(key)}
                        onPointerLeave={() => onHoverArrangement(null)}
                        className={`flex w-full items-baseline gap-1.5 rounded-md px-1.5 py-0.5 text-left text-[11px] ${
                          active ? 'bg-indigo-50 text-indigo-700' : 'text-neutral-700 hover:bg-neutral-50'
                        }`}
                      >
                        <span className="w-4 shrink-0 tabular-nums text-neutral-400">{ai + 1}.</span>
                        <span className="min-w-0 flex-1">{arrangementLabel(a.copies, names)}</span>
                        <span className="shrink-0 text-neutral-400">
                          {a.copies.length} cop{a.copies.length === 1 ? 'y' : 'ies'}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ol>
              {result.arrangements.length === 0 && !result.budgetHit && (
                <div className="px-1.5 text-[11px] text-neutral-400">none</div>
              )}
              {result.limitReached && (
                <div className="px-1.5 text-[11px] text-neutral-400">… limit reached</div>
              )}
              {result.budgetHit && (
                <div className="px-1.5 text-[11px] text-amber-700">search limit reached</div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
