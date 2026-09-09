export async function deckApi(path, body) {
  const response = await fetch(`/api/deck/${path}`, { cache: 'no-store', ...(body !== undefined ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) })
  const data = await response.json()
  if (!response.ok) throw Object.assign(new Error(data.error || `HTTP ${response.status}`), { status: response.status })
  return data
}

export function openDeckView(target) {
  window.dispatchEvent(new CustomEvent('agentdeck:open-view', { detail: target }))
}

export function announceDashboardEnd(id) {
  window.dispatchEvent(new CustomEvent('agentdeck:dashboard-ended', { detail: { id } }))
}
export async function endDashboard(id) {
  const result = await deckApi('dashboard/end', { id })
  announceDashboardEnd(id)
  return result
}
