import { useEffect, useState } from 'react'
import { SunIcon, MoonIcon } from './icons.jsx'

const STORAGE_KEY = 'agentdeck_theme'

function getInitialTheme() {
  return localStorage.getItem(STORAGE_KEY) === 'light' ? 'light' : 'dark'
}

// index.html sets documentElement.dataset.theme before first paint (from the
// same key) to avoid a flash; this just keeps it in sync after that.
export default function ThemeToggle() {
  const [theme, setTheme] = useState(getInitialTheme)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem(STORAGE_KEY, theme)
  }, [theme])

  const next = theme === 'dark' ? 'light' : 'dark'
  return (
    <button
      onClick={() => setTheme(next)}
      title={`Switch to ${next} theme`}
      className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded bg-ink-700 border border-zinc-700 text-zinc-400 hover:text-zinc-100 text-[11px]"
    >
      {theme === 'dark' ? <MoonIcon className="w-3.5 h-3.5" /> : <SunIcon className="w-3.5 h-3.5" />}
      {theme === 'dark' ? 'Dark' : 'Light'}
    </button>
  )
}
