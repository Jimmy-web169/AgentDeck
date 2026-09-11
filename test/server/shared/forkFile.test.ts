import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { writeFork } from '../../../server/shared/forkFile.ts'
import { temporaryDirectory } from '../../helpers/tmpConfigDir.ts'

test('fork publication preserves the source, publishes complete private bytes, and refuses overwrite', () => {
  const root = temporaryDirectory('fork-file-')
  const source = path.join(root, 'source.jsonl')
  fs.writeFileSync(source, 'first\nsecond\n')
  const fork = writeFork(
    root,
    source,
    () => 'fork.jsonl',
    (lines, id) => [id, lines[0]]
  )
  assert.equal(fs.readFileSync(source, 'utf8'), 'first\nsecond\n')
  assert.equal(fs.readFileSync(fork.file, 'utf8'), `${fork.id}\nfirst\n`)
  if (process.platform !== 'win32') assert.equal(fs.statSync(fork.file).mode & 0o777, 0o600)
  assert.throws(
    () =>
      writeFork(
        root,
        source,
        () => 'fork.jsonl',
        () => ['replacement']
      ),
    { code: 'EEXIST' }
  )
  assert.equal(fs.readFileSync(fork.file, 'utf8'), `${fork.id}\nfirst\n`)
  assert.deepEqual(fs.readdirSync(root).sort(), ['fork.jsonl', 'source.jsonl'])
})

test('fork rejects escapes and failed transforms without publishing a transcript', () => {
  const base = temporaryDirectory('fork-boundary-')
  const root = path.join(base, 'root')
  fs.mkdirSync(root)
  const outside = path.join(base, 'source.jsonl'),
    source = path.join(root, 'source.jsonl')
  fs.writeFileSync(outside, 'external')
  fs.writeFileSync(source, 'original')
  assert.throws(
    () =>
      writeFork(
        root,
        outside,
        () => 'fork.jsonl',
        (lines) => lines
      ),
    { status: 403 }
  )
  assert.throws(
    () =>
      writeFork(
        root,
        source,
        () => '../escape.jsonl',
        (lines) => lines
      ),
    { status: 400 }
  )
  assert.throws(
    () =>
      writeFork(
        root,
        source,
        () => 'fork.jsonl',
        () => {
          throw new Error('invalid cut')
        }
      ),
    /invalid cut/
  )
  assert.deepEqual(fs.readdirSync(root), ['source.jsonl'])
})
