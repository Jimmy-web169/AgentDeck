export interface LayoutRect {
  x: number
  y: number
  width: number
  height: number
}
export interface LayoutViolation {
  rule: string
  selector: string
  actual: Record<string, unknown>
  rect: LayoutRect
  reportOnly: boolean
}
export type LayoutProbe = ReturnType<typeof probeLayout>
// Runs in the page (serialize with toString); no Node or imported dependencies.
export function probeLayout() {
  const violations: LayoutViolation[] = [],
    geometry: ({ selector: string } & LayoutRect)[] = []
  const rect = (r: DOMRect) => ({ x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) })
  const selector = (element: Element) => {
    const parts: string[] = []
    for (let el: Element | null = element; el?.tagName && el !== document.body; el = el.parentElement) {
      const siblings = [...(el.parentElement?.children || [])].filter((s) => s.tagName === el.tagName)
      parts.unshift(`${el.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(el) + 1})`)
    }
    return `body${parts.length ? ` > ${parts.join(' > ')}` : ''}`
  }
  const report = (
    rule: string,
    element: Element,
    actual: {
      scrollWidth?: number
      clientWidth?: number
      scroll?: number
      client?: number
      overflow?: string
      textOverflow?: string
      text?: string
      left?: number
      right?: number
      viewport?: number
      child?: { x: number; y: number; width: number; height: number }
      parent?: { x: number; y: number; width: number; height: number }
      width?: number
      height?: number
      ratio?: number
      foreground?: string
      background?: number[]
      visible?: boolean
    },
    reportOnly = false
  ) => violations.push({ rule, selector: selector(element), actual, rect: rect(element.getBoundingClientRect()), reportOnly })
  const parseColor = (value: string) => {
    const parts = value.match(/[\d.]+/g)?.map(Number)
    return parts && parts.length >= 3 ? [parts[0], parts[1], parts[2], parts[3] ?? 1] : null
  }
  const blend = (front: number[], back: number[]) => front.slice(0, 3).map((v: number, i: number) => v * front[3] + back[i] * (1 - front[3]))
  const background = (element: Element) => {
    const chain: Element[] = []
    for (let el: Element | null = element; el; el = el.parentElement) chain.unshift(el)
    let rgb = [255, 255, 255]
    for (const el of chain) {
      const color = parseColor(getComputedStyle(el).backgroundColor)
      if (color) rgb = blend(color, rgb)
    }
    return rgb
  }
  const luminance = (rgb: number[]) =>
    rgb
      .map((v: number) => v / 255)
      .map((v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
      .reduce((sum: number, v: number, i: number) => sum + v * [0.2126, 0.7152, 0.0722][i], 0)
  const scrollAncestor = (element: Element) => {
    for (let el = element.parentElement; el && el !== document.body; el = el.parentElement) {
      const css = getComputedStyle(el)
      if (/(auto|scroll)/.test(`${css.overflowX} ${css.overflowY}`)) return el
    }
    return null
  }
  if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
    report('page-overflow', document.body, { scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth })
  const visible = [...document.body.querySelectorAll('*')].filter((el) => {
    const css = getComputedStyle(el)
    return el.getClientRects().length && css.visibility !== 'hidden' && Number(css.opacity) !== 0 && !['SCRIPT', 'STYLE', 'SVG', 'PATH'].includes(el.tagName)
  })
  for (const element of visible) {
    const box = element.getBoundingClientRect(),
      css = getComputedStyle(element)
    const text = [...element.childNodes]
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent)
      .join('')
      .trim()
    const inViewport = box.bottom > 0 && box.top < innerHeight && box.right >= 0 && box.left < innerWidth
    if (!inViewport && scrollAncestor(element)) continue
    geometry.push({ selector: selector(element), ...rect(box) })
    if (
      text &&
      element.clientWidth > 0 &&
      element.scrollWidth > element.clientWidth + 1 &&
      ['visible', 'hidden', 'clip'].includes(css.overflowX) &&
      css.textOverflow !== 'ellipsis' &&
      css.display !== 'inline'
    ) {
      report('horizontal-clipping', element, { scroll: element.scrollWidth, client: element.clientWidth, overflow: css.overflowX })
      if (css.overflowX === 'hidden') report('truncation-without-ellipsis', element, { textOverflow: css.textOverflow }, true)
    }
    if (text && element.clientHeight > 0 && element.scrollHeight > element.clientHeight + 1 && css.overflowY === 'hidden' && css.webkitLineClamp === 'none')
      report('vertical-clipping', element, { scroll: element.scrollHeight, client: element.clientHeight })
    if (text && box.width === 0 && box.height > 0) report('zero-width-text', element, { text: text.slice(0, 80) })
    if ((box.right > innerWidth + 1 || box.left < -1) && !scrollAncestor(element))
      report('off-viewport', element, { left: box.left, right: box.right, viewport: innerWidth })
    const parent = element.parentElement
    if (parent && css.position !== 'absolute' && css.position !== 'fixed') {
      const parentCss = getComputedStyle(parent),
        p = parent.getBoundingClientRect()
      if (parentCss.overflowX === 'visible' && (box.right > p.right + 1 || box.left < p.left - 1))
        report('escaping-parent', element, { child: rect(box), parent: rect(p) })
      const previous = element.previousElementSibling
      if (previous && ['flex', 'grid'].includes(parentCss.display) && !['absolute', 'fixed'].includes(getComputedStyle(previous).position)) {
        const other = previous.getBoundingClientRect()
        const overlap = {
          width: Math.min(box.right, other.right) - Math.max(box.left, other.left),
          height: Math.min(box.bottom, other.bottom) - Math.max(box.top, other.top),
        }
        if (overlap.width > 1 && overlap.height > 1) report('sibling-overlap', element, overlap, true)
      }
    }
    if (text && inViewport) {
      const fg = parseColor(css.color),
        bg = background(element)
      if (fg) {
        const a = luminance(blend(fg, bg)),
          b = luminance(bg),
          contrast = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
        if (contrast < 4.5) report('text-contrast', element, { ratio: Math.round(contrast * 100) / 100, foreground: css.color, background: bg })
      }
    }
  }
  const hints = [...document.querySelectorAll('kbd, button[title*="shortcut" i]')]
  if (
    !hints.some((el) => {
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.top >= 0 && r.bottom <= innerHeight && getComputedStyle(el).visibility !== 'hidden'
    })
  )
    report('keyboard-hints', document.body, { visible: false })
  return { width: innerWidth, height: innerHeight, geometry, violations, text: document.body.innerText.replace(/[\t ]+/g, ' ').trim() }
}
