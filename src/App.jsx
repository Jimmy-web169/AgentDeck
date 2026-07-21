import { useState, useEffect } from 'react'
import Dashboard from './components/shared/Dashboard.jsx'
import { PROVIDER_LIST } from './providers/index.js'

// Shell: renders every provider's app (from the provider registry — no provider
// is hardcoded here), kept mounted at all times. Switching toggles CSS
// visibility (display:none) instead of remounting, so each app's live-chat store
// + WebSockets survive while hidden and switching is instant. The inactive app
// receives active={false} and runs no auto-fetches. A Dashboard layer overlays
// the apps when view==='dashboard'; apps stay mounted (active goes false).
//
// Adding a provider = add `src/providers/<id>.jsx` (with its `App` + `accent`)
// and one line in `src/providers/index.js`. This shell needs no change.
export default function App() {
  const [provider, setProv] = useState(() => localStorage.getItem('agentdeck_provider') || PROVIDER_LIST[0]?.id)
  const [view, setView] = useState(null) // null | 'dashboard'
  const [pendingOpen, setPendingOpen] = useState(null) // null | { provider, root, slug, id?, kind?, engine? }
  useEffect(() => localStorage.setItem('agentdeck_provider', provider), [provider])
  // Open a session anywhere (Dashboard card, unified Live panel): switch to its
  // provider, leave the dashboard, and hand the target to that app to consume
  // (it switches root/project/session, and engine + reconnect when given).
  const openSession = (providerId, target) => {
    setProv(providerId)
    setView(null)
    setPendingOpen({ provider: providerId, ...target })
  }

  return (
    <div className="h-full relative">
      {PROVIDER_LIST.map((p) => {
        const ProviderApp = p.App
        const shown = view !== 'dashboard' && provider === p.id
        return (
          <div key={p.id} className="absolute inset-0" style={{ display: shown ? 'block' : 'none' }}>
            <ProviderApp
              active={shown}
              provider={provider}
              onProvider={setProv}
              providers={PROVIDER_LIST}
              onLogo={() => setView('dashboard')}
              onOpenSession={openSession}
              pendingOpen={pendingOpen?.provider === p.id ? pendingOpen : null}
              onConsumedPending={() => setPendingOpen(null)}
            />
          </div>
        )
      })}
      <div className="absolute inset-0" style={{ display: view === 'dashboard' ? 'block' : 'none' }}>
        <Dashboard
          providers={PROVIDER_LIST}
          visible={view === 'dashboard'}
          onClose={() => setView(null)}
          onOpen={openSession}
        />
      </div>
    </div>
  )
}
