import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'
import fontUnits from './scripts/postcss-font-units.mjs'

export default {
  plugins: [tailwindcss(), autoprefixer(), fontUnits()],
}
