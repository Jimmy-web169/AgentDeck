import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

// Read-only access to Codex's memory store (sqlite) and installed plugins
// (filesystem + config.toml). We never write. Memory lives in a sqlite DB so we
// shell out to the `sqlite3` CLI in read-only mode (no node sqlite dependency).

function readText(f) {
  try {
    return fs.readFileSync(f, 'utf8')
  } catch {
    return null
  }
}

let sqliteBin
function findSqlite() {
  if (sqliteBin !== undefined) return sqliteBin
  const cands = ['sqlite3', '/home/linuxbrew/.linuxbrew/bin/sqlite3', '/usr/bin/sqlite3', '/usr/local/bin/sqlite3', '/opt/homebrew/bin/sqlite3']
  for (const c of cands) {
    try {
      execFileSync(c, ['--version'], { stdio: 'ignore', timeout: 3000 })
      sqliteBin = c
      return c
    } catch {}
  }
  sqliteBin = null
  return null
}

// Run a read-only query and parse sqlite3's -json output. null = couldn't read.
function sqliteJson(dbFile, sql) {
  const bin = findSqlite()
  if (!bin || !fs.existsSync(dbFile)) return null
  try {
    const out = execFileSync(bin, ['-readonly', '-json', dbFile, sql], { encoding: 'utf8', timeout: 5000, maxBuffer: 32 * 1024 * 1024 })
    return out.trim() ? JSON.parse(out) : []
  } catch {
    return null
  }
}

// Codex memories: per-thread rows in memories_1.sqlite (stage1_outputs), joined
// with state_5.sqlite `threads` for a human-readable title/cwd.
export function readMemories(rootDir) {
  const memDb = path.join(rootDir, 'memories_1.sqlite')
  if (!fs.existsSync(memDb)) return { source: 'none', memories: [] }
  const rows = sqliteJson(
    memDb,
    'SELECT thread_id, raw_memory, rollout_summary, rollout_slug, generated_at, source_updated_at, usage_count, last_usage, selected_for_phase2 FROM stage1_outputs ORDER BY source_updated_at DESC LIMIT 300;',
  )
  if (rows == null) return { source: 'error', memories: [] } // sqlite3 missing or query failed
  if (!rows.length) return { source: 'empty', memories: [] }
  const threads = {}
  for (const t of sqliteJson(path.join(rootDir, 'state_5.sqlite'), 'SELECT id, title, cwd FROM threads;') || []) threads[t.id] = t
  const memories = rows.map((r) => ({
    threadId: r.thread_id,
    title: threads[r.thread_id]?.title || null,
    cwd: threads[r.thread_id]?.cwd || r.rollout_slug || null,
    content: r.raw_memory || '',
    summary: r.rollout_summary || '',
    generatedAt: r.generated_at || null,
    sourceUpdatedAt: r.source_updated_at || null,
    usageCount: r.usage_count || 0,
    selectedForPhase2: !!r.selected_for_phase2,
  }))
  return { source: 'sqlite', memories }
}

// enabled-state for each plugin from config.toml: [plugins."<name>@<marketplace>"] enabled = bool
function pluginEnabledMap(configFile) {
  const txt = readText(configFile)
  const map = {}
  if (!txt) return map
  const re = /\[plugins\."([^"]+)"\]([\s\S]*?)(?=\n\[|$)/g
  let m
  while ((m = re.exec(txt))) {
    const em = /enabled\s*=\s*(true|false)/.exec(m[2])
    map[m[1]] = em ? em[1] === 'true' : true
  }
  return map
}

function listSkillNames(dir) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => e.name)
  } catch {
    return []
  }
}

// Codex plugins: plugins/cache/<marketplace>/<source>/<hash>/.codex-plugin/plugin.json
export function readPlugins(rootDir) {
  const cacheDir = path.join(rootDir, 'plugins', 'cache')
  const enabledMap = pluginEnabledMap(path.join(rootDir, 'config.toml'))
  const installed = []
  const marketplaces = new Set()
  const ls = (d) => {
    try {
      return fs.readdirSync(d, { withFileTypes: true })
    } catch {
      return []
    }
  }
  for (const mk of ls(cacheDir)) {
    if (!mk.isDirectory()) continue
    marketplaces.add(mk.name)
    for (const src of ls(path.join(cacheDir, mk.name))) {
      if (!src.isDirectory()) continue
      for (const hash of ls(path.join(cacheDir, mk.name, src.name))) {
        if (!hash.isDirectory()) continue
        const base = path.join(cacheDir, mk.name, src.name, hash.name)
        const txt = readText(path.join(base, '.codex-plugin', 'plugin.json'))
        if (!txt) continue
        let m
        try {
          m = JSON.parse(txt)
        } catch {
          continue
        }
        const repo = typeof m.repository === 'string' ? m.repository : m.repository?.url || null
        installed.push({
          name: m.name || hash.name,
          version: m.version || null,
          description: m.description || m.interface?.shortDescription || '',
          marketplace: mk.name,
          source: src.name,
          enabled: enabledMap[`${m.name}@${mk.name}`] !== false,
          homepage: m.homepage || null,
          repository: repo,
          license: m.license || null,
          skills: listSkillNames(path.join(base, 'skills')),
          displayName: m.interface?.displayName || m.name || null,
        })
      }
    }
  }
  installed.sort((a, b) => a.name.localeCompare(b.name))
  return { installed, marketplaces: [...marketplaces] }
}
