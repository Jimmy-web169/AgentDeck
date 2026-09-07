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
//
// `compact` renders an icon-only button (the tab strip); the default is the
// labelled pill.
export default function ThemeToggle({ compact = false, className = '' }) {
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

  if (compact) {
    return (
      <button
        onClick={pick}
        title={`Switch to ${next} theme`}
        className={`w-7 h-7 rounded-md flex items-center justify-center text-zinc-500 hover:text-zinc-100 hover:bg-ink-700 ${className}`}
      >
        {theme === 'dark' ? <MoonIcon className="w-4 h-4" /> : <SunIcon className="w-4 h-4" />}
      </button>
    )
  }

  return (
    <button
      onClick={pick}
      title={`Switch to ${next} theme`}
      className={`flex items-center justify-center gap-1.5 px-3 py-1.5 rounded bg-ink-700 border border-zinc-700 text-zinc-400 hover:text-zinc-100 text-[11px] ${className}`}
    >
      {theme === 'dark' ? <MoonIcon className="w-3.5 h-3.5" /> : <SunIcon className="w-3.5 h-3.5" />}
      {theme === 'dark' ? 'Dark' : 'Light'}
    </button>
  )
}
