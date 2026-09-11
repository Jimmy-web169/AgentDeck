import type { ProviderClient } from '../api/providerApi.ts'
// Conservative scope: never guess another project when cwd is missing or no
// exact project matches. The server validates the selected session again.
export async function repairCandidates(api: Pick<ProviderClient, 'projects' | 'sessions'>, root: string | null | undefined, cwd: string | null | undefined) {
  if (!root || !cwd) return []
  const { projects } = await api.projects({ root })
  const matches = projects.filter((p) => p.cwd === cwd)
  const groups = await Promise.all(
    matches.map(async (p) => {
      const { sessions } = await api.sessions({ root, slug: p.slug })
      return sessions.filter((s) => !s.isSubagent && (!s.cwd || s.cwd === cwd)).map((s) => ({ ...s, slug: p.slug }))
    })
  )
  return [...new Map(groups.flat().map((s) => [s.id, s])).values()]
}
