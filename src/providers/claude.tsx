import { rawRecord } from './views.ts'
import TerminalPanel from '../components/claude/TerminalPanel.tsx'
import Stats from '../components/shared/Stats.tsx'
import { forkCutByUuid } from '../lib/sessionPolicy.ts'
import { PROVIDER_METADATA } from './metadata.ts'
import Conversation from '../components/claude/Conversation.tsx'
import ToolCall from '../components/claude/ToolCall.tsx'
import Resources from '../components/claude/Resources.tsx'
import NewResourceForm from '../components/claude/NewResourceForm.tsx'
import SubagentsView from '../components/claude/SubagentsView.tsx'
import MemoryView from '../components/claude/MemoryView.tsx'
import PluginsView from '../components/claude/PluginsView.tsx'
import SkillImport from '../components/claude/SkillImport.tsx'
import RateLimitsBar from '../components/claude/RateLimitsBar.tsx'
import { HOME_PAGES } from '../components/claude/HomePages.tsx'

export default {
  ...PROVIDER_METADATA.claude,
  vendor: 'Anthropic',
  homeHint: '~/.claude',
  // badge classes for this provider (Dashboard + Live panel)
  accent: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  // shell accent (tab dot / active-tab bar / quick-switcher rows) — see lib/providerColors.js
  color: 'emerald',
  docsBase: 'https://code.claude.com/docs',
  docsMap: {
    agents: '/en/sub-agents',
    skills: '/en/skills',
    commands: '/en/skills',
    workflows: '/en/workflows',
    rules: '/en/memory',
    'output-styles': '/en/output-styles',
    claudeMd: '/en/memory',
    mcpJson: '/en/mcp',
    settingsJson: '/en/settings',
    settingsLocalJson: '/en/settings',
  },
  ns: 'cm',
  thinkingLabel: 'thinking',
  rootStatusField: 'hasSessions',
  // Session/project-scoped views — shown in the main tab bar when a session is open.
  sessionTabs: [
    { k: 'conversation', need: 'session', label: 'Conversation' },
    { k: 'subagents', need: 'subagents', label: 'Sub-agents' },
    { k: 'raw', need: 'session', label: 'Raw' },
    { k: 'stats', need: 'session', label: 'Stats' },
    { k: 'memory', need: 'project', label: 'Memory' },
    { k: 'config', need: 'project', label: 'Config' },
  ],
  // Folder-scoped pages rendered by Home (stats, history, memory, plugins, resources)
  homePages: HOME_PAGES,
  rateLimit: {
    windows: [
      { key: 'five_hour', label: '5h', pct: 'used_percentage', reset: 'resets_at' },
      { key: 'seven_day', label: '7d', pct: 'used_percentage', reset: 'resets_at' },
    ],
  },
  contextMeter: { strategy: 'usage-bridge' },
  capabilities: {
    aiHandoff: true, // Config views + Insights can open the CLI seeded with a brief
    subagentModel: 'nested' as const,
    skillAgentFlag: 'claude-code',
    inlineContextMeter: false,
  },
  rawTypeOf: (r: unknown) => String(rawRecord(r).type || '(no type)'),
  docsTitle: 'Claude Code documentation',
  usageInfo:
    'Claude never writes usage to disk — it only exposes rate limits to the status line. Install the usage-bar skill, then an active Claude session has to hit the status line before the 5h / 7d meters appear here.',
  fillConfig: false,
  forkCut: forkCutByUuid,
  components: {
    TerminalPanel,
    Stats,
    ResourcesView: Resources,
    Conversation,
    ToolCall,
    Resources,
    NewResourceForm,
    SubagentsView,
    MemoryView,
    PluginsView,
    SkillImport,
    RateLimitsBar,
  },
}
