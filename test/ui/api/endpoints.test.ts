import assert from 'node:assert/strict'
import { test } from 'vitest'
import { createProviderClient } from '../../../src/api/endpoints.ts'
import { createFetcher } from '../../../src/api/fetcher.ts'
import { providerMetadata } from '../../../src/providers/metadata.ts'

// Captured from the original positional client before migration. These literal
// requests freeze its bytes independently of the new addressing implementation.
const contracts: {
  provider: string
  method: string
  expected: { url: string; method: string; cache: string | undefined; headers: Record<string, string>; body: string | undefined }
  run: (client: ReturnType<typeof createProviderClient>) => Promise<unknown>
}[] = [
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.roots(),
    provider: 'claude',
    method: 'roots',
    expected: { url: '/api/claude/roots', method: 'GET', cache: 'no-store', headers: {}, body: undefined },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.projects({ root: 'account|two' }),
    provider: 'claude',
    method: 'projects',
    expected: { url: '/api/claude/projects?root=account%7Ctwo', method: 'GET', cache: 'no-store', headers: {}, body: undefined },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.sessions({ root: 'account|two', slug: '/工作/a?b' }),
    provider: 'claude',
    method: 'sessions',
    expected: {
      url: '/api/claude/sessions?root=account%7Ctwo&slug=%2F%E5%B7%A5%E4%BD%9C%2Fa%3Fb',
      method: 'GET',
      cache: 'no-store',
      headers: {},
      body: undefined,
    },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.probeRun({ root: 'account|two' }),
    provider: 'claude',
    method: 'probeRun',
    expected: {
      url: '/api/claude/probe/run',
      method: 'POST',
      cache: undefined,
      headers: { 'Content-Type': 'application/json' },
      body: '{"root":"account|two"}',
    },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.probeAccept({ root: 'account|two' }),
    provider: 'claude',
    method: 'probeAccept',
    expected: {
      url: '/api/claude/probe/accept',
      method: 'POST',
      cache: undefined,
      headers: { 'Content-Type': 'application/json' },
      body: '{"root":"account|two"}',
    },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.addRoot({ path: '/target', label: 'label' }),
    provider: 'claude',
    method: 'addRoot',
    expected: {
      url: '/api/claude/roots',
      method: 'POST',
      cache: undefined,
      headers: { 'Content-Type': 'application/json' },
      body: '{"path":"/target","label":"label"}',
    },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.addRoot({ path: '/target' }),
    provider: 'claude',
    method: 'addRoot',
    expected: { url: '/api/claude/roots', method: 'POST', cache: undefined, headers: { 'Content-Type': 'application/json' }, body: '{"path":"/target"}' },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.relabelRoot({ id: 'account|two', label: 'label' }),
    provider: 'claude',
    method: 'relabelRoot',
    expected: {
      url: '/api/claude/roots/label',
      method: 'POST',
      cache: undefined,
      headers: { 'Content-Type': 'application/json' },
      body: '{"id":"account|two","label":"label"}',
    },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.removeRoot({ id: 'account|two' }),
    provider: 'claude',
    method: 'removeRoot',
    expected: { url: '/api/claude/roots?id=account%7Ctwo', method: 'DELETE', cache: undefined, headers: {}, body: undefined },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.stats({ root: 'account|two' }),
    provider: 'claude',
    method: 'stats',
    expected: { url: '/api/claude/stats?root=account%7Ctwo', method: 'GET', cache: 'no-store', headers: {}, body: undefined },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.history({ root: 'account|two' }),
    provider: 'claude',
    method: 'history',
    expected: { url: '/api/claude/history?root=account%7Ctwo', method: 'GET', cache: 'no-store', headers: {}, body: undefined },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.usage({ root: 'account|two' }),
    provider: 'claude',
    method: 'usage',
    expected: { url: '/api/claude/usage?root=account%7Ctwo', method: 'GET', cache: 'no-store', headers: {}, body: undefined },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.plugins({ root: 'account|two' }),
    provider: 'claude',
    method: 'plugins',
    expected: { url: '/api/claude/plugins?root=account%7Ctwo', method: 'GET', cache: 'no-store', headers: {}, body: undefined },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.activity({ root: 'account|two', days: 14 }),
    provider: 'claude',
    method: 'activity',
    expected: { url: '/api/claude/activity?root=account%7Ctwo&days=14', method: 'GET', cache: 'no-store', headers: {}, body: undefined },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.activity({ root: 'account|two' }),
    provider: 'claude',
    method: 'activity',
    expected: { url: '/api/claude/activity?root=account%7Ctwo&days=undefined', method: 'GET', cache: 'no-store', headers: {}, body: undefined },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.skillRun({ root: 'account|two', slug: '/工作/a?b' }),
    provider: 'claude',
    method: 'skillRun',
    expected: {
      url: '/api/claude/skill-run',
      method: 'POST',
      cache: undefined,
      headers: { 'Content-Type': 'application/json' },
      body: '{"root":"account|two","slug":"/工作/a?b"}',
    },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.terminal({ root: 'account|two', id: 'session:1' }),
    provider: 'claude',
    method: 'terminal',
    expected: {
      url: '/api/claude/terminal',
      method: 'POST',
      cache: undefined,
      headers: { 'Content-Type': 'application/json' },
      body: '{"root":"account|two","id":"session:1"}',
    },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.terminals(),
    provider: 'claude',
    method: 'terminals',
    expected: { url: '/api/claude/terminals', method: 'GET', cache: 'no-store', headers: {}, body: undefined },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.terminalStop({ key: 'opaque|key' }),
    provider: 'claude',
    method: 'terminalStop',
    expected: { url: '/api/claude/terminal?key=opaque%7Ckey', method: 'DELETE', cache: undefined, headers: {}, body: undefined },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.browse({ path: '/target' }),
    provider: 'claude',
    method: 'browse',
    expected: { url: '/api/claude/browse?path=%2Ftarget', method: 'GET', cache: 'no-store', headers: {}, body: undefined },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.browse(),
    provider: 'claude',
    method: 'browse',
    expected: { url: '/api/claude/browse', method: 'GET', cache: 'no-store', headers: {}, body: undefined },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.pickFolder(),
    provider: 'claude',
    method: 'pickFolder',
    expected: { url: '/api/claude/pick-folder', method: 'GET', cache: 'no-store', headers: {}, body: undefined },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.session({ root: 'account|two', slug: '/工作/a?b', id: 'session:1' }),
    provider: 'claude',
    method: 'session',
    expected: {
      url: '/api/claude/session?root=account%7Ctwo&slug=%2F%E5%B7%A5%E4%BD%9C%2Fa%3Fb&id=session%3A1',
      method: 'GET',
      cache: 'no-store',
      headers: {},
      body: undefined,
    },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.raw({ root: 'account|two', slug: '/工作/a?b', id: 'session:1' }),
    provider: 'claude',
    method: 'raw',
    expected: {
      url: '/api/claude/raw?root=account%7Ctwo&slug=%2F%E5%B7%A5%E4%BD%9C%2Fa%3Fb&id=session%3A1',
      method: 'GET',
      cache: 'no-store',
      headers: {},
      body: undefined,
    },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.subagents({ root: 'account|two', slug: '/工作/a?b', id: 'session:1' }),
    provider: 'claude',
    method: 'subagents',
    expected: {
      url: '/api/claude/subagents?root=account%7Ctwo&slug=%2F%E5%B7%A5%E4%BD%9C%2Fa%3Fb&id=session%3A1',
      method: 'GET',
      cache: 'no-store',
      headers: {},
      body: undefined,
    },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.deleteSession({ root: 'account|two', slug: '/工作/a?b', id: 'session:1' }),
    provider: 'claude',
    method: 'deleteSession',
    expected: {
      url: '/api/claude/session?root=account%7Ctwo&slug=%2F%E5%B7%A5%E4%BD%9C%2Fa%3Fb&id=session%3A1',
      method: 'DELETE',
      cache: undefined,
      headers: {},
      body: undefined,
    },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) =>
      client.subagent({ root: 'account|two', slug: '/工作/a?b', id: 'session:1', run: 'run', agent: 'agent' }),
    provider: 'claude',
    method: 'subagent',
    expected: {
      url: '/api/claude/subagent?root=account%7Ctwo&slug=%2F%E5%B7%A5%E4%BD%9C%2Fa%3Fb&session=session%3A1&run=run&agent=agent',
      method: 'GET',
      cache: 'no-store',
      headers: {},
      body: undefined,
    },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.subagent({ root: 'account|two', slug: '/工作/a?b', id: 'session:1', agent: 'agent' }),
    provider: 'claude',
    method: 'subagent',
    expected: {
      url: '/api/claude/subagent?root=account%7Ctwo&slug=%2F%E5%B7%A5%E4%BD%9C%2Fa%3Fb&session=session%3A1&agent=agent',
      method: 'GET',
      cache: 'no-store',
      headers: {},
      body: undefined,
    },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.memory({ root: 'account|two' }),
    provider: 'claude',
    method: 'memory',
    expected: { url: '/api/claude/memory?root=account%7Ctwo', method: 'GET', cache: 'no-store', headers: {}, body: undefined },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.memory({ root: 'account|two', slug: '/工作/a?b' }),
    provider: 'claude',
    method: 'memory',
    expected: {
      url: '/api/claude/memory?root=account%7Ctwo&slug=%2F%E5%B7%A5%E4%BD%9C%2Fa%3Fb',
      method: 'GET',
      cache: 'no-store',
      headers: {},
      body: undefined,
    },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.fork({ root: 'account|two', slug: '/工作/a?b', id: 'session:1' }, 0),
    provider: 'claude',
    method: 'fork',
    expected: {
      url: '/api/claude/fork',
      method: 'POST',
      cache: undefined,
      headers: { 'Content-Type': 'application/json' },
      body: '{"root":"account|two","slug":"/工作/a?b","id":"session:1","cut":0}',
    },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.fork({ root: 'account|two', slug: '/工作/a?b', id: 'session:1' }),
    provider: 'claude',
    method: 'fork',
    expected: {
      url: '/api/claude/fork',
      method: 'POST',
      cache: undefined,
      headers: { 'Content-Type': 'application/json' },
      body: '{"root":"account|two","slug":"/工作/a?b","id":"session:1","cut":null}',
    },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.fork({ root: 'account|two', slug: '/工作/a?b', id: 'session:1' }, 'uuid'),
    provider: 'claude',
    method: 'fork',
    expected: {
      url: '/api/claude/fork',
      method: 'POST',
      cache: undefined,
      headers: { 'Content-Type': 'application/json' },
      body: '{"root":"account|two","slug":"/工作/a?b","id":"session:1","cut":"uuid"}',
    },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) =>
      client.saveMemory({ root: 'account|two', slug: '/工作/a?b', name: 'name with spaces', content: 'hello\nworld' }),
    provider: 'claude',
    method: 'saveMemory',
    expected: {
      url: '/api/claude/memory',
      method: 'POST',
      cache: undefined,
      headers: { 'Content-Type': 'application/json' },
      body: '{"root":"account|two","slug":"/工作/a?b","name":"name with spaces","content":"hello\\nworld"}',
    },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.deleteMemory({ root: 'account|two', slug: '/工作/a?b', name: 'name with spaces' }),
    provider: 'claude',
    method: 'deleteMemory',
    expected: {
      url: '/api/claude/memory?root=account%7Ctwo&slug=%2F%E5%B7%A5%E4%BD%9C%2Fa%3Fb&name=name+with+spaces',
      method: 'DELETE',
      cache: undefined,
      headers: {},
      body: undefined,
    },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.resources({ root: 'account|two', scope: 'project', slug: '/工作/a?b' }),
    provider: 'claude',
    method: 'resources',
    expected: {
      url: '/api/claude/resources?root=account%7Ctwo&slug=%2F%E5%B7%A5%E4%BD%9C%2Fa%3Fb',
      method: 'GET',
      cache: 'no-store',
      headers: {},
      body: undefined,
    },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.resources({ root: 'account|two', scope: 'user' }),
    provider: 'claude',
    method: 'resources',
    expected: { url: '/api/claude/resources?root=account%7Ctwo', method: 'GET', cache: 'no-store', headers: {}, body: undefined },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) =>
      client.resource({ root: 'account|two', kind: 'skills', name: 'name with spaces', slug: '/工作/a?b' }),
    provider: 'claude',
    method: 'resource',
    expected: {
      url: '/api/claude/resource?root=account%7Ctwo&kind=skills&name=name+with+spaces&slug=%2F%E5%B7%A5%E4%BD%9C%2Fa%3Fb',
      method: 'GET',
      cache: 'no-store',
      headers: {},
      body: undefined,
    },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.resource({ root: 'account|two', kind: 'skills', name: 'name with spaces' }),
    provider: 'claude',
    method: 'resource',
    expected: {
      url: '/api/claude/resource?root=account%7Ctwo&kind=skills&name=name+with+spaces',
      method: 'GET',
      cache: 'no-store',
      headers: {},
      body: undefined,
    },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) =>
      client.saveResource({ root: 'account|two', kind: 'skills', name: 'name with spaces', content: 'hello\nworld', slug: '/工作/a?b' }),
    provider: 'claude',
    method: 'saveResource',
    expected: {
      url: '/api/claude/resource',
      method: 'POST',
      cache: undefined,
      headers: { 'Content-Type': 'application/json' },
      body: '{"root":"account|two","kind":"skills","name":"name with spaces","content":"hello\\nworld","slug":"/工作/a?b"}',
    },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) =>
      client.saveResource({ root: 'account|two', kind: 'skills', name: 'name with spaces', content: 'hello\nworld' }),
    provider: 'claude',
    method: 'saveResource',
    expected: {
      url: '/api/claude/resource',
      method: 'POST',
      cache: undefined,
      headers: { 'Content-Type': 'application/json' },
      body: '{"root":"account|two","kind":"skills","name":"name with spaces","content":"hello\\nworld"}',
    },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.createResource({ root: 'account|two', kind: 'skills', name: 'name with spaces' }),
    provider: 'claude',
    method: 'createResource',
    expected: {
      url: '/api/claude/resource',
      method: 'POST',
      cache: undefined,
      headers: { 'Content-Type': 'application/json' },
      body: '{"root":"account|two","kind":"skills","name":"name with spaces"}',
    },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) =>
      client.deleteResource({ root: 'account|two', scope: 'project', slug: '/工作/a?b', kind: 'skills', name: 'name with spaces', stamp: '123' }),
    provider: 'claude',
    method: 'deleteResource',
    expected: {
      url: '/api/claude/resource?root=account%7Ctwo&kind=skills&name=name+with+spaces&stamp=123&slug=%2F%E5%B7%A5%E4%BD%9C%2Fa%3Fb',
      method: 'DELETE',
      cache: undefined,
      headers: {},
      body: undefined,
    },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) =>
      client.deleteResource({ root: 'account|two', scope: 'user', kind: 'skills', name: 'name with spaces', stamp: '123' }),
    provider: 'claude',
    method: 'deleteResource',
    expected: {
      url: '/api/claude/resource?root=account%7Ctwo&kind=skills&name=name+with+spaces&stamp=123',
      method: 'DELETE',
      cache: undefined,
      headers: {},
      body: undefined,
    },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) =>
      client.open({ root: 'account|two', slug: '/工作/a?b', id: 'session:1' }, { what: 'code', cwd: '/target' }),
    provider: 'claude',
    method: 'open',
    expected: {
      url: '/api/claude/open',
      method: 'POST',
      cache: undefined,
      headers: { 'Content-Type': 'application/json' },
      body: '{"root":"account|two","slug":"/工作/a?b","id":"session:1","what":"code","cwd":"/target"}',
    },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.open({ root: 'account|two' }, { what: 'code' }),
    provider: 'claude',
    method: 'open',
    expected: {
      url: '/api/claude/open',
      method: 'POST',
      cache: undefined,
      headers: { 'Content-Type': 'application/json' },
      body: '{"root":"account|two","what":"code"}',
    },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.roots(),
    provider: 'codex',
    method: 'roots',
    expected: { url: '/api/codex/roots', method: 'GET', cache: 'no-store', headers: {}, body: undefined },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.projects({ root: 'account|two' }),
    provider: 'codex',
    method: 'projects',
    expected: { url: '/api/codex/projects?root=account%7Ctwo', method: 'GET', cache: 'no-store', headers: {}, body: undefined },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.sessions({ root: 'account|two', slug: '/工作/a?b' }),
    provider: 'codex',
    method: 'sessions',
    expected: {
      url: '/api/codex/sessions?root=account%7Ctwo&slug=%2F%E5%B7%A5%E4%BD%9C%2Fa%3Fb',
      method: 'GET',
      cache: 'no-store',
      headers: {},
      body: undefined,
    },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.probeRun({ root: 'account|two' }),
    provider: 'codex',
    method: 'probeRun',
    expected: {
      url: '/api/codex/probe/run',
      method: 'POST',
      cache: undefined,
      headers: { 'Content-Type': 'application/json' },
      body: '{"root":"account|two"}',
    },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.probeAccept({ root: 'account|two' }),
    provider: 'codex',
    method: 'probeAccept',
    expected: {
      url: '/api/codex/probe/accept',
      method: 'POST',
      cache: undefined,
      headers: { 'Content-Type': 'application/json' },
      body: '{"root":"account|two"}',
    },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.addRoot({ path: '/target', label: 'label' }),
    provider: 'codex',
    method: 'addRoot',
    expected: {
      url: '/api/codex/roots',
      method: 'POST',
      cache: undefined,
      headers: { 'Content-Type': 'application/json' },
      body: '{"path":"/target","label":"label"}',
    },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.addRoot({ path: '/target' }),
    provider: 'codex',
    method: 'addRoot',
    expected: { url: '/api/codex/roots', method: 'POST', cache: undefined, headers: { 'Content-Type': 'application/json' }, body: '{"path":"/target"}' },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.relabelRoot({ id: 'account|two', label: 'label' }),
    provider: 'codex',
    method: 'relabelRoot',
    expected: {
      url: '/api/codex/roots/label',
      method: 'POST',
      cache: undefined,
      headers: { 'Content-Type': 'application/json' },
      body: '{"id":"account|two","label":"label"}',
    },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.removeRoot({ id: 'account|two' }),
    provider: 'codex',
    method: 'removeRoot',
    expected: { url: '/api/codex/roots?id=account%7Ctwo', method: 'DELETE', cache: undefined, headers: {}, body: undefined },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.stats({ root: 'account|two' }),
    provider: 'codex',
    method: 'stats',
    expected: { url: '/api/codex/stats?root=account%7Ctwo', method: 'GET', cache: 'no-store', headers: {}, body: undefined },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.history({ root: 'account|two' }),
    provider: 'codex',
    method: 'history',
    expected: { url: '/api/codex/history?root=account%7Ctwo', method: 'GET', cache: 'no-store', headers: {}, body: undefined },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.usage({ root: 'account|two' }),
    provider: 'codex',
    method: 'usage',
    expected: { url: '/api/codex/usage?root=account%7Ctwo', method: 'GET', cache: 'no-store', headers: {}, body: undefined },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.plugins({ root: 'account|two' }),
    provider: 'codex',
    method: 'plugins',
    expected: { url: '/api/codex/plugins?root=account%7Ctwo', method: 'GET', cache: 'no-store', headers: {}, body: undefined },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.activity({ root: 'account|two', days: 14 }),
    provider: 'codex',
    method: 'activity',
    expected: { url: '/api/codex/activity?root=account%7Ctwo&days=14', method: 'GET', cache: 'no-store', headers: {}, body: undefined },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.activity({ root: 'account|two' }),
    provider: 'codex',
    method: 'activity',
    expected: { url: '/api/codex/activity?root=account%7Ctwo&days=undefined', method: 'GET', cache: 'no-store', headers: {}, body: undefined },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.skillRun({ root: 'account|two', slug: '/工作/a?b' }),
    provider: 'codex',
    method: 'skillRun',
    expected: {
      url: '/api/codex/skill-run',
      method: 'POST',
      cache: undefined,
      headers: { 'Content-Type': 'application/json' },
      body: '{"root":"account|two","slug":"/工作/a?b"}',
    },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.terminal({ root: 'account|two', id: 'session:1' }),
    provider: 'codex',
    method: 'terminal',
    expected: {
      url: '/api/codex/terminal',
      method: 'POST',
      cache: undefined,
      headers: { 'Content-Type': 'application/json' },
      body: '{"root":"account|two","id":"session:1"}',
    },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.terminals(),
    provider: 'codex',
    method: 'terminals',
    expected: { url: '/api/codex/terminals', method: 'GET', cache: 'no-store', headers: {}, body: undefined },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.terminalStop({ key: 'opaque|key' }),
    provider: 'codex',
    method: 'terminalStop',
    expected: { url: '/api/codex/terminal?key=opaque%7Ckey', method: 'DELETE', cache: undefined, headers: {}, body: undefined },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.browse({ path: '/target' }),
    provider: 'codex',
    method: 'browse',
    expected: { url: '/api/codex/browse?path=%2Ftarget', method: 'GET', cache: 'no-store', headers: {}, body: undefined },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.browse(),
    provider: 'codex',
    method: 'browse',
    expected: { url: '/api/codex/browse', method: 'GET', cache: 'no-store', headers: {}, body: undefined },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.pickFolder(),
    provider: 'codex',
    method: 'pickFolder',
    expected: { url: '/api/codex/pick-folder', method: 'GET', cache: 'no-store', headers: {}, body: undefined },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.session({ root: 'account|two', slug: '/工作/a?b', id: 'session:1' }),
    provider: 'codex',
    method: 'session',
    expected: { url: '/api/codex/session?root=account%7Ctwo&id=session%3A1', method: 'GET', cache: 'no-store', headers: {}, body: undefined },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.raw({ root: 'account|two', slug: '/工作/a?b', id: 'session:1' }),
    provider: 'codex',
    method: 'raw',
    expected: { url: '/api/codex/raw?root=account%7Ctwo&id=session%3A1', method: 'GET', cache: 'no-store', headers: {}, body: undefined },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.subagents({ root: 'account|two', slug: '/工作/a?b', id: 'session:1' }),
    provider: 'codex',
    method: 'subagents',
    expected: { url: '/api/codex/subagents?root=account%7Ctwo&id=session%3A1', method: 'GET', cache: 'no-store', headers: {}, body: undefined },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.deleteSession({ root: 'account|two', slug: '/工作/a?b', id: 'session:1' }),
    provider: 'codex',
    method: 'deleteSession',
    expected: { url: '/api/codex/session?root=account%7Ctwo&id=session%3A1', method: 'DELETE', cache: undefined, headers: {}, body: undefined },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) =>
      client.subagent({ root: 'account|two', slug: '/工作/a?b', id: 'session:1', run: 'run', agent: 'agent' }),
    provider: 'codex',
    method: 'subagent',
    expected: {
      url: '/api/codex/subagent?root=account%7Ctwo&slug=%2F%E5%B7%A5%E4%BD%9C%2Fa%3Fb&session=session%3A1&run=run&agent=agent',
      method: 'GET',
      cache: 'no-store',
      headers: {},
      body: undefined,
    },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.subagent({ root: 'account|two', slug: '/工作/a?b', id: 'session:1', agent: 'agent' }),
    provider: 'codex',
    method: 'subagent',
    expected: {
      url: '/api/codex/subagent?root=account%7Ctwo&slug=%2F%E5%B7%A5%E4%BD%9C%2Fa%3Fb&session=session%3A1&agent=agent',
      method: 'GET',
      cache: 'no-store',
      headers: {},
      body: undefined,
    },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.memory({ root: 'account|two' }),
    provider: 'codex',
    method: 'memory',
    expected: { url: '/api/codex/memory?root=account%7Ctwo', method: 'GET', cache: 'no-store', headers: {}, body: undefined },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.memory({ root: 'account|two', slug: '/工作/a?b' }),
    provider: 'codex',
    method: 'memory',
    expected: {
      url: '/api/codex/memory?root=account%7Ctwo&slug=%2F%E5%B7%A5%E4%BD%9C%2Fa%3Fb',
      method: 'GET',
      cache: 'no-store',
      headers: {},
      body: undefined,
    },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.fork({ root: 'account|two', slug: '/工作/a?b', id: 'session:1' }, 0),
    provider: 'codex',
    method: 'fork',
    expected: {
      url: '/api/codex/fork',
      method: 'POST',
      cache: undefined,
      headers: { 'Content-Type': 'application/json' },
      body: '{"root":"account|two","id":"session:1","cut":0}',
    },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.fork({ root: 'account|two', slug: '/工作/a?b', id: 'session:1' }),
    provider: 'codex',
    method: 'fork',
    expected: {
      url: '/api/codex/fork',
      method: 'POST',
      cache: undefined,
      headers: { 'Content-Type': 'application/json' },
      body: '{"root":"account|two","id":"session:1","cut":null}',
    },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.fork({ root: 'account|two', slug: '/工作/a?b', id: 'session:1' }, 'uuid'),
    provider: 'codex',
    method: 'fork',
    expected: {
      url: '/api/codex/fork',
      method: 'POST',
      cache: undefined,
      headers: { 'Content-Type': 'application/json' },
      body: '{"root":"account|two","id":"session:1","cut":"uuid"}',
    },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) =>
      client.saveMemory({ root: 'account|two', slug: '/工作/a?b', name: 'name with spaces', content: 'hello\nworld' }),
    provider: 'codex',
    method: 'saveMemory',
    expected: {
      url: '/api/codex/memory',
      method: 'POST',
      cache: undefined,
      headers: { 'Content-Type': 'application/json' },
      body: '{"root":"account|two","slug":"/工作/a?b","name":"name with spaces","content":"hello\\nworld"}',
    },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.deleteMemory({ root: 'account|two', slug: '/工作/a?b', name: 'name with spaces' }),
    provider: 'codex',
    method: 'deleteMemory',
    expected: {
      url: '/api/codex/memory?root=account%7Ctwo&slug=%2F%E5%B7%A5%E4%BD%9C%2Fa%3Fb&name=name+with+spaces',
      method: 'DELETE',
      cache: undefined,
      headers: {},
      body: undefined,
    },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.resources({ root: 'account|two', scope: 'project', slug: '/工作/a?b' }),
    provider: 'codex',
    method: 'resources',
    expected: {
      url: '/api/codex/resources?root=account%7Ctwo&scope=project&slug=%2F%E5%B7%A5%E4%BD%9C%2Fa%3Fb',
      method: 'GET',
      cache: 'no-store',
      headers: {},
      body: undefined,
    },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.resources({ root: 'account|two', scope: 'user' }),
    provider: 'codex',
    method: 'resources',
    expected: { url: '/api/codex/resources?root=account%7Ctwo&scope=user', method: 'GET', cache: 'no-store', headers: {}, body: undefined },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) =>
      client.resource({ root: 'account|two', kind: 'skills', name: 'name with spaces', slug: '/工作/a?b' }),
    provider: 'codex',
    method: 'resource',
    expected: {
      url: '/api/codex/resource?root=account%7Ctwo&kind=skills&name=name+with+spaces&slug=%2F%E5%B7%A5%E4%BD%9C%2Fa%3Fb',
      method: 'GET',
      cache: 'no-store',
      headers: {},
      body: undefined,
    },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.resource({ root: 'account|two', kind: 'skills', name: 'name with spaces' }),
    provider: 'codex',
    method: 'resource',
    expected: {
      url: '/api/codex/resource?root=account%7Ctwo&kind=skills&name=name+with+spaces',
      method: 'GET',
      cache: 'no-store',
      headers: {},
      body: undefined,
    },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) =>
      client.saveResource({ root: 'account|two', kind: 'skills', name: 'name with spaces', content: 'hello\nworld', slug: '/工作/a?b' }),
    provider: 'codex',
    method: 'saveResource',
    expected: {
      url: '/api/codex/resource',
      method: 'POST',
      cache: undefined,
      headers: { 'Content-Type': 'application/json' },
      body: '{"root":"account|two","kind":"skills","name":"name with spaces","content":"hello\\nworld","slug":"/工作/a?b"}',
    },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) =>
      client.saveResource({ root: 'account|two', kind: 'skills', name: 'name with spaces', content: 'hello\nworld' }),
    provider: 'codex',
    method: 'saveResource',
    expected: {
      url: '/api/codex/resource',
      method: 'POST',
      cache: undefined,
      headers: { 'Content-Type': 'application/json' },
      body: '{"root":"account|two","kind":"skills","name":"name with spaces","content":"hello\\nworld"}',
    },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.createResource({ root: 'account|two', kind: 'skills', name: 'name with spaces' }),
    provider: 'codex',
    method: 'createResource',
    expected: {
      url: '/api/codex/resource',
      method: 'POST',
      cache: undefined,
      headers: { 'Content-Type': 'application/json' },
      body: '{"root":"account|two","kind":"skills","name":"name with spaces"}',
    },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) =>
      client.deleteResource({ root: 'account|two', scope: 'project', slug: '/工作/a?b', kind: 'skills', name: 'name with spaces', stamp: '123' }),
    provider: 'codex',
    method: 'deleteResource',
    expected: {
      url: '/api/codex/resource?root=account%7Ctwo&scope=project&slug=%2F%E5%B7%A5%E4%BD%9C%2Fa%3Fb&kind=skills&name=name+with+spaces',
      method: 'DELETE',
      cache: undefined,
      headers: {},
      body: undefined,
    },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) =>
      client.deleteResource({ root: 'account|two', scope: 'user', kind: 'skills', name: 'name with spaces', stamp: '123' }),
    provider: 'codex',
    method: 'deleteResource',
    expected: {
      url: '/api/codex/resource?root=account%7Ctwo&scope=user&kind=skills&name=name+with+spaces',
      method: 'DELETE',
      cache: undefined,
      headers: {},
      body: undefined,
    },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) =>
      client.open({ root: 'account|two', slug: '/工作/a?b', id: 'session:1' }, { what: 'code', cwd: '/target' }),
    provider: 'codex',
    method: 'open',
    expected: {
      url: '/api/codex/open',
      method: 'POST',
      cache: undefined,
      headers: { 'Content-Type': 'application/json' },
      body: '{"root":"account|two","id":"session:1","what":"code","cwd":"/target","slug":"/工作/a?b"}',
    },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.open({ root: 'account|two' }, { what: 'code' }),
    provider: 'codex',
    method: 'open',
    expected: {
      url: '/api/codex/open',
      method: 'POST',
      cache: undefined,
      headers: { 'Content-Type': 'application/json' },
      body: '{"root":"account|two","what":"code"}',
    },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.roots(),
    provider: 'antigravity',
    method: 'roots',
    expected: { url: '/api/antigravity/roots', method: 'GET', cache: 'no-store', headers: {}, body: undefined },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.projects({ root: 'account|two' }),
    provider: 'antigravity',
    method: 'projects',
    expected: { url: '/api/antigravity/projects?root=account%7Ctwo', method: 'GET', cache: 'no-store', headers: {}, body: undefined },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.sessions({ root: 'account|two', slug: '/工作/a?b' }),
    provider: 'antigravity',
    method: 'sessions',
    expected: {
      url: '/api/antigravity/sessions?root=account%7Ctwo&slug=%2F%E5%B7%A5%E4%BD%9C%2Fa%3Fb',
      method: 'GET',
      cache: 'no-store',
      headers: {},
      body: undefined,
    },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.probeRun({ root: 'account|two' }),
    provider: 'antigravity',
    method: 'probeRun',
    expected: {
      url: '/api/antigravity/probe/run',
      method: 'POST',
      cache: undefined,
      headers: { 'Content-Type': 'application/json' },
      body: '{"root":"account|two"}',
    },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.probeAccept({ root: 'account|two' }),
    provider: 'antigravity',
    method: 'probeAccept',
    expected: {
      url: '/api/antigravity/probe/accept',
      method: 'POST',
      cache: undefined,
      headers: { 'Content-Type': 'application/json' },
      body: '{"root":"account|two"}',
    },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.addRoot({ path: '/target', label: 'label' }),
    provider: 'antigravity',
    method: 'addRoot',
    expected: {
      url: '/api/antigravity/roots',
      method: 'POST',
      cache: undefined,
      headers: { 'Content-Type': 'application/json' },
      body: '{"path":"/target","label":"label"}',
    },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.addRoot({ path: '/target' }),
    provider: 'antigravity',
    method: 'addRoot',
    expected: { url: '/api/antigravity/roots', method: 'POST', cache: undefined, headers: { 'Content-Type': 'application/json' }, body: '{"path":"/target"}' },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.relabelRoot({ id: 'account|two', label: 'label' }),
    provider: 'antigravity',
    method: 'relabelRoot',
    expected: {
      url: '/api/antigravity/roots/label',
      method: 'POST',
      cache: undefined,
      headers: { 'Content-Type': 'application/json' },
      body: '{"id":"account|two","label":"label"}',
    },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.removeRoot({ id: 'account|two' }),
    provider: 'antigravity',
    method: 'removeRoot',
    expected: { url: '/api/antigravity/roots?id=account%7Ctwo', method: 'DELETE', cache: undefined, headers: {}, body: undefined },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.stats({ root: 'account|two' }),
    provider: 'antigravity',
    method: 'stats',
    expected: { url: '/api/antigravity/stats?root=account%7Ctwo', method: 'GET', cache: 'no-store', headers: {}, body: undefined },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.history({ root: 'account|two' }),
    provider: 'antigravity',
    method: 'history',
    expected: { url: '/api/antigravity/history?root=account%7Ctwo', method: 'GET', cache: 'no-store', headers: {}, body: undefined },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.usage({ root: 'account|two' }),
    provider: 'antigravity',
    method: 'usage',
    expected: { url: '/api/antigravity/usage?root=account%7Ctwo', method: 'GET', cache: 'no-store', headers: {}, body: undefined },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.plugins({ root: 'account|two' }),
    provider: 'antigravity',
    method: 'plugins',
    expected: { url: '/api/antigravity/plugins?root=account%7Ctwo', method: 'GET', cache: 'no-store', headers: {}, body: undefined },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.activity({ root: 'account|two', days: 14 }),
    provider: 'antigravity',
    method: 'activity',
    expected: { url: '/api/antigravity/activity?root=account%7Ctwo&days=14', method: 'GET', cache: 'no-store', headers: {}, body: undefined },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.activity({ root: 'account|two' }),
    provider: 'antigravity',
    method: 'activity',
    expected: { url: '/api/antigravity/activity?root=account%7Ctwo&days=undefined', method: 'GET', cache: 'no-store', headers: {}, body: undefined },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.skillRun({ root: 'account|two', slug: '/工作/a?b' }),
    provider: 'antigravity',
    method: 'skillRun',
    expected: {
      url: '/api/antigravity/skill-run',
      method: 'POST',
      cache: undefined,
      headers: { 'Content-Type': 'application/json' },
      body: '{"root":"account|two","slug":"/工作/a?b"}',
    },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.terminal({ root: 'account|two', id: 'session:1' }),
    provider: 'antigravity',
    method: 'terminal',
    expected: {
      url: '/api/antigravity/terminal',
      method: 'POST',
      cache: undefined,
      headers: { 'Content-Type': 'application/json' },
      body: '{"root":"account|two","id":"session:1"}',
    },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.terminals(),
    provider: 'antigravity',
    method: 'terminals',
    expected: { url: '/api/antigravity/terminals', method: 'GET', cache: 'no-store', headers: {}, body: undefined },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.terminalStop({ key: 'opaque|key' }),
    provider: 'antigravity',
    method: 'terminalStop',
    expected: { url: '/api/antigravity/terminal?key=opaque%7Ckey', method: 'DELETE', cache: undefined, headers: {}, body: undefined },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.browse({ path: '/target' }),
    provider: 'antigravity',
    method: 'browse',
    expected: { url: '/api/antigravity/browse?path=%2Ftarget', method: 'GET', cache: 'no-store', headers: {}, body: undefined },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.browse(),
    provider: 'antigravity',
    method: 'browse',
    expected: { url: '/api/antigravity/browse', method: 'GET', cache: 'no-store', headers: {}, body: undefined },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.pickFolder(),
    provider: 'antigravity',
    method: 'pickFolder',
    expected: { url: '/api/antigravity/pick-folder', method: 'GET', cache: 'no-store', headers: {}, body: undefined },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.session({ root: 'account|two', slug: '/工作/a?b', id: 'session:1' }),
    provider: 'antigravity',
    method: 'session',
    expected: { url: '/api/antigravity/session?root=account%7Ctwo&id=session%3A1', method: 'GET', cache: 'no-store', headers: {}, body: undefined },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.raw({ root: 'account|two', slug: '/工作/a?b', id: 'session:1' }),
    provider: 'antigravity',
    method: 'raw',
    expected: { url: '/api/antigravity/raw?root=account%7Ctwo&id=session%3A1', method: 'GET', cache: 'no-store', headers: {}, body: undefined },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.subagents({ root: 'account|two', slug: '/工作/a?b', id: 'session:1' }),
    provider: 'antigravity',
    method: 'subagents',
    expected: { url: '/api/antigravity/subagents?root=account%7Ctwo&id=session%3A1', method: 'GET', cache: 'no-store', headers: {}, body: undefined },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.deleteSession({ root: 'account|two', slug: '/工作/a?b', id: 'session:1' }),
    provider: 'antigravity',
    method: 'deleteSession',
    expected: { url: '/api/antigravity/session?root=account%7Ctwo&id=session%3A1', method: 'DELETE', cache: undefined, headers: {}, body: undefined },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) =>
      client.subagent({ root: 'account|two', slug: '/工作/a?b', id: 'session:1', run: 'run', agent: 'agent' }),
    provider: 'antigravity',
    method: 'subagent',
    expected: {
      url: '/api/antigravity/subagent?root=account%7Ctwo&slug=%2F%E5%B7%A5%E4%BD%9C%2Fa%3Fb&session=session%3A1&run=run&agent=agent',
      method: 'GET',
      cache: 'no-store',
      headers: {},
      body: undefined,
    },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.subagent({ root: 'account|two', slug: '/工作/a?b', id: 'session:1', agent: 'agent' }),
    provider: 'antigravity',
    method: 'subagent',
    expected: {
      url: '/api/antigravity/subagent?root=account%7Ctwo&slug=%2F%E5%B7%A5%E4%BD%9C%2Fa%3Fb&session=session%3A1&agent=agent',
      method: 'GET',
      cache: 'no-store',
      headers: {},
      body: undefined,
    },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.memory({ root: 'account|two' }),
    provider: 'antigravity',
    method: 'memory',
    expected: { url: '/api/antigravity/memory?root=account%7Ctwo', method: 'GET', cache: 'no-store', headers: {}, body: undefined },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.memory({ root: 'account|two', slug: '/工作/a?b' }),
    provider: 'antigravity',
    method: 'memory',
    expected: {
      url: '/api/antigravity/memory?root=account%7Ctwo&slug=%2F%E5%B7%A5%E4%BD%9C%2Fa%3Fb',
      method: 'GET',
      cache: 'no-store',
      headers: {},
      body: undefined,
    },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.fork({ root: 'account|two', slug: '/工作/a?b', id: 'session:1' }, 0),
    provider: 'antigravity',
    method: 'fork',
    expected: {
      url: '/api/antigravity/fork',
      method: 'POST',
      cache: undefined,
      headers: { 'Content-Type': 'application/json' },
      body: '{"root":"account|two","id":"session:1","cut":0}',
    },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.fork({ root: 'account|two', slug: '/工作/a?b', id: 'session:1' }),
    provider: 'antigravity',
    method: 'fork',
    expected: {
      url: '/api/antigravity/fork',
      method: 'POST',
      cache: undefined,
      headers: { 'Content-Type': 'application/json' },
      body: '{"root":"account|two","id":"session:1","cut":null}',
    },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.fork({ root: 'account|two', slug: '/工作/a?b', id: 'session:1' }, 'uuid'),
    provider: 'antigravity',
    method: 'fork',
    expected: {
      url: '/api/antigravity/fork',
      method: 'POST',
      cache: undefined,
      headers: { 'Content-Type': 'application/json' },
      body: '{"root":"account|two","id":"session:1","cut":"uuid"}',
    },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) =>
      client.saveMemory({ root: 'account|two', slug: '/工作/a?b', name: 'name with spaces', content: 'hello\nworld' }),
    provider: 'antigravity',
    method: 'saveMemory',
    expected: {
      url: '/api/antigravity/memory',
      method: 'POST',
      cache: undefined,
      headers: { 'Content-Type': 'application/json' },
      body: '{"root":"account|two","slug":"/工作/a?b","name":"name with spaces","content":"hello\\nworld"}',
    },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.deleteMemory({ root: 'account|two', slug: '/工作/a?b', name: 'name with spaces' }),
    provider: 'antigravity',
    method: 'deleteMemory',
    expected: {
      url: '/api/antigravity/memory?root=account%7Ctwo&slug=%2F%E5%B7%A5%E4%BD%9C%2Fa%3Fb&name=name+with+spaces',
      method: 'DELETE',
      cache: undefined,
      headers: {},
      body: undefined,
    },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.resources({ root: 'account|two', scope: 'project', slug: '/工作/a?b' }),
    provider: 'antigravity',
    method: 'resources',
    expected: {
      url: '/api/antigravity/resources?root=account%7Ctwo&scope=project&slug=%2F%E5%B7%A5%E4%BD%9C%2Fa%3Fb',
      method: 'GET',
      cache: 'no-store',
      headers: {},
      body: undefined,
    },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.resources({ root: 'account|two', scope: 'user' }),
    provider: 'antigravity',
    method: 'resources',
    expected: { url: '/api/antigravity/resources?root=account%7Ctwo&scope=user', method: 'GET', cache: 'no-store', headers: {}, body: undefined },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) =>
      client.resource({ root: 'account|two', kind: 'skills', name: 'name with spaces', slug: '/工作/a?b' }),
    provider: 'antigravity',
    method: 'resource',
    expected: {
      url: '/api/antigravity/resource?root=account%7Ctwo&kind=skills&name=name+with+spaces&slug=%2F%E5%B7%A5%E4%BD%9C%2Fa%3Fb',
      method: 'GET',
      cache: 'no-store',
      headers: {},
      body: undefined,
    },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.resource({ root: 'account|two', kind: 'skills', name: 'name with spaces' }),
    provider: 'antigravity',
    method: 'resource',
    expected: {
      url: '/api/antigravity/resource?root=account%7Ctwo&kind=skills&name=name+with+spaces',
      method: 'GET',
      cache: 'no-store',
      headers: {},
      body: undefined,
    },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) =>
      client.saveResource({ root: 'account|two', kind: 'skills', name: 'name with spaces', content: 'hello\nworld', slug: '/工作/a?b' }),
    provider: 'antigravity',
    method: 'saveResource',
    expected: {
      url: '/api/antigravity/resource',
      method: 'POST',
      cache: undefined,
      headers: { 'Content-Type': 'application/json' },
      body: '{"root":"account|two","kind":"skills","name":"name with spaces","content":"hello\\nworld","slug":"/工作/a?b"}',
    },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) =>
      client.saveResource({ root: 'account|two', kind: 'skills', name: 'name with spaces', content: 'hello\nworld' }),
    provider: 'antigravity',
    method: 'saveResource',
    expected: {
      url: '/api/antigravity/resource',
      method: 'POST',
      cache: undefined,
      headers: { 'Content-Type': 'application/json' },
      body: '{"root":"account|two","kind":"skills","name":"name with spaces","content":"hello\\nworld"}',
    },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.createResource({ root: 'account|two', kind: 'skills', name: 'name with spaces' }),
    provider: 'antigravity',
    method: 'createResource',
    expected: {
      url: '/api/antigravity/resource',
      method: 'POST',
      cache: undefined,
      headers: { 'Content-Type': 'application/json' },
      body: '{"root":"account|two","kind":"skills","name":"name with spaces"}',
    },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) =>
      client.deleteResource({ root: 'account|two', scope: 'project', slug: '/工作/a?b', kind: 'skills', name: 'name with spaces', stamp: '123' }),
    provider: 'antigravity',
    method: 'deleteResource',
    expected: {
      url: '/api/antigravity/resource?root=account%7Ctwo&scope=project&slug=%2F%E5%B7%A5%E4%BD%9C%2Fa%3Fb&kind=skills&name=name+with+spaces',
      method: 'DELETE',
      cache: undefined,
      headers: {},
      body: undefined,
    },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) =>
      client.deleteResource({ root: 'account|two', scope: 'user', kind: 'skills', name: 'name with spaces', stamp: '123' }),
    provider: 'antigravity',
    method: 'deleteResource',
    expected: {
      url: '/api/antigravity/resource?root=account%7Ctwo&scope=user&kind=skills&name=name+with+spaces',
      method: 'DELETE',
      cache: undefined,
      headers: {},
      body: undefined,
    },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) =>
      client.open({ root: 'account|two', slug: '/工作/a?b', id: 'session:1' }, { what: 'code', cwd: '/target' }),
    provider: 'antigravity',
    method: 'open',
    expected: {
      url: '/api/antigravity/open',
      method: 'POST',
      cache: undefined,
      headers: { 'Content-Type': 'application/json' },
      body: '{"root":"account|two","id":"session:1","what":"code","cwd":"/target","slug":"/工作/a?b"}',
    },
  },
  {
    run: (client: ReturnType<typeof createProviderClient>) => client.open({ root: 'account|two' }, { what: 'code' }),
    provider: 'antigravity',
    method: 'open',
    expected: {
      url: '/api/antigravity/open',
      method: 'POST',
      cache: undefined,
      headers: { 'Content-Type': 'application/json' },
      body: '{"root":"account|two","what":"code"}',
    },
  },
]

