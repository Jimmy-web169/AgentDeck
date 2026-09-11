import type { SidebarModel } from './useSidebar.tsx'
import { SectionHeader, ProjectLine, ProjectSessions, SessionLine } from './rows.tsx'
import { projectKey } from '../../../lib/workspaces.ts'
import { sidebarItemKey } from '../../../../shared/identity.ts'

export default function PinnedSection({ model }: { model: SidebarModel }) {
  const {
    filter,
    prefs,
    pins,
    sections,
    toggleSection,
    folderMode,
    folderPins,
    renderFolderProjects,
    pinnedProjects,
    srcL,
    ctx,
    openKeys,
    toggleKey,
    pinnedSessions,
  } = model
  return (
    <>
      {!filter && prefs.showPinned && pins.length > 0 && (
        <div className="border-b border-zinc-800/60 pb-1">
          <SectionHeader title="Pinned" count={pins.length} open={sections.pinned} onToggle={() => toggleSection('pinned')} />
          {sections.pinned && (
            <>
              {folderMode && folderPins.length > 0 && renderFolderProjects('pinned')}
              {pinnedProjects.map((p) => {
                const k = projectKey(p)
                const src = srcL(p)
                return (
                  <ProjectLine ctx={ctx} key={k} src={src} open={openKeys.has(k)} onToggle={() => toggleKey(k)} menuKey={sidebarItemKey('pin', k)}>
                    {openKeys.has(k) && <ProjectSessions ctx={ctx} src={src} keyPrefix={sidebarItemKey('pin', k)} />}
                  </ProjectLine>
                )
              })}
              {pinnedSessions.map((p) => (
                <SessionLine
                  ctx={ctx}
                  key={sidebarItemKey(projectKey(p), p.id)}
                  src={srcL(p)}
                  s={{ id: p.id, title: p.title || p.id.slice(0, 8), lastTs: null, toolCalls: undefined }}
                  indent="pl-3"
                  showSource
                  menuKey={sidebarItemKey('pin', sidebarItemKey(projectKey(p), p.id))}
                />
              ))}
            </>
          )}
        </div>
      )}
    </>
  )
}
