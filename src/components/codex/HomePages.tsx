import type { HomePageProps } from '../../providers/views.ts'
import { useProviderApi, useProviderLabel, useStats, useHistory } from '../../api/index.ts'
import Stats from '../shared/Stats.tsx'
import HistoryView from '../shared/HistoryView.tsx'
import PluginsView from './PluginsView.tsx'
import ResourcesView from './ResourcesView.tsx'

// Home pages for the Codex provider (home-scoped: stats, history, plugins,
// resources). Each page takes { root, focus, onOpen } — onOpen(target)
// asks the shell to open a session { root, id } in the current tab (Codex is
// id-addressed; the app derives the project from the session).

const Err = ({ msg }: { msg: string }) => <div className="m-4 text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded p-3">{msg}</div>

export function StatsPage({ root, focus, onOpen, initialProject, breadcrumbPrefix, embedded }: HomePageProps) {
  const api = useProviderApi()
  const label = useProviderLabel()
  const { data: stats, error } = useStats(api.provider, root)
  if (error) return <Err msg={error.message} />
  return (
    <Stats
      apiClient={api}
      providerLabel={label}
      root={root}
      stats={stats}
      focus={focus}
      initialProject={initialProject}
      breadcrumbPrefix={breadcrumbPrefix}
      embedded={embedded}
      onOpenSession={(_slug, s) => onOpen?.({ root, id: s.id, title: s.title })}
    />
  )
}

export function HistoryPage({ root }: HomePageProps) {
  const api = useProviderApi()
  const { data, error } = useHistory(api.provider, root)
  if (error) return <Err msg={error.message} />
  return <HistoryView data={data} />
}

export function PluginsPage({ root }: HomePageProps) {
  return <PluginsView root={root} />
}

export function ResourcesPage({ root }: HomePageProps) {
  return <ResourcesView key={`res-${root}`} root={root} scope="user" />
}

export const HOME_PAGES = {
  stats: StatsPage,
  history: HistoryPage,
  plugins: PluginsPage,
  resources: ResourcesPage,
}
