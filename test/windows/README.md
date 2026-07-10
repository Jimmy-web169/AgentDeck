# Windows-support tests

Regression tests for the native-Windows support changeset. They run on every
platform (`npm test`; CI runs them on Ubuntu **and** Windows) — the "windows"
here means *what they protect*, not where they run.

| File | What it protects |
| --- | --- |
| `webterm.test.js` | The built-in node-pty web terminal used instead of ttyd on win32. Asserts the shared-pty contract the UI depends on: page served, first client spawns the pty, a late joiner (pop-out tab) gets the scrollback replay, **a client disconnect never kills the pty** (the pop-out bug), and a taken port fails loudly so the server never hands out a dead iframe URL. |
| `find-on-path.test.js` | CLI discovery (`findOnPath`): Windows extension handling (`.exe/.cmd/.bat`), the `node_modules/.bin` exclusion (the embedded terminal must run the *user's* CLI, not the SDK's bundled `codex` — the perpetual-update-prompt bug), and explicit fallback candidates (psmux's winget path). |
| `statusline-bridge.test.js` | `scripts/statusline-bridge.mjs`, the usage-bar bridge: writes `rate-limits.json` from the status-line payload, tolerates PowerShell's BOM, chains the user's original status line unchanged, and never crashes or writes on malformed input. |
| `skills-parse.test.js` | Input validation for the Install-a-skill UI (`parseSkillsAdd`): accepts real skill refs and full `npx skills add` commands, strips user agent flags when the provider pins its own, and **rejects non-skill input** (the backend spawns a real process from this string). |
