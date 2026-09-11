function record(value: unknown): Record<string, unknown> {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value))
  return value as Record<string, unknown>
}
// Original groups remain named below; test assertions are unchanged.
import test from 'node:test'
import { describe } from 'node:test'
import assert from 'node:assert/strict'
import { decode, deepFind, uriToPath } from '../../../../server/providers/antigravity/sqlite.ts'

describe('antigravity/antigravity/sqlite', async () => {
  // ---- raw protobuf --------------------------------------------------------------------

  // minimal wire-format encoder for the shapes readMeta reads
  const varint = (n: string | number | bigint | boolean) => {
    const out = []
    let v = BigInt(n)
    do {
      let b = Number(v & 0x7fn)
      v >>= 7n
      if (v) b |= 0x80
      out.push(b)
    } while (v)
    return Buffer.from(out)
  }

  const field = (num: number, wire: number, payload: Uint8Array<ArrayBufferLike> | Buffer<ArrayBuffer>) => Buffer.concat([varint((num << 3) | wire), payload])

  const vint = (num: number, n: number) => field(num, 0, varint(n))

  const str = (num: number, s: string) => field(num, 2, Buffer.concat([varint(Buffer.byteLength(s)), Buffer.from(s)]))

  const msg = (num: number, ...parts: (Uint8Array<ArrayBufferLike> | Buffer<ArrayBuffer>)[]) =>
    field(num, 2, Buffer.concat([varint(Buffer.concat(parts).length), ...parts]))

  test('sqlite: the raw decoder reads nested messages, strings and repeated fields; deepFind locates the model id', () => {
    const blob = Buffer.concat([
      vint(1, 4),
      msg(10, msg(1, vint(1, 1318), vint(6, 65536), msg(3, str(28, 'gemini-3.8-flash-high')))),
      str(9, '5ddc18c0-30e4-4ca5-a0d3-7e3c6439c70a'),
      vint(2, 7),
      vint(2, 9),
    ])
    const d = record(decode(blob))
    assert.ok(Array.isArray(d[2]))
    assert.equal(d[1], 4)
    assert.equal(d[9], '5ddc18c0-30e4-4ca5-a0d3-7e3c6439c70a')
    assert.deepEqual([...d[2]], [7, 9], 'repeated scalar → array')
    assert.equal(record(record(d[10])[1])[1], 1318)
    const model = deepFind(d, (k, v) => k === '28' && typeof v === 'string' && /^[a-z][a-z0-9]*-[a-z0-9.-]+$/i.test(v))
    assert.equal(model, 'gemini-3.8-flash-high')
    assert.equal(decode(Buffer.from([0xff, 0xff, 0xff])), null, 'garbage is null, not a throw')
  })

  test('sqlite: token usage sums per step from field 9 of steps.metadata (decoder level)', () => {
    const usage = msg(9, vint(2, 1200), vint(3, 80), vint(5, 900), vint(9, 30))
    const d = record(decode(usage))
    assert.deepEqual(
      { input: record(d[9])[2], output: record(d[9])[3], cacheRead: record(d[9])[5], reasoning: record(d[9])[9] },
      { input: 1200, output: 80, cacheRead: 900, reasoning: 30 }
    )
  })

  test('sqlite: workspace URIs become local paths', () => {
    assert.equal(
      uriToPath('file:///C:/Users/demo/code/orbit-api'),
      'C:\\Users\\demo\\code\\orbit-api',
      'drive-letter URIs decode as Windows paths on every platform'
    )
    if (process.platform !== 'win32') assert.equal(uriToPath('file:///home/demo/code/orbit-api'), '/home/demo/code/orbit-api')
    assert.equal(uriToPath(null), null)
    assert.equal(uriToPath('/already/a/path'), '/already/a/path')
  })
})
