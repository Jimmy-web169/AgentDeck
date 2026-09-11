import { handoffNonceInput } from '../../shared/identity.ts'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { stateDirectory } from './state.ts'

// AI hand-off (spec/PROVIDER-SPEC.md §7, research §5): AgentDeck never calls a
// model itself. It writes a brief — what the user wants, which file, its
// current content, the official docs link, how to work — into
// <configDir>/handoffs/<id>.md and opens the provider's own terminal seeded
// with a one-line prompt that points at that file. The CLI reads the brief,
// the docs, and does the work under the user's eyes; AgentDeck edits nothing.
// (The brief goes to a file rather than argv: a config file quoted in full
// would blow past Windows' command-line limit, and tmux would mangle it.)

const dir = () => stateDirectory('handoffs')

export function writeBrief(text: unknown, { key = '' } = {}) {
  fs.mkdirSync(dir(), { recursive: true })
  const id = crypto
    .createHash('sha1')
    .update(handoffNonceInput(key, Date.now(), Math.random()))
    .digest('hex')
    .slice(0, 10)
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
export const seedPrompt = (file: string) =>
  `Read the hand-off brief at ${file} and follow its "How to work" section: read the linked docs first, then interview me about what to set up before editing anything, and explain each field you touch in plain words.`

// Compose the brief. `context` is what the UI knew: provider label, the kind of
// thing being changed, its path, current content, docs URL, working folder.
// `docsIndex` is the provider's docs home; `kinds` [{ name, docs }] the config
// kinds this provider has — the brief lists them so the CLI can interview the
// user about each instead of assuming they know the vocabulary.
export interface BriefContext {
  need?: string | null
  providerLabel: string
  kind?: string | null
  filePath?: string | null
  content?: unknown
  docs?: string | null
  cwd?: string | null
  docsIndex?: string | null
  kinds?: { name: string; docs?: string | null }[] | null
}
export function composeBrief({ need, providerLabel, kind, filePath, content, docs, cwd, docsIndex = null, kinds = null }: BriefContext) {
  const lines = [
    `# AgentDeck hand-off → ${providerLabel}`,
    '',
    '## What I want',
    '',
    String(need || '').trim() || '(no request written — ask me what I want first)',
    '',
    '## Where',
  ]
  if (kind) lines.push(`- Kind: ${kind}`)
  if (filePath) lines.push(`- File: ${filePath}`)
  if (cwd) lines.push(`- Working folder: ${cwd}`)
  if (docs) lines.push(`- Official docs (read first): ${docs}`)
  if (docsIndex) lines.push(`- Docs index: ${docsIndex}`)
  lines.push(
    '',
    '## How to work',
    '',
    '1. Read the docs index and the page for the setting involved before touching anything; field names and their meaning come from there, not from memory.',
    "2. Start by asking, not editing. What I wrote above is an intent, not necessarily a finished config change. Work out which of this CLI's building blocks serve it (see the list below) and, for each one that applies, tell me in one plain sentence what it is and ask whether I want it. One question at a time; skip the kinds that clearly do not apply. I may not know the difference between a command, a rule, an output style, a workflow, a skill, a hook and an MCP server — that is your job to explain.",
    '3. Once you understand the intent, look for skills that serve it: use the find-skills skill in this project (skills/find-skills, also .claude/skills/find-skills) or `npx skills find <query>` with what I am trying to do, and propose the matches — what each would add and whether I want it — before configuring anything by hand.',
    '4. When my answers are in, show the plan — which files, what each will contain — and wait for a yes.',
    '5. Then change only what the plan names, show the diff, and explain every field you added or changed in plain words.'
  )
  if (kinds?.length) {
    lines.push('', `## ${providerLabel}'s building blocks (with their docs)`, '')
    for (const k of kinds) lines.push(`- ${k.name}${k.docs ? ` — ${k.docs}` : ''}`)
  }
  if (content != null && String(content).length) {
    const body = String(content)
    lines.push('', `## Current content of ${filePath || 'the file'}`, '', '```', body.length > 60000 ? body.slice(0, 60000) + '\n… (truncated)' : body, '```')
  }
  return lines.join('\n') + '\n'
}
