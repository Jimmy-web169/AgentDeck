import fs from 'node:fs'
// Wire messages may be repeated arrays with numeric fields; retain that shape.
const wireRecord = (value: object): Record<string, unknown> => value as Record<string, unknown>
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// What the transcript does not say, the per-conversation SQLite does:
// conversations/<id>.db (WAL) holds protobuf blobs with the workspace URI,
// git remote and branch (trajectory_metadata_blob), the selected model
// (executor_metadata, field 28) and per-step token usage (steps.metadata,
// field 9). The schemas are unpublished, so this decodes raw protobuf wire
// format and reads fields by number — the numbers below were verified against
// agy 1.1.27's own `usage` output (Σ f2 = input, f3 = output, f5 = cache_read,
// f9 = thinking) and against a trusted interactive session's workspace.
//
// Needs `node:sqlite` (Node ≥ 22.5). Without it every reader returns null and
// the provider degrades to what the JSONL carries (no cwd / model / tokens).

let DatabaseSync: typeof import('node:sqlite').DatabaseSync | null = null
try {
  ;({ DatabaseSync } = await import('node:sqlite'))
} catch {
  DatabaseSync = null
}
export const sqliteAvailable = () => !!DatabaseSync

// ---- raw protobuf --------------------------------------------------------------

function varint(b: Buffer, o: number): [bigint, number] {
  let r = 0n
  let s = 0n
  for (;;) {
    const c = b[o++]
    if (c === undefined) throw new Error('eof')
    r |= BigInt(c & 0x7f) << s
    if (!(c & 0x80)) break
    s += 7n
  }
  return [r, o]
}
// biome-ignore lint/suspicious/noControlCharactersInRegex: The protobuf text heuristic explicitly permits tab, LF and CR bytes.
const PRINTABLE = /^[\x09\x0a\x0d\x20-\x7e\u00a0-\uffff]*$/

