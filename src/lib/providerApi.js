import { createContext, useContext } from 'react'
import { codexApi } from '../api.js'

// Which provider's API a component talks to. Components that used to import
// `codexApi` directly read this instead, so the same Conversation / Sub-agents /
// Memory / Terminal / Stats components serve every id-addressed provider
// (Codex, Antigravity, …): the provider's App puts its client here once.
// Without a provider above, Codex stays the default — nothing existing changes.
export const ProviderApiContext = createContext(null)
export const useProviderApi = () => useContext(ProviderApiContext) || codexApi
export const useProviderId = () => useProviderApi().provider || 'codex'

// the few words of copy those shared components say about "their" CLI — kept
// here (not in src/providers/) so components never import the registry
const LABEL = { claude: 'Claude Code', codex: 'Codex', antigravity: 'Antigravity' }
const RESUME = { codex: 'codex resume', antigravity: 'agy --conversation' }
export const useProviderLabel = () => LABEL[useProviderId()] || 'Codex'
export const useProviderResume = () => RESUME[useProviderId()] || 'codex resume'
