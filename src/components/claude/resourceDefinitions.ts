export const DOCS_BASE = 'https://code.claude.com/docs'

export const DOCS: Record<string, string> = {
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
}

// kinds whose "+ new" opens the guided form (workflows stay JS-template only)
export const FORM_KINDS = new Set(['agents', 'skills', 'commands', 'rules', 'output-styles'])

// single config files (no list / no delete; edited in place)
export const SINGLE_KINDS: import('../../api/models.ts').ClaudeFileKind[] = ['claudeMd', 'mcpJson', 'settingsJson', 'settingsLocalJson']

// Order kept in sync with the Codex resources view so the categories the two
// providers share (Instructions, Agents, Skills, …, MCP, Settings) line up.
export const KINDS: { key: import('../../api/models.ts').ClaudeListKind; label: string; hint: string }[] = [
  { key: 'agents', label: 'Agents', hint: 'name.md' },
  { key: 'skills', label: 'Skills', hint: 'skill-folder-name' },
  { key: 'commands', label: 'Commands', hint: 'name.md' },
  { key: 'rules', label: 'Rules', hint: 'name.md or sub/name.md' },
  { key: 'output-styles', label: 'Output styles', hint: 'name.md' },
  { key: 'workflows', label: 'Workflows', hint: 'name.js' },
]

export const TEMPLATES: Record<string, string> = {
  agents: '---\nname: my-agent\ndescription: what this agent does\ntools: Read, Grep, Glob\n---\nYou are ...\n',
  commands: '---\ndescription: what this command does\nargument-hint: <arg>\n---\nInstructions. Use $ARGUMENTS for input.\n',
  workflows:
    "export const meta = {\n  name: 'my-workflow',\n  description: 'what it does',\n  phases: [{ title: 'Step' }],\n}\n\nphase('Step')\nconst out = await agent('do something')\nreturn out\n",
  skills: '---\nname: my-skill\ndescription: when to use this skill\n---\n# My Skill\nInstructions.\n',
  rules: '---\npaths:\n  - "src/**/*.ts"\n---\n\n# Rule\n- Convention that loads when a matching file is in context\n',
  'output-styles': '---\ndescription: what this style does\nkeep-coding-instructions: true\n---\nAppended to the system prompt.\n',
  claudeMd: '# Project conventions\n\n## Commands\n- Build: \n- Test: \n\n## Rules\n- \n',
  // Every MCP transport, as a multi-server example so you can see how each looks.
  mcpJson: `{
  "mcpServers": {
    "http-server": {
      "type": "http",
      "url": "https://mcp.example.com/mcp",
      "headers": { "Authorization": "Bearer \${API_TOKEN}" }
    },
    "sse-server": {
      "type": "sse",
      "url": "https://mcp.example.com/sse",
      "headers": { "X-API-Key": "\${API_KEY}" }
    },
    "stdio-server": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "some-mcp-server"],
      "env": { "SOME_API_KEY": "\${SOME_API_KEY}" }
    },
    "ws-server": {
      "type": "ws",
      "url": "wss://mcp.example.com/socket",
      "headers": { "Authorization": "Bearer \${TOKEN}" }
    }
  }
}
`,
  settingsJson: '{\n  "permissions": {\n    "allow": [],\n    "deny": []\n  }\n}\n',
  settingsLocalJson: '{\n  "permissions": {\n    "allow": []\n  }\n}\n',
}
