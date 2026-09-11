export type ProviderMetadata = { id: string; label: string; apiAddr: 'id' | 'slug+id'; addressing: import('./addressing.ts').Addressing; resume?: string }
import { idAddressing, slugAddressing } from './addressing.ts'

// Pure provider catalog. Descriptors spread these same objects;
// API clients can validate IDs without importing any React view or App factory.

export const PROVIDER_METADATA: Record<string, ProviderMetadata> = {
  claude: { id: 'claude', label: 'Claude Code', apiAddr: 'slug+id', addressing: slugAddressing },
  codex: { id: 'codex', label: 'Codex', apiAddr: 'id', addressing: idAddressing, resume: 'codex resume' },
  antigravity: { id: 'antigravity', label: 'Antigravity', apiAddr: 'id', addressing: idAddressing, resume: 'agy --conversation' },
}

export function providerMetadata(provider: string) {
  if (!Object.hasOwn(PROVIDER_METADATA, provider)) throw new Error(`unsupported provider: ${provider}`)
  return PROVIDER_METADATA[provider]
}
