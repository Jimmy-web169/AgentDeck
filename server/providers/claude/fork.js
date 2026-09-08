// Pure fork/truncation logic for Claude session transcripts (unit-testable;
// api.js owns the fs/roots side). A fork keeps every line strictly BEFORE the
// record whose uuid is `cut` (a user prompt) and rewrites sessionId so
// `claude --resume <newId>` picks the copy up. No `cut` = full copy.

/** @returns {string[]} kept lines · @throws {Error} e.code='CUT_NOT_FOUND' | 'EMPTY_FORK' */
export function forkLines(lines, cut, newId) {
  const kept = [] // { type, line }
  let found = !cut
  for (const line of lines) {
    if (!line.trim()) continue
    let rec = null
    try {
      rec = JSON.parse(line)
    } catch {
      kept.push({ type: null, line }) // preserve unparsable lines verbatim
      continue
    }
    if (cut && rec.uuid === cut) {
      found = true
      break
    }
    if (typeof rec.sessionId === 'string') rec.sessionId = newId
    kept.push({ type: rec.type || null, line: JSON.stringify(rec) })
  }
  if (!found) {
    const e = new Error('cut point not found in transcript')
    e.code = 'CUT_NOT_FOUND'
    throw e
  }
  // queue metadata immediately preceding the dropped prompt belongs to it
  while (kept.length && kept[kept.length - 1].type === 'queue-operation') kept.pop()
  if (!kept.length) {
    const e = new Error('fork would be empty')
    e.code = 'EMPTY_FORK'
    throw e
  }
  return kept.map((k) => k.line)
}
