import { useEffect, useState } from 'react'
import { hexToHsl, hslToHex, normalizeColor } from '../../lib/accent.js'
import { setPref, usePrefs } from '../../lib/prefs.js'

// Accent colours, picked freely — there is no fixed palette on purpose (the
// maintainer wanted any colour, and users keeping their own).
//
//   <AccentField>  one quiet row: a colour chip + the hex + "change". Clicking
//                  the chip unfolds the tray below it; only what you are
//                  changing takes space (the first version showed everything
//                  at once and read as a wall of sliders).
//   <AccentTray>   the picker itself: the user's saved swatches, a thin hue
//                  bar, a thin saturation bar, a hex field, the system colour
//                  dialog, and default / clear. Lightness is not a control —
//                  each theme sets it (index.css --accent-l-*), which is what
//                  keeps any hue readable on Midnight, Graphite and Paper.
//
//   value: current colour (hex or legacy name) · defaultValue: what "default" restores
//   onChange(hex) · onReset() optional (shows the reset button) · resetLabel ('default' | 'clear')
const MAX_SWATCHES = 24
const HUE_TRACK = 'linear-gradient(to right, hsl(0 85% 55%), hsl(60 85% 55%), hsl(120 85% 55%), hsl(180 85% 55%), hsl(240 85% 55%), hsl(300 85% 55%), hsl(360 85% 55%))'
const RAINBOW = 'conic-gradient(hsl(0 85% 55%), hsl(60 85% 55%), hsl(120 85% 55%), hsl(180 85% 55%), hsl(240 85% 55%), hsl(300 85% 55%), hsl(360 85% 55%))'
const resolve = (value, defaultValue) => normalizeColor(value) || normalizeColor(defaultValue) || '#71717a'

export function AccentTray({ value, defaultValue, onChange, onReset = null, resetLabel = 'default' }) {
  const prefs = usePrefs()
  const hex = resolve(value, defaultValue)
  const { h, s } = hexToHsl(hex)
  const [text, setText] = useState(hex)
  useEffect(() => setText(hex), [hex])
  // the stored hex is the colour at a fixed mid lightness — the theme paints it lighter or darker
  const pick = (nh, ns) => onChange(hslToHex(nh, ns, 55))
  const live = `hsl(${h} ${s}% 55%)`
  const saved = Array.isArray(prefs.customAccents) ? prefs.customAccents : []
  const isSaved = saved.includes(hex)
  const save = () => !isSaved && setPref('customAccents', [...saved, hex].slice(-MAX_SWATCHES))
  const remove = (c) => setPref('customAccents', saved.filter((x) => x !== c))
  const link = 'text-[11px] text-zinc-500 hover:text-zinc-200 disabled:opacity-40 disabled:hover:text-zinc-500'

  return (
    <div className="rounded-md border border-zinc-800 bg-ink-900/60 px-2.5 py-2 space-y-2" onMouseDown={(e) => e.stopPropagation()}>
      {/* the user's swatches, plus "+" to keep the current colour */}
      <div className="flex flex-wrap items-center gap-1.5">
        {saved.map((c) => (
          <span key={c} className="relative group/sw">
            <button
              data-swatch
              onClick={() => onChange(c)}
              title={c}
              className={`block w-3.5 h-3.5 rounded-full transition-transform hover:scale-125 ${c === hex ? 'ring-2 ring-zinc-100 ring-offset-1 ring-offset-ink-900' : 'ring-1 ring-ink-900'}`}
              style={{ background: c }}
            />
            <button onClick={() => remove(c)} title="Remove from your swatches" className="absolute -top-1.5 -right-1.5 w-3 h-3 rounded-full bg-ink-900 border border-zinc-600 text-[8px] leading-none text-zinc-300 flex items-center justify-center opacity-0 group-hover/sw:opacity-100 transition-opacity">
              ×
            </button>
          </span>
        ))}
        <button
          onClick={save}
          disabled={isSaved}
          title={isSaved ? 'This colour is in your swatches' : 'Keep this colour in your swatches'}
          className={`w-3.5 h-3.5 rounded-full border border-dashed text-[10px] leading-none flex items-center justify-center ${isSaved ? 'border-zinc-800 text-zinc-700' : 'border-zinc-500 text-zinc-400 hover:text-zinc-100 hover:border-zinc-300'}`}
        >
          +
        </button>
        {!saved.length && <span className="text-[10.5px] text-zinc-600 ml-0.5">save colours here</span>}
      </div>
      <input type="range" min={0} max={360} value={h} onChange={(e) => pick(Number(e.target.value), s)} className="accent-range w-full" style={{ background: HUE_TRACK, '--thumb': live }} title={`hue ${h}°`} aria-label="Hue" />
      <input type="range" min={0} max={100} value={s} onChange={(e) => pick(h, Number(e.target.value))} className="accent-range w-full" style={{ background: `linear-gradient(to right, hsl(${h} 0% 55%), hsl(${h} 100% 55%))`, '--thumb': live }} title={`saturation ${s}%`} aria-label="Saturation" />
      <div className="flex items-center gap-2">
        <input
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            const n = normalizeColor(e.target.value)
            if (n && n !== hex) onChange(n)
          }}
          spellCheck={false}
          maxLength={7}
          className="w-[70px] font-mono text-[11px] bg-ink-800 border border-zinc-800 rounded px-1.5 py-0.5 text-zinc-200 focus:border-zinc-500 outline-none"
          title="Type a hex colour"
        />
        <label title="System colour dialog" className="relative w-4 h-4 rounded-full shrink-0 cursor-pointer ring-1 ring-ink-900 opacity-80 hover:opacity-100" style={{ background: RAINBOW }}>
          <input type="color" value={hex} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" aria-label="System colour dialog" />
        </label>
        <span className="flex-1" />
        {onReset && (
          <button onClick={onReset} title={`Back to the ${resetLabel}`} className={link}>
            {resetLabel}
          </button>
        )}
      </div>
    </div>
  )
}

