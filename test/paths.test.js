import test from 'node:test'
import assert from 'node:assert/strict'
import { baseName, projectName, shortPath, splitPath } from '../src/lib/paths.js'

test('splitPath handles POSIX, Windows and mixed separators', () => {
  assert.deepEqual(splitPath('/home/me/repo'), ['home', 'me', 'repo'])
  assert.deepEqual(splitPath('C:\\Users\\me\\repo'), ['C:', 'Users', 'me', 'repo'])
  assert.deepEqual(splitPath('C:\\Users\\me/repo\\'), ['C:', 'Users', 'me', 'repo'])
  assert.deepEqual(splitPath(''), [])
  assert.deepEqual(splitPath(null), [])
})

test('shortPath keeps the last two segments on every platform', () => {
  assert.equal(shortPath('/home/me/project/repo'), 'project/repo')
  assert.equal(shortPath('C:\\Users\\me\\Desktop\\WorkSpace\\project\\repo'), 'project/repo')
  assert.equal(shortPath('repo'), 'repo')
  assert.equal(shortPath(''), '(unknown)')
  assert.equal(shortPath('C:\\a\\b\\c', 1), 'c')
})

test('baseName / projectName', () => {
  assert.equal(baseName('C:\\Users\\me\\repo'), 'repo')
  assert.equal(baseName('/x/y/z/'), 'z')
  assert.equal(projectName('C:\\Users\\me\\repo', 'C--Users-me-repo'), 'repo')
  assert.equal(projectName(null, 'C--Users-me-repo'), 'C--Users-me-repo')
  assert.equal(projectName(null, null), '(unknown)')
})
