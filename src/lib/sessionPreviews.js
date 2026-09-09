// Presentation-only preferences: hidden previews remain searchable. Keep the
// selection/deduplication shared by Activity and the compact quick switcher.
export function sessionPreviews(session, { showLatestPrompt = true } = {}) {
  // Do not fall back to the opening question: it can misrepresent current work.
  return showLatestPrompt && session.lastUserPrompt && session.lastUserPrompt !== session.title
    ? [{ kind: 'latest', text: session.lastUserPrompt, hitField: 'latest' }]
    : []
}
