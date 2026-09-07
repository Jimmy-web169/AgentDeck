import makeIdApp from './IdApp.jsx'
import { codexApi } from './api.js'
import Conversation from './components/codex/Conversation.jsx'
import ResourcesView from './components/codex/ResourcesView.jsx'
import SubagentsView from './components/codex/SubagentsView.jsx'
import MemoryView from './components/codex/MemoryView.jsx'
import TerminalPanel from './components/codex/TerminalPanel.jsx'
import RateLimitsBar from './components/codex/RateLimitsBar.jsx'
import Stats from './components/codex/Stats.jsx'
import subagentAdapter from './components/codex/subagentAdapter.js'

// codex raw-record discriminator (records are wrapped: response_item/event_msg)
const CODEX_RAW_TYPE = (rec) => {
  if (rec?.type === 'response_item' || rec?.type === 'event_msg') return `${rec.type}:${rec.payload?.type || '?'}`
  if (rec?.type) return rec.type
  return rec?.payload?.type || 'other'
}

// The Codex provider's main area: the id-addressed app (IdApp.jsx) with the
// Codex views plugged in.
const SESSION_TABS = [
  { k: 'conversation', need: 'session', label: 'Conversation' },
  { k: 'subagents', need: 'session', label: 'Sub-agents' },
  { k: 'raw', need: 'session', label: 'Raw' },
  { k: 'stats', need: 'session', label: 'Stats' },
  { k: 'memory', need: 'project', label: 'Memory' },
  { k: 'config', need: 'project', label: 'Config' },
]

export default makeIdApp({
  providerId: 'codex',
  api: codexApi,
  Conversation,
  ResourcesView,
  SubagentsView,
  MemoryView,
  TerminalPanel,
  RateLimitsBar,
  Stats,
  subagentAdapter,
  rawTypeOf: CODEX_RAW_TYPE,
  sessionTabs: SESSION_TABS,
  docsUrl: 'https://developers.openai.com/codex',
  docsTitle: 'Codex documentation',
  usageInfo: "Codex writes usage (5h / weekly) into each session's rollout log, so this is the newest snapshot from disk — not live. It reflects your quota at the moment of the last session activity; if the window has since reset, your real remaining quota is higher (the meter shows ↺ when that reading's window has already reset).",
})
