import { useEffect, useState } from 'react'
import { SunIcon, MoonIcon } from './icons.jsx'

const STORAGE_KEY = 'agentdeck_theme'

function getInitialTheme() {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark' // storage disabled (SecurityError) -> default dark
  }
}

// index.html sets documentElement.dataset.theme before first paint (from the
// same key) to avoid a flash; this just keeps it in sync after that. Only an
// explicit click persists to localStorage, so a future prefers-color-scheme
// auto mode can tell "user picked" apart from "default".
export default function ThemeToggle() {
  const [theme, setTheme] = useState(getInitialTheme)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  // keep other tabs in sync when the preference changes anywhere
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key !== STORAGE_KEY) return
      setTheme(e.newValue === 'light' ? 'light' : 'dark')
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const next = theme === 'dark' ? 'light' : 'dark'
  const pick = () => {
    setTheme(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      /* storage disabled -> theme still applies for this tab */
    }
  }

  return (
    <button
      onClick={pick}
      title={`Switch to ${next} theme`}
      className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded bg-ink-700 border border-zinc-700 text-zinc-400 hover:text-zinc-100 text-[11px]"
    >
      {theme === 'dark' ? <MoonIcon className="w-3.5 h-3.5" /> : <SunIcon className="w-3.5 h-3.5" />}
      {theme === 'dark' ? 'Dark' : 'Light'}
    </button>
  )
}
