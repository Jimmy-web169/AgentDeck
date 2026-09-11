import { required } from '../helpers/assert.ts'
import { test } from 'vitest'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

test('first paint restores only supported font sizes and tolerates unavailable storage', () => {
  const script = required(fs.readFileSync('index.html', 'utf8').match(/<script>([\s\S]*?)<\/script>/))[1]
  for (const size of [90, 100, 110, 125, 150, 0, '150', 999]) {
    const root: { dataset: Record<string, string>; style: { fontSize?: string } } = { dataset: {}, style: {} }
    vm.runInNewContext(script, {
      document: { documentElement: root },
      localStorage: { getItem: (key: string) => (key === 'agentdeck_prefs' ? JSON.stringify({ fontSize: size }) : null) },
    })
    assert.equal(root.style.fontSize, [90, 100, 110, 125, 150].includes(Number.isFinite(size) ? Number(size) : NaN) ? `${size}%` : undefined)
  }
  assert.doesNotThrow(() =>
    vm.runInNewContext(script, {
      localStorage: {
        getItem() {
          throw Error('blocked')
        },
      },
    })
  )
})
