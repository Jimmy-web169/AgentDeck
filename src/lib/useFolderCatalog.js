import { useEffect, useState } from 'react'
import { deckApi } from './deckApi.js'

// Use the host's canonical folder identities, not case-folded path guesses.
// Only folder metadata is eager; session lists stay lazy in the nav index.
export default function useFolderCatalog(enabled, projects) {
  const [data, setData] = useState(null), [error, setError] = useState('')
  useEffect(() => {
    if (!enabled) return
    let stale = false, pending = false, again = false, soon
    const refresh = async () => {
      if (pending) { again = true; return }
      pending = true
      try {
        const next = await deckApi('folders?fresh=1')
        if (!stale) { setData(next); setError('') }
      } catch (e) { if (!stale) setError(e.message) }
      finally { pending = false; if (!stale && again) { again = false; refresh() } }
    }
    const changed = () => { clearTimeout(soon); soon = setTimeout(refresh, 1200) }
    refresh()
    const timer = setInterval(refresh, 30000)
    window.addEventListener('agentdeck:files-changed', changed)
    window.addEventListener('focus', changed)
    return () => { stale = true; clearTimeout(soon); clearInterval(timer); window.removeEventListener('agentdeck:files-changed', changed); window.removeEventListener('focus', changed) }
  }, [enabled, projects])
  return { folders: data?.folders || [], errors: data?.errors || [], loading: !data && !error, error }
}
