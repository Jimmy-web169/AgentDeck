import type { SessionSummary } from '../../shared/types.d.ts'

// The public schema permits partial summaries; native adapters always produce
// these normalized fields. This describes our output, not native JSONL input.
export interface NormalizedSummary extends SessionSummary {
  firstPrompt: string
  lastUserPrompt: string
  lastUserPromptTs: string | number | null
  firstTs: string | number | null
  lastTs: string | number | null
  userTurns: number
  assistantTurns: number
  toolCalls: number
  toolCounts: Record<string, number>
  models: string[]
  tokens: SessionSummary['tokens'] & Record<string, number>
  hasSidechain?: boolean
  oversized?: boolean
  mtime?: number
  childCount?: number
  parentId?: string | null
  agentRole?: string | null
  agentNickname?: string | null
  gitRepo?: string | null
  branch?: string | null
  live?: boolean
}
