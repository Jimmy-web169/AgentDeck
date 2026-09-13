# Terminal and conversation lifecycle

A tab is a view. Closing it never ends the CLI. Use **End** in the terminal or
Live sessions to terminate it. Live Enter, Home's Live Open, and the new-tab
picker focus an existing tab or open a new one beside the current tab.

## Identity

There are three distinct identifiers:

| Identifier | Owner | Lifetime |
| --- | --- | --- |
| Tab key | Browser shell | A view; survives tab persistence |
| Launch ID / terminal key | AgentDeck | One CLI launch; unchanged when a transcript appears |
| Session ID | Provider | A saved conversation; may not exist at startup |

New conversations receive a UUID before launch. Server keys include the provider
and tracked root, so two launches in the same folder and different providers
never reuse each other's terminal. A retry with the same launch ID is idempotent;
concurrent starts share one pending operation.

Live targets carry the exact server `terminalKey`. A POST with that key only
reattaches; if it has ended, it returns 410 and never creates a replacement CLI.
Resume is a separate request addressed by session ID. It first checks for an
existing running terminal bound to that session.

The tmux session stores identity metadata in `AGENTDECK_META`. The server can
recover it after restart without browser storage or an in-memory process map.
Only persistent metadata is stored; ports, URLs and attached state are observed
at runtime. Without tmux, the ttyd process survives tab navigation but cannot
survive the AgentDeck server stopping.

On native Windows the `tmux` on PATH is psmux, which resolves targets
differently: `attach-session -t <name>` attaches to the server's *current*
session whatever the name, and `kill-session -t =<name>` does nothing. The pool
therefore attaches there with `new-session -A -s <name>` — exact by name; a
session that has ended runs an exiting command instead of a bare shell — and
addresses kill, has-session and set-environment by the plain name, which is
exact because every AgentDeck session name is the same fixed-length hash. tmux
keeps `=<name>`. `tmuxTarget` and `tmuxAttachArgs` in
`server/shared/terminalBinary.ts` own the two forms.

## Provider adapter contract

Keep provider behavior in `server/providers/<provider>/terminal.js`, registered
through `TERMINAL_CONFIG` in that provider's API module:

```js
{
  id,
  findBin,
  envKey,
  resumeArgs,
  promptArgs,
  checkOrigin,
  // Optional: validate the actual data root, add launch arguments/environment,
  // or reserve an ID. Do not change global CLI configuration.
  prepareLaunch({ bin, key, cwd, configDir, resumeId, meta }) {
    return { args: [], env: {}, meta: {} }
  },
  // Optional, synchronous, bounded. Return verified { id, slug, cwd, title? }
  // or null. files() lazily returns paths owned by this tmux process tree.
  resolveSession({ meta, files }) {},
  // Optional: validate an explicitly selected saved conversation in this root.
  // Return cwd from the saved transcript, never from the request body.
  // Its presence enables a repair fallback after delayed identification.
  resolveSavedSession({ root, id, slug }) {}
}
```

Adapters must not infer ownership from the newest transcript, a matching cwd,
title, or modification time. Ambiguous or unavailable evidence returns `null`.
An unbound terminal stays usable in Live sessions and the picker. Linking a
saved conversation validates the provider/root and exact local working folder,
rejects a conversation that already has a different running terminal, and cannot
replace an already identified conversation. The UI hides manual repair beneath
"Trouble detecting this conversation?" only after 20 seconds with a loaded,
unidentified terminal. It offers "Match current conversation manually" with
candidates from the current folder, never a folder picker.

The shared pool owns launch locking, attach, End, metadata recovery and optional
binding. Providers own arguments, data-root semantics and transcript discovery.
The UI consumes the same targets and navigation policy for every provider.

## Current adapters

| Provider | Automatic binding | Limits |
| --- | --- | --- |
| Claude Code | Probe for `--session-id`, reserve a UUID, wait for that exact transcript | Older CLI versions fall back to process-owned transcript evidence |
| Codex | Exact rollout held by the terminal's process tree, validated against the provider index; subagents excluded | Daemon-backed CLIs or versions that do not hold a rollout open may require explicit linking |
| Antigravity | The conversation `agy` names in this launch's own log file (`--log-file`, exact on every platform), else the transcript/database held by the terminal's process tree; both validated against its index | Only the CLI's default data folder is supported for new/resume; workspace metadata may arrive later |

Process-file discovery is optional on POSIX (`ps`/`lsof`). On Windows, inaccessible
processes, or ambiguous candidates, use explicit linking. The terminal key and
reattachment work independently of this capability. Provider adapters can add
verified lifecycle events later without changing the shell or tab model.

Binding describes the conversation selected through AgentDeck. CLI commands
that independently switch conversations require relinking; an existing binding
is not overwritten by guesses about other files held open by the process.

## Browser rules and migration

Session identity uses provider + root + session ID; slug, cwd, title and view are
navigation/display metadata. Unbound drafts use launch/terminal identity.
Learning a session ID updates the same tab and preserves its terminal alias.
Duplicate saved tabs are normalized while retaining the active tab. The new-tab
picker opens before allocating a tab, so cancel/focus-existing leaves no blank tab.

Terminal panes have their own stable view key. Both draft and saved conversations
use the same pane collection; learning a session ID or changing tabs does not
replace the iframe. An exact Live target renders its terminal immediately,
independently of loading the transcript/project metadata. Stale transcript
responses are guarded during rapid navigation.

