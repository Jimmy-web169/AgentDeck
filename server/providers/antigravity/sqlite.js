import fs from 'node:fs'
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

let DatabaseSync = null
try {
  ;({ DatabaseSync } = await import('node:sqlite'))
} catch {
  DatabaseSync = null
}
export const sqliteAvailable = () => !!DatabaseSync

// ---- raw protobuf --------------------------------------------------------------

function varint(b, o) {
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
const PRINTABLE = /^[\x09\x0a\x0d\x20-\x7e\u00a0-\uffff]*$/

// Decode a message into { [fieldNumber]: value | [values] }. Length-delimited
// fields are tried as nested messages first and fall back to strings.
export function decode(buf, depth = 0) {
  const out = {}
  let o = 0
  try {
    while (o < buf.length) {
      let [tag, o1] = varint(buf, o)
      o = o1
      const f = Number(tag >> 3n)
      const w = Number(tag & 7n)
      if (f === 0 || f > 2000) return null
      let v
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
        let [l, o2] = varint(buf, o)
        o = o2
        l = Number(l)
        if (o + l > buf.length) return null
        const s = buf.subarray(o, o + l)
        o += l
        const txt = s.toString('utf8')
        const printable = l > 0 && !txt.includes('\ufffd') && PRINTABLE.test(txt)
        const looksLikeText = printable && /^[\x20-\x7e]{4,}$/.test(txt) && (/[{}":/ ]/.test(txt) || /^[0-9a-f-]{36}$/.test(txt))
        let sub = null
        if (l > 1 && depth < 8 && !looksLikeText) sub = decode(s, depth + 1)
        if (sub && Object.keys(sub).length && (!printable || l < 4 || Object.values(sub).some((x) => x && typeof x === 'object'))) v = sub
        else v = printable ? txt : { __bytes: l }
      } else return null
      if (out[f] === undefined) out[f] = v
      else if (Array.isArray(out[f]) && out[f].__arr) out[f].push(v)
      else {
        out[f] = [out[f], v]
        out[f].__arr = true
      }
    }
  } catch {
    return null
  }
  return out
}

const first = (v) => (Array.isArray(v) ? v[0] : v)
const num = (v) => (typeof first(v) === 'number' ? first(v) : 0)
const str = (v) => (typeof first(v) === 'string' ? first(v) : null)
// depth-first search of a decoded message for the first (key, value) the predicate accepts
export function deepFind(d, pred, depth = 0) {
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
export function uriToPath(uri) {
  if (typeof uri !== 'string' || !uri) return null
  try {
    if (!uri.startsWith('file:')) return uri
    return fileURLToPath(uri, { windows: /^file:\/\/\/[A-Za-z]:\//.test(uri) ? true : undefined })
  } catch {
    return uri
  }
}

// ---- opening a live WAL database read-only ----------------------------------------

function openReadOnly(dbPath) {
  try {
    return { db: new DatabaseSync(dbPath, { readOnly: true }), tmp: null }
  } catch {
    // a WAL database whose -shm cannot be created read-only: read a copy instead
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdeck-agy-'))
    for (const ext of ['', '-wal', '-shm']) {
      try {
        fs.copyFileSync(dbPath + ext, path.join(dir, 'c.db' + ext))
      } catch {}
    }
    return { db: new DatabaseSync(path.join(dir, 'c.db'), { readOnly: true }), tmp: dir }
  }
}

const cache = new Map() // dbPath -> { sig, meta }
function sig(dbPath) {
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
export function readMeta(dbPath) {
  if (!DatabaseSync || !fs.existsSync(dbPath)) return null
  const s = sig(dbPath)
  const hit = cache.get(dbPath)
  if (hit && hit.sig === s) return hit.meta
  let opened
  try {
    opened = openReadOnly(dbPath)
  } catch {
    return null
  }
  const { db, tmp } = opened
  const meta = { workspace: null, gitRepo: null, gitRemote: null, branch: null, model: null, tokens: { input: 0, output: 0, cacheRead: 0, reasoning: 0, total: 0 }, plannerSteps: 0 }
  try {
    try {
      for (const r of db.prepare('select data from trajectory_metadata_blob').all()) {
        const d = decode(Buffer.from(r.data || new Uint8Array()))
        const ws = d && d[1] && typeof d[1] === 'object' ? d[1] : null
        const uri = str(ws?.[1]) || str(d?.[7])
        if (uri && !meta.workspace) meta.workspace = uriToPath(uri)
        const git = ws && ws[3] && typeof ws[3] === 'object' ? ws[3] : null
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
            if (m) meta.model = m
          }
        }
      }
    } catch {}
    try {
      for (const r of db.prepare('select metadata from steps').all()) {
        const d = decode(Buffer.from(r.metadata || new Uint8Array()))
        const u = d && d[9] && typeof d[9] === 'object' ? d[9] : null
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
