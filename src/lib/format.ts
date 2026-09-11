export type Tokens = { input?: number; output?: number; cacheRead?: number; cacheCreate?: number; total?: number; reasoning?: number }
export function fmtTime(ts: string | number | Date | null | undefined) {
  if (!ts) return ''
  const d = new Date(ts)
  if (Number.isNaN(Number(d))) return String(ts)
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function fmtRelative(ts: string | number | Date | null | undefined) {
  if (!ts) return ''
  const d = new Date(ts)
  const diff = Date.now() - d.getTime()
  if (Number.isNaN(diff)) return ''
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day}d ago`
  return d.toLocaleDateString()
}

export function fmtTokens(n: number | null | undefined) {
  if (!n) return '0'
  if (n < 1000) return String(n)
  if (n < 1_000_000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k'
  if (n < 1_000_000_000) return (n / 1_000_000).toFixed(n < 100_000_000 ? 2 : 1).replace(/\.0+$/, '') + 'M'
  // a billion-token folder reads as 1.06B, not 1056.42M (which overflows a Stats tile)
  return (n / 1_000_000_000).toFixed(2).replace(/\.00$/, '') + 'B'
}

// Codex reports a cumulative `total`; fall back to summing the parts
// (cacheCreate is claude-only and absent on codex token shapes).
export function totalTokens(t: Tokens | null | undefined) {
  if (!t) return 0
  if (t.total) return t.total
  return (t.input || 0) + (t.output || 0) + (t.cacheCreate || 0) + (t.cacheRead || 0)
}
