import type { SidebarModel } from './useSidebar.tsx'
import { SectionHeader, iconBtn, DraftLine, ProjectActions, draftsOf, SessionLine } from './rows.tsx'
import { PlusIcon, PinIcon, LayersIcon } from '../shellIcons.tsx'
import { FolderIcon } from '../icons.tsx'
import { shortPath } from '../../../lib/paths.ts'
import { projectKey } from '../../../lib/workspaces.ts'
import { sidebarItemKey } from '../../../../shared/identity.ts'
import { targetKey } from '../../../lib/tabs.ts'

export default function ProjectsSection({ model }: { model: SidebarModel }) {
  const {
    folderMode,
    sections,
    filter,
    toggleSection,
    picking,
    index,
    setNewScope,
    scope,
    renderFolderProjects,
    filtered,
    newProjectFlow,
    api,
    drafts,
    provider,
    root,
    projects,
    ctx,
    openSlug,
    srcL,
    setOpenSlug,
    newConversationItems,
    onDeleteSessions,
    setSelectMode,
    selectMode,
    selCount,
    setSelected,
    list,
    batchBusy,
    askBatchDelete,
    exitSelectMode,
    sessions,
    hiddenPinned,
    hiddenGrouped,
  } = model
  return (
    <>
      {folderMode ? (
        <div className="pb-2">
          <SectionHeader
            title="Folders"
            open={sections.projects || !!filter}
            onToggle={() => toggleSection('projects')}
            right={
              <button
                type="button"
                disabled={picking || !index.scopes.some((s: { exists: boolean }) => s.exists !== false)}
                onClick={() =>
                  setNewScope(
                    index.scopes.find((s) => s.provider === scope?.provider && s.root === scope?.root && s.exists !== false) ||
                      index.scopes.find((s: { exists: boolean }) => s.exists !== false) ||
                      null
                  )
                }
                title="New folder: choose AI and working folder"
                className={`${iconBtn} text-zinc-500 hover:text-zinc-200`}
              >
                <PlusIcon className="w-3.5 h-3.5" />
              </button>
            }
          />
          {(sections.projects || !!filter) && renderFolderProjects('folders')}
        </div>
      ) : (
        <div className="pb-2">
          <SectionHeader
            title="Projects"
            count={filtered.length}
            open={sections.projects || !!filter}
            onToggle={() => toggleSection('projects')}
            right={
              <button
                type="button"
                onClick={() => newProjectFlow()}
                disabled={picking || !api}
                title={picking ? 'Choosing a folder…' : 'New project: pick a folder and start a conversation in it'}
                className={`${iconBtn} text-zinc-500 hover:text-zinc-100 hover:bg-ink-600 disabled:opacity-60`}
              >
                <PlusIcon className="w-3.5 h-3.5" />
              </button>
            }
          />
          {(sections.projects || !!filter) &&
            drafts
              .filter((d) => d.provider === provider && d.root === root && !projects.some((p) => (d.slug && d.slug === p.slug) || (d.cwd && d.cwd === p.cwd)))
              .map((d) => (
                <div key={targetKey(d)} className="border-b border-zinc-800/60">
                  <div
                    className="flex items-center gap-1.5 pl-3 pr-2 sb-row-lg"
                    title={`${d.cwd || d.slug} — a new project: it is listed for real once its first conversation is written`}
                  >
                    <span className="text-zinc-600 text-xs w-3 shrink-0">▾</span>
                    <FolderIcon className="w-3.5 h-3.5 text-zinc-600 shrink-0" />
                    <span className="text-[13px] font-medium text-zinc-400 italic truncate flex-1">{shortPath(d.cwd || d.slug)}</span>
                    <span className="text-[10.5px] text-zinc-600 shrink-0">new</span>
                  </div>
                  <DraftLine ctx={ctx} d={d} />
                </div>
              ))}
          {(sections.projects || !!filter) &&
            filtered.map((p) => {
              const isOpen = p.slug === openSlug
              const src = srcL({ ...p, provider, root })
              const pk = projectKey({ provider, root, slug: p.slug })
              const mk = sidebarItemKey('proj', pk)
              return (
                <div key={p.slug} className="border-b border-zinc-800/60 last:border-0">
                  <div className={`group relative flex items-stretch hover:bg-ink-700/50 ${isOpen ? 'bg-ink-700/40' : ''}`}>
                    <button type="button" onClick={() => setOpenSlug(isOpen ? null : p.slug)} className="flex-1 min-w-0 text-left pl-3 pr-1 sb-row-lg">
                      <div className="flex items-center gap-1.5">
                        <span className="text-zinc-600 text-xs w-3 shrink-0">{isOpen ? '▾' : '▸'}</span>
                        <FolderIcon className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                        <span className="text-[13px] font-medium text-zinc-200 truncate flex-1" title={p.cwd || p.slug}>
                          {shortPath(p.cwd || p.slug)}
                        </span>
                        <span className="text-[11px] text-zinc-600 shrink-0">{p.sessionCount}</span>
                      </div>
                    </button>
                    <ProjectActions
                      ctx={ctx}
                      src={src}
                      menuKey={mk}
                      items={[
                        ...newConversationItems(src),
                        !!onDeleteSessions && {
                          label: 'Select sessions to trash…',
                          disabled: !p.sessionCount,
                          onClick: () => {
                            setOpenSlug(p.slug)
                            setSelectMode(true)
                          },
                        },
                      ].filter(Boolean)}
                    />
                  </div>

                  {isOpen && (
                    <div className="pb-1">
                      {selectMode && (
                        <div className="pl-7 pr-2 py-1 flex items-center gap-1.5 text-[11px]">
                          <span className="text-zinc-400">{selCount} selected</span>
                          <button
                            type="button"
                            onClick={() => setSelected(selCount === list.length ? new Set() : new Set(list.map((s) => s.id)))}
                            className="px-1.5 py-0.5 rounded bg-ink-700 text-zinc-400 hover:text-zinc-200"
                          >
                            {selCount === list.length ? 'none' : 'all'}
                          </button>
                          <span className="flex-1" />
                          {batchBusy ? (
                            <span className="text-zinc-500">trashing…</span>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={askBatchDelete}
                                disabled={selCount === 0}
                                className="px-1.5 py-0.5 rounded bg-red-500/10 text-red-300 hover:bg-red-500/20 disabled:opacity-40"
                              >
                                Delete…
                              </button>
                              <button type="button" onClick={exitSelectMode} className="px-1.5 py-0.5 rounded bg-ink-600 text-zinc-300">
                                Cancel
                              </button>
                            </>
                          )}
                        </div>
                      )}
                      {draftsOf(drafts, src).map((d) => (
                        <DraftLine key={targetKey(d)} ctx={ctx} d={d} />
                      ))}
                      {sessions === null && <div className="px-7 py-2 text-[12px] text-zinc-600">loading…</div>}
                      {sessions && sessions.length === 0 && !draftsOf(drafts, src).length && (
                        <div className="px-7 py-2 text-[12px] text-zinc-600">no sessions yet</div>
                      )}
                      {list.map((s) => (
                        <SessionLine ctx={ctx} key={s.id} src={src} s={s} menuKey={sidebarItemKey(mk, s.id)} selectable={selectMode} />
                      ))}
                      {hiddenPinned > 0 && (
                        <div
                          className="pl-7 pr-2 py-1 text-[11px] text-zinc-600 flex items-center gap-1"
                          title="Pinned sessions are listed in the Pinned section above"
                        >
                          <PinIcon className="w-3 h-3 text-amber-300/70" />
                          {list.length
                            ? `${hiddenPinned} more pinned · see Pinned`
                            : `${hiddenPinned === 1 ? 'its only session is' : `all ${hiddenPinned} sessions are`} pinned · see Pinned`}
                        </div>
                      )}
                      {hiddenGrouped > 0 && (
                        <div
                          className="pl-7 pr-2 py-1 text-[11px] text-zinc-600 flex items-center gap-1"
                          title="Sessions in a workspace are listed under that workspace above"
                        >
                          <LayersIcon className="w-3 h-3 text-sky-300/70" />
                          {`${hiddenGrouped} more in a workspace · see Workspaces`}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          {(sections.projects || !!filter) && filtered.length === 0 && (
            <div className="px-3 py-3 text-[12px] text-zinc-600">
              {!scope ? 'No tracked folders yet — press + above to track one.' : index.loading && !projects.length ? 'Loading projects…' : 'No projects.'}
            </div>
          )}
        </div>
      )}
    </>
  )
}
