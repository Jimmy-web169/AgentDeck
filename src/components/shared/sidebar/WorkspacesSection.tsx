import type { SidebarModel } from './useSidebar.tsx'
// Focus only the new/rename field explicitly opened by the user.
const focusEditor = (node: HTMLInputElement | null) => node?.focus()
import { SectionHeader, iconBtn, hoverBtn, WS_GROUP_SESSIONS, removeItem, SessionLine } from './rows.tsx'
import { PlusIcon, CloseIcon, ChevronRightIcon, DotsIcon } from '../shellIcons.tsx'
import {
  createWorkspace,
  workspaceSources,
  isFolderItem,
  sourceKey,
  renameWorkspace,
  setWorkspaceIcon,
  setWorkspaceColor,
  type Workspace,
} from '../../../lib/workspaces.ts'
import { sidebarItemKey, sessionKey, sourceKey as identitySourceKey } from '../../../../shared/identity.ts'
import { accentStyle } from '../../../lib/accent.ts'
import { WorkspaceIcon } from '../workspaceIcons.tsx'
import { providerColor, providerLabel } from '../../../lib/providerColors.ts'
import RowMenu from '../RowMenu.tsx'

export default function WorkspacesSection({ model }: { model: SidebarModel }) {
  const {
    filter,
    prefs,
    workspaces,
    sections,
    toggleSection,
    setSections,
    setNewWs,
    newWs,
    setOpenWs,
    openWs,
    folderCatalog,
    labelOf,
    wsFilter,
    wsGroups,
    toggleWs,
    renaming,
    setRenaming,
    wsName,
    providers,
    setMenuFor,
    menuFor,
    askDeleteWorkspace,
    toggleWsSource,
    renderFolderProjects,
    openKeys,
    toggleKey,
    newConversationItems,
    ctx,
    folderMode,
    suggestions,
  } = model
  return (
    <>
      {!filter && prefs.showWorkspaces && (
        <div className="border-b border-zinc-800/60 pb-1">
          <SectionHeader
            title="Workspaces"
            count={workspaces.length}
            open={sections.workspaces}
            onToggle={() => toggleSection('workspaces')}
            right={
              <button
                type="button"
                onClick={() => {
                  setSections((s) => ({ ...s, workspaces: true }))
                  setNewWs('')
                }}
                title="New workspace"
                className={`${iconBtn} text-zinc-500 hover:text-zinc-100 hover:bg-ink-600`}
              >
                <PlusIcon className="w-3.5 h-3.5" />
              </button>
            }
          />
          {sections.workspaces && (
            <>
              {newWs != null && (
                <div className="flex items-center gap-1 px-2 pb-1.5">
                  <input
                    ref={focusEditor}
                    value={newWs}
                    onChange={(e) => setNewWs(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newWs.trim()) {
                        const id = createWorkspace(newWs)
                        setOpenWs((s) => new Set(s).add(id))
                        setNewWs(null)
                      } else if (e.key === 'Escape') setNewWs(null)
                    }}
                    placeholder="Workspace name, then Enter"
                    className="flex-1 min-w-0 bg-ink-700 border border-zinc-700 rounded px-2 py-1 text-[12px] text-zinc-100 placeholder-zinc-600"
                  />
                  <button type="button" onClick={() => setNewWs(null)} className={`${iconBtn} text-zinc-500 hover:text-zinc-100`}>
                    <CloseIcon />
                  </button>
                </div>
              )}
              {workspaces.map((w: Workspace) => {
                const open = openWs.has(w.id)
                const sources = workspaceSources(w, folderCatalog.folders).map((x) => ({ ...x, rootLabel: labelOf(x.provider, x.root, x.rootLabel) }))
                const hasFolders = w.items.some(isFolderItem)
                const filt = wsFilter[w.id]
                const { groups, loading, untracked } = open ? wsGroups(w) : { groups: [], loading: false, untracked: 0 }
                const visible = filt?.size ? groups.filter((g) => filt.has(sourceKey(g.src))) : groups
                const mk = sidebarItemKey('ws', w.id)
                return (
                  <div key={w.id}>
                    <div className={`group relative flex items-stretch hover:bg-ink-700/50 ${open ? 'bg-ink-700/30' : ''}`}>
                      <button type="button" onClick={() => toggleWs(w.id)} className="flex-1 min-w-0 text-left pl-2 pr-1 py-1.5 flex items-center gap-1.5">
                        <ChevronRightIcon className={`w-3 h-3 text-zinc-600 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
                        {/* the colour tints the glyph only — the name stays as readable as any other row */}
                        <span className="shrink-0 inline-flex" style={w.color ? accentStyle(w.color).style : undefined}>
                          <WorkspaceIcon icon={w.icon} className={`w-3.5 h-3.5 ${w.color ? 'accent-text' : 'text-sky-300/80'}`} />
                        </span>
                        {renaming?.id === w.id ? (
                          <input
                            ref={focusEditor}
                            value={renaming.name}
                            onChange={(e) => setRenaming({ id: w.id, name: e.target.value })}
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                renameWorkspace(w.id, renaming.name)
                                setRenaming(null)
                              } else if (e.key === 'Escape') setRenaming(null)
                            }}
                            onBlur={() => setRenaming(null)}
                            className="flex-1 min-w-0 bg-ink-700 border border-zinc-700 rounded px-1.5 py-0.5 text-[12.5px] text-zinc-100"
                          />
                        ) : (
                          <span className="text-[12.5px] text-zinc-200 truncate" title={w.name}>
                            {wsName.get(w.id) || w.name}
                          </span>
                        )}
                        {!open && sources.length > 0 && (
                          <span className="flex -space-x-0.5 shrink-0 ml-1">
                            {sources.map((s) => (
                              <span key={s.key} className={`w-1.5 h-1.5 rounded-full ring-1 ring-ink-900 ${providerColor(providers, s.provider).dot}`} />
                            ))}
                          </span>
                        )}
                        <span className="text-[11px] text-zinc-600 shrink-0 ml-auto">{w.items.length}</span>
                      </button>
                      <div className="flex items-center gap-0.5 pr-1.5">
                        <button
                          type="button"
                          onClick={() => setMenuFor(menuFor === mk ? null : mk)}
                          title="More"
                          className={`${hoverBtn} ${menuFor === mk ? 'opacity-100 text-zinc-100 bg-ink-600' : ''}`}
                        >
                          <DotsIcon className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <RowMenu
                        open={menuFor === mk}
                        onClose={() => setMenuFor(null)}
                        items={[
                          { label: 'Rename', onClick: () => setRenaming({ id: w.id, name: w.name }) },
                          { label: 'Delete workspace', danger: true, onClick: () => askDeleteWorkspace(w) },
                        ]}
                        icon={{
                          value: w.icon,
                          onPick: (i: string) => setWorkspaceIcon(w.id, i),
                          accentStyle: w.color ? accentStyle(w.color).style : undefined,
                        }}
                        accent={{
                          value: w.color,
                          onChange: (c: unknown) => setWorkspaceColor(w.id, c),
                          onReset: w.color ? () => setWorkspaceColor(w.id, null) : null,
                          resetLabel: 'clear',
                        }}
                      />
                    </div>
                    {open && (
                      <div className="pb-1">
                        {sources.length > 1 && (
                          <div className="flex flex-wrap items-center gap-1 pl-7 pr-2 pb-1">
                            {sources.map((s) => {
                              const on = filt?.has(s.key)
                              const c = providerColor(providers, s.provider)
                              return (
                                <button
                                  type="button"
                                  key={s.key}
                                  onClick={() => toggleWsSource(w.id, s.key)}
                                  title={`${providerLabel(providers, s.provider)} · ${s.rootLabel}${on ? ' — showing only this' : ' — click to show only this'}`}
                                  className={`flex items-center gap-1 px-1.5 h-5 rounded text-[10.5px] border transition-colors ${on ? `bg-ink-600 border-zinc-500 ${c.text}` : 'border-zinc-800 text-zinc-500 hover:text-zinc-200 hover:border-zinc-600'}`}
                                >
                                  <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
                                  <span className="truncate max-w-[110px]">{s.rootLabel}</span>
                                </button>
                              )
                            })}
                          </div>
                        )}
                        {hasFolders && renderFolderProjects('workspace', w)}
                        {visible.map((g) => {
                          const gk = sidebarItemKey(mk, g.key)
                          const gopen = !openKeys.has(sidebarItemKey(gk, 'closed')) // groups start open
                          const all = openKeys.has(sidebarItemKey(gk, 'all'))
                          const shownRows = all ? g.rows : g.rows.slice(0, WS_GROUP_SESSIONS)
                          const c = providerColor(providers, g.src.provider)
                          return (
                            <div key={g.key}>
                              <div className="group relative flex items-stretch hover:bg-ink-700/40">
                                <button
                                  type="button"
                                  onClick={() => toggleKey(sidebarItemKey(gk, 'closed'))}
                                  title={`${g.src.cwd || g.src.slug}\n${providerLabel(providers, g.src.provider)} · ${g.src.rootLabel}${g.partial ? '\nonly the sessions you added, not the whole project' : ''}`}
                                  className="flex-1 min-w-0 text-left pl-6 pr-1 py-1 flex items-center gap-1.5"
                                >
                                  <ChevronRightIcon className={`w-3 h-3 text-zinc-600 shrink-0 transition-transform ${gopen ? 'rotate-90' : ''}`} />
                                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${c.dot}`} />
                                  <span className="text-[12px] font-medium text-zinc-300 truncate">{g.src.project}</span>
                                  <span className={`text-[10.5px] truncate ${c.text}`}>{g.src.rootLabel}</span>
                                  {g.partial && <span className="text-[10px] text-zinc-600 shrink-0">selected</span>}
                                  <span className="ml-auto text-[10.5px] text-zinc-600 shrink-0">{g.rows.length}</span>
                                </button>
                                {!g.partial && (
                                  <div className="flex items-center gap-0.5 pr-1.5">
                                    <button
                                      type="button"
                                      onClick={() => setMenuFor(menuFor === gk ? null : gk)}
                                      title="More"
                                      className={`${hoverBtn} ${menuFor === gk ? 'opacity-100 text-zinc-100 bg-ink-600' : ''}`}
                                    >
                                      <DotsIcon className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                )}
                                {!g.partial && (
                                  <RowMenu
                                    open={menuFor === gk}
                                    onClose={() => setMenuFor(null)}
                                    items={[
                                      ...newConversationItems(g.src),
                                      { label: `Remove ${g.src.project} (${g.src.rootLabel}) from workspace`, onClick: () => removeItem(w.id, g.item) },
                                    ]}
                                  />
                                )}
                              </div>
                              {gopen &&
                                shownRows.map((r) => (
                                  <SessionLine
                                    ctx={ctx}
                                    key={sessionKey(g.src.provider || '', g.src.root || '', r.s.id)}
                                    src={g.src}
                                    s={r.s}
                                    indent="pl-9"
                                    menuKey={sidebarItemKey(gk, r.s.id)}
                                    extraItems={r.item.kind === 'session' ? [{ label: 'Remove from workspace', onClick: () => removeItem(w.id, r.item) }] : []}
                                  />
                                ))}
                              {gopen && !g.rows.length && <div className="pl-9 pr-2 py-1 text-[11px] text-zinc-600">no sessions yet</div>}
                              {gopen && g.rows.length > WS_GROUP_SESSIONS && (
                                <button
                                  type="button"
                                  onClick={() => toggleKey(sidebarItemKey(gk, 'all'))}
                                  className="pl-9 pr-2 py-1 text-[11px] text-sky-400 hover:text-sky-300"
                                >
                                  {all ? 'show fewer' : `show all ${g.rows.length}`}
                                </button>
                              )}
                            </div>
                          )
                        })}
                        {loading && <div className="pl-7 pr-2 py-1.5 text-[11.5px] text-zinc-600">loading…</div>}
                        {untracked > 0 && (
                          <div className="pl-7 pr-2 py-1 text-[11px] text-zinc-600">
                            {untracked} member{untracked === 1 ? '' : 's'} in a folder that is no longer tracked — hidden
                          </div>
                        )}
                        {!loading && !groups.length && !hasFolders && (
                          <div className="pl-7 pr-2 py-1.5 text-[11.5px] text-zinc-600">
                            Empty — open ⋯ on a folder, project or session and tick this workspace.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
              {!workspaces.length && newWs == null && !(!folderMode && prefs.showSuggestions && suggestions.length) && (
                <div className="px-3 pb-1.5 text-[11.5px] text-zinc-600">
                  Group folders, projects and sessions from any provider under one name — ⋯ on a row → Workspaces.
                </div>
              )}
              {!folderMode && prefs.showSuggestions && suggestions.length > 0 && (
                <div className="mt-1 mx-2 mb-1 rounded-md border border-dashed border-zinc-700/70 px-2 py-1.5">
                  <div className="text-[10px] uppercase tracking-wider text-zinc-600 mb-1">Suggested · same folder in several places</div>
                  {suggestions.slice(0, 5).map((s) => (
                    <div key={s.cwd} className="flex items-center gap-2 py-0.5">
                      <span className="flex -space-x-0.5 shrink-0">
                        {s.sources.map((x) => (
                          <span
                            key={identitySourceKey(x.provider || '', x.root || '')}
                            className={`w-1.5 h-1.5 rounded-full ring-1 ring-ink-900 ${providerColor(providers, x.provider).dot}`}
                            title={`${providerLabel(providers, x.provider)} · ${x.rootLabel}`}
                          />
                        ))}
                      </span>
                      <span className="flex-1 min-w-0 text-[12px] text-zinc-300 truncate" title={s.cwd || undefined}>
                        {s.name}
                      </span>
                      <span className="text-[10.5px] text-zinc-600 shrink-0">{s.sources.length}</span>
                      <button
                        type="button"
                        onClick={() => {
                          const id = createWorkspace(s.name, s.items)
                          setOpenWs((o) => new Set(o).add(id))
                        }}
                        className="shrink-0 text-[11px] px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-200 hover:bg-sky-500/25"
                      >
                        Group
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </>
  )
}
