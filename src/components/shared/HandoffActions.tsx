import { shellActions } from '../../store/index.ts'
// Local conversation actions, shared by every provider's terminal panel.
export default function HandoffActions({
  provider,
  root,
  slug,
  id,
  cwd,
  title,
  disabled = false,
}: import('../../../shared/types.d.ts').Target & { disabled?: boolean }) {
  if (!id) return null
  const open = (mode: 'send' | 'export') => shellActions.requestHandoff({ mode, source: { provider, root, slug, id, cwd, title } })
  const cls = 'shrink-0 whitespace-nowrap text-[12px] px-2 py-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-ink-700 disabled:opacity-40'
  return (
    <>
      <button type="button" className={cls} disabled={disabled} onClick={() => open('send')}>
        Continue with another AI
      </button>
      <button type="button" className={cls} disabled={disabled} onClick={() => open('export')}>
        Export JSONL
      </button>
    </>
  )
}
