import { rawRecord } from './views.ts'
import TerminalPanel from '../components/codex/TerminalPanel.tsx'
import Stats from '../components/shared/Stats.tsx'
import subagentAdapter from '../components/antigravity/subagentAdapter.ts'
import { PROVIDER_METADATA } from './metadata.ts'
import Conversation from '../components/codex/Conversation.tsx'
import ToolCall from '../components/codex/ToolCall.tsx'
import ContextMeter from '../components/codex/ContextMeter.tsx'
import SubagentsView from '../components/codex/SubagentsView.tsx'
import PluginsView from '../components/codex/PluginsView.tsx'
import RateLimitsBar from '../components/codex/RateLimitsBar.tsx'
import ResourcesView from '../components/antigravity/ResourcesView.tsx'
import MemoryView from '../components/antigravity/MemoryView.tsx'
import { HOME_PAGES } from '../components/antigravity/HomePages.tsx'

// Antigravity CLI (`agy`, Google). Experimental: its on-disk format is
// unpublished (JSONL transcripts + protobuf blobs in SQLite) — see
// spec/providers/antigravity.yaml for what is read and how sure we are.
export default {
  ...PROVIDER_METADATA.antigravity,
  vendor: 'Google',
  homeHint: '~/.gemini/antigravity-cli',
  accent: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
  color: 'violet',
  // official docs: the CLI pages live under /docs/cli/…, the customisation
  // pages (skills, MCP, plugins, hooks, rules) are shared with the IDE under /docs/…
  docsBase: 'https://antigravity.google/docs/cli/overview',
  docsMap: {
    skill: 'https://antigravity.google/docs/skills',
    mcp: 'https://antigravity.google/docs/mcp',
    plugin: 'https://antigravity.google/docs/plugins',
    hooks: 'https://antigravity.google/docs/hooks',
    rules: 'https://antigravity.google/docs/rules-workflows',
    agentsMd: 'https://antigravity.google/docs/rules-workflows',
    config: 'https://antigravity.google/docs/cli/settings',
    permissions: 'https://antigravity.google/docs/cli/permissions',
    conversations: 'https://antigravity.google/docs/cli/conversations',
    subagents: 'https://antigravity.google/docs/cli/subagents',
    artifacts: 'https://antigravity.google/docs/cli/artifacts',
    usage: 'https://antigravity.google/docs/cli/credits',
    headless: 'https://antigravity.google/docs/cli/headless',
    reference: 'https://antigravity.google/docs/cli/reference',
  },
  ns: 'agm',
  thinkingLabel: 'thinking',
  rootStatusField: 'hasSessions',
  sessionTabs: [
    { k: 'conversation', need: 'session', label: 'Conversation' },
    { k: 'subagents', need: 'subagents', label: 'Sub-agents' },
    { k: 'raw', need: 'session', label: 'Raw' },
    { k: 'stats', need: 'session', label: 'Stats' },
    { k: 'memory', need: 'project', label: 'Artifacts' },
    { k: 'config', need: 'project', label: 'Config' },
  ],
  homePages: HOME_PAGES,
  rateLimit: {
    windows: [
      { key: 'primary', pct: 'used_percent', reset: 'resets_at', window: 'window_minutes' },
      { key: 'secondary', pct: 'used_percent', reset: 'resets_at', window: 'window_minutes' },
    ],
  },
  contextMeter: { strategy: 'none' },
  capabilities: {
    aiHandoff: true, // Config views + Insights can open the CLI seeded with a brief
    subagentModel: 'independent-sessions' as const,
    skillAgentFlag: null, // agy has no skill-run flag; resources are read-only here
    inlineContextMeter: false,
    readOnlyResources: true,
  },
  rawTypeOf: (rec: unknown) => String(rawRecord(rec).type || rawRecord(rec).source || 'other'),
  docsTitle: 'Antigravity CLI documentation',
  usageInfo:
    'Antigravity reports its quota through `agy /usage` (5-hour and weekly buckets per model group). AgentDeck asks at most every five minutes, so this is a recent snapshot, not a live meter.',
  fillConfig: true,
  subagentAdapter,
  components: {
    TerminalPanel,
    Stats,
    Conversation,
    ToolCall,
    ContextMeter,
    ResourcesView,
    SubagentsView,
    MemoryView,
    PluginsView,
    RateLimitsBar,
  },
}
