import type { TerminalProps, TerminalPresentation, TitleProps } from '../shared/TerminalPanel.tsx'
import TerminalPanel from '../shared/TerminalPanel.tsx'
import { useProviderApi, useProviderResume } from '../../api/index.ts'
import { legacySessionKey } from '../../../shared/identity.ts'
import ContextMeter from './ContextMeter.tsx'

const presentation: TerminalPresentation = {
  sessionKey: (root, _slug, id) => legacySessionKey(root, id),
  height: { key: 'cxm_termH', minimum: 160, maximum: 1200, fallback: () => Math.round((typeof window !== 'undefined' ? window.innerHeight : 800) * 0.52) },
  continueLabel: '▸ Continue in a terminal',
  endTitle: 'Stop this terminal',
  panelClass: 'shrink-0 border-t border-zinc-800 bg-ink-900 flex flex-col',
  headerClass: 'min-h-8 py-1 shrink-0 flex flex-wrap items-center gap-2 px-3 text-[11px] border-b border-zinc-800/60',
  reloadClass: 'text-zinc-500 hover:text-zinc-200 ml-1',
  reloadTitle: 'reload',
  reloadLabel: '⟳',
  idleContext: true,
  headerError: true,
  wrapFrame: true,
  frameTitle: 'agent terminal',
}
function IdleNote({ resume }: { resume?: string }) {
  return (
    <>
      runs the real <span className="font-mono">{resume}</span> in an embedded terminal — stays alive when you switch away
    </>
  )
}
function Title({ isNew, resume, id }: TitleProps) {
  return <>{isNew ? 'new conversation' : resume + ' ' + (id ? id.slice(0, 8) : '')} — embedded terminal</>
}
export default function IdTerminalPanel(props: TerminalProps) {
  const api = useProviderApi(),
    resume = useProviderResume()
  return <TerminalPanel {...props} api={api} resume={resume} presentation={presentation} IdleNote={IdleNote} Title={Title} ContextMeter={ContextMeter} />
}
