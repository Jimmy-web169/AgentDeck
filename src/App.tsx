import SessionApp from './SessionApp.tsx'
import { QueryActivityContext } from './api/index.ts'
import BackgroundTerminalNotice from './components/shared/BackgroundTerminalNotice.tsx'
import HomeView from './components/shared/HomeView.tsx'
import SidebarFrame from './components/shared/sidebar/SidebarFrame.tsx'
import TabStrip from './components/shared/TabStrip.tsx'
import QuickSwitcher from './components/shared/QuickSwitcher.tsx'
import FoldersDialog from './components/shared/FoldersDialog.tsx'
import ConversationHandoffDialog from './components/shared/ConversationHandoffDialog.tsx'
import DashboardView from './components/shared/DashboardView.tsx'
import LiveSessionsPanel from './components/shared/LiveSessionsPanel.tsx'
import { PROVIDER_LIST } from './providers/index.ts'
import { registerProviders } from './lib/providerColors.ts'
import { liveTarget, type Terminal } from './lib/tabs.ts'
import { toManagerItems } from './lib/useActiveSessions.ts'
import useAppShell from './lib/useAppShell.ts'
import type { Target } from '../shared/types.js'

registerProviders(PROVIDER_LIST)

export default function App() {
  const {
    pendingOpen,
    closedRunning,
    searchOpen,
    showLive,
    foldersOpen,
    handoffRequest,
    recent,
    collapsed,
    searchNewTab,
    index,
    live,
    activeSessions,
    termKeys,
    scope,
    activeTarget,
    activeTab,
    tabs,
    activeKey,
    openTabKeys,
    showHome,
    stopLiveTerminal,
    dismissClosedRunning,
    consumedPending,
    openTarget,
    openHome,
    updateHome,
    activateTab,
    closeTab,
    closeOthers,
    closeRight,
    moveTab,
    newTab,
    copyLink,
    onNavigate,
    openSession,
    setSearchOpen,
    setShowLive,
    setFoldersOpen,
    setHandoffRequest,
    setCollapsed,
    setSearchNewTab,
  } = useAppShell(PROVIDER_LIST)
  return (
    <div className="h-full flex flex-col">
      <TabStrip
        tabs={tabs}
        activeKey={activeTab?.key}
        providers={PROVIDER_LIST}
        live={live}
        termKeys={termKeys}
        onSelect={activateTab}
        onClose={closeTab}
        onCloseOthers={closeOthers}
        onCloseRight={closeRight}
        onNew={newTab}
        onReorder={moveTab}
        onSearch={() => {
          setSearchNewTab(false)
          setSearchOpen(true)
        }}
        onLive={() => setShowLive(true)}
        liveCount={activeSessions.count}
        onHome={() => openHome()}
        onCopyLink={copyLink}
        sidebarCollapsed={collapsed}
        onToggleSidebar={() => setCollapsed((c) => !c)}
      />
      <div className="flex-1 min-h-0 flex">
        <SidebarFrame providers={PROVIDER_LIST} />
        <div className="flex-1 min-w-0 relative">
          {tabs
            .filter((t) => t.target?.kind === 'dashboard')
            .map((tab) => (
              <div key={tab.key} className="absolute inset-0" style={{ display: tab.key === activeKey ? 'block' : 'none' }}>
                <QueryActivityContext.Provider value={tab.key === activeKey}>
                  <DashboardView dashboardId={tab.target?.dashboardId} onOpen={openTarget} providers={PROVIDER_LIST} />
                </QueryActivityContext.Provider>
              </div>
            ))}
          {PROVIDER_LIST.map((p) => {
            const shown = activeTarget?.provider === p.id
            return (
              <div key={p.id} className="absolute inset-0" style={{ display: shown ? 'block' : 'none' }}>
                <QueryActivityContext.Provider value={shown}>
                  <SessionApp
                    active={shown}
                    provider={p}
                    providers={PROVIDER_LIST}
                    onOpenSession={openSession}
                    onNavigate={onNavigate}
                    pendingOpen={pendingOpen?.provider === p.id ? pendingOpen : null}
                    navigationTarget={shown ? activeTarget : null}
                    openTargets={tabs.map((t) => t.target).filter((t): t is Target => t?.provider === p.id)}
                    onConsumedPending={consumedPending}
                  />
                </QueryActivityContext.Provider>
              </div>
            )
          })}
          <div className="absolute inset-0" style={{ display: showHome ? 'block' : 'none' }}>
            <QueryActivityContext.Provider value={showHome}>
              <HomeView
                tabKey={activeKey}
                providers={PROVIDER_LIST}
                visible={showHome}
                target={showHome ? activeTarget : null}
                scope={scope}
                index={index}
                live={live}
                termKeys={termKeys}
                onOpen={openSession}
                onNavigate={updateHome}
                onOpenHome={openHome}
              />
            </QueryActivityContext.Provider>
          </div>
        </div>
      </div>
      <QuickSwitcher
        open={searchOpen}
        onClose={() => {
          setSearchOpen(false)
          setSearchNewTab(false)
        }}
        providers={PROVIDER_LIST}
        index={index}
        recent={recent}
        live={live}
        openTabs={openTabKeys}
        terminals={activeSessions.tmux}
        onPick={(target: Target, opts) => {
          setSearchOpen(false)
          openTarget(target, { ...opts, newTab: searchNewTab || opts?.newTab || target.kind === 'tmux' })
          setSearchNewTab(false)
        }}
        onNewConversation={(p) => {
          setSearchOpen(false)
          setSearchNewTab(false)
          openTarget({
            provider: p.provider,
            root: p.root,
            rootLabel: p.rootLabel,
            slug: p.slug,
            cwd: p.cwd,
            project: typeof p.name === 'string' ? p.name : undefined,
            draft: true,
            title: 'New conversation',
            newConversation: true,
          })
        }}
      />
      <BackgroundTerminalNotice
        targets={closedRunning || undefined}
        onDismiss={dismissClosedRunning}
        onReopen={() => {
          if (closedRunning?.length === 1) openTarget(closedRunning[0], { newTab: true })
          else {
            setSearchNewTab(true)
            setSearchOpen(true)
          }
          dismissClosedRunning()
        }}
      />
      <FoldersDialog open={foldersOpen} onClose={() => setFoldersOpen(false)} providers={PROVIDER_LIST} index={index} />
      {showLive && (
        <LiveSessionsPanel
          items={toManagerItems(activeSessions)}
          providers={PROVIDER_LIST}
          onEnter={(t: Terminal) => {
            openTarget(liveTarget(t), { newTab: true })
            setShowLive(false)
          }}
          onClose={stopLiveTerminal}
          onClosePanel={() => setShowLive(false)}
        />
      )}
      {handoffRequest && (
        <ConversationHandoffDialog {...handoffRequest} providers={PROVIDER_LIST} onOpen={openTarget} onClose={() => setHandoffRequest(null)} />
      )}
    </div>
  )
}
