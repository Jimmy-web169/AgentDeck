import Conversation from '../components/codex/Conversation.jsx'
import ToolCall from '../components/codex/ToolCall.jsx'
import ContextMeter from '../components/codex/ContextMeter.jsx'
import SubagentsView from '../components/codex/SubagentsView.jsx'
import PluginsView from '../components/codex/PluginsView.jsx'
import RateLimitsBar from '../components/codex/RateLimitsBar.jsx'
import ResourcesView from '../components/antigravity/ResourcesView.jsx'
import MemoryView from '../components/antigravity/MemoryView.jsx'
import App from '../AntigravityApp.jsx'
import { HOME_PAGES } from '../components/antigravity/HomePages.jsx'

// Antigravity CLI (`agy`, Google). Experimental: its on-disk format is
// unpublished (JSONL transcripts + protobuf blobs in SQLite) — see
// spec/providers/antigravity.yaml for what is read and how sure we are.
export default {
  id: 'antigravity',
  label: 'Antigravity',
  vendor: 'Google',
  homeHint: '~/.gemini/antigravity-cli',
  App,
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
  apiAddr: 'id',
  sessionTabs: [
    { k: 'conversation', need: 'session', label: 'Conversation' },
    { k: 'subagents', need: 'session', label: 'Sub-agents' },
    { k: 'raw', need: 'session', label: 'Raw' },
    { k: 'stats', need: 'session', label: 'Stats' },
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
    subagentModel: 'independent-sessions',
    skillAgentFlag: null, // agy has no skill-run flag; resources are read-only here
    inlineContextMeter: false,
    readOnlyResources: true,
  },
  rawTypeOf: (rec) => rec?.type || rec?.source || 'other',
  components: {
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
