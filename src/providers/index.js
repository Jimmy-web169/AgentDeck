import claude from './claude.jsx'
import codex from './codex.jsx'
import antigravity from './antigravity.jsx'

// Provider registry (frontend). Add a provider = add its config here.
export const PROVIDERS = { claude, codex, antigravity }
export const PROVIDER_LIST = [claude, codex, antigravity]
