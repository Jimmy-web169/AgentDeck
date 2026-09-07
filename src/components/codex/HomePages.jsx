import { useEffect, useState } from 'react'
import { codexApi as api } from '../../api.js'
import Stats from './Stats.jsx'
import HistoryView from '../shared/HistoryView.jsx'
import PluginsView from './PluginsView.jsx'
import ResourcesView from './ResourcesView.jsx'

// Home pages for the Codex provider (home-scoped: stats, history, plugins,
// resources). Each page takes { root, focus, onOpen } — onOpen(target)
// asks the shell to open a session { root, id } in the current tab (Codex is
// id-addressed; the app derives the project from the session).

function useFetch(fn, deps) {
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => {
    let cancelled = false
    setData(null)
    setErr(null)
    fn()
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setErr(e.message))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return [data, err]
}

const Err = ({ msg }) => <div className="m-4 text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded p-3">{msg}</div>

export function StatsPage({ root, focus, onOpen }) {
  const [stats, err] = useFetch(() => api.stats(root), [root])
  if (err) return <Err msg={err} />
  return <Stats root={root} stats={stats} focus={focus} onOpenSession={(id) => onOpen({ root, id })} />
}

export function HistoryPage({ root }) {
  const [data, err] = useFetch(() => api.history(root), [root])
  if (err) return <Err msg={err} />
  return <HistoryView data={data} />
}

export function PluginsPage({ root }) {
  return <PluginsView root={root} />
}

export function ResourcesPage({ root }) {
  return <ResourcesView key={`res-${root}`} root={root} scope="user" />
}

export const HOME_PAGES = {
  stats: StatsPage,
  history: HistoryPage,
  plugins: PluginsPage,
  resources: ResourcesPage,
}
