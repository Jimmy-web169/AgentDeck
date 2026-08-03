// Pure fork/truncation logic for Codex rollouts (unit-testable; api.js owns
// the fs/index side). A fork keeps everything strictly before the `cut`-th
// real user prompt (1-based, counted the same way the timeline does: the
// event_msg.user_message layer when present, response_item user messages
// otherwise, environment/instructions wrappers excluded), also dropping the
// dropped turn's scaffolding (task_started / env-context message /
// turn_context). session_meta gets its id rewritten to `newId` so
// `codex resume <newId>` picks the copy up. No `cut` = full copy.

const ENV_WRAP = /<environment_context>[\s\S]*?<\/environment_context>/g
const INSTR_WRAP = /<user_instructions>[\s\S]*?<\/user_instructions>/g
const cleanUser = (raw) => String(raw || '').replace(ENV_WRAP, '').replace(INSTR_WRAP, '').trim()

const bodyText = (p) => {
  const c = p.content
  if (Array.isArray(c)) return c.map((b) => (typeof b === 'string' ? b : b?.text || '')).join('\n')
  return String(c || '')
}

/** @returns {string[]} kept lines · @throws {Error} e.code='CUT_NOT_FOUND' | 'EMPTY_FORK' */
export function forkLines(rawLines, cut, newId) {
  const lines = rawLines.filter((l) => l.trim())
  const recs = lines.map((l) => {
    try {
      return JSON.parse(l)
    } catch {
      return null
    }
  })
  const hasEventUser = recs.some((r) => r?.type === 'event_msg' && r.payload?.type === 'user_message')
  const isUserPrompt = (r) => {
    if (!r) return false
    if (hasEventUser) return r.type === 'event_msg' && r.payload?.type === 'user_message' && !!cleanUser(r.payload.message)
    const p = r.payload && typeof r.payload === 'object' ? r.payload : r
    const isMsg = (r.type === 'response_item' && p.type === 'message') || r.type === 'message'
    return isMsg && p.role === 'user' && !!cleanUser(bodyText(p))
  }
  // The dropped turn's scaffolding precedes its user prompt; back over it so the
  // fork doesn't end on a dangling turn header. When the event layer is
  // authoritative, the raw response_item copy of the SAME prompt also precedes
  // the user_message event — it belongs to the dropped turn too.
  const isScaffold = (r) => {
    if (!r) return false
    if (r.type === 'event_msg' && r.payload?.type === 'task_started') return true
    if (r.type === 'turn_context') return true
    const p = r.payload && typeof r.payload === 'object' ? r.payload : r
    const isMsg = (r.type === 'response_item' && p.type === 'message') || r.type === 'message'
    return isMsg && p.role === 'user' && (hasEventUser || !cleanUser(bodyText(p)))
  }

  let end = lines.length
  if (cut) {
    let seen = 0
    let cutIdx = -1
    for (let i = 0; i < recs.length; i++) {
      if (isUserPrompt(recs[i])) {
        seen++
        if (seen === cut) {
          cutIdx = i
          break
        }
      }
    }
    if (cutIdx < 0) {
      const e = new Error('cut point not found in transcript')
      e.code = 'CUT_NOT_FOUND'
      throw e
    }
    while (cutIdx > 0 && isScaffold(recs[cutIdx - 1])) cutIdx--
    end = cutIdx
  }
  // a fork with no remaining user prompt has no history worth branching from
  if (!end || !recs.slice(0, end).some(isUserPrompt)) {
    const e = new Error('fork would be empty')
    e.code = 'EMPTY_FORK'
    throw e
  }
  const out = []
  for (let i = 0; i < end; i++) {
    const r = recs[i]
    if (r && r.type === 'session_meta' && r.payload && typeof r.payload === 'object') {
      out.push(JSON.stringify({ ...r, payload: { ...r.payload, id: newId } }))
    } else if (r && !r.type && (r.instructions !== undefined || r.id)) {
      out.push(JSON.stringify({ ...r, id: newId })) // legacy bare header
    } else {
      out.push(lines[i])
    }
  }
  return out
}
