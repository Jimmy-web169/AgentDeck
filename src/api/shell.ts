import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { TerminalEntry } from '../../shared/types.js'
import { queryKeys } from '../../shared/identity.ts'
import { shellActions } from '../store/index.ts'
import { updateLiveTerminal } from './queries.ts'

// Shell actions consume Query through services. The store never keeps a second
// copy of server inventories, and the UI never manages an event bridge.
export function useShellQueries(provider: string) {
  const client = useQueryClient()
  useEffect(
    () =>
      shellActions.connect({
        readTerminals: () => client.getQueryData<{ tmux: TerminalEntry[] }>(queryKeys.activeSessions(provider))?.tmux || [],
        updateTerminal: (entry, remove) => {
          void updateLiveTerminal(client, entry, { remove })
        },
      }),
    [client, provider]
  )
}
