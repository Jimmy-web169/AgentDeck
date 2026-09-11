import { useCallback } from 'react'
import { useDeckMutation } from '../api/index.ts'
import { shellActions } from '../store/index.ts'

// UI orchestration joins a successful server command to shell state. The API
// layer owns requests/cache; it never imports the UI store to close tabs.
export function useDashboardActions() {
  const { mutateAsync } = useDeckMutation('endDashboard')
  const endDashboard = useCallback(
    async (id: string) => {
      const result = await mutateAsync({ id })
      shellActions.dashboardEnded(id)
      return result
    },
    [mutateAsync]
  )
  return { endDashboard, openDeckView: shellActions.openDeckView, announceDashboardEnd: shellActions.dashboardEnded }
}
