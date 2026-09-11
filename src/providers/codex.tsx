import { rawRecord } from './views.ts'
import TerminalPanel from '../components/codex/TerminalPanel.tsx'
import Stats from '../components/shared/Stats.tsx'
import subagentAdapter from '../components/codex/subagentAdapter.ts'
import { forkCutByOrdinal } from '../lib/sessionPolicy.ts'
import { PROVIDER_METADATA } from './metadata.ts'
import Conversation from '../components/codex/Conversation.tsx'
import ToolCall from '../components/codex/ToolCall.tsx'
import ContextMeter from '../components/codex/ContextMeter.tsx'
import ResourcesView from '../components/codex/ResourcesView.tsx'
import NewResourceForm from '../components/codex/NewResourceForm.tsx'
import SubagentsView from '../components/codex/SubagentsView.tsx'
import MemoryView from '../components/codex/MemoryView.tsx'
import PluginsView from '../components/codex/PluginsView.tsx'
import SkillImport from '../components/codex/SkillImport.tsx'
import RateLimitsBar from '../components/codex/RateLimitsBar.tsx'
import { HOME_PAGES } from '../components/codex/HomePages.tsx'

export default {
  ...PROVIDER_METADATA.codex,
  vendor: 'OpenAI',
  homeHint: '~/.codex',
  // badge classes for this provider (Dashboard + Live panel)
  accent: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  // shell accent (tab dot / active-tab bar / quick-switcher rows) — see lib/providerColors.js
  color: 'sky',
  docsBase: 'https://developers.openai.com/codex',
  // resource-kind → Codex docs page (from ResourcesView's DOCS map)
  docsMap: {
    agent: 'https://developers.openai.com/codex/subagents',
    skill: 'https://developers.openai.com/codex/skills',
    hook: 'https://developers.openai.com/codex/hooks',
    mcp: 'https://developers.openai.com/codex/mcp',
    config: 'https://developers.openai.com/codex/config-reference',
    agentsMd: 'https://developers.openai.com/codex/guides/agents-md',
  },
  ns: 'cxm',
  thinkingLabel: 'reasoning',
  rootStatusField: 'hasSessions',
  // session/project-scoped tabs (from App.jsx SESSION_TABS)
  sessionTabs: [
    { k: 'conversation', need: 'session', label: 'Conversation' },
    { k: 'subagents', need: 'subagents', label: 'Sub-agents' },
    { k: 'raw', need: 'session', label: 'Raw' },
    { k: 'stats', need: 'session', label: 'Stats' },
    { k: 'memory', need: 'project', label: 'Memory' },
    { k: 'config', need: 'project', label: 'Config' },
  ],
  // home-scoped pages rendered by Home (stats, history, memory, plugins, resources)
  homePages: HOME_PAGES,
  rateLimit: {
    windows: [
      { key: 'primary', pct: 'used_percent', reset: 'resets_at', window: 'window_minutes' },
      { key: 'secondary', pct: 'used_percent', reset: 'resets_at', window: 'window_minutes' },
    ],
  },
  contextMeter: { strategy: 'transcript' },
  capabilities: {
    aiHandoff: true, // Config views + Insights can open the CLI seeded with a brief
    subagentModel: 'independent-sessions' as const,
    skillAgentFlag: 'codex',
    inlineContextMeter: true,
  },
  // Discriminator for a Codex rollout record (from RawView.jsx typeOf) — handles
  // both the wrapped and bare shapes.
  rawTypeOf: (value: unknown) => {
    const rec = rawRecord(value)
    const payload = rawRecord(rec.payload)
    if (rec?.type === 'response_item' || rec?.type === 'event_msg') return `${rec.type}:${payload.type || '?'}`
    if (rec?.type) return String(rec.type)
    return String(payload.type || 'other')
  },
  docsTitle: 'Codex documentation',
  usageInfo:
    "Codex writes usage (5h / weekly) into each session's rollout log, so this is the newest snapshot from disk — not live. It reflects your quota at the moment of the last session activity; if the window has since reset, your real remaining quota is higher (the meter shows ↺ when that reading's window has already reset).",
  fillConfig: true,
  forkCut: forkCutByOrdinal,
  subagentAdapter,
  components: {
    TerminalPanel,
    Stats,
    Conversation,
    ToolCall,
    ContextMeter,
    ResourcesView,
    NewResourceForm,
    SubagentsView,
    MemoryView,
    PluginsView,
    SkillImport,
    RateLimitsBar,
  },
}
