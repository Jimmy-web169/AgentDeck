export const LINK_HINT_MS = 20000

export function terminalStatus({ loading, reconnecting, running, frameLoaded, id, transcriptReady, delayed }) {
  if (loading) return reconnecting ? 'Reconnecting to terminal…' : 'Starting terminal…'
  if (!running) return null
  if (!frameLoaded) return delayed ? 'Terminal is running. If the view stays blank, reload it or pop it out.' : 'Opening terminal view…'
  if (!id) return delayed
    ? 'Terminal is running. Keep working, or use “Link saved conversation” if a record is available.'
    : 'Terminal is running · waiting for its conversation record.'
  if (!transcriptReady) return delayed
    ? 'The conversation record is still unavailable. You can keep using the terminal.'
    : 'Terminal is running · loading conversation record…'
  return 'Terminal is running · conversation synced'
}
