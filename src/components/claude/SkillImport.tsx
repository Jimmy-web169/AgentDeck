import SkillImport from '../shared/SkillImport.tsx'
import { claudeApi } from '../../api/index.ts'
const policy = {
  title: 'Install a skill',
  agent: 'claude-code',
  stripAgent: false,
  showScope: false,
  projectLabel: 'this project (./.claude/skills)',
  userLabel: 'the user folder (~/.claude/skills)',
  placeholder: 'vercel-labs/agent-skills --skill agent-browser',
}
function Description() {
  return (
    <div className="text-[12px] text-zinc-500">
      Runs the official{' '}
      <a href="https://github.com/vercel-labs/skills" target="_blank" rel="noreferrer" className="text-sky-400 underline">
        skills
      </a>{' '}
      CLI — the same as <span className="font-mono text-zinc-400">npx skills add &lt;ref&gt;</span> in a terminal. Paste{' '}
      <span className="font-mono text-zinc-400">owner/repo</span>, a GitHub URL, or a full command (with flags like{' '}
      <span className="font-mono text-zinc-400">--skill &lt;name&gt;</span>). Browse skills at{' '}
      <a href="https://www.skills.sh/" target="_blank" rel="noreferrer" className="text-sky-400 underline">
        skills.sh
      </a>
      .
    </div>
  )
}
export default function ProviderSkillImport(props: import('../shared/SkillImport.tsx').SkillProps) {
  const api = claudeApi
  return <SkillImport {...props} api={api} policy={policy} Description={Description} isProject={!!props.slug} />
}
