// Dependency-free fuzzy matcher for the quick switcher.
//
// fuzzyMatch(query, text) → { score, indices } | null
//   A contiguous substring match wins over a scattered subsequence; matches at
//   the start of a word (after space, '-', '_', '/', '\', '.', ':') score higher;
//   longer texts and wider spreads score slightly lower so "AgentDeck" beats
//   "…/some/other/agent-deck-experiments" for the query "agentdeck".
//
// matchFields(query: string, fields: Record<string, unknown>) → { score, hits: { [fieldName]: indices } } | null
//   Whitespace-separated query tokens must each match at least one field.

const WORD_BREAK = /[\s\-_/\\.:]/

export function fuzzyMatch(query: string, text: unknown) {
  const q = String(query || '').toLowerCase()
  const t = String(text || '').toLowerCase()
  if (!q) return { score: 0, indices: [] }
  if (!t) return null

  // 1. contiguous — prefer the occurrence at a word start
  let at = t.indexOf(q)
  if (at !== -1) {
    let best = at
    while (at !== -1) {
      if (at === 0 || WORD_BREAK.test(t[at - 1])) {
        best = at
        break
      }
      at = t.indexOf(q, at + 1)
    }
    const wordStart = best === 0 || WORD_BREAK.test(t[best - 1])
    const score = 100 + q.length * 4 + (wordStart ? 20 : 0) - best * 0.5 - t.length * 0.05
    return { score, indices: Array.from({ length: q.length }, (_, i) => best + i) }
  }

  // 2. subsequence (greedy, word-start aware)
  const indices = []
  let qi = 0
  let prev = -2
  let score = 0
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] !== q[qi]) continue
    let s = 1
    if (ti === prev + 1) s += 2
    if (ti === 0 || WORD_BREAK.test(t[ti - 1])) s += 3
    score += s
    indices.push(ti)
    prev = ti
    qi++
  }
  if (qi < q.length) return null
  const spread = indices[indices.length - 1] - indices[0] - (q.length - 1)
  score -= spread * 0.3 + t.length * 0.05
  return { score, indices }
}

export function matchFields(query: string, fields: Record<string, unknown>) {
  const tokens = String(query || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  const hits: Record<string, number[]> = {}
  if (!tokens.length) return { score: 0, hits }
  let total = 0
  for (const tok of tokens) {
    let best = null
    let bestName = null
    for (const [name, text] of Object.entries(fields)) {
      const m = fuzzyMatch(tok, text)
      if (m && (!best || m.score > best.score)) {
        best = m
        bestName = name
      }
    }
    if (!best || bestName === null) return null
    total += best.score
    hits[bestName] = [...(hits[bestName] || []), ...best.indices]
  }
  return { score: total, hits }
}

// split `text` into [{ text, hit }] chunks for rendering highlighted matches
export function highlightChunks(text: unknown, indices?: number[]) {
  const s = String(text || '')
  if (!indices?.length) return [{ text: s, hit: false }]
  const set = new Set(indices)
  const out = []
  let cur = null
  for (let i = 0; i < s.length; i++) {
    const hit = set.has(i)
    if (cur && cur.hit === hit) cur.text += s[i]
    else {
      cur = { text: s[i], hit }
      out.push(cur)
    }
  }
  return out
}
