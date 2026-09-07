import Conversation from '../components/codex/Conversation.jsx'
import ToolCall from '../components/codex/ToolCall.jsx'
import ContextMeter from '../components/codex/ContextMeter.jsx'
import ResourcesView from '../components/codex/ResourcesView.jsx'
import NewResourceForm from '../components/codex/NewResourceForm.jsx'
import SubagentsView from '../components/codex/SubagentsView.jsx'
import MemoryView from '../components/codex/MemoryView.jsx'
import PluginsView from '../components/codex/PluginsView.jsx'
import SkillImport from '../components/codex/SkillImport.jsx'
import RateLimitsBar from '../components/codex/RateLimitsBar.jsx'
import App from '../CodexApp.jsx'
import { HOME_PAGES } from '../components/codex/HomePages.jsx'

export default {
  id: 'codex',
  label: 'Codex',
  // the provider's top-level app (the shell renders this — no hardcoding in App.jsx)
  App,
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
  apiAddr: 'id',
  // session/project-scoped tabs (from App.jsx SESSION_TABS)
  sessionTabs: [
    { k: 'conversation', need: 'session', label: 'Conversation' },
    { k: 'subagents', need: 'session', label: 'Sub-agents' },
    { k: 'raw', need: 'session', label: 'Raw' },
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
    subagentModel: 'independent-sessions',
    skillAgentFlag: 'codex',
    inlineContextMeter: true,
  },
  // Discriminator for a Codex rollout record (from RawView.jsx typeOf) — handles
  // both the wrapped and bare shapes.
  rawTypeOf: (rec) => {
    if (rec?.type === 'response_item' || rec?.type === 'event_msg') return `${rec.type}:${rec.payload?.type || '?'}`
    if (rec?.type) return rec.type
    return rec?.payload?.type || 'other'
  },
  components: {
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
