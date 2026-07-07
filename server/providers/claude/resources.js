import fs from 'node:fs'
import path from 'node:path'
import { safeTrash } from '../../shared/trash.js'
import { assertInside } from './paths.js'

function err(status, message) {
  const e = new Error(message)
  e.status = status
  return e
}

// Whitelisted resource kinds, relative to a base dir (a `.claude` directory —
// either a tracked config root for user scope, or <project-cwd>/.claude for
// project scope). Only these subdirs + extensions are ever written/deleted.
const KINDS = {
  agents: { kind: 'file', exts: ['.md'] },
  commands: { kind: 'file', exts: ['.md'] },
  workflows: { kind: 'file', exts: ['.js', '.md'] },
  rules: { kind: 'file', exts: ['.md'], recurse: true },
  'output-styles': { kind: 'file', exts: ['.md'] },
  skills: { kind: 'dir', file: 'SKILL.md' },
  claudeMd: { kind: 'single' }, // CLAUDE.md (project root or .claude/)
  mcpJson: { kind: 'single' }, // .mcp.json (project root; JSON-validated)
  settingsJson: { kind: 'single' }, // .claude/settings.json (JSON-validated)
  settingsLocalJson: { kind: 'single' }, // .claude/settings.local.json (JSON-validated)
}

// Single files. CLAUDE.md/.mcp.json sit at the project root; settings*.json sit
// INSIDE the .claude dir (= base).
const SINGLE_FILES = {
  claudeMd: { name: 'CLAUDE.md', alsoBase: true },
  mcpJson: { name: '.mcp.json', validate: 'json' },
  settingsJson: { name: 'settings.json', inBase: true, validate: 'json' },
  settingsLocalJson: { name: 'settings.local.json', inBase: true, validate: 'json' },
}
function singleCandidates(kind, base, claudeRoot) {
  const sf = SINGLE_FILES[kind]
  if (sf.inBase) return [path.join(base, sf.name)]
  const root = claudeRoot || base
  const cands = [path.join(root, sf.name)]
  if (sf.alsoBase) cands.push(path.join(base, sf.name))
  return cands
}

// names may contain '/' (nested rules) but never '..', leading '.', or absolute.
function safeName(name) {
  if (!name || name.includes('..') || name.startsWith('/') || name.startsWith('.') || name.startsWith('\\')) {
    throw err(400, `Invalid name: ${name}`)
  }
  return name
}

function checkExt(spec, name) {
  if (spec.kind === 'file' && !spec.exts.some((e) => name.endsWith(e))) {
    throw err(400, `Name must end with ${spec.exts.join(' or ')}`)
  }
}

function readHead(file, n = 400) {
  try {
    return fs.readFileSync(file, 'utf8').slice(0, n)
  } catch {
    return ''
  }
}

