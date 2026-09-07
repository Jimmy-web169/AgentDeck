# Release checklist

Run top to bottom before tagging. Every step is a command or a yes/no check.

## 1. Docs

- [ ] `CHANGELOG.md` has a `## [x.y.z] - YYYY-MM-DD` section for this release
      (Added / Changed / Fixed) and `package.json` `version` matches it.
- [ ] Demo assets in `demo/` are current: `monitor-work-flow.gif` (+ `.mp4`)
      and the screenshots `README.md` embeds (`claude-states.png`,
      `codex-states.png`, `monitor-sub-agents.png`, `quick-switcher.jpg`,
      `skill.png`, `tmux-attach-session.png`). Re-record when the UI changed;
      keep the file names the README links to.
- [ ] README install / OS notes still match `scripts/setup.sh`,
      `scripts/setup.ps1` and the Makefile targets.

## 2. Gate: `npm run release:check`

Runs `npm test` → `npm run build` → `npm run check:providers` → `npm run check:privacy`.
All four must pass on the release machine.

- `check:providers` — `claude` and `codex` are on PATH, `--version`/`--help`
  answer, `claude --resume` and `codex resume <id>` are still in their help;
  tmux (psmux on Windows), ttyd (macOS/Linux) and node-pty (Windows) are
  reported. Add `--skills` once to also verify the `skills` CLI flags the
  installer passes (`add -a -g -y`); it downloads the package the first time.
- `check:privacy` — no home paths (`C:\Users\…`, `/Users/…`, `/home/…`, or
  their project-slug form), e-mail addresses or key-looking strings in anything
  git would commit; `LICENSE` present. Only add `.privacyignore` rules for
  placeholders, never for real data.

## 3. OS matrix

- [ ] GitHub Actions `ci` is green for the release commit on ubuntu-latest,
      windows-latest and macos-latest (`npm ci`, `npm test`, `npm run build`).
- [ ] Hands-on smoke on at least one POSIX box and one Windows box:
      `make init` (macOS/WSL) or `npm run init:win` (Windows), start the app,
      open a terminal tab for each provider, pop it out, attach the tmux
      session from a shell.

## 4. Licensing

- [ ] `LICENSE` (MIT) present, copyright line current.
- [ ] Third-party notices: `npx license-checker --summary --production` shows
      only MIT / ISC / BSD / Apache-2.0 (or otherwise compatible) licences; the
      bundled xterm.js and highlight.js assets keep their own headers.

## 5. Demo on a clean data root  _(placeholder)_

- [ ] Run the demo skill against an empty `CLAUDE_CONFIG_DIR` / `CODEX_HOME`
      and a fresh `roots.*.json`, walk the README demo once, confirm the GIF
      still matches what a first-time user sees.
      _The skill itself is not written yet — until it is, do this by hand._

## 6. Tag + GitHub release

- [ ] `git tag -a vX.Y.Z -m "AgentDeck X.Y.Z"` on the release commit
      (`git tag -f vX.Y.Z` while a pre-release tag is being moved), then
      `git push origin vX.Y.Z`.
- [ ] GitHub release for the tag: paste the CHANGELOG section as the notes,
      attach `demo/monitor-work-flow.gif`, link the CI run.
