import type { HomePageProps } from '../../providers/views.ts'
import { claudeApi as api, useStats, useHistory, usePlugins } from '../../api/index.ts'
import Stats from '../shared/Stats.tsx'
import HistoryView from '../shared/HistoryView.tsx'
import PluginsView from './PluginsView.tsx'
import Resources from './Resources.tsx'

// Home pages for the Claude provider (folder-scoped: stats, history, plugins,
// resources). Each page takes { root, focus, onOpen } — onOpen(target)
// asks the shell to open a session { root, slug, id, title } in the current tab.

const Err = ({ msg }: { msg: string }) => <div className="m-4 text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded p-3">{msg}</div>

export function StatsPage({ root, focus, onOpen, initialProject, breadcrumbPrefix, embedded }: HomePageProps) {
  const { data: stats, error } = useStats(api.provider, root)
  if (error) return <Err msg={error.message} />
  return (
    <Stats
      apiClient={api}
      providerLabel="Claude Code"
      stats={stats}
      root={root}
      focus={focus}
      initialProject={initialProject}
      breadcrumbPrefix={breadcrumbPrefix}
      embedded={embedded}
      onOpenSession={(slug, s) => onOpen?.({ root, slug, id: s.id, title: s.title })}
    />
  )
}

export function HistoryPage({ root }: HomePageProps) {
  const { data, error } = useHistory(api.provider, root)
  if (error) return <Err msg={error.message} />
  return <HistoryView data={data} />
}

export function PluginsPage({ root }: HomePageProps) {
  const { data, error } = usePlugins(api.provider, root)
  if (error) return <Err msg={error.message} />
  return <PluginsView data={data} />
}

export function ResourcesPage({ root }: HomePageProps) {
  return <Resources key={`res-${root}`} root={root} />
}

export const HOME_PAGES = {
  stats: StatsPage,
  history: HistoryPage,
  plugins: PluginsPage,
  resources: ResourcesPage,
}
