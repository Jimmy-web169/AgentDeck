import { fmtTokens, totalTokens } from '../../lib/format.js'

// Token tiles in the order the maintainer asked for: the fields every provider
// has first (so a reader knows what can be compared and added up across
// folders), then this provider's own, marked as such. Which is which comes
// from GET /api/stats `fields` (server/shared/tokens.js) — the UI never guesses.
//   Tile: the caller's tile component ({ label, value, hint })
const LABELS = { total: 'total tokens', input: 'input', output: 'output', cacheRead: 'cache read', cacheCreate: 'cache create', reasoning: 'reasoning' }
const DEFAULT_COMMON = ['total', 'input', 'output', 'cacheRead']

export default function TokenTiles({ tokens, fields, Tile, providerLabel = 'this provider' }) {
  const t = tokens || {}
  const common = fields?.common?.length ? ['total', ...fields.common.filter((k) => k !== 'total')] : DEFAULT_COMMON
  const specific = (fields?.specific || []).filter((k) => !common.includes(k))
  const val = (k) => (k === 'total' ? totalTokens(t) : t[k] || 0)
  return (
    <>
      {common.map((k) => (
        <Tile key={k} label={LABELS[k] || k} value={fmtTokens(val(k))} />
      ))}
      {specific.map((k) => (
        <Tile key={k} label={LABELS[k] || k} value={fmtTokens(val(k))} hint={`${providerLabel} only`} />
      ))}
    </>
  )
}
