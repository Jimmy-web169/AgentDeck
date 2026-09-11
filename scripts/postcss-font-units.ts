// Legacy UI components use explicit px font utilities alongside Tailwind's rem
// defaults. Normalize typography at build time so one root font size scales both.
// Do not convert borders, coordinates, media queries, or other pixel geometry.
export default function fontUnits() {
  return {
    postcssPlugin: 'agentdeck-font-units',
    Declaration(decl: { prop: string; value: string }) {
      if (decl.prop !== 'font-size' && decl.prop !== 'line-height') return
      decl.value = decl.value.replace(/(-?\d*\.?\d+)px\b/g, (_, px) => `${Number(px) / 16}rem`)
    },
  }
}
fontUnits.postcss = true
