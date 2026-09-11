import type { Usage } from '../../shared/types.d.ts'
export interface RateWindow {
  used_percent?: number
  used_percentage?: number
  window_minutes?: number
  resets_at?: number
  resets_in_seconds?: number
}
export interface RateLimitsProps {
  usage?: Record<string, RateWindow | undefined> | null
  ts?: string | number | null
}
export interface UsageReport extends Usage {
  rateLimits: Record<string, RateWindow | undefined> | null
}
export interface SubagentsProps {
  data?: SubagentIndex | null
  root?: string | null
  parent?: Partial<SessionDetails> | null
  active?: boolean
  onOpenSession?: (id: string) => void
}
import type { Target as importTarget, Root } from '../../shared/types.d.ts'
import type { ProbeResult } from '../../shared/probe.ts'
export interface RootInfo extends Root {
  probe?: ProbeResult | null
}
// Browser contracts for inventories outside the generated session schemas.
// Keep provider payloads at their API boundary; views share these normalized shapes.
import type { SessionSummary, TimelineEvent } from '../../shared/types.d.ts'
import type { Tokens } from '../lib/format.ts'

export interface SessionDetails extends SessionSummary {
  childCount?: number
  hasSubagents?: boolean
  parentId?: string | null
  agentRole?: string | null
  agentNickname?: string | null
  agentPath?: string | null
  hasSidechain?: boolean
  oversized?: boolean
  lastTokenUsage?: { input_tokens?: number } | null
}
export interface ConversationEvent extends TimelineEvent {
  usage?: Tokens | null
  isError?: boolean
  isSidechain?: boolean
  name?: string
  detail?: string
}
export interface ConversationData {
  slug?: string | null
  summary: SessionDetails
  timeline: ConversationEvent[]
  children?: AgentSummary[]
}
export interface AgentSummary {
  endTurn?: boolean
  userTurns?: number
  parentId?: string | null
  kind?: string
  depth?: number
  assistantTurns?: number
  contextWindow?: number | null
  model?: string
  phase?: number | null
  id: string
  toolUseId?: string | null
  description?: string
  label?: string
  agentType?: string
  agentRole?: string | null
  agentNickname?: string | null
  agentPath?: string | null
  title?: string | null
  firstPrompt?: string
  status?: string
  type?: string
  firstTs?: string | number | null
  lastTs?: string | number | null
  startTs?: string | number | null
  mtimeMs?: number
  toolCalls?: number
  tokens?: Tokens
  oversized?: boolean
}
export interface SubagentRun {
  runId: string
  agents: AgentSummary[]
  phases: { title: string }[]
  name?: string
  description?: string
  runStatus?: string
  elapsedMs: number
  agentCount: number
  totals: Tokens
  authoritative?: { subagentTokens?: number; durationMs?: number; agentCount?: number; toolUses?: number } | null
}
export interface SubagentIndex {
  groups?: unknown[]
  root?: string
  slug?: string | null
  id?: string
  agents?: AgentSummary[]
  children?: AgentSummary[]
  runs?: SubagentRun[]
}
export interface FolderSource extends importTarget {
  provider: string
  root: string
  rootLabel: string
  slug: string | null
  cwd: string | null
  sessionCount: number
  draftOnly?: boolean
}
export interface Folder {
  id: string
  cwd: string | null
  name: string
  resolved?: boolean
  sources: FolderSource[]
  sessionCount: number
  lastActivity?: number
  draftOnly?: boolean
  pinStatus?: string
}
export interface FolderCatalog {
  folders: Folder[]
  errors: { provider: string; root?: string; rootLabel?: string; error: string }[]
  capturedAt: number
}

export interface MemoryRecord {
  id?: string
  threadId?: string
  sessionId?: string
  title?: string
  cwd?: string | null
  summary?: string
  content?: string
  body?: string
  kind?: string
  updatedAt?: string | number
  usageCount?: number
  selectedForPhase2?: boolean
}
export interface MemoryReply {
  scope?: string
  writable?: boolean
  index?: string | null
  files?: { name: string; content: string }[]
  memories?: MemoryRecord[]
  source?: string
}

export interface ResourceItem {
  name: string
  description?: string
  content?: string
  file?: string
  hasSkillMd?: boolean
  system?: boolean
}
export type ClaudeListKind = 'agents' | 'commands' | 'workflows' | 'rules' | 'output-styles' | 'skills'
export type ClaudeFileKind = 'claudeMd' | 'mcpJson' | 'settingsJson' | 'settingsLocalJson'
export type ClaudeResources = Record<ClaudeListKind, ResourceItem[]> &
  Record<ClaudeFileKind, boolean> & {
    base: string
    scope?: string
    settings: { keys: string[]; model?: string; hooks: string[] } | null
    plugins: { installed: number } | null
  }
