// Claude Code skill-install config for the shared skills runner (see
// ../../shared/skills.ts). `-a claude-code` targets Claude Code; the CLI resolves
// its install dir from CLAUDE_CONFIG_DIR.
export const SKILL_CONFIG = { agent: 'claude-code', envKey: 'CLAUDE_CONFIG_DIR' }
