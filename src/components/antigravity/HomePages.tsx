import type { HomePageProps } from '../../providers/views.ts'
import { antigravityApi } from '../../api/index.ts'
import { ProviderApiContext } from '../../api/index.ts'
import { StatsPage, HistoryPage, PluginsPage } from '../codex/HomePages.tsx'
import ResourcesView from './ResourcesView.tsx'

// Home pages for the Antigravity provider. Stats / History / Plugins are the
// Codex pages verbatim — they only talk to the API they find in
// ProviderApiContext, so each page is wrapped with Antigravity's client.

function WithApi({ Page, ...props }: HomePageProps & { Page: React.ComponentType<HomePageProps> }) {
  return (
    <ProviderApiContext.Provider value={antigravityApi}>
      <Page {...props} />
    </ProviderApiContext.Provider>
  )
}
const AntigravityStats = (props: HomePageProps) => <WithApi Page={StatsPage} {...props} />
const AntigravityHistory = (props: HomePageProps) => <WithApi Page={HistoryPage} {...props} />
const AntigravityPlugins = (props: HomePageProps) => <WithApi Page={PluginsPage} {...props} />
const AntigravityResources = (props: HomePageProps) => <WithApi Page={ResourcesPage} {...props} />

function ResourcesPage({ root }: HomePageProps) {
  return <ResourcesView key={`res-${root}`} root={root} scope="user" />
}

export const HOME_PAGES = {
  stats: AntigravityStats,
  history: AntigravityHistory,
  plugins: AntigravityPlugins,
  resources: AntigravityResources,
}
