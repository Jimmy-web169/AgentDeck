import { antigravityApi } from '../../api.js'
import { ProviderApiContext } from '../../lib/providerApi.js'
import { StatsPage, HistoryPage, PluginsPage } from '../codex/HomePages.jsx'
import ResourcesView from './ResourcesView.jsx'

// Home pages for the Antigravity provider. Stats / History / Plugins are the
// Codex pages verbatim — they only talk to the API they find in
// ProviderApiContext, so each page is wrapped with Antigravity's client.

const withApi = (Page) => {
  const Wrapped = (props) => (
    <ProviderApiContext.Provider value={antigravityApi}>
      <Page {...props} />
    </ProviderApiContext.Provider>
  )
  Wrapped.displayName = `Antigravity(${Page.displayName || Page.name || 'Page'})`
  return Wrapped
}

function ResourcesPage({ root }) {
  return <ResourcesView key={`res-${root}`} root={root} scope="user" />
}

export const HOME_PAGES = {
  stats: withApi(StatsPage),
  history: withApi(HistoryPage),
  plugins: withApi(PluginsPage),
  resources: withApi(ResourcesPage),
}
