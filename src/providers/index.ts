import claude from './claude.tsx'
import codex from './codex.tsx'
import antigravity from './antigravity.tsx'

// Provider registry (frontend). Add a provider = add its config here.
export const PROVIDERS = { claude, codex, antigravity }
export const PROVIDER_LIST = [claude, codex, antigravity]
