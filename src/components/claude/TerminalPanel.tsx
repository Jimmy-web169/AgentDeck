import type { TerminalProps, TerminalPresentation, MeterProps, TitleProps } from '../shared/TerminalPanel.tsx'
import TerminalPanel from '../shared/TerminalPanel.tsx'
import { claudeApi } from '../../api/index.ts'
import { legacyProjectSessionKey } from '../../../shared/identity.ts'

const presentation: TerminalPresentation = {
  sessionKey: legacyProjectSessionKey,
  height: { key: 'cm_termH', minimum: 160, maximum: Infinity, fallback: () => 500 },
  continueLabel: '▸ Open terminal (continue this session)',
  endTitle: 'End this terminal',
  panelClass: 'shrink-0 border-t border-zinc-800 flex flex-col',
  headerClass: 'min-h-7 py-1 shrink-0 flex flex-wrap items-center gap-2 px-3 text-[11px] bg-ink-900/70 border-b border-zinc-800',
  reloadClass: 'text-zinc-500 hover:text-zinc-200',
  reloadLabel: '⟳ reload',
  idleContext: false,
  headerError: false,
  wrapFrame: false,
  frameTitle: 'claude terminal',
}
function IdleNote() {
  return (
    <>
      runs the real <span className="font-mono">claude</span> TUI here via ttyd — uses this folder’s account login
    </>
  )
}
function Title({ isNew }: TitleProps) {
  return <>terminal · real claude TUI{isNew ? ' · new' : ''}</>
}
function ContextMeter({ used }: MeterProps) {
  return used == null ? null : (
    <span
      className={'font-mono mr-1 ' + (used >= 90 ? 'text-red-300' : used >= 70 ? 'text-amber-300' : 'text-sky-300')}
      title="context window used for this session (from the status line)"
    >
      ⛶ ctx {used}% used
    </span>
  )
}
export default function ClaudeTerminalPanel(props: TerminalProps) {
  return <TerminalPanel {...props} api={claudeApi} presentation={presentation} IdleNote={IdleNote} Title={Title} ContextMeter={ContextMeter} />
}
