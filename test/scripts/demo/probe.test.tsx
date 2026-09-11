// @vitest-environment jsdom
// The repository routes browser-based tests outside test/ui through .tsx.
import { test, expect, vi, afterEach } from 'vitest'
import { probeLayout } from '../../../scripts/demo/probe.ts'
afterEach(() => {
  document.body.innerHTML = ''
  Reflect.deleteProperty(document.body, 'innerText')
  vi.restoreAllMocks()
})

test('display-contents wrappers use the actual ancestor box while genuine escaping children still fail', () => {
  Object.defineProperty(document.body, 'innerText', { configurable: true, get: () => document.body.textContent || '' })
  document.body.innerHTML =
    '<div id="box" style="overflow-x:visible"><div style="display:contents"><div id="child" style="opacity:1">Example</div></div></div><kbd>Alt</kbd>'
  const box = document.getElementById('box'),
    child = document.getElementById('child')
  if (!box || !child) throw Error('Fixture elements missing')
  const rect = (x: number, width: number) => ({
    x,
    y: 20,
    left: x,
    right: x + width,
    top: 20,
    bottom: 60,
    width,
    height: 40,
    toJSON() {
      return {}
    },
  })
  vi.spyOn(box, 'getBoundingClientRect').mockReturnValue(rect(0, 800))
  vi.spyOn(child, 'getClientRects').mockReturnValue({
    0: rect(10, 400),
    length: 1,
    item: () => rect(10, 400),
    [Symbol.iterator]: () => [rect(10, 400)].values(),
  })
  const measure = vi.spyOn(child, 'getBoundingClientRect').mockReturnValue(rect(10, 400))
  expect(probeLayout().violations.filter((item) => item.rule === 'escaping-parent')).toHaveLength(0)
  measure.mockReturnValue(rect(750, 100))
  expect(probeLayout().violations.filter((item) => item.rule === 'escaping-parent')).toHaveLength(1)
})