function describe(file) {
  const head = readHead(file)
  const fm = head.match(/description:\s*(.+)/i)
  if (fm) return fm[1].trim().replace(/^["']|["']$/g, '').slice(0, 140)
  const h = head.match(/^#+\s*(.+)$/m)
  if (h) return h[1].trim().slice(0, 140)
  return ''
}

function listFiles(dir, exts, recurse, prefix = '') {
  const out = []
  let entries = []
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (recurse) out.push(...listFiles(path.join(dir, e.name), exts, recurse, prefix + e.name + '/'))
    } else if (e.isFile() && exts.some((x) => e.name.endsWith(x))) {
      out.push(prefix + e.name)
    }
  }
  return out
}

/** Inventory of authorable resources under a base .claude dir. */
export function inventory(base, opts = {}) {
  const out = { base, agents: [], commands: [], workflows: [], rules: [], 'output-styles': [], skills: [], settings: null, claudeMd: false, mcpJson: false, settingsJson: false, settingsLocalJson: false, plugins: null }

  for (const k of ['agents', 'commands', 'workflows', 'rules', 'output-styles']) {
    const dir = path.join(base, k)
    out[k] = listFiles(dir, KINDS[k].exts, !!KINDS[k].recurse).map((name) => ({
      name,
      description: describe(path.join(dir, name)),
    }))
    out[k].sort((a, b) => a.name.localeCompare(b.name))
  }

  try {
    const sdir = path.join(base, 'skills')
    for (const name of fs.readdirSync(sdir)) {
      let isDir = false
      try {
        isDir = fs.statSync(path.join(sdir, name)).isDirectory()
      } catch {}
      if (!isDir) continue
      const skillFile = path.join(sdir, name, 'SKILL.md')
      const has = fs.existsSync(skillFile)
      out.skills.push({ name, hasSkillMd: has, description: has ? describe(skillFile) : '' })
    }
  } catch {}
  out.skills.sort((a, b) => a.name.localeCompare(b.name))

  try {
    const s = JSON.parse(fs.readFileSync(path.join(base, 'settings.json'), 'utf8'))
    out.settings = {
      keys: Object.keys(s),
      model: s.model || null,
      theme: s.theme || null,
      hooks: s.hooks ? Object.keys(s.hooks) : [],
      statusLine: s.statusLine?.type || null,
      permissionsAllow: s.permissions?.allow?.length || 0,
    }
  } catch {}

  out.claudeMd = singleCandidates('claudeMd', base, opts.claudeRoot).some((p) => fs.existsSync(p))
  out.mcpJson = singleCandidates('mcpJson', base, opts.claudeRoot).some((p) => fs.existsSync(p))
  out.settingsJson = fs.existsSync(path.join(base, 'settings.json'))
  out.settingsLocalJson = fs.existsSync(path.join(base, 'settings.local.json'))

  try {
    const installed = JSON.parse(fs.readFileSync(path.join(base, 'plugins', 'installed_plugins.json'), 'utf8'))
    // v2 nests plugins under `.plugins`; count those, not the wrapper keys.
    const map = installed?.plugins && typeof installed.plugins === 'object' ? installed.plugins : installed
    out.plugins = { installed: Array.isArray(map) ? map.length : Object.keys(map || {}).length }
  } catch {}

  return out
}

function resolveTarget(base, kind, name, opts = {}) {
  const spec = KINDS[kind]
  if (!spec) throw err(400, `Unknown kind: ${kind}`)

  if (spec.kind === 'single') {
    // CLAUDE.md / .mcp.json sit at project root; settings*.json sit inside base.
    const root = SINGLE_FILES[kind].inBase ? base : opts.claudeRoot || base
    const cands = singleCandidates(kind, base, opts.claudeRoot)
    const file = cands.find((p) => fs.existsSync(p)) || cands[0]
    assertInside(root, file)
    return { spec, file, contentFile: file, validate: SINGLE_FILES[kind].validate || null }
  }

  safeName(name)
  if (spec.kind === 'file') {
    checkExt(spec, name)
    const file = path.join(base, kind, name)
    assertInside(base, file)
    return { spec, file, contentFile: file }
  }
  const dir = path.join(base, kind, name)
  assertInside(base, dir)
  return { spec, dir, contentFile: path.join(dir, spec.file) }
}

export function readResource(base, kind, name, opts) {
  const { contentFile } = resolveTarget(base, kind, name, opts)
  let content = ''
  try {
    content = fs.readFileSync(contentFile, 'utf8')
  } catch {
    throw err(404, 'Resource not found')
  }
  return { kind, name, content }
}

export function writeResource(base, kind, name, content, opts) {
  const t = resolveTarget(base, kind, name, opts)
  if (t.validate === 'json') {
    try {
      JSON.parse(content || '')
    } catch {
      throw err(400, 'Invalid JSON — fix the syntax before saving')
    }
  }
  if (t.spec.kind === 'dir') fs.mkdirSync(t.dir, { recursive: true })
  else fs.mkdirSync(path.dirname(t.contentFile), { recursive: true })
  fs.writeFileSync(t.contentFile, content ?? '')
  return { kind, name, bytes: (content ?? '').length, path: t.contentFile }
}

// Delete = move to the OS recycle bin (macOS Trash / Windows Recycle Bin /
// Linux trash) via `trash` — recoverable, and nothing lands in the repo.
export async function deleteResource(base, kind, name, _stamp, opts) {
  const spec = KINDS[kind]
  if (!spec) throw err(400, `Unknown kind: ${kind}`)
  if (spec.kind === 'single') throw err(400, 'This file cannot be deleted from here')
  const { file, dir } = resolveTarget(base, kind, name, opts)
  const src = spec.kind === 'file' ? file : dir
  if (!fs.existsSync(src)) throw err(404, 'Resource not found')
  await safeTrash(src)
  return { kind, name, trashed: true }
}

export { KINDS }
