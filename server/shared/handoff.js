import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { configDir } from './roots.js'

// AI hand-off (spec/PROVIDER-SPEC.md §7, research §5): AgentDeck never calls a
// model itself. It writes a brief — what the user wants, which file, its
// current content, the official docs link, how to work — into
// <configDir>/handoffs/<id>.md and opens the provider's own terminal seeded
// with a one-line prompt that points at that file. The CLI reads the brief,
// the docs, and does the work under the user's eyes; AgentDeck edits nothing.
// (The brief goes to a file rather than argv: a config file quoted in full
// would blow past Windows' command-line limit, and tmux would mangle it.)

const dir = () => path.join(configDir(), 'handoffs')

export function writeBrief(text, { key = '' } = {}) {
  fs.mkdirSync(dir(), { recursive: true })
  const id = crypto.createHash('sha1').update(`${key}|${Date.now()}|${Math.random()}`).digest('hex').slice(0, 10)
  const file = path.join(dir(), `${id}.md`)
  fs.writeFileSync(file, String(text || '').replace(/\r\n/g, '\n'))
  // keep the folder small: the newest 40 briefs
  try {
    const all = fs
      .readdirSync(dir())
      .filter((f) => f.endsWith('.md'))
      .map((f) => ({ f, t: fs.statSync(path.join(dir(), f)).mtimeMs }))
      .sort((a, b) => b.t - a.t)
    for (const x of all.slice(40)) fs.rmSync(path.join(dir(), x.f), { force: true })
  } catch {}
  return file
}

// the one line the CLI is started with — short, and it tells the agent where to read
export const seedPrompt = (file) => `Read the hand-off brief at ${file} and do exactly what it asks. It links the official documentation for the setting involved — read that first, change only what the brief names, and explain each field you touch in plain words.`

// Compose the brief. `context` is what the UI knew: provider label, the kind of
// thing being changed, its path, current content, docs URL, working folder.
export function composeBrief({ need, providerLabel, kind, filePath, content, docs, cwd }) {
  const lines = [`# AgentDeck hand-off → ${providerLabel}`, '', '## What I want', '', String(need || '').trim() || '(no request written — ask me what I want first)', '', '## Where']
  if (kind) lines.push(`- Kind: ${kind}`)
  if (filePath) lines.push(`- File: ${filePath}`)
  if (cwd) lines.push(`- Working folder: ${cwd}`)
  if (docs) lines.push(`- Official docs (read first): ${docs}`)
  lines.push('', '## How to work', '', '1. Read the docs page above before changing anything; the field names and their meaning come from there, not from memory.', '2. Change only the file named above (or say which file it belongs in, if not this one) and keep the rest untouched.', '3. Show the diff and explain every field you added or changed in plain words — what it does and why it is the right one for the request.', '4. If the request is ambiguous, ask before editing.')
  if (content != null && String(content).length) {
    const body = String(content)
    lines.push('', `## Current content of ${filePath || 'the file'}`, '', '```', body.length > 60000 ? body.slice(0, 60000) + '\n… (truncated)' : body, '```')
  }
  return lines.join('\n') + '\n'
}
