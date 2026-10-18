import { useState } from 'react'
import { BLACK, HUES, PICKER_SHADES, PRESETS, WHITE, type Hue } from '../model/palette'

interface Props {
  fill: string
  border: string
  onChange: (c: { fill?: string; border?: string }) => void
}

const HUE_ORDER = Object.keys(HUES) as Hue[]

function Swatch({
  color,
  active,
  onClick,
  title,
}: {
  color: string
  active: boolean
  onClick: () => void
  title: string
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={`h-6 w-6 rounded-[5px] border transition-transform hover:scale-110 ${
        active ? 'ring-2 ring-indigo-500 ring-offset-1' : ''
      } ${color.toLowerCase() === WHITE ? 'border-neutral-300' : 'border-black/10'}`}
      style={{ background: color }}
    />
  )
}

export function ColorPicker({ fill, border, onChange }: Props) {
  const [target, setTarget] = useState<'fill' | 'border'>('fill')
  const current = target === 'fill' ? fill : border
  const set = (c: string) => onChange({ [target]: c })

  return (
    <div className="space-y-3">
      <div>
        <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-neutral-500">Presets</div>
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.name}
              type="button"
              title={p.name}
              aria-label={`Preset ${p.name}`}
              onClick={() => onChange({ fill: p.fill, border: p.border })}
              className={`h-7 w-7 rounded-md border-2 transition-transform hover:scale-110 ${
                p.fill === fill && p.border === border ? 'ring-2 ring-indigo-500 ring-offset-1' : ''
              }`}
              style={{ background: p.fill, borderColor: p.border }}
            />
          ))}
        </div>
      </div>

      <div>
        <div className="mb-1.5 flex items-center gap-1 rounded-lg bg-neutral-100 p-0.5 text-xs">
          {(['fill', 'border'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTarget(t)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1 capitalize ${
                target === t ? 'bg-white font-medium shadow-sm' : 'text-neutral-500 hover:text-neutral-800'
              }`}
            >
              <span
                className="inline-block h-3 w-3 rounded-sm border border-black/15"
                style={{ background: t === 'fill' ? fill : border }}
              />
              {t}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Swatch color={WHITE} active={current === WHITE} onClick={() => set(WHITE)} title="White" />
          <Swatch color={BLACK} active={current === BLACK} onClick={() => set(BLACK)} title="Black" />
          {HUE_ORDER.map((hue) => {
            const c = HUES[hue][target === 'fill' ? 4 : 8]
            return <Swatch key={hue} color={c} active={current === c} onClick={() => set(c)} title={hue} />
          })}
        </div>
        <div className="mt-2 mb-1 text-[11px] font-medium uppercase tracking-wide text-neutral-500">Shades</div>
        <div className="grid grid-cols-[repeat(13,1fr)] gap-1">
          {HUE_ORDER.map((hue) => (
            <div key={hue} className="flex flex-col gap-1">
              {PICKER_SHADES.map((s) => {
                const c = HUES[hue][s]
                return (
                  <button
                    key={s}
                    type="button"
                    title={`${hue} ${s}`}
                    aria-label={`${hue} ${s}`}
                    onClick={() => set(c)}
                    className={`aspect-square w-full rounded-[3px] border border-black/5 hover:scale-125 ${
                      current === c ? 'ring-2 ring-indigo-500' : ''
                    }`}
                    style={{ background: c }}
                  />
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
