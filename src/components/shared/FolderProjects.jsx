import { useEffect, useMemo, useRef, useState } from 'react'
import { folderTree, folderHasTarget, visibleFolderTree, resolveFolderReferences, providerBranches, folderNodeKey, folderAncestorKeys } from '../../lib/folderTree.js'
import { shortPath } from '../../lib/paths.js'
import { providerLabel, providerColor } from '../../lib/providerColors.js'
import { FolderIcon } from './icons.jsx'
import { homeSourceEnabled } from '../../lib/homeScope.js'
import { folderPinTarget, isPinned, togglePin } from '../../lib/pins.js'
import { PinIcon, DotsIcon } from './shellIcons.jsx'
import { folderItem, workspaceHolding } from '../../lib/workspaces.js'
import RowMenu from './RowMenu.jsx'

// Keep counts in one column even when a branch has no project actions.
const actionSlot = 'flex items-center w-14 shrink-0'
const countStyle = 'ml-auto shrink-0 tabular-nums text-right text-zinc-600'

export default function FolderProjects({ catalog, ctx, filter, excludedProviders = [], excludedRoots = [], showUnavailable = false, renderSessions, renderDrafts, renderProjectActions, section = 'folders', workspace }) {
  const tree = useMemo(() => folderTree(catalog.folders, ctx.drafts, ctx.index.scopes), [catalog.folders, ctx.drafts, ctx.index.scopes])
  const options = { excludedProviders, excludedRoots, showUnavailable }
  const referenced = section !== 'folders'
  const visible = referenced ? resolveFolderReferences(workspace ? workspace.items : ctx.folderPins || [], tree, options) : visibleFolderTree(tree, options).filter((f) =>
    (!ctx.hidePinned || !isPinned(folderPinTarget(f))) && (!ctx.hideGrouped || !workspaceHolding(folderItem(f), ctx.workspaces)))
  let moved = 0
  const folders = visible.flatMap((folder) => {
    const sources = folder.sources.filter((s) => !s.slug || !ctx.projectHidden?.(s))
    moved += folder.sources.length - sources.length
    return sources.length || referenced ? [{ ...folder, sources, sessionCount: sources.reduce((n, s) => n + (s.sessionCount || 0), 0) }] : []
  })
  const activeKeys = JSON.stringify(folderAncestorKeys(folders, ctx.activeTarget))
  const [localExpanded, setLocalExpanded] = useState(() => new Set(JSON.parse(activeKeys)))
  const expanded = ctx.folderExpanded || localExpanded, setExpanded = ctx.setFolderExpanded || setLocalExpanded
  const container = useRef(null)
  const folderIds = JSON.stringify(folders.map((f) => f.id))
  useEffect(() => {
    const id = ctx.folderFocus?.folderId
    if (!id || !JSON.parse(folderIds).includes(id)) return
    setExpanded((prev) => new Set([...prev, folderNodeKey(id)]))
    const row = [...(container.current?.querySelectorAll('[data-folder-id]') || [])].find((el) => el.dataset.folderId === id)
    row?.scrollIntoView({ block: 'nearest' }); row?.querySelector('button')?.focus({ preventScroll: true })
  }, [ctx.folderFocus, folderIds])
  useEffect(() => {
    const keys = JSON.parse(activeKeys)
    if (keys.length) setExpanded((prev) => new Set([...prev, ...keys]))
  }, [activeKeys])
  const toggle = (id) => setExpanded((prev) => { const next = new Set(prev); if (!next.delete(id)) next.add(id); return next })
  const shown = folders.filter((f) => `${f.cwd || f.name} ${f.sources.map((s) => `${providerLabel(ctx.providers, s.provider)} ${s.rootLabel}`).join(' ')}`.toLowerCase().includes(filter.toLowerCase()))

  const sourceView = (source, folder, indent) => {
    const src = { ...source, project: shortPath(folder.cwd || folder.name, 1) }, key = JSON.stringify([folder.id, src.provider, src.root, src.slug])
    return <div key={key} className={`${indent === 'pl-9' ? 'ml-6' : 'ml-9'} my-1 border-l border-zinc-700/70 bg-ink-800/20`}>{src.draftOnly || !src.slug ? renderDrafts(src, 'pl-3') : renderSessions(src, key, 'pl-3')}</div>
  }
  const actions = (source, folder, key) => {
    const src = { ...source, project: shortPath(folder.cwd || folder.name, 1) }
    return renderProjectActions?.(src, key, !!src.cwd && (folder.resolved || folder.draftOnly))
  }
  return <div ref={container}>
    {section === 'folders' && <>
      {catalog.error && <p role="alert" className="px-3 py-2 text-xs text-red-300">{catalog.error}</p>}
      {showUnavailable && catalog.errors.some((e) => homeSourceEnabled(e, { excluded: excludedProviders, excludedRoots })) && <p role="status" className="px-3 py-2 text-xs text-zinc-500">Some sources are unavailable. Showing accessible data.</p>}
      {catalog.loading && <p className="px-3 py-2 text-xs text-zinc-500">Loading folders…</p>}
      {!catalog.loading && !shown.length && <p className="px-3 py-2 text-xs text-zinc-500">{filter ? 'No matching folders.' : 'No folders to show. Check Pinned, Workspaces or the source filters above.'}</p>}
    </>}
    {shown.map((folder) => {
      const folderKey = folderNodeKey(folder.id), open = expanded.has(folderKey) || !!filter
      const pin = folderPinTarget(folder), pinned = isPinned(pin)
      const menuKey = JSON.stringify(['folder-menu', section, workspace?.id, folder.id])
      const canGroup = folder.resolved && !folder.draftOnly || !!workspaceHolding(folderItem(folder), ctx.workspaces)
      return <div key={folder.id} data-folder-id={folder.id} className="border-b border-zinc-800/60">
        <div className={`group flex items-stretch ${folderHasTarget(folder, ctx.activeTarget) ? 'bg-sky-500/10' : 'hover:bg-ink-700/50'}`}>
        <button aria-expanded={open} onClick={() => toggle(folderKey)} title={folder.cwd || folder.name} className="flex-1 min-w-0 text-left pl-3 pr-1 sb-row-lg flex items-center gap-1.5">
          <span className="text-xs text-zinc-600">{open ? '▾' : '▸'}</span><FolderIcon className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
          <span className="flex-1 min-w-0 text-[13px] text-zinc-200 truncate">{shortPath(folder.cwd || folder.name)}</span>
          {!folder.resolved && !folder.draftOnly && <span title={folder.pinStatus || 'The original working folder is unavailable.'} className="text-zinc-500 text-[10px] shrink-0">{folder.pinStatus ? '—' : 'Unavailable'}</span>}
          <span className={`${countStyle} text-[11px]`}>{folder.sessionCount}</span>
        </button>
        <div className={actionSlot}><button disabled={!pinned && (!folder.resolved || folder.draftOnly)} onClick={() => togglePin(pin)} title={pinned ? 'Unpin folder' : 'Pin folder'} className={`self-center shrink-0 w-6 h-6 rounded flex items-center justify-center hover:bg-ink-600 disabled:opacity-30 ${pinned ? 'text-amber-300' : 'text-zinc-500 opacity-0 group-hover:opacity-100 focus:opacity-100'}`}><PinIcon className="w-3.5 h-3.5" filled={pinned} /></button>
          <button disabled={!canGroup} title="More" onClick={() => ctx.setMenuFor(ctx.menuFor === menuKey ? null : menuKey)} className={`ml-0.5 shrink-0 w-6 h-6 rounded flex items-center justify-center text-zinc-500 hover:bg-ink-600 disabled:opacity-30 ${ctx.menuFor === menuKey ? 'text-zinc-100 bg-ink-600' : 'opacity-0 group-hover:opacity-100 focus:opacity-100'}`}><DotsIcon className="w-3.5 h-3.5" /></button>
        </div>
        <RowMenu bounded open={ctx.menuFor === menuKey} onClose={() => ctx.setMenuFor(null)} workspaceItem={folderItem(folder)} workspaces={ctx.workspaces} onWorkspaceChange={(id, added) => { ctx.setMenuFor(null); ctx.onFolderWorkspaceChange?.(id, added) }} />
        </div>
        {open && !folder.sources.length && <p className="px-4 py-2 text-xs text-zinc-500">{catalog.loading ? 'Loading folder sources…' : folder.pinStatus || 'Projects are already listed in Pinned / Workspaces.'}</p>}
        {open && providerBranches(folder, ctx.providers).map((branch) => {
          const key = folderNodeKey(folder.id, branch.provider), providerOpen = expanded.has(key), single = branch.roots.length === 1
          const label = providerLabel(ctx.providers, branch.provider), onlyRoot = branch.roots[0]
          return <div key={key} className="pb-1">
            <div className="group relative flex items-center pl-6 hover:bg-ink-700/40">
              <button aria-expanded={providerOpen} onClick={() => toggle(key)} title={single ? `${label} · ${onlyRoot.rootLabel}` : label} className="flex-1 min-w-0 flex items-center gap-1.5 py-1.5 pr-1 text-left">
                <span className="text-xs text-zinc-600">{providerOpen ? '▾' : '▸'}</span>
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${providerColor(ctx.providers, branch.provider).dot}`} />
                <span className="text-[11.5px] font-semibold text-zinc-300 truncate">{label}</span>
                {single && <span className="text-[10.5px] text-zinc-500 truncate">{onlyRoot.rootLabel}</span>}
                <span className={`${countStyle} text-[10.5px]`}>{branch.sessionCount}</span>
              </button>
              <div className={actionSlot}>{single && onlyRoot.sources.length === 1 && actions(onlyRoot.sources[0], folder, key)}</div>
            </div>
            {providerOpen && branch.roots.map((root) => {
              const rootKey = folderNodeKey(folder.id, branch.provider, root.root), rootOpen = single || expanded.has(rootKey)
              return <div key={rootKey}>
                {!single && <div className="group relative flex items-center pl-9 hover:bg-ink-700/40">
                  <button aria-expanded={rootOpen} title={`${label} · ${root.rootLabel}`} onClick={() => toggle(rootKey)} className="flex-1 min-w-0 text-left py-1 pr-1 flex gap-1.5 items-center">
                    <span className="text-xs text-zinc-600">{rootOpen ? '▾' : '▸'}</span><span className="text-[11px] text-zinc-500 truncate">{root.rootLabel}</span><span className={`${countStyle} text-[10.5px]`}>{root.sessionCount}</span>
                  </button>
                  <div className={actionSlot}>{root.sources.length === 1 && actions(root.sources[0], folder, rootKey)}</div>
                </div>}
                {rootOpen && root.sources.map((s) => <div key={JSON.stringify([s.provider, s.root, s.slug])}>
                  {root.sources.length > 1 && <div className="group relative flex items-center pl-12"><span className="text-xs text-zinc-500 truncate flex-1" title={s.slug}>{s.slug || 'New project'}</span>{actions(s, folder, JSON.stringify([rootKey, s.slug]))}</div>}
                  {sourceView(s, folder, single ? 'pl-9' : 'pl-12')}
                </div>)}
              </div>
            })}
          </div>
        })}
      </div>
    })}
    {moved > 0 && <p className="px-3 py-2 text-[11px] text-zinc-600">{moved} {moved === 1 ? 'project' : 'projects'} moved · see Pinned / Workspaces</p>}
  </div>
}