export interface McpResource {
  id: string
  name: string
  scope: string
  transport?: string
  enabled?: boolean
  url?: string
  command?: string
  args?: string[]
  cwd?: string
  env: string[]
  headers: string[]
  toolDeny: string[]
  sourcePath?: string
}
export interface CodexResources {
  hasHooksJson?: boolean
  scope: string
  codexDir: string
  configToml?: string | null
  agentsMd?: { name: string; content: string } | null
  summary: Record<string, unknown>
  features: Record<string, unknown>
  agentLimits: Record<string, unknown>
  agents: (ResourceItem & { model?: string; sandbox?: string; effort?: string })[]
  skills: ResourceItem[]
  rules: ResourceItem[]
  hooks: string[]
  mcpServers: McpResource[]
}
export interface ScopedResource extends ResourceItem {
  dir?: string
  source?: string
  path: string
  scope: string
  text?: string
}
export interface PluginResource extends ScopedResource {
  enabled?: boolean
  version?: string
  skills?: number
  mcpServers?: number
  rules?: number
  hooks?: boolean
}
export interface HookResource {
  scope: string
  sourcePath: string
  events: { event: string; handlers: number }[]
}
export interface AntigravityResources {
  scope: string
  base: string
  configDir: string
  geminiMd?: string | null
  agentsMd?: string | null
  skills: ScopedResource[]
  plugins: PluginResource[]
  hooks: HookResource[]
  rules: ScopedResource[]
  mcpServers: McpResource[]
  settings?: { trustedWorkspaces?: string[] | Record<string, unknown>; [key: string]: unknown } | null
  sharedSettings?: Record<string, unknown> | null
  keybindings?: unknown
  permissions?: unknown
}
export interface ResourceSelection {
  kind: string
  id?: string
}
export interface ResourceScopeProps {
  root: string
  scope?: string
  slug?: string | null
}

export interface ActivityDay {
  date: string
  sessions: number
  prompts: number
  toolCalls: number
  tokens: number
}
export interface ActivityProject {
  slug: string | null
  cwd: string | null
  sessions: number
  toolCalls: number
  tokens: number
  lastTs: string | null
}
export type ActivityReport = {
  sessionsDetail: {
    count: number
    avgPrompts: number
    medianPrompts: number
    avgDurationMin: number
    medianDurationMin: number
    longest: { title: string | null; slug: string | null; cwd: string | null; minutes: number; date: string } | null
    durationBuckets: { label: string; n: number }[]
    promptBuckets: { label: string; n: number }[]
  }
  weekly: { projects: number; weekStart: string; sessions: number; prompts: number; activeDays: number }[]
  compare: { thisWeek: { sessions: number; prompts: number; activeDays: number }; lastWeek: { sessions: number; prompts: number; activeDays: number } }
  rhythm: { part: string | null; share: number; weekendShare: number }
  neglected: { slug: string | null; cwd: string | null; lastTs: string | null; daysAgo: number; sessions: number }[]
  days: number
  range: { from: string; to: string }
  daily: ActivityDay[]
  hours: number[]
  weekdays: number[]
  totals: { activeDays: number; sessions: number; prompts: number; toolCalls: number; tokens: number }
  streak: { current: number; longest: number }
  topProjects: ActivityProject[]
  models: Record<string, number>
  busiest: { hour: number | null; weekday: number | null }
}
export interface StatsTotals {
  tokens?: Tokens
  sessions?: number
  userTurns?: number
  toolCalls?: number
  toolCounts?: Record<string, number>
  modelCounts?: Record<string, number>
}
export interface StatsProject extends StatsTotals {
  models?: string[]
  slug: string
  cwd?: string | null
  lastActivity?: string | number | null
}
export interface StatsReport extends StatsTotals {
  root?: string
  projects: StatsProject[]
  fields?: { common?: string[]; specific?: string[] }
}

export interface Plugin {
  name: string
  displayName?: string
  enabled?: boolean
  version?: string
  description?: string
  installedAt?: string | number
  license?: string
  scope?: string
  marketplace?: string
  source?: string
  installPath?: string
  path?: string
  skills?: string[]
  mcpServers?: number
  rules?: number
  hooks?: boolean
}
export interface PluginsReport {
  installed: Plugin[]
  marketplaces: { name: string; repo?: string | null }[]
}
export interface HistoryRecord {
  key?: string
  rowId?: string
  display: string
  project?: string | null
  cwd?: string | null
  ts?: string | number | null
}
export interface HistoryReport {
  history: HistoryRecord[]
}
export interface HomeSource {
  provider: string
  root: string
  rootLabel: string
  note?: string
  slug?: string | null
}
export interface HomeCommon {
  scope: { sources: HomeSource[] }
  sources: HomeSource[]
  errors: { provider?: string; root?: string; rootLabel?: string; error: string }[]
  notices: { message: string; provider?: string; root?: string; rootLabel?: string }[]
  capturedAt: number
  nextCursor?: string | null
}
export interface HomeStatsTotals {
  sessions: number
  subagentSessions: number
  userTurns: number
  toolCalls: number
  tokens: Record<string, number | null>
}
export interface HomeStatsSource extends HomeSource {
  stats: HomeStatsTotals & { slug?: string; cwd?: string | null }
}
export interface HomeStatsFolder {
  id: string
  cwd: string | null
  resolved: boolean
  sessions: number
  sources: HomeStatsSource[]
}
export interface HomeStatsReport extends HomeCommon {
  sources: HomeStatsSource[]
  totals: HomeStatsTotals
  folders: HomeStatsFolder[]
  coverage: Record<string, { available: number; sources: number }>
}
export interface HomeInsightsReport extends HomeCommon {
  activity: ActivityReport
}
export interface HomeHistoryReport extends HomeCommon {
  history: (HistoryRecord & HomeSource & { key: string })[]
  total: number
}
export interface ResourceGroup {
  readOnly?: boolean
  scope: string
  base?: string
  project?: { slug: string }
  items: { label: string; names: string[] }[]
}
export interface HomeResourceSource extends HomeSource {
  entries: ResourceGroup[]
}
export interface HomeResourcesReport extends HomeCommon {
  sources: HomeResourceSource[]
}
export interface HomePluginsReport extends HomeCommon {
  sources: (HomeSource & { data: PluginsReport })[]
}
export type HomeData = HomeStatsReport | HomeInsightsReport | HomeHistoryReport | HomeResourcesReport | HomePluginsReport
