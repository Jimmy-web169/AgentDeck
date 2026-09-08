import Conversation from '../components/claude/Conversation.jsx'
import ToolCall from '../components/claude/ToolCall.jsx'
import Resources from '../components/claude/Resources.jsx'
import NewResourceForm from '../components/claude/NewResourceForm.jsx'
import SubagentsView from '../components/claude/SubagentsView.jsx'
import MemoryView from '../components/claude/MemoryView.jsx'
import PluginsView from '../components/claude/PluginsView.jsx'
import SkillImport from '../components/claude/SkillImport.jsx'
import RateLimitsBar from '../components/claude/RateLimitsBar.jsx'
import App from '../ClaudeApp.jsx'
import { HOME_PAGES } from '../components/claude/HomePages.jsx'

export default {
  id: 'claude',
  label: 'Claude Code',
  vendor: 'Anthropic',
  homeHint: '~/.claude',
  // the provider's top-level app (the shell renders this — no hardcoding in App.jsx)
  App,
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
  apiAddr: 'slug+id',
  // Session/project-scoped views — shown in the main tab bar when a session is open.
  sessionTabs: [
    { k: 'conversation', need: 'session', label: 'Conversation' },
    { k: 'subagents', need: 'subagents', label: 'Sub-agents' },
    { k: 'raw', need: 'session', label: 'Raw' },
    { k: 'stats', need: 'session', label: 'Stats' },
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
    subagentModel: 'nested',
    skillAgentFlag: 'claude-code',
    inlineContextMeter: false,
  },
  rawTypeOf: (r) => r.type || '(no type)',
  components: {
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