// Decode a message into { [fieldNumber]: value | [values] }. Length-delimited
// fields are tried as nested messages first and fall back to strings.
export function decode(buf: Buffer, depth = 0): Record<string, unknown> | null {
  const out: Record<string, unknown> = {}
  let o = 0
  try {
    while (o < buf.length) {
      const [tag, o1] = varint(buf, o)
      o = o1
      const f = Number(tag >> 3n)
      const w = Number(tag & 7n)
      if (f === 0 || f > 2000) return null
      let v: unknown
      if (w === 0) {
        ;[v, o] = varint(buf, o)
        v = Number(v)
      } else if (w === 1) {
        v = Number(buf.readBigUInt64LE(o))
        o += 8
      } else if (w === 5) {
        v = buf.readUInt32LE(o)
        o += 4
      } else if (w === 2) {
        const [length, o2] = varint(buf, o)
        o = o2
        const l = Number(length)
        if (o + l > buf.length) return null
        const s = buf.subarray(o, o + l)
        o += l
        const txt = s.toString('utf8')
        const printable = l > 0 && !txt.includes('\ufffd') && PRINTABLE.test(txt)
        const looksLikeText = printable && /^[\x20-\x7e]{4,}$/.test(txt) && (/[{}":/ ]/.test(txt) || /^[0-9a-f-]{36}$/.test(txt))
        let sub: Record<string, unknown> | null = null
        if (l > 1 && depth < 8 && !looksLikeText) sub = decode(s, depth + 1)
        if (sub && Object.keys(sub).length && (!printable || l < 4 || Object.values(sub).some((x) => x && typeof x === 'object'))) v = sub
        else v = printable ? txt : { __bytes: l }
      } else return null
      if (out[f] === undefined) out[f] = v
      else {
        const previous = out[f]
        if (Array.isArray(previous) && '__arr' in previous && previous.__arr) previous.push(v)
        else out[f] = Object.assign([previous, v], { __arr: true })
      }
    }
  } catch {
    return null
  }
  return out
}

const first = (v: unknown): unknown => (Array.isArray(v) ? v[0] : v)
const num = (v: unknown): number => {
  const value = first(v)
  return typeof value === 'number' ? value : 0
}
const str = (v: unknown): string | null => {
  const value = first(v)
  return typeof value === 'string' ? value : null
}
// depth-first search of a decoded message for the first (key, value) the predicate accepts
export function deepFind(d: unknown, pred: (key: string, value: unknown) => boolean, depth = 0): unknown {
  if (!d || typeof d !== 'object' || depth > 12) return null
  for (const [k, v] of Object.entries(d)) {
    for (const x of Array.isArray(v) ? v : [v]) {
      if (pred(k, x)) return x
      if (x && typeof x === 'object') {
        const r = deepFind(x, pred, depth + 1)
        if (r != null) return r
      }
    }
  }
  return null
}

// file:///C:/x/y or file://wsl.localhost/Ubuntu/home/me → a local path, else the URI itself.
// A drive-letter URI is a Windows path whatever this process runs on (homes get copied
// between machines), so it is decoded as one instead of becoming "/C:/x/y" on posix.
export function uriToPath(uri: unknown): string | null {
  if (typeof uri !== 'string' || !uri) return null
  try {
    if (!uri.startsWith('file:')) return uri
    return fileURLToPath(uri, { windows: /^file:\/\/\/[A-Za-z]:\//.test(uri) ? true : undefined })
  } catch {
    return uri
  }
}

// ---- opening a live WAL database read-only ----------------------------------------

function openReadOnly(dbPath: string) {
  const Database = DatabaseSync
  if (!Database) throw Error('SQLite is unavailable')
  try {
    return { db: new Database(dbPath, { readOnly: true }), tmp: null }
  } catch {
    // a WAL database whose -shm cannot be created read-only: read a copy instead
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdeck-agy-'))
    for (const ext of ['', '-wal', '-shm']) {
      try {
        fs.copyFileSync(dbPath + ext, path.join(dir, 'c.db' + ext))
      } catch {}
    }
    return { db: new Database(path.join(dir, 'c.db'), { readOnly: true }), tmp: dir }
  }
}

export interface ConversationMeta {
  workspace: string | null
  gitRepo: string | null
  gitRemote: string | null
  branch: string | null
  model: string | null
  tokens: { input: number; output: number; cacheRead: number; reasoning: number; total: number }
  plannerSteps: number
}
function blob(value: unknown): Buffer {
  if (!value) return Buffer.alloc(0)
  if (typeof value === 'string' || value instanceof Uint8Array) return Buffer.from(value)
  throw new TypeError('SQLite blob must contain bytes or text')
}
const cache = new Map<string, { sig: string; meta: ConversationMeta }>() // dbPath -> { sig, meta }
function sig(dbPath: string) {
  let s = ''
  for (const ext of ['', '-wal']) {
    try {
      const st = fs.statSync(dbPath + ext)
      s += `${st.size}:${st.mtimeMs};`
    } catch {
      s += '-;'
    }
  }
  return s
}

// { workspace, gitRepo, gitRemote, branch, model, tokens{input,output,cacheRead,reasoning,total}, plannerSteps } | null
export function readMeta(dbPath: string): ConversationMeta | null {
  if (!DatabaseSync || !fs.existsSync(dbPath)) return null
  const s = sig(dbPath)
  const hit = cache.get(dbPath)
  if (hit && hit.sig === s) return hit.meta
  let opened: ReturnType<typeof openReadOnly>
  try {
    opened = openReadOnly(dbPath)
  } catch {
    return null
  }
  const { db, tmp } = opened
  const meta: ConversationMeta = {
    workspace: null,
    gitRepo: null,
    gitRemote: null,
    branch: null,
    model: null,
    tokens: { input: 0, output: 0, cacheRead: 0, reasoning: 0, total: 0 },
    plannerSteps: 0,
  }
  try {
    try {
      for (const r of db.prepare('select data from trajectory_metadata_blob').all()) {
        const d = decode(blob(r.data))
        const ws = d?.[1] && typeof d[1] === 'object' ? wireRecord(d[1]) : null
        const uri = str(ws?.[1]) || str(d?.[7])
        if (uri && !meta.workspace) meta.workspace = uriToPath(uri)
        const git = ws?.[3] && typeof ws[3] === 'object' ? wireRecord(ws[3]) : null
        if (git) {
          meta.gitRepo = str(git[1])
          meta.gitRemote = str(git[2])
        }
        if (ws) meta.branch = str(ws[4])
      }
    } catch {}
    try {
      // the model id ("gemini-3.8-flash-high") sits under field 28 somewhere
      // inside the executor blob; the exact nesting has moved between versions
      for (const r of db.prepare('select * from executor_metadata').all()) {
        for (const v of Object.values(r)) {
          if (v instanceof Uint8Array || Buffer.isBuffer(v)) {
            const m = deepFind(decode(Buffer.from(v)), (k, x) => k === '28' && typeof x === 'string' && /^[a-z][a-z0-9]*-[a-z0-9.-]+$/i.test(x))
            if (typeof m === 'string' && m) meta.model = m
          }
        }
      }
    } catch {}
    try {
      for (const r of db.prepare('select metadata from steps').all()) {
        const d = decode(blob(r.metadata))
        const u = d?.[9] && typeof d[9] === 'object' ? wireRecord(d[9]) : null
        if (!u) continue
        meta.plannerSteps++
        meta.tokens.input += num(u[2])
        meta.tokens.output += num(u[3])
        meta.tokens.cacheRead += num(u[5])
        meta.tokens.reasoning += num(u[9])
      }
    } catch {}
    meta.tokens.total = meta.tokens.input + meta.tokens.output // agy's own total_tokens = input + output
  } finally {
    try {
      db.close()
    } catch {}
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true })
  }
  cache.set(dbPath, { sig: s, meta })
  return meta
}
