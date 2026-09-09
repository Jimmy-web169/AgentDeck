// Local conversation actions, shared by every provider's terminal panel.
export default function HandoffActions({ provider, root, slug, id, cwd, title, disabled = false }) {
  if (!id) return null
  const open = (mode) => window.dispatchEvent(new CustomEvent('agentdeck:conversation-handoff', {
    detail: { mode, source: { provider, root, slug, id, cwd, title } },
  }))
  const cls = 'shrink-0 whitespace-nowrap text-[12px] px-2 py-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-ink-700 disabled:opacity-40'
  return <>
    <button className={cls} disabled={disabled} onClick={() => open('send')}>Continue with another AI</button>
    <button className={cls} disabled={disabled} onClick={() => open('export')}>Export JSONL</button>
  </>
}
