import makeIdApp from './IdApp.jsx'
import { antigravityApi } from './api.js'
import Conversation from './components/codex/Conversation.jsx'
import SubagentsView from './components/codex/SubagentsView.jsx'
import TerminalPanel from './components/codex/TerminalPanel.jsx'
import RateLimitsBar from './components/codex/RateLimitsBar.jsx'
import ResourcesView from './components/antigravity/ResourcesView.jsx'
import MemoryView from './components/antigravity/MemoryView.jsx'
import subagentAdapter from './components/antigravity/subagentAdapter.js'

// transcript_full.jsonl records are flat: { type: 'PLANNER_RESPONSE' | 'USER_INPUT' | … }
const AGY_RAW_TYPE = (rec) => rec?.type || rec?.source || 'other'

// The Antigravity (agy) provider's main area: the id-addressed app with the
// Codex conversation / sub-agent / terminal views (they read their API from
// context) plus agy-specific read-only Config and Artifacts views.
const SESSION_TABS = [
  { k: 'conversation', need: 'session', label: 'Conversation' },
  { k: 'subagents', need: 'session', label: 'Sub-agents' },
  { k: 'raw', need: 'session', label: 'Raw' },
  { k: 'memory', need: 'project', label: 'Artifacts' },
  { k: 'config', need: 'project', label: 'Config' },
]

export default makeIdApp({
  providerId: 'antigravity',
  api: antigravityApi,
  Conversation,
  ResourcesView,
  SubagentsView,
  MemoryView,
  TerminalPanel,
  RateLimitsBar,
  subagentAdapter,
  rawTypeOf: AGY_RAW_TYPE,
  sessionTabs: SESSION_TABS,
  docsUrl: 'https://antigravity.google/docs/cli',
  docsTitle: 'Antigravity CLI documentation',
  usageInfo: 'Antigravity reports its quota through `agy /usage` (5-hour and weekly buckets per model group). AgentDeck asks at most every five minutes, so this is a recent snapshot, not a live meter.',
})
