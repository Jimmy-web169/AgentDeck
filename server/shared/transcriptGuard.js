import fs from 'node:fs'

// Single source of truth for "how large a transcript are we willing to parse".
// Both providers read whole .jsonl files into memory (readFileSync + one
// JSON.parse per line), so an unbounded file is an OOM risk for the entire
// process. 128 MB is far beyond any real session; it also keeps us safely
// under Node's max string length (~512 MB), which would otherwise surface as
// an opaque ERR_STRING_TOO_LONG. Override via AGENTDECK_MAX_TRANSCRIPT_MB.
const envMb = Number(process.env.AGENTDECK_MAX_TRANSCRIPT_MB)
export const MAX_TRANSCRIPT_BYTES = envMb > 0 ? envMb * 1024 * 1024 : 128 * 1024 * 1024

const OVERSIZE_CODE = 'TRANSCRIPT_TOO_LARGE'

/** Throw a 413 when `size` exceeds `limit`. Pure — testable without big files. */
export function assertSizeUnder(size, label = 'transcript', limit = MAX_TRANSCRIPT_BYTES) {
  if (size <= limit) return
  const e = new Error(`${label} too large to parse (${Math.round(size / 1e6)} MB, limit ${Math.round(limit / 1e6)} MB)`)
  e.status = 413
  e.code = OVERSIZE_CODE
  e.bytes = size
  throw e
}

/**
 * Stat `file` and refuse to proceed if it exceeds the parse cap. Stat failures
 * are deliberately ignored: the caller's own read surfaces ENOENT etc. with
 * its usual handling.
 */
export function guardTranscriptSize(file, label) {
  let size = null
  try {
    size = fs.statSync(file).size
  } catch {
    return
  }
  assertSizeUnder(size, label)
}

export const isOversize = (e) => e?.code === OVERSIZE_CODE

/**
 * Run `fn`; if it fails because a transcript is over the parse cap, return
 * `fallback(err)` instead. Any other error propagates untouched. This is how
 * list/aggregate endpoints stay up when ONE file is oversized: that entry
 * degrades to a stub, every other session stays visible. Opening the oversized
 * session itself still 413s (single-session endpoints don't use this).
 */
export function withOversizeFallback(fn, fallback) {
  try {
    return fn()
  } catch (e) {
    if (isOversize(e)) return fallback(e)
    throw e
  }
}
