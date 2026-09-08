import test from 'node:test'
import assert from 'node:assert/strict'
import { fuzzyMatch, highlightChunks, matchFields } from '../src/lib/fuzzy.js'

test('fuzzyMatch: contiguous beats subsequence, word-start beats mid-word', () => {
  const contiguous = fuzzyMatch('deck', 'AgentDeck')
  const scattered = fuzzyMatch('deck', 'd-e-c-k')
  assert.ok(contiguous && scattered)
  assert.ok(contiguous.score > scattered.score)
  assert.deepEqual(contiguous.indices, [5, 6, 7, 8])
  // prefers the occurrence that starts a word
  const m = fuzzyMatch('deck', 'sundeck/deck-tools')
  assert.equal(m.indices[0], 8)
})

test('fuzzyMatch: no match / empty query', () => {
  assert.equal(fuzzyMatch('xyz', 'AgentDeck'), null)
  assert.deepEqual(fuzzyMatch('', 'anything'), { score: 0, indices: [] })
  assert.equal(fuzzyMatch('a', ''), null)
})

test('fuzzyMatch: shorter, earlier matches rank higher', () => {
  const a = fuzzyMatch('agent', 'AgentDeck')
  const b = fuzzyMatch('agent', 'C:/Users/me/experiments/agent-deck-experiments')
  assert.ok(a.score > b.score)
})

test('matchFields: every token must hit some field', () => {
  const fields = { project: 'AgentDeck', title: 'fix oversized transcripts' }
  const ok = matchFields('agent fix', fields)
  assert.ok(ok)
  assert.deepEqual(Object.keys(ok.hits).sort(), ['project', 'title'])
  assert.equal(matchFields('agent nope', fields), null)
  assert.deepEqual(matchFields('  ', fields), { score: 0, hits: {} })
})

test('highlightChunks splits text into hit / miss runs', () => {
  assert.deepEqual(highlightChunks('AgentDeck', [5, 6, 7, 8]), [
    { text: 'Agent', hit: false },
    { text: 'Deck', hit: true },
  ])
  assert.deepEqual(highlightChunks('abc', []), [{ text: 'abc', hit: false }])
})