// One row: chip + hex + "change"; the tray unfolds under it.
export default function AccentField({ label, hint = null, value, defaultValue, onChange, onReset = null, resetLabel = 'default', open: openProp, onToggle, empty = 'none' }) {
  const [openState, setOpenState] = useState(false)
  const open = openProp ?? openState
  const toggle = () => (onToggle ? onToggle(!open) : setOpenState((o) => !o))
  const hexNow = normalizeColor(value)
  const shown = resolve(value, defaultValue)
  const { h, s } = hexToHsl(shown)
  const live = `hsl(${h} ${s}% 55%)`
  return (
    <div className="py-0.5">
      <button onClick={toggle} data-accent-chip className="w-full flex items-center gap-2 py-1 text-left group/chip" title={open ? 'Close' : 'Change colour'}>
        <span className="w-4 h-4 rounded-full shrink-0 ring-1 ring-ink-900 transition-shadow group-hover/chip:shadow-[0_0_8px_var(--glow)]" style={{ background: hexNow ? live : 'transparent', border: hexNow ? 'none' : '1px dashed rgb(var(--zinc-600))', '--glow': live }} />
        {label && <span className="text-[12.5px] text-zinc-200 shrink-0">{label}</span>}
        {hint && <span className="text-[10.5px] text-zinc-600 truncate">{hint}</span>}
        <span className="text-[11px] font-mono text-zinc-500">{hexNow || empty}</span>
        <span className="ml-auto text-[11px] text-zinc-500 group-hover/chip:text-zinc-200">{open ? 'done' : 'change'}</span>
      </button>
      {open && (
        <div className="pl-6 pb-1">
          <AccentTray value={value} defaultValue={defaultValue} onChange={onChange} onReset={onReset} resetLabel={resetLabel} />
        </div>
      )}
    </div>
  )
}
