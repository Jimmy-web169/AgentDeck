export type ProviderClient = ReturnType<typeof createProviderClient>
import { createContext, useContext } from 'react'
import { createProviderClient } from './endpoints.ts'
import { PROVIDER_METADATA, providerMetadata } from '../providers/metadata.ts'

export function createApi(provider: string) {
  const descriptor = providerMetadata(provider)
  return createProviderClient(provider, descriptor.addressing)
}
export const claudeApi = createApi('claude')
export const codexApi = createApi('codex')
export const antigravityApi = createApi('antigravity')
// Which provider's API a component talks to. Components that used to import
// `codexApi` directly read this instead, so the same Conversation / Sub-agents /
// Memory / Terminal / Stats components serve every id-addressed provider
// (Codex, Antigravity, …): the provider's App puts its client here once.
// Without a provider above, Codex stays the default — nothing existing changes.
export const ProviderApiContext = createContext(null as ProviderClient | null)
export const useProviderApi = () => useContext(ProviderApiContext) || codexApi
export const useProviderId = () => useProviderApi().provider || 'codex'

export const providerLabelOf = (id: string) => PROVIDER_METADATA[id]?.label || id || 'Codex'
export const useProviderLabel = () => providerLabelOf(useProviderId())
export const useProviderResume = () => PROVIDER_METADATA[useProviderId()]?.resume || 'codex resume'
