import type { ReactNode, Dispatch, SetStateAction } from 'react'
import type { Target } from '../../../../shared/types.d.ts'
import type { SessionDetails } from '../../../api/models.ts'
import type { NavIndex } from '../../../api/useNavIndex.ts'
import type { UIProvider } from '../../../providers/views.ts'
import type { Workspace } from '../../../lib/workspaces.ts'
import type { useShellNavigation } from '../../../lib/useShellNavigation.ts'
import type { shellActions } from '../../../store/index.ts'
import type { MenuItem } from '../RowMenu.tsx'
export type SidebarSession = Partial<SessionDetails> & { id: string }
export interface SidebarRowsContext {
  providers: readonly UIProvider[]
  index: NavIndex
  dotFor: (provider: string | null | undefined, root: string | null | undefined, id: string) => string | null
  isActive: (provider: string | null | undefined, root: string | null | undefined, id: string) => boolean
  isRecent: (session: SidebarSession) => boolean
  selected: Set<string>
  toggleSelected: (id: string) => void
  onOpenTarget: typeof shellActions.openTarget
  onDeleteSession?: ReturnType<typeof useShellNavigation>['deleteSession']
  askTrash: (source: WorkspaceItem, session: SidebarSession, active: boolean) => Promise<void>
  menuFor: string | null
  setMenuFor: Dispatch<SetStateAction<string | null>>
  workspaces: Workspace[]
  openKeys: Set<string>
  toggleKey: (key: string) => void
  hidePinned: boolean
  hideGrouped: boolean
  drafts: Target[]
  activeTarget: Target | null
  newConversationItems: (source: WorkspaceItem) => MenuItem[]
  projectHidden: (source: Pin) => boolean
  folderPins: Pin[]
  folderFocus: { folderId: string } | null
  folderExpanded?: Set<string>
  setFolderExpanded?: Dispatch<SetStateAction<Set<string>>>
  onFolderWorkspaceChange: (id: string, added: boolean) => void
  folderSession?: boolean
}
import { ChevronRightIcon, PinIcon, DotsIcon, LayersIcon } from '../shellIcons.tsx'
import { providerColor, providerLabel } from '../../../lib/providerColors.ts'
import { shortPath } from '../../../lib/paths.ts'
import { sameTarget, targetKey } from '../../../lib/tabs.ts'
import { isPinned, type Pin, togglePin } from '../../../lib/pins.ts'
import { MOD_WORD } from '../ShortcutHints.tsx'
import { fmtRelative } from '../../../lib/format.ts'
import RowMenu from '../RowMenu.tsx'
import { FolderIcon } from '../icons.tsx'
import { sidebarItemKey } from '../../../../shared/identity.ts'
import { workspaceHolding, removeFromWorkspace, type WorkspaceItem } from '../../../lib/workspaces.ts'

export const INLINE_SESSIONS = 8

export const WS_GROUP_SESSIONS = 6

export const iconBtn = 'w-6 h-6 rounded flex items-center justify-center shrink-0 transition-colors'

export const hoverBtn = `${iconBtn} text-zinc-500 opacity-0 group-hover:opacity-100 hover:text-zinc-100 hover:bg-ink-600`

export const RECENT_MS = 5 * 60 * 1000

export function SectionHeader({
  title,
  count,
  open,
  onToggle,
  right,
}: {
  title: string
  count?: number
  open: boolean
  onToggle: () => void
  right?: ReactNode
}) {
  return (
    <div className="flex items-center gap-1 px-2 pt-2.5 pb-1">
      <button type="button" onClick={onToggle} className="flex items-center gap-1.5 text-[10.5px] uppercase tracking-wider text-zinc-500 hover:text-zinc-300">
        <ChevronRightIcon className={`w-3 h-3 transition-transform ${open ? 'rotate-90' : ''}`} />
        {title}
        {count != null && <span className="text-zinc-600 normal-case tracking-normal">· {count}</span>}
      </button>
      <span className="flex-1" />
      {right}
    </div>
  )
}

