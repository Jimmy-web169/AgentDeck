import type { ChildProcess } from 'node:child_process'
import type { Root } from '../../shared/types.d.ts'

export interface TerminalMetadata {
  key?: string
  provider?: string
  root?: string
  id?: string | null
  slug?: string | null
  cwd?: string | null
  title?: string | null
  configDir?: string
  launchId?: string | null
  startedAt?: string | number | null
  tmuxName?: string | null
  [field: string]: unknown
}
export interface SavedSession {
  id: string
  slug?: string | null
  cwd?: string | null
  title?: string | null
  [field: string]: unknown
}
export interface TerminalConfig {
  id: string
  title: string
  envKey?: string | null
  checkOrigin?: boolean
  findBin(): string | null
  resumeArgs(id: string): string[]
  promptArgs?(prompt: string): string[]
  prepareLaunch?(input: {
    bin: string | null
    key: string
    cwd?: string | null
    configDir: string
    resumeId?: string | null
    meta: TerminalMetadata
  }): { args?: string[]; env?: NodeJS.ProcessEnv; meta?: TerminalMetadata } | null
  resolveSavedSession?(input: { root: Root; id: string; slug?: string | null }): SavedSession | null
  resolveSession?(input: { meta: TerminalMetadata; files(): string[] }): SavedSession | null
}
export interface TerminalOptions {
  key: string
  cwd?: string | null
  configDir: string
  resumeId?: string | null
  promptArgs?: string[] | null
  meta?: TerminalMetadata
  config: TerminalConfig
  attach?: TerminalMetadata | null
}
export interface TerminalPoolEntry {
  proc: ChildProcess
  port: number
  url: string
  meta: TerminalMetadata
  tmuxName: string | null
}
export interface StartResult extends TerminalMetadata {
  key: string
  url: string
  port: number
  reused: boolean
}
export interface ReattachBody {
  bindSessionId?: string
  terminalKey?: string
  launchId?: string
  id?: string
  slug?: string
  cwd?: string
  legacyDraft?: boolean
}
