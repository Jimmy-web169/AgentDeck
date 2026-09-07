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
  App,
  accent: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
  color: 'violet',
  docsBase: 'https://antigravity.google/docs/cli',
  docsMap: {
    skill: 'https://antigravity.google/docs/cli/skills',
    mcp: 'https://antigravity.google/docs/cli/mcp',
    config: 'https://antigravity.google/docs/cli/settings',
    agentsMd: 'https://antigravity.google/docs/cli/agents-md',
  },
  ns: 'agm',
  thinkingLabel: 'thinking',
  rootStatusField: 'hasSessions',
  apiAddr: 'id',
  sessionTabs: [
    { k: 'conversation', need: 'session', label: 'Conversation' },
    { k: 'subagents', need: 'session', label: 'Sub-agents' },
    { k: 'raw', need: 'session', label: 'Raw' },
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