for (const provider of ['claude', 'codex', 'antigravity']) {
  test(provider + ' endpoint contracts retain exact legacy requests', async () => {
    const calls: unknown[] = []
    const fetch: typeof globalThis.fetch = async (url, options = {}) => {
      calls.push({ url, method: options.method, cache: options.cache, headers: options.headers, body: options.body })
      return new Response('{}', { status: 200 })
    }
    const client = createProviderClient(provider, providerMetadata(provider).addressing, createFetcher({ fetch }))
    for (const { method, expected, run } of contracts.filter((row) => row.provider === provider)) {
      calls.length = 0
      await run(client)
      assert.deepEqual(calls, [expected], provider + '.' + method)
    }
  })
}

test('provider-bound API clients never leak the selected provider', async () => {
  const urls: unknown[] = []
  const fetch: typeof globalThis.fetch = async (url) => {
    urls.push(url)
    return new Response('{}')
  }
  const request = createFetcher({ fetch })
  const client = (provider: string) => createProviderClient(provider, providerMetadata(provider).addressing, request)
  const claude = client('claude'),
    codex = client('codex')
  await Promise.all([claude.roots(), codex.roots(), claude.projects({ root: 'r1' }), codex.projects({ root: 'r2' })])
  assert.deepEqual(urls, ['/api/claude/roots', '/api/codex/roots', '/api/claude/projects?root=r1', '/api/codex/projects?root=r2'])
})
