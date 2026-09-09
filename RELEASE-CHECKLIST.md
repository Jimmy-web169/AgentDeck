# Release checklist

Run top to bottom before tagging. Every step is a command or a yes/no check.

For an ordinary **Unreleased commit/push**, run the gate and review the changed
docs only. Do not regenerate demo material, bump versions, change release dates
or create/move tags. Existing package versions and tags are not release intent.

Before **every demo**, the user must describe what the current release includes.
If that brief is missing, ask and pause before generating fixtures or assets;
do not infer the scope from git history or a previous release's tour. The demo
and version/tag sections below apply only to an explicitly requested release
(or an explicit standalone demo with its current release brief).

## 1. Docs

- [ ] `CHANGELOG.md` has a `## [x.y.z] - YYYY-MM-DD` section for this release
      (Added / Changed / Fixed) and `package.json` `version` matches it.
- [ ] Demo assets for this release exist in `demo/vX.Y/` — the screenshots
      `README.md` embeds plus `tour.gif` / `tour.mp4` — produced by the `demo`
      skill (`scripts/demo/make-fixture.mjs` → side server on 47861 →
      `shoot.mjs` → `record.mjs`) from the synthetic data root, never from a
      real home. Keep the file names the README links to; earlier releases'
      folders stay untouched.
- [ ] README install / OS notes still match `scripts/setup.sh`,
      `scripts/setup.ps1` and the Makefile targets.

## 2. Gate: `npm run release:check`

Runs `npm test` → `npm run build` → `npm run check:providers` → `npm run check:privacy`
→ `npm run check:spec`. All five must pass on the release machine.

- `check:spec` — every `spec/providers/*.yaml` validates, every fixture session in
  `spec/fixtures/` parses to its committed golden, and each descriptor describes
  what its parser emits. A parser change that is intended: `npm run check:spec --
  --update`, then review the golden diff in the same commit.

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

- [ ] `docs/site.json` carries the new version (the GitHub Pages one-pager reads
      it); the page's image links point at files that exist in `demo/<release>/`
      and `docs/tour.mp4` is the release's tour.
- [ ] GitHub Actions `ci` is green for the release commit on ubuntu-latest,
      windows-latest and macos-latest (`npm ci`, `npm test`, `npm run build`,
      `npm run check:spec`, `npm run check:privacy`).
- [ ] Hands-on smoke on at least one POSIX box and one Windows box:
      `make init` (macOS/WSL) or `npm run init:win` (Windows), start the app,
      open a terminal tab for each provider, pop it out, attach the tmux
      session from a shell.

## 4. Licensing

- [ ] `LICENSE` (MIT) present, copyright line current.
- [ ] Third-party notices: `npx license-checker --summary --production` shows
      only MIT / ISC / BSD / Apache-2.0 (or otherwise compatible) licences; the
      bundled xterm.js and highlight.js assets keep their own headers.

## 5. Demo on a clean data root

- [ ] The user supplied this release's included changes and the selected
      screenshots/tour beats reflect that brief. No automatic demo on Unreleased pushes.
- [ ] The `demo` skill ran for this release (it is the last step of the
      `release` skill): fixture regenerated, every PNG under `demo/vX.Y/`
      reviewed for fictional data only, `tour.gif` plays and matches the UI,
      the 47861 server is stopped. This — not `check:privacy` — is the privacy
      check for images.

## 6. Tag + GitHub release

- [ ] Only when explicitly requested: `git tag -a vX.Y.Z -m "AgentDeck X.Y.Z"`
      on the release commit (moving an existing tag needs explicit approval), then
      `git push origin vX.Y.Z`. **The `release` skill is the pre-push gate:
      run it before every `git push origin`, never after.**
- [ ] GitHub release for the tag: paste the CHANGELOG section as the notes,
      attach `demo/vX.Y/tour.gif` and `tour.mp4`, link the CI run.
