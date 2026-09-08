// Token accounting shared by every provider — the one place that says which
// fields every provider has (and can therefore be added up across folders and
// providers) and which are a single provider's own.
//
//   common:   input, output, cacheRead, total   — present on every provider's
//             summary; `total` is COMPUTED BY THE PROVIDER (never re-derived in
//             the UI), so three different formulas can no longer disagree.
//   specific: e.g. cacheCreate (Claude), reasoning (Codex) — declared per
//             provider in its api.js and echoed in GET /api/stats `fields`, so the
//             UI can show the common tiles first and the provider's own after.
//
// `total` means "tokens that went through the model for this session": input +
// output + everything read from or written to the prompt cache. Codex reports
// its own cumulative total (which is what its CLI shows); when a provider
// reports one it wins, otherwise it is the sum of the parts.
export const COMMON_TOKEN_FIELDS = ['input', 'output', 'cacheRead', 'total']

export function zeroTokens(specific = []) {
  const t = { input: 0, output: 0, cacheRead: 0, total: 0 }
  for (const k of specific) t[k] = 0
  return t
}

// sum every numeric field `t` carries (common or specific) into `into`
export function addTokens(into, t) {
  if (!t) return into
  for (const [k, v] of Object.entries(t)) if (typeof v === 'number') into[k] = (into[k] || 0) + v
  return into
}

// fill `total` when the provider's raw data has none (Claude) — or when it is
// zero on a shape that clearly has parts
export function withTotal(t) {
  if (!t) return t
  if (typeof t.total === 'number' && t.total > 0) return t
  return { ...t, total: (t.input || 0) + (t.output || 0) + (t.cacheRead || 0) + (t.cacheCreate || 0) }
}

export const tokenFields = (specific = []) => ({ common: COMMON_TOKEN_FIELDS, specific })
