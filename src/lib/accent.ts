// Accent colours as *data*: a user picks any colour (hex), the UI derives the
// hue and saturation, and each theme supplies the lightness (`--accent-l-dot`,
// `--accent-l-text`, `--accent-l-bar` in index.css — bright on Midnight and
// Graphite, deep on Paper). That is what lets one chosen colour look right in
// all three themes without a fixed palette: there is none — the maintainer
// wanted "百變", any colour, and users saving their own.
//
// Legacy names (the old fixed palette, and the providers' registry defaults)
// still resolve, so stored prefs and workspaces from before keep their colour.

export const NAMED: Record<string, string> = {
  emerald: '#34d399',
  teal: '#2dd4bf',
  lime: '#a3e635',
  cyan: '#22d3ee',
  sky: '#38bdf8',
  indigo: '#818cf8',
  violet: '#a78bfa',
  fuchsia: '#e879f9',
  pink: '#f472b6',
  rose: '#fb7185',
  red: '#f87171',
  orange: '#fb923c',
  amber: '#fbbf24',
  zinc: '#71717a',
}

const HEX6 = /^#([0-9a-f]{6})$/i
const HEX3 = /^#([0-9a-f]{3})$/i

// hex / legacy name → canonical lower-case #rrggbb, or null
export function normalizeColor(v: unknown) {
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (HEX6.test(s)) return s.toLowerCase()
  const m3 = s.match(HEX3)
  if (m3) return `#${[...m3[1]].map((c) => c + c).join('')}`.toLowerCase()
  return NAMED[s.toLowerCase()] || null
}
export const isColor = (v: unknown) => normalizeColor(v) !== null

export function hexToHsl(hex: unknown) {
  const n = normalizeColor(hex) || NAMED.zinc
  const r = parseInt(n.slice(1, 3), 16) / 255
  const g = parseInt(n.slice(3, 5), 16) / 255
  const b = parseInt(n.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  let h = 0
  let s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) }
}

export function hslToHex(h: number, s: number, l: number) {
  const S = Math.min(100, Math.max(0, s)) / 100
  const L = Math.min(100, Math.max(0, l)) / 100
  const H = ((h % 360) + 360) % 360
  const c = (1 - Math.abs(2 * L - 1)) * S
  const x = c * (1 - Math.abs(((H / 60) % 2) - 1))
  const m = L - c / 2
  const [r, g, b] = H < 60 ? [c, x, 0] : H < 120 ? [x, c, 0] : H < 180 ? [0, c, x] : H < 240 ? [0, x, c] : H < 300 ? [x, 0, c] : [c, 0, x]
  const to = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${to(r)}${to(g)}${to(b)}`
}

// What a component needs to paint an accent: generic classes (index.css:
// .accent-dot / .accent-text read --ah / --as) plus the inline style that
// carries the hue and saturation, and a bar colour for inline box-shadows.
export function accentStyle(color: unknown) {
  const hex = normalizeColor(color) || NAMED.zinc
  const { h, s } = hexToHsl(hex)
  return {
    hex,
    h,
    s,
    dot: 'accent-dot',
    text: 'accent-text',
    bar: `hsl(${h} ${s}% var(--accent-l-bar))`,
    style: { '--ah': String(h), '--as': `${s}%` } as React.CSSProperties & { '--ah': string; '--as': string },
  }
}
