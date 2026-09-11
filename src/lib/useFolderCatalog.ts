import { useFolderCatalog as useCatalog } from '../api/index.ts'

// Host-owned folder identities share the single Deck Query cache.
export default function useFolderCatalog(enabled: boolean) {
  const { data, error } = useCatalog({ enabled })
  return { folders: data?.folders || [], errors: data?.errors || [], loading: !data && !error, error: error?.message || '' }
}
