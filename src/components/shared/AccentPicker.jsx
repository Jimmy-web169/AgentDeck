import { useEffect, useState } from 'react'
import { hexToHsl, hslToHex, normalizeColor } from '../../lib/accent.js'
import { setPref, usePrefs } from '../../lib/prefs.js'

// A free colour picker for accents (a provider's, a workspace's). There is no
// fixed palette on purpose: a hue slider and a saturation slider cover every
// colour, the OS colour dialog is one click away, a hex can be typed, and the
// user keeps the ones they like as swatches (prefs.customAccents) for the next
// pick. Lightness is not a control — each theme sets it (index.css
// --accent-l-*), which is what keeps any hue readable on Midnight, Graphite and
// Paper alike.
//   value: the current colour (hex or legacy name) · defaultValue: what "default" restores
//   onChange(hex) · onReset() (optional, shows the default / clear button) · resetLabel
const MAX_SWATCHES = 24
const HUE_TRACK = 'linear-gradient(to right, hsl(0 90% 55%), hsl(60 90% 55%), hsl(120 90% 55%), hsl(180 90% 55%), hsl(240 90% 55%), hsl(300 90% 55%), hsl(360 90% 55%))'

export default function AccentPicker({ value, defaultValue, onChange, onReset = null, resetLabel = 'default' }) {
  const prefs = usePrefs()
  const hex = normalizeColor(value) || normalizeColor(defaultValue) || '#71717a'
  const { h, s } = hexToHsl(hex)
  const [text, setText] = useState(hex)
  useEffect(() => setText(hex), [hex])
  // the hex we store is the colour at a fixed mid lightness — the theme paints it lighter or darker
  const pick = (nh, ns) => onChange(hslToHex(nh, ns, 55))
  const preview = `hsl(${h} ${s}% 55%)`
  const saved = Array.isArray(prefs.customAccents) ? prefs.customAccents : []
  const isSaved = saved.includes(hex)
  const save = () => !isSaved && setPref('customAccents', [...saved, hex].slice(-MAX_SWATCHES))
  const remove = (c) => setPref('customAccents', saved.filter((x) => x !== c))
  const small = 'h-6 px-2 rounded text-[11px] bg-ink-700 border border-zinc-700 text-zinc-300 hover:text-zinc-100 hover:bg-ink-600 disabled:opacity-40 disabled:hover:bg-ink-700'

  return (
    <div className="space-y-2" onMouseDown={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-2">
        <span className="w-8 h-8 rounded-full shrink-0 transition-[background,box-shadow]" style={{ background: preview, boxShadow: `0 0 0 2px rgb(var(--ink-900)), 0 0 18px ${preview}` }} title={hex} />
        <input
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            const n = normalizeColor(e.target.value)
            if (n && n !== hex) onChange(n)
          }}
          spellCheck={false}
          maxLength={7}
          className="w-[82px] font-mono text-[12px] bg-ink-700 border border-zinc-700 rounded px-1.5 py-1 text-zinc-100 focus:border-zinc-500 outline-none"
          title="Type a hex colour"
        />
        <label title="Open the system colour dialog" className="relative w-6 h-6 rounded-full shrink-0 cursor-pointer ring-1 ring-zinc-600 hover:ring-zinc-300 transition-shadow" style={{ background: 'conic-gradient(hsl(0 90% 55%), hsl(60 90% 55%), hsl(120 90% 55%), hsl(180 90% 55%), hsl(240 90% 55%), hsl(300 90% 55%), hsl(360 90% 55%))' }}>
          <input type="color" value={hex} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" aria-label="System colour dialog" />
        </label>
        <button onClick={save} disabled={isSaved} title={isSaved ? 'Already in your swatches' : 'Keep this colour in your swatches'} className={small}>
          {isSaved ? 'saved' : '+ save'}
        </button>
        {onReset && (
          <button onClick={onReset} title={`Back to the ${resetLabel}`} className={`${small} ml-auto`}>
            {resetLabel}
          </button>
        )}
      </div>
      <input type="range" min={0} max={360} value={h} onChange={(e) => pick(Number(e.target.value), s)} className="accent-range w-full" style={{ background: HUE_TRACK, '--thumb': preview }} title={`hue ${h}°`} aria-label="Hue" />
      <input type="range" min={0} max={100} value={s} onChange={(e) => pick(h, Number(e.target.value))} className="accent-range w-full" style={{ background: `linear-gradient(to right, hsl(${h} 0% 55%), hsl(${h} 100% 55%))`, '--thumb': preview }} title={`saturation ${s}%`} aria-label="Saturation" />
      {saved.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          {saved.map((c) => (
            <span key={c} className="relative group/sw">
              <button data-swatch onClick={() => onChange(c)} title={c} className={`block w-5 h-5 rounded-full transition-transform hover:scale-110 ${c === hex ? 'ring-2 ring-zinc-100 ring-offset-1 ring-offset-ink-800' : ''}`} style={{ background: c, boxShadow: `0 0 8px ${c}99` }} />
              <button onClick={() => remove(c)} title="Remove from your swatches" className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 rounded-full bg-ink-900 border border-zinc-600 text-[9px] leading-none text-zinc-300 flex items-center justify-center opacity-0 group-hover/sw:opacity-100 transition-opacity">
                ×
              </button>
            </span>
          ))}
        </div>
      ) : (
        <div className="text-[11px] text-zinc-500">No swatches yet — pick a colour and press "+ save" to keep it.</div>
      )}
    </div>
  )
}
