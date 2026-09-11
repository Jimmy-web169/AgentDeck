import { useEffect, useState } from 'react'

type View = 'hidden' | 'popped'
interface HeightPolicy {
  key: string
  minimum: number
  maximum: number
  fallback: () => number
}
const VIEW_KEY = 'cm_termView'
function readViews(): Record<string, View> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(VIEW_KEY) || '{}')
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, View] => entry[1] === 'hidden' || entry[1] === 'popped'))
  } catch {
    return {}
  }
}
export const getTermView = (key: string | null) => (key ? readViews()[key] || null : null)
export function setTermView(key: string | null, state: View | null) {
  if (!key) return
  const views = readViews()
  if (state) views[key] = state
  else delete views[key]
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify(views))
  } catch {
    /* Storage can be unavailable in private windows. */
  }
}
export function useTerminalHeight(policy: HeightPolicy) {
  const [height, setHeight] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(policy.key))
      if (saved >= policy.minimum && saved <= policy.maximum) return saved
    } catch {
      /* Use the provider's existing default when storage is unavailable. */
    }
    return policy.fallback()
  })
  useEffect(() => {
    try {
      localStorage.setItem(policy.key, String(height))
    } catch {
      /* Keep the in-memory height. */
    }
  }, [policy.key, height])
  return [height, setHeight] as const
}
