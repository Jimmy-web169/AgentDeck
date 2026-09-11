import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { assertSizeUnder } from './transcriptGuard.ts'

type Transform = (lines: string[], id: string) => string[]
const failure = (status: number, message: string) => Object.assign(new Error(message), { status })
const inside = (root: string, file: string) => {
  const relative = path.relative(root, file)
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw failure(403, 'Path escapes root')
}

// Publish a complete fork without overwriting either the source or another
// session. The destination basename comes from the provider, never the request.
export function writeFork(root: string, source: string, name: (id: string) => string, transform: Transform) {
  const realRoot = fs.realpathSync(root),
    realSource = fs.realpathSync(source)
  inside(realRoot, realSource)
  const directory = path.dirname(realSource),
    id = crypto.randomUUID(),
    basename = name(id)
  if (path.basename(basename) !== basename) throw failure(400, 'Invalid fork filename')
  const destination = path.join(directory, basename)
  const sourceFd = fs.openSync(realSource, 'r')
  let bytes: Buffer
  try {
    const before = fs.fstatSync(sourceFd)
    if (!before.isFile()) throw failure(400, 'Transcript is not a regular file')
    assertSizeUnder(before.size)
    bytes = Buffer.alloc(before.size)
    let offset = 0
    while (offset < bytes.length) {
      const count = fs.readSync(sourceFd, bytes, offset, bytes.length - offset, offset)
      if (!count) throw failure(409, 'Transcript changed while forking; retry')
      offset += count
    }
    const after = fs.fstatSync(sourceFd)
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw failure(409, 'Transcript changed while forking; retry')
  } finally {
    fs.closeSync(sourceFd)
  }
  const content = transform(bytes.toString('utf8').split(/\r?\n/), id).join('\n') + '\n'
  // A temporary file has no .jsonl suffix and is never indexed as a session.
  const temporary = path.join(directory, `.agentdeck-fork-${id}.tmp`)
  let staged = false
  try {
    const fd = fs.openSync(temporary, 'wx', 0o600)
    staged = true
    try {
      fs.writeFileSync(fd, content)
      fs.fsyncSync(fd)
    } finally {
      fs.closeSync(fd)
    }
    // link, unlike rename, refuses an existing destination on every platform.
    fs.linkSync(temporary, destination)
  } finally {
    // Once the destination exists the operation succeeded. A cleanup failure
    // must not invite the client to retry and create a second fork.
    if (staged)
      try {
        fs.unlinkSync(temporary)
      } catch (error) {
        console.warn('[fork] could not remove staging link', error instanceof Error ? error.message : String(error))
      }
  }
  return { id, file: destination }
}
