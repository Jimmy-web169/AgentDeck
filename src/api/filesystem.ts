import { useQuery } from '@tanstack/react-query'
import { queryKeys } from './queryPolicy.ts'
import { request } from './fetcher.ts'
import { useProjects, providerQueryOptions, QueryActivityContext } from './queries.ts'
import { useContext } from 'react'
import { useQueries } from '@tanstack/react-query'

interface Directory {
  path: string
  parent: string | null
  home: string
  dirs: { path: string; name: string }[]
}
export function useBrowse(provider: string, path: string | undefined) {
  return useQuery({
    queryKey: queryKeys.browse(provider, path || ''),
    enabled: !!provider,
    queryFn: ({ signal }) => request<Directory>(`/api/${provider}/browse`, { signal, params: path ? { path } : {} }),
  })
}

// The repair picker reads the same project/session inventories as the sidebar.
// Exact cwd matching remains conservative; it never guesses another project.
export function useRepairCandidates(provider: string, root: string, cwd: string) {
  const visible = useContext(QueryActivityContext)
  const projects = useProjects(provider, root, { enabled: !!cwd })
  const matches = (projects.data?.projects || []).filter((project) => project.cwd === cwd)
  const groups = useQueries({
    queries: matches.map((project) => providerQueryOptions('sessions', { provider, root, slug: project.slug }, { enabled: visible && !!cwd })),
  })
  const rows = groups.flatMap((group, index) =>
    (group.data?.sessions || [])
      .filter((session) => !session.isSubagent && (!session.cwd || session.cwd === cwd))
      .map((session) => ({ ...session, slug: matches[index].slug }))
  )
  return {
    data: [...new Map(rows.map((session) => [session.id, session])).values()],
    isPending: projects.isPending || groups.some((group) => group.isPending),
    error: projects.error || groups.find((group) => group.error)?.error,
  }
}