export function SourceTag({
  providers,
  provider,
  rootLabel,
  className = '',
}: {
  providers: readonly UIProvider[]
  provider?: string | null
  rootLabel?: string | null
  className?: string
}) {
  const c = providerColor(providers, provider)
  return (
    <span className={`inline-flex items-center gap-1 ${className}`} title={`${providerLabel(providers, provider)} · ${rootLabel}`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${c.dot}`} />
      <span className={`truncate ${c.text}`}>{rootLabel}</span>
    </span>
  )
}

export const srcOf = (p: WorkspaceItem) => ({
  provider: p.provider,
  root: p.root,
  rootLabel: p.rootLabel || '',
  slug: p.slug,
  project: p.project || p.name || shortPath(p.cwd || p.slug, 1),
  cwd: p.cwd || null,
})

export const sessionTarget = (src: WorkspaceItem, s: SidebarSession) => ({ ...src, id: s.id, title: s.title })

export const projectItem = (src: Pin) => ({ kind: 'project', ...src })

export const sessionItem = (src: WorkspaceItem, s: SidebarSession) => ({ kind: 'session', ...src, id: s.id, title: s.title })

export const draftsOf = (drafts: Target[] | undefined, src: WorkspaceItem) =>
  (drafts || []).filter((d) => d.provider === src.provider && d.root === src.root && ((d.slug && d.slug === src.slug) || (d.cwd && d.cwd === src.cwd)))

export function DraftLine({ ctx, d, indent = 'pl-7' }: { ctx: SidebarRowsContext; d: Target; indent?: string }) {
  const active = ctx.activeTarget?.draft && sameTarget(ctx.activeTarget, d)
  return (
    <button
      type="button"
      onClick={() => ctx.onOpenTarget(d)}
      title={`New conversation in ${d.cwd || d.slug} — nothing written yet`}
      className={`w-full text-left ${indent} pr-2 sb-row flex items-center gap-2 hover:bg-ink-700/50 ${active ? 'bg-sky-500/10 border-l-2 border-sky-500' : ''}`}
    >
      <span className="w-1.5 h-1.5 rounded-full shrink-0 border border-dashed border-zinc-500" />
      <span className="min-w-0 flex-1">
        <span className="block text-[12.5px] text-zinc-400 italic truncate">New conversation</span>
        <span className="block sb-meta text-[10.5px] text-zinc-600 truncate">not written yet</span>
      </span>
    </button>
  )
}

export function SessionLine({
  ctx,
  src,
  s,
  indent = 'pl-7',
  showSource = false,
  menuKey,
  extraItems = [],
  selectable = false,
}: {
  ctx: SidebarRowsContext
  src: WorkspaceItem
  s: SidebarSession
  indent?: string
  showSource?: boolean
  menuKey: string
  extraItems?: MenuItem[]
  selectable?: boolean
}) {
  const { providers, dotFor, isActive, isRecent, selected, toggleSelected, onOpenTarget, onDeleteSession, menuFor, setMenuFor, workspaces } = ctx
  const dot = dotFor(src.provider, src.root, s.id)
  const active = isActive(src.provider, src.root, s.id)
  const pinned = isPinned({ provider: src.provider, root: src.root, slug: src.slug, id: s.id })
  const checked = selectable && selected.has(s.id)
  const t = sessionTarget(src, s)
  const items = [...extraItems, onDeleteSession && { label: 'Move to trash', danger: true, onClick: () => ctx.askTrash(src, s, !!dot || isRecent(s)) }].filter(
    (item): item is MenuItem => !!item
  )
  return (
    <div
      className={`group relative flex items-stretch hover:bg-ink-700/50 ${selectable && checked ? 'bg-red-500/10' : active ? 'bg-sky-500/10 border-l-2 border-sky-500' : ''}`}
    >
      <button
        type="button"
        onClick={(e) => (selectable ? toggleSelected(s.id) : onOpenTarget(t, { newTab: e.ctrlKey || e.metaKey }))}
        onMouseDown={(e) => e.button === 1 && e.preventDefault()}
        onAuxClick={(e) => e.button === 1 && !selectable && onOpenTarget(t, { newTab: true })}
        title={selectable ? undefined : `${s.title}\nOpen here · ${MOD_WORD}+click or middle-click opens in a new tab`}
        className={`flex-1 min-w-0 text-left ${indent} pr-2 sb-row`}
      >
        <div className={`text-[12px] ${ctx.folderSession ? 'text-zinc-300' : 'text-zinc-400'} group-hover:text-zinc-200 truncate flex items-center gap-1.5`}>
          {selectable && <span className={`shrink-0 ${checked ? 'text-red-300' : 'text-zinc-600'}`}>{checked ? '☑' : '☐'}</span>}
          {dot && <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} title={dot.includes('terminal') ? 'terminal running' : 'being written'} />}
          {s.isSubagent && (
            <span className="shrink-0 text-violet-400" title={`subagent${s.agentRole ? ` · ${s.agentRole}` : ''}`}>
              ⤷
            </span>
          )}
          {s.oversized && (
            <span className="shrink-0 text-amber-400" title="Transcript exceeds the parse limit — it can't be opened">
              ⚠
            </span>
          )}
          {pinned && !selectable && <PinIcon className="w-3 h-3 text-amber-300 shrink-0" filled />}
          <span className="truncate">{s.title}</span>
          {s.lastTs && <span className="sb-time ml-auto pl-2 shrink-0 text-[10px] text-zinc-600 tabular-nums">{fmtRelative(s.lastTs)}</span>}
        </div>
        <div className="sb-meta flex items-center gap-1.5 text-[10.5px] text-zinc-600 min-w-0">
          {showSource && <SourceTag providers={providers} provider={src.provider} rootLabel={src.rootLabel} className="max-w-[45%]" />}
          {showSource && <span className="truncate">{src.project}</span>}
          {showSource && <span>·</span>}
          <span className="shrink-0">{s.lastTs ? fmtRelative(s.lastTs) : ''}</span>
          {s.toolCalls != null && <span className="shrink-0">· {s.toolCalls} tools</span>}
          {(s.childCount || 0) > 0 && <span className="text-violet-400/80 shrink-0">· ⤷ {s.childCount}</span>}
          {s.hasSubagents && <span className="text-violet-400 shrink-0">· ⚇ subs</span>}
        </div>
      </button>
      {!selectable && (
        <div className="flex items-center gap-0.5 pr-1.5">
          <button
            type="button"
            onClick={() => togglePin(t)}
            title={pinned ? 'Unpin session' : 'Pin session'}
            className={`${hoverBtn} ${pinned ? 'text-amber-300 opacity-100' : ''}`}
          >
            <PinIcon className="w-3.5 h-3.5" filled={pinned} />
          </button>
          <button
            type="button"
            onClick={() => setMenuFor(menuFor === menuKey ? null : menuKey)}
            title="More"
            className={`${hoverBtn} ${menuFor === menuKey ? 'opacity-100 text-zinc-100 bg-ink-600' : ''}`}
          >
            <DotsIcon className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      <RowMenu open={menuFor === menuKey} onClose={() => setMenuFor(null)} items={items} workspaceItem={sessionItem(src, s)} workspaces={workspaces} />
    </div>
  )
}

export function ProjectActions({
  ctx,
  src,
  menuKey,
  items,
  bounded = false,
}: {
  ctx: SidebarRowsContext
  src: WorkspaceItem
  menuKey: string
  items?: MenuItem[]
  bounded?: boolean
}) {
  const pinned = isPinned(src)
  return (
    <>
      <div className="flex items-center gap-0.5 pr-1.5 shrink-0">
        <button
          type="button"
          disabled={!src.slug}
          onClick={() => togglePin(src)}
          title={pinned ? 'Unpin project' : 'Pin project'}
          className={`${hoverBtn} disabled:opacity-30 ${pinned ? 'text-amber-300 opacity-100' : ''}`}
        >
          <PinIcon className="w-3.5 h-3.5" filled={pinned} />
        </button>
        <button
          type="button"
          onClick={() => ctx.setMenuFor(ctx.menuFor === menuKey ? null : menuKey)}
          title="More"
          className={`${hoverBtn} ${ctx.menuFor === menuKey ? 'opacity-100 text-zinc-100 bg-ink-600' : ''}`}
        >
          <DotsIcon className="w-3.5 h-3.5" />
        </button>
      </div>
      <RowMenu
        open={ctx.menuFor === menuKey}
        onClose={() => ctx.setMenuFor(null)}
        items={items || ctx.newConversationItems(src)}
        workspaceItem={src.slug ? projectItem(src) : null}
        workspaces={ctx.workspaces}
        bounded={bounded}
      />
    </>
  )
}

export function ProjectLine({
  ctx,
  src,
  open,
  onToggle,
  menuKey,
  children,
}: {
  ctx: SidebarRowsContext
  src: WorkspaceItem
  open: boolean
  onToggle: () => void
  menuKey: string
  children?: ReactNode
}) {
  const { providers, onOpenTarget } = ctx
  const c = providerColor(providers, src.provider)
  const t = { provider: src.provider, root: src.root, rootLabel: src.rootLabel, slug: src.slug, cwd: src.cwd, project: src.project }
  return (
    <div>
      <div className={`group relative flex items-stretch hover:bg-ink-700/50 ${open ? 'bg-ink-700/30' : ''}`}>
        <button
          type="button"
          onClick={onToggle}
          className="w-6 shrink-0 flex items-center justify-center text-zinc-600 hover:text-zinc-300"
          title={open ? 'Collapse' : 'Show sessions'}
        >
          <ChevronRightIcon className={`w-3 h-3 transition-transform ${open ? 'rotate-90' : ''}`} />
        </button>
        <button
          type="button"
          onClick={(e) => onOpenTarget(t, { newTab: e.ctrlKey || e.metaKey })}
          className="flex-1 min-w-0 text-left pr-1 sb-row-lg"
          title={`${src.cwd || src.slug}\nOpen the project · Ctrl+click for a new tab`}
        >
          <div className="flex items-center gap-1.5">
            <FolderIcon className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${c.dot}`} />
            <span className="text-[13px] font-medium text-zinc-200 truncate">{src.project}</span>
          </div>
          <div className="sb-meta text-[10.5px] text-zinc-600 truncate pl-5">
            {providerLabel(providers, src.provider)} · {src.rootLabel}
          </div>
        </button>
        <ProjectActions ctx={ctx} src={t} menuKey={menuKey} />
      </div>
      {children}
    </div>
  )
}

