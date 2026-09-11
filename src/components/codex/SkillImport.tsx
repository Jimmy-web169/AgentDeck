import SkillImport from '../shared/SkillImport.tsx'
import { useProviderApi } from '../../api/index.ts'
const policy = {
  title: 'Install a skill (Codex)',
  agent: 'codex',
  stripAgent: true,
  showScope: true,
  projectLabel: 'this project (./.codex/skills)',
  userLabel: 'the Codex home (~/.codex/skills)',
  placeholder: 'softaworks/agent-toolkit --skill codex',
}
function Description() {
  return (
    <div className="text-[12px] text-zinc-500">
      Runs the official{' '}
      <a href="https://github.com/vercel-labs/skills" target="_blank" rel="noreferrer" className="text-sky-400 underline">
        skills
      </a>{' '}
      CLI for Codex — the same as <span className="font-mono text-zinc-400">npx skills add &lt;ref&gt; -a codex</span> in a terminal. Paste an{' '}
      <span className="font-mono text-zinc-400">owner/repo</span>, a GitHub/skills.sh URL, or a full command (with flags like{' '}
      <span className="font-mono text-zinc-400">--skill &lt;name&gt;</span>). Browse skills at{' '}
      <a href="https://www.skills.sh/agent/codex" target="_blank" rel="noreferrer" className="text-sky-400 underline">
        skills.sh
      </a>
      .
    </div>
  )
}
export default function ProviderSkillImport(props: import('../shared/SkillImport.tsx').SkillProps) {
  const api = useProviderApi()
  return <SkillImport {...props} api={api} policy={policy} Description={Description} isProject={props.scope === 'project' && !!props.slug} />
}
