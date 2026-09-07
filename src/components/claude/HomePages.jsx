import { useEffect, useState } from 'react'
import { claudeApi as api } from '../../api.js'
import Stats from '../shared/Stats.jsx'
import HistoryView from '../shared/HistoryView.jsx'
import MemoryView from './MemoryView.jsx'
import PluginsView from './PluginsView.jsx'
import Resources from './Resources.jsx'

// Home pages for the Claude provider (folder-scoped: stats, history, memory,
// plugins, resources). Each page takes { root, focus, onOpen } — onOpen(target)
// asks the shell to open a session { root, slug, id, title } in the current tab.

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
  return <Stats apiClient={api} stats={stats} root={root} focus={focus} onOpenSession={(slug, s) => onOpen({ root, slug, id: s.id, title: s.title })} />
}

export function HistoryPage({ root }) {
  const [data, err] = useFetch(() => api.history(root), [root])
  if (err) return <Err msg={err} />
  return <HistoryView data={data} />
}

export function MemoryPage({ root }) {
  const [projects, err] = useFetch(() => api.projects(root).then((d) => d.projects || []), [root])
  if (err) return <Err msg={err} />
  return <MemoryView root={root} projects={projects || []} />
}

export function PluginsPage({ root }) {
  const [data, err] = useFetch(() => api.plugins(root), [root])
  if (err) return <Err msg={err} />
  return <PluginsView data={data} />
}

export function ResourcesPage({ root }) {
  return <Resources key={`res-${root}`} root={root} />
}

export const HOME_PAGES = {
  stats: StatsPage,
  history: HistoryPage,
  memory: MemoryPage,
  plugins: PluginsPage,
  resources: ResourcesPage,
}
