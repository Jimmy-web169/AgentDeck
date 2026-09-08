import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { composeBrief, writeBrief, seedPrompt } from '../server/shared/handoff.js'

// The AI hand-off never calls a model: it writes a brief into the config dir and
// hands the provider's own terminal a one-line prompt pointing at it.

async function withConfigDir(dir, fn) {
  const prev = process.env.AGENTDECK_CONFIG_DIR
  process.env.AGENTDECK_CONFIG_DIR = dir
  try {
    return await fn()
  } finally {
    if (prev === undefined) delete process.env.AGENTDECK_CONFIG_DIR
    else process.env.AGENTDECK_CONFIG_DIR = prev
  }
}

test('composeBrief: request, where, how to work, docs first, current content fenced', () => {
  const md = composeBrief({ need: 'Run prettier after every Edit.', providerLabel: 'Codex', kind: 'hooks (config.toml)', filePath: '/home/demo/.codex/config.toml', content: '[hooks]\n', docs: 'https://developers.openai.com/codex/hooks', cwd: '/home/demo/code/orbit-api' })
  assert.match(md, /^# AgentDeck hand-off → Codex/)
  assert.match(md, /## What I want\n\nRun prettier after every Edit\./)
  assert.match(md, /- Official docs \(read first\): https:\/\/developers\.openai\.com\/codex\/hooks/)
  assert.match(md, /- Working folder: \/home\/demo\/code\/orbit-api/)
  assert.match(md, /## Current content of \/home\/demo\/\.codex\/config\.toml\n\n```\n\[hooks\]\n\n```/)
  assert.match(md, /Read the docs index and the page for the setting involved/, 'docs-first instruction')
  assert.match(md, /Start by asking, not editing/, 'interview before editing')
  assert.match(md, /look for skills that serve it: use the find-skills skill/, 'find skills for the intent')
})

test('composeBrief: docs index and the provider\x27s building blocks are listed for the interview', () => {
  const md = composeBrief({ need: 'set this project up for me', providerLabel: 'Codex', cwd: '/home/demo/code/orbit-api', docsIndex: 'https://developers.openai.com/codex', kinds: [{ name: 'skills', docs: 'https://developers.openai.com/codex/skills' }, { name: 'MCP servers', docs: null }] })
  assert.match(md, /- Docs index: https:\/\/developers\.openai\.com\/codex/)
  assert.match(md, /## Codex\x27s building blocks \(with their docs\)\n\n- skills — https:\/\/developers\.openai\.com\/codex\/skills\n- MCP servers\n/)
  const bare = composeBrief({ need: 'x', providerLabel: 'Claude Code' })
  assert.ok(!/building blocks \(with/.test(bare), 'no list when the caller passes no kinds')
})

test('composeBrief: an empty request is flagged instead of silently sent; huge content is truncated', () => {
  const md = composeBrief({ need: '  ', providerLabel: 'Claude Code', content: 'x'.repeat(70000) })
  assert.match(md, /no request written/)
  assert.match(md, /… \(truncated\)/)
  assert.ok(md.length < 62000)
})

test('writeBrief stores under <configDir>/handoffs, keeps the newest 40, and the seed prompt names the file', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdeck-handoff-'))
  await withConfigDir(dir, () => {
    const files = []
    for (let i = 0; i < 43; i++) files.push(writeBrief(`brief ${i}\r\n`, { key: `k${i}` }))
    assert.ok(files.every((f) => f.startsWith(path.join(dir, 'handoffs'))))
    assert.equal(fs.readFileSync(files[42], 'utf8'), 'brief 42\n', 'CRLF normalised')
    const left = fs.readdirSync(path.join(dir, 'handoffs')).filter((f) => f.endsWith('.md'))
    assert.ok(left.length <= 40, `${left.length} briefs kept`)
    assert.match(seedPrompt(files[42]), new RegExp(files[42].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  })
})
