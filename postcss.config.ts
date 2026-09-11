import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'
import fontUnits from './scripts/postcss-font-units.ts'

export default {
  plugins: [tailwindcss(), autoprefixer(), fontUnits()],
}
