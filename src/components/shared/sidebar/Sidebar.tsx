import type { SidebarProps } from './useSidebar.tsx'
import { memo } from 'react'
import ProviderFilterChips from '../ProviderFilterChips.tsx'
import { setFolderFilter } from '../../../lib/prefs.ts'
import { toggleHomeFilter } from '../../../lib/homeScope.ts'
import FolderChips from '../FolderChips.tsx'
import NewFolderDialog from './NewFolderDialog.tsx'
import PathPicker from '../PathPicker.tsx'
import useSidebar from './useSidebar.tsx'
import WorkspacesSection from './WorkspacesSection.tsx'
import PinnedSection from './PinnedSection.tsx'
import ProjectsSection from './ProjectsSection.tsx'

// One persistent sidebar; section extraction preserves its DOM and row owners.
function Sidebar(props: SidebarProps) {
  const model = useSidebar(props)
  const {
    folderMode,
    index,
    providers,
    prefs,
    onManageFolders,
    scope,
    onScope,
    filter,
    setFilter,
    confirmEl,
    newScope,
    setNewScope,
    newProjectFlow,
    pickerOpen,
    pickerScope,
    pickerApi,
    setPickerOpen,
    onNewProject,
  } = model
  return (
    <aside className="w-full h-full flex flex-col bg-ink-900 border-r border-zinc-800">
      <div className="p-3 border-b border-zinc-800 space-y-2.5">
        {folderMode ? (
          <ProviderFilterChips
            scopes={index.scopes}
            providers={providers}
            excluded={prefs.folderExcludedProviders}
            excludedRoots={prefs.folderExcludedRoots}
            onToggle={(provider: string, root: string | null | undefined) =>
              setFolderFilter(
                toggleHomeFilter({ excluded: prefs.folderExcludedProviders, excludedRoots: prefs.folderExcludedRoots }, index.scopes, provider, root)
              )
            }
            onReset={() => setFolderFilter({})}
            onManage={onManageFolders}
          />
        ) : (
          <FolderChips scopes={index.scopes} providers={providers} value={scope} onPick={onScope} onManage={onManageFolders} />
        )}
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={folderMode ? 'Filter folders…' : 'Filter projects…'}
          className="w-full bg-ink-700 border border-zinc-700 rounded-md px-2.5 py-1.5 text-[13px] text-zinc-200 placeholder-zinc-600 focus:border-zinc-500 outline-none"
        />
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* ---- Workspaces ---- */}
        <WorkspacesSection model={model} />

        {/* ---- Pinned: every provider ---- */}
        <PinnedSection model={model} />

        {/* ---- Projects of the current folder ---- */}
        <ProjectsSection model={model} />
      </div>

      {confirmEl}
      {newScope && (
        <NewFolderDialog
          scope={newScope}
          scopes={index.scopes}
          providers={providers}
          onChange={setNewScope}
          onClose={() => setNewScope(null)}
          onChoose={() => {
            const chosen = newScope
            setNewScope(null)
            newProjectFlow(chosen)
          }}
        />
      )}
      {pickerOpen && pickerScope && pickerApi && (
        <PathPicker
          apiClient={pickerApi}
          onPick={(p) => {
            setPickerOpen(false)
            onNewProject(pickerScope, p)
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </aside>
  )
}

export default memo(Sidebar)
