import Conversation from '../components/claude/Conversation.jsx'
import ToolCall from '../components/claude/ToolCall.jsx'
import AskQuestionForm from '../components/claude/AskQuestionForm.jsx'
import Resources from '../components/claude/Resources.jsx'
import NewResourceForm from '../components/claude/NewResourceForm.jsx'
import SubagentsView from '../components/claude/SubagentsView.jsx'
import MemoryView from '../components/claude/MemoryView.jsx'
import PluginsView from '../components/claude/PluginsView.jsx'
import SkillImport from '../components/claude/SkillImport.jsx'
import RateLimitsBar from '../components/claude/RateLimitsBar.jsx'
import App from '../ClaudeApp.jsx'

export default {
  id: 'claude',
  label: 'Claude Code',
  // the provider's top-level app (the shell renders this — no hardcoding in App.jsx)
  App,
  // badge classes for this provider (Dashboard + Live panel)
  accent: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
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
  rootStatusField: 'hasProjects',
  apiAddr: 'slug+id',
  // Session/project-scoped views — shown in the main tab bar when a session is open.
  sessionTabs: [
    { k: 'conversation', need: 'session', label: 'Conversation' },
    { k: 'subagents', need: 'subagents', label: 'Sub-agents' },
    { k: 'raw', need: 'session', label: 'Raw' },
    { k: 'memory', need: 'project', label: 'Memory' },
    { k: 'config', need: 'project', label: 'Config' },
  ],
  // Folder(root)-scoped views — reached from the sidebar.
  globalViews: [
    { k: 'stats', label: 'Stats' },
    { k: 'resources', label: 'Resources' },
    { k: 'history', label: 'History' },
    { k: 'plugins', label: 'Plugins' },
  ],
  paneTabs: ['conversation', 'subagents', 'raw', 'memory', 'config'],
  chatModes: [
    { v: 'acceptEdits', label: 'Auto-accept edits' },
    { v: 'default', label: 'Ask me per tool' },
    { v: 'plan', label: 'Plan (no actions)' },
    { v: 'bypass', label: 'Bypass (danger)' },
  ],
  defaultChatMode: 'acceptEdits',
  rateLimit: {
    windows: [
      { key: 'five_hour', label: '5h', pct: 'used_percentage', reset: 'resets_at' },
      { key: 'seven_day', label: '7d', pct: 'used_percentage', reset: 'resets_at' },
    ],
  },
  contextMeter: { strategy: 'usage-bridge' },
  capabilities: {
    permissions: true,
    askQuestion: true,
    subagentModel: 'nested',
    liveStream: 'delta',
    skillAgentFlag: 'claude-code',
    inlineContextMeter: false,
  },
  rawTypeOf: (r) => r.type || '(no type)',
  components: {
    Conversation,
    ToolCall,
    AskQuestionForm,
    Resources,
    NewResourceForm,
    SubagentsView,
    MemoryView,
    PluginsView,
    SkillImport,
    RateLimitsBar,
  },
}