export function ProjectSessions({ ctx, src, indent = 'pl-9', keyPrefix }: { ctx: SidebarRowsContext; src: WorkspaceItem; indent?: string; keyPrefix: string }) {
  const { index, openKeys, toggleKey, hidePinned, hideGrouped, workspaces } = ctx
  const full = index.sessionsFor(src.provider || '', src.root || '', src.slug || '')
  const all = openKeys.has(sidebarItemKey(keyPrefix, 'all'))
  if (full === null) return <div className={`${indent} pr-2 py-1.5 text-[11.5px] text-zinc-600`}>loading…</div>
  // pinned sessions live in the Pinned section and grouped ones in their
  // workspace, not under their project — nothing is listed twice
  const notPinned = hidePinned ? full.filter((s) => !isPinned({ provider: src.provider, root: src.root, slug: src.slug, id: s.id })) : full
  const hidden = full.length - notPinned.length
  const lst = hideGrouped
    ? notPinned.filter((s) => !workspaceHolding({ kind: 'session', provider: src.provider, root: src.root, slug: src.slug, id: s.id }, workspaces))
    : notPinned
  const grouped = notPinned.length - lst.length
  const ghosts = draftsOf(ctx.drafts, src)
  if (!full.length && !ghosts.length) return <div className={`${indent} pr-2 py-1.5 text-[11.5px] text-zinc-600`}>no sessions yet</div>
  const shown = all ? lst : lst.slice(0, INLINE_SESSIONS)
  return (
    <>
      {ghosts.map((d) => (
        <DraftLine key={targetKey(d)} ctx={ctx} d={d} indent={indent} />
      ))}
      {shown.map((s) => (
        <SessionLine key={s.id} ctx={ctx} src={src} s={s} indent={indent} menuKey={sidebarItemKey(keyPrefix, s.id)} />
      ))}
      {lst.length > INLINE_SESSIONS && (
        <button
          type="button"
          onClick={() => toggleKey(sidebarItemKey(keyPrefix, 'all'))}
          className={`${indent} pr-2 py-1 text-[11px] text-sky-400 hover:text-sky-300`}
        >
          {all ? 'show fewer' : `show all ${lst.length}`}
        </button>
      )}
      {hidden > 0 && (
        <div className={`${indent} pr-2 py-1 text-[11px] text-zinc-600 flex items-center gap-1`} title="Pinned sessions are listed in the Pinned section above">
          <PinIcon className="w-3 h-3 text-amber-300/70" />
          {lst.length ? `${hidden} more pinned · see Pinned` : `${hidden === 1 ? 'its only session is' : `all ${hidden} sessions are`} pinned · see Pinned`}
        </div>
      )}
      {grouped > 0 && (
        <div
          className={`${indent} pr-2 py-1 text-[11px] text-zinc-600 flex items-center gap-1`}
          title="Sessions in a workspace are listed under that workspace above"
        >
          <LayersIcon className="w-3 h-3 text-sky-300/70" />
          {`${grouped} more in a workspace · see Workspaces`}
        </div>
      )}
    </>
  )
}

export function removeItem(wid: string, item: WorkspaceItem) {
  removeFromWorkspace(wid, item)
}
