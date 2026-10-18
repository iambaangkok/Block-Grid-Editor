import type { CheckStatus, PieceChecks } from '../model/checks'

const PILL: Record<CheckStatus, { label: string; cls: string }> = {
  pass: { label: 'Pass', cls: 'bg-green-50 text-green-700 border-green-200' },
  fail: { label: 'Fail', cls: 'bg-red-50 text-red-700 border-red-200' },
  na: { label: 'n/a', cls: 'bg-neutral-50 text-neutral-500 border-neutral-200' },
  unknown: { label: '?', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

export function PieceChecksPanel({
  checks,
  showEvidence,
  onShowEvidence,
}: {
  checks: PieceChecks
  showEvidence: boolean
  onShowEvidence: (v: boolean) => void
}) {
  const { connected, cavity, concave } = checks
  const rows: { title: string; status: CheckStatus; detail: string }[] = [
    {
      title: 'Edge-connected',
      status: connected.status,
      detail:
        connected.status === 'pass'
          ? 'Every cell shares an edge with the rest of the piece.'
          : `${connected.groups.length} separate groups — stray cells in red.`,
    },
    {
      title: 'No enclosed cavity',
      status: cavity.status,
      detail:
        cavity.status === 'pass'
          ? 'All empty space reaches the outside through edges.'
          : `${plural(cavity.cells.length, 'trapped cell')} in red.`,
    },
    {
      title: 'Cannot fill its own concave',
      status: concave.status,
      detail:
        concave.status === 'na'
          ? 'Needs the two checks above to pass.'
          : concave.status === 'fail'
            ? `Copies can make the innermost notch solid — ${plural(concave.witness!.copies.length, 'copy')} shown dashed.`
            : concave.status === 'unknown'
              ? `Search limit reached on ${plural(concave.undecided.length, 'concave')} (outlined).`
              : concave.concaves.length === 0
                ? 'No concaves.'
                : `${plural(concave.concaves.length, 'concave')}, none fillable.`,
    },
  ]
  return (
    <section>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">Checks</span>
        <label className="flex items-center gap-1 text-[11px] text-neutral-500">
          <input type="checkbox" checked={showEvidence} onChange={(e) => onShowEvidence(e.target.checked)} />
          show on grid
        </label>
      </div>
      <ul className="space-y-1.5">
        {rows.map((r) => (
          <li key={r.title} className="flex items-start gap-2">
            <span className={`mt-0.5 w-10 shrink-0 rounded border px-1 text-center text-[10px] font-semibold ${PILL[r.status].cls}`}>
              {PILL[r.status].label}
            </span>
            <span className="min-w-0">
              <span className="block text-xs font-medium text-neutral-800">{r.title}</span>
              <span className="block text-[11px] leading-snug text-neutral-500">{r.detail}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
