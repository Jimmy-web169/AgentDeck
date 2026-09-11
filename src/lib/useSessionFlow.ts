import { useEffect } from 'react'
import { useSessionNav, type SessionNavOptions } from './useSessionNav.ts'
import { useSessionData } from '../api/index.ts'
import { useSessionPane } from './useSessionPane.ts'
import { useConnectionStatus } from '../store/index.ts'
import { projectName } from './paths.ts'

interface Options extends SessionNavOptions {
  nestedSubagents?: boolean
  liveProvider?: string
}
// SessionApp's composition boundary. Navigation holds intent,
// Query holds server data, and pane memory holds only reader scroll position.
export function useSessionFlow(options: Options) {
  const nav = useSessionNav(options)
  const { selection, enrich } = nav
  const listed = nav.sessions.data?.sessions.find((item) => item.id === selection.id)
  const oversized = listed?.oversized === true
  const data = useSessionData({
    provider: options.provider,
    root: selection.root || '',
    slug: selection.slug,
    id: selection.id,
    view: selection.view,
    active: options.active,
    oversized,
    nestedSubagents: options.nestedSubagents,
    liveProvider: options.liveProvider,
  })
  const title = data.selected?.title
  const project = data.projects.data?.projects.find((item) => item.slug === data.ref.slug)
  const cwd = typeof data.selected?.cwd === 'string' ? data.selected.cwd : project?.cwd || null
  const name = data.ref.slug || cwd ? projectName(cwd, data.ref.slug) : null
  const rootLabel = nav.roots.data?.roots.find((item) => item.id === selection.root)?.label
  useEffect(() => {
    if (!options.active || !selection.id || !data.session.isSuccess) return
    enrich({ root: selection.root, id: selection.id, slug: data.ref.slug, title, cwd, project: name, rootLabel })
  }, [options.active, selection.root, selection.id, data.session.isSuccess, data.ref.slug, title, cwd, name, rootLabel, enrich])
  const pane = useSessionPane({ provider: options.provider, root: selection.root, id: selection.id, view: selection.view, data: data.session.data })
  const connection = useConnectionStatus(options.provider)
  const error = nav.error || data.session.error?.message || data.sessions.error?.message || nav.roots.error?.message || null
  return { nav, data, pane, connection, oversized, error }
}
