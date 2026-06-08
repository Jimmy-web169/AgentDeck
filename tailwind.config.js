/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // neutral dark palette
        ink: {
          900: '#0d0d0d',
          800: '#171717',
          700: '#212121',
          600: '#2a2a2a',
          500: '#343541',
          400: '#3f3f46',
        },
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
}