The terminal distinguishes starting/reconnecting, opening its view, waiting for
a record, and loading that record. After 20 seconds, pending record copy offers
continued terminal use and manual linking instead of an indefinite spinner.
Iframe load is only a view-load signal, not proof of provider readiness.

The shell and provider views share one Live snapshot/request stream. File SSE
events schedule a refresh in a bounded 600ms window; provider/root-scoped backend
invalidation permits evidence checks after a 500ms burst throttle. The 4-second
poll remains as a fallback. Start/End events update the snapshot immediately;
older requests cannot overwrite those updates. Evidence rules remain unchanged.

Closing a running tab (including close-others/right) shows an 8-second notice
with Reopen/View Live actions. Closing a non-running tab shows no such notice.
No close action sends a terminal termination request.

Legacy folder-keyed tmux sessions are reattached using their original key. A
single matching legacy draft can be adopted; multiple candidates require
selection from Live sessions. No existing tmux session is renamed or killed by
migration. Draft deep links preserve launch, terminal and cwd information.

## The terminal sub-tab

**⧉ to tab** in a terminal panel gives the terminal a sub-tab of its
conversation's tab (`kind: 'terminal'`, deep link `#/terminal/<the
conversation link>`, `targetKey` `…|terminal-tab|<key>`). The tab list stays
flat and persisted as before: `normalizeGroups` (run by the store on every
commit and on load) keeps the sub-tab right after its conversation tab, gives an
orphan sub-tab a conversation tab of its own and drops a second sub-tab for the
same conversation; `groupTabs`/`unitOf` expose the pairs as units. The strip
renders a unit as one tab with a `>_` segment; `closeTab` on the conversation
takes the sub-tab with it (one notice), on the sub-tab only folds it back (no
notice); "others" and "to the right" count units; a drag moves the unit. Tab
shortcuts (Alt+←/→, Alt+[ ], Alt+1…9) step over units and land on the segment
last used (`lastSegment`, in memory); Alt+↓ / Alt+↑ move inside the unit. `TerminalTabView` renders the
shared `TerminalPage` with pop out and End; the conversation's
`TerminalPanel` folds to a bar while a sub-tab for its key exists (derived
from the tab list, not stored), so one pty has one viewer. **Back to session**
opens the conversation and detaches the sub-tab; **re-embed**, a middle-click
on the glyph and the menu's **Fold terminal back** only detach it; End, or the
terminal ending anywhere, closes it (`closeTerminalTabs`). `sameTarget` and
`dedupeTabs` keep a sub-tab apart from its conversation's tab, while
`adoptTerminal` lets it learn the saved conversation the same way.

## The popped-out terminal

**Pop out** opens `#/popout/<provider>/<root>/…?terminal=<key>&title=…` in a
tab named after the terminal key (`popoutWindowName`). `src/main.tsx` renders
`TerminalPopout` for that hash instead of the app; the page attaches through
`POST /api/terminal` with the exact `terminalKey`, so the server reuses the
running viewer or answers 410 once the terminal has ended, and the terminal
fills the window under a slim bar. The main window carries `window.name =
agentdeck-main`. **← Back to session** (`focusMainWindow` in
`src/lib/route.ts`) clears the panel's popped view in storage — the panel in
the main window follows through `subscribeTermView` and re-embeds — sets the
main window's hash to the conversation, which the shell's hash listener opens or
focuses, and closes the pop-out tab, which returns the browser to its opener.
Browsers do not raise another tab on `focus()`, so closing is the one reliable
way back; a tab the browser refuses to close, or a pop-out whose main window is
gone, navigates itself to the conversation and becomes the main window. The
main window's **focus tab** reopens or re-targets the pop-out by its name;
whether an already open tab is brought forward is the browser's decision.

## Verification## Verification

The following covers the shared policies and provider evidence using synthetic transcripts and fake
tmux/ttyd processes. No model requests or real terminal processes are needed.

```sh
node --test test/tab-identity.test.js test/terminal-lifecycle.test.js \
  test/provider-terminal-adapters.test.js test/quick-switcher.test.js
```

For manual UI testing in an environment that supports a browser/local server,
`node scripts/test/session-preview.ts` builds a standalone synthetic preview.
Its API and terminals are in-memory fixtures. It continuously emits updates to
exercise the tab strip while opening, switching and closing tabs. Serve the
printed preview directory with a local static server when file URLs are blocked.

Manual acceptance checks with the real providers:

1. Start two new conversations in one folder; each must retain its own terminal
   when switching tabs, and only the started drafts should show a running dot.
2. Enter a Live session from another conversation: preserve the current tab;
   enter it again and focus the existing tab without adding another.
3. Close a running tab, then reopen it from the new-tab picker's Live list.
   Restart AgentDeck and repeat; the tmux session name must stay unchanged.
4. Observe the strip while replies/SSE updates arrive: only explicit tab actions
   should change its order or layout. Drag reordering must still work.
5. For a provider without automatic transcript evidence, link its saved
   conversation explicitly. Opening that conversation must focus the same tab.
   End must remove the terminal; an old exact terminal link must return 410.

The automated lifecycle suite uses fake processes, not a real tmux/psmux server.
Socket-based webterm tests and these real-browser checks require an environment
that permits localhost listeners and access to the user's tmux socket.
