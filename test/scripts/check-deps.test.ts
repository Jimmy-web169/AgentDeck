import assert from 'node:assert/strict'
import test from 'node:test'
import { auditDependencies, parseVersion, reportAudit, run, satisfiesRange } from '../../scripts/check-deps.ts'

const probe = (over: Partial<Parameters<typeof auditDependencies>[0]> = {}) => ({
  manifest: { dependencies: { zustand: '^5.0.15' }, devDependencies: { typescript: '^5.9.3' } },
  treePresent: true,
  installed: (name: string) => ({ zustand: '5.0.15', typescript: '5.9.3' })[name] ?? null,
  lockMtime: 1000,
  installedLockMtime: 1000,
  ...over,
})

test('a range is only judged when its shape is fully understood', () => {
  assert.equal(satisfiesRange('^5.0.15', '5.2.0'), true)
  assert.equal(satisfiesRange('^5.0.15', '5.0.14'), false, 'caret still has a floor')
  assert.equal(satisfiesRange('^5.0.15', '6.0.0'), false, 'caret pins the major')
  assert.equal(satisfiesRange('~5.0.15', '5.0.20'), true)
  assert.equal(satisfiesRange('~5.0.15', '5.1.0'), false, 'tilde pins the minor')
  assert.equal(satisfiesRange('>=5.0.15', '9.9.9'), true)
  assert.equal(satisfiesRange('5.0.15', '5.0.16'), false, 'a bare version is exact')
  // 0.x releases are breaking per minor, so ^ floats only the patch there.
  assert.equal(satisfiesRange('^0.11.0', '0.11.4'), true)
  assert.equal(satisfiesRange('^0.11.0', '0.12.0'), false)
  // Anything npm resolves in ways we do not model is left to npm.
  for (const range of ['latest', '*', '>=1 <3', 'npm:pkg@1.2.3', 'github:o/r', 'file:../local'])
    assert.equal(satisfiesRange(range, '1.0.0'), true, `${range} must not be judged`)
})

test('a prerelease range is satisfied by the prerelease npm installed for it', () => {
  assert.deepEqual(parseVersion('1.2.0-beta.12'), { major: 1, minor: 2, patch: 0 })
  assert.equal(satisfiesRange('^1.2.0-beta.12', '1.2.0-beta.12'), true)
  assert.equal(satisfiesRange('^1.2.0-beta.12', '1.4.0'), true)
  assert.equal(satisfiesRange('^1.2.0-beta.12', '2.0.0'), false)
  assert.equal(parseVersion('not-a-version'), null)
  assert.equal(satisfiesRange('^1.2.3', 'workspace-linked'), true, 'an unparseable install is left to npm')
})

test('a tree that satisfies package.json and the lockfile passes', () => {
  const audit = auditDependencies(probe())
  assert.deepEqual(audit, { treePresent: true, missing: [], mismatched: [], stale: false, ok: true })
  assert.deepEqual(reportAudit(audit), ['check-deps: dependencies match package.json'])
})

test('a dependency added by a pull is reported, not silently started', () => {
  // The real failure: node_modules exists, so `test -d node_modules` passed and
  // Vite started, then every page broke on "Failed to resolve import".
  const audit = auditDependencies(probe({ installed: (name) => (name === 'zustand' ? null : '5.9.3') }))
  assert.deepEqual(audit.missing, [{ name: 'zustand', range: '^5.0.15' }])
  assert.equal(audit.ok, false)
  const report = reportAudit(audit)
  assert.match(report[0], /1 dependency not installed: zustand@\^5\.0\.15/)
  assert.match(report.at(-1) as string, /npm install/)
})

test('an interrupted install leaves a directory without a manifest and still counts as missing', () => {
  const audit = auditDependencies(probe({ installed: () => null }))
  assert.deepEqual(
    audit.missing.map((item) => item.name),
    ['typescript', 'zustand'],
    'findings are sorted so the report is stable'
  )
})

test('an installed version outside the range is named with both versions', () => {
  const audit = auditDependencies(probe({ installed: (name) => (name === 'typescript' ? '4.9.5' : '5.0.15') }))
  assert.deepEqual(audit.mismatched, [{ name: 'typescript', range: '^5.9.3', version: '4.9.5' }])
  assert.equal(audit.ok, false)
  assert.match(reportAudit(audit)[0], /typescript is 4\.9\.5, package\.json wants \^5\.9\.3/)
})

test('a lockfile edited after the last install is drift, within the same-install tolerance', () => {
  assert.equal(auditDependencies(probe({ lockMtime: 9000, installedLockMtime: 1000 })).stale, true)
  assert.equal(auditDependencies(probe({ lockMtime: 1600, installedLockMtime: 1000 })).stale, false, 'one install writes both files')
  assert.equal(auditDependencies(probe({ lockMtime: 1000, installedLockMtime: 9000 })).stale, false, 'an install newer than the lockfile is fine')
  // Nothing to compare against: a hand-built tree, or an npm too old to write
  // the hidden lockfile. The inventory is the only signal then.
  assert.equal(auditDependencies(probe({ installedLockMtime: null })).stale, false)
  assert.equal(auditDependencies(probe({ lockMtime: null })).stale, false)
  assert.match(reportAudit(auditDependencies(probe({ lockMtime: 9000 })))[0], /package-lock\.json changed since the last install/)
})

test('an absent tree is sent to make init rather than inspected', () => {
  const audit = auditDependencies(
    probe({
      treePresent: false,
      installed: () => assert.fail('an absent tree must not be inspected package by package'),
      lockMtime: 9000,
    })
  )
  assert.deepEqual(audit, { treePresent: false, missing: [], mismatched: [], stale: false, ok: false })
  assert.deepEqual(reportAudit(audit), ["check-deps: node_modules is missing — run 'make init' first (npm deps + ttyd + provider CLI check)."])
})

test('a manifest without dependency blocks audits clean', () => {
  assert.equal(auditDependencies(probe({ manifest: {}, installed: () => null })).ok, true)
})

// run() with both the filesystem probe and npm injected, so the repair path is
// exercised without installing anything.
const runner = (probes: Parameters<typeof auditDependencies>[0][], npmStatus = 0, verbose = true) => {
  const log: string[] = []
  const installs: string[] = []
  const code = run({
    root: '/repo',
    install: true,
    verbose,
    log: (line: string) => log.push(line),
    probe: () => probes.shift() ?? assert.fail('probed more times than the test staged'),
    npm: (root: string) => {
      installs.push(root)
      return npmStatus
    },
  })
  return { code, log, installs, remaining: probes.length }
}

test('a drifted tree is repaired in place and starts', () => {
  const broken = probe({ installed: (name) => (name === 'zustand' ? null : '5.9.3') })
  const { code, log, installs, remaining } = runner([broken, probe()])
  assert.equal(code, 0)
  assert.deepEqual(installs, ['/repo'], 'npm install ran once, in the repo')
  assert.equal(remaining, 0, 'the tree is re-probed after the install')
  assert.match(log.join(' '), /not installed: zustand/)
  assert.equal(
    log.some((line) => /run 'npm install'/.test(line)),
    false,
    'no manual instruction when we just ran it'
  )
  assert.equal(log.at(-1), 'check-deps: dependencies match package.json')
})

test('a healthy tree neither installs nor re-probes', () => {
  const { code, log, installs } = runner([probe()])
  assert.equal(code, 0)
  assert.deepEqual(installs, [])
  assert.deepEqual(log, ['check-deps: dependencies match package.json'])
})

test('a healthy tree says nothing unless asked, because it guards every start', () => {
  const quiet = runner([probe()], 0, false)
  assert.equal(quiet.code, 0)
  assert.deepEqual(quiet.log, [], 'a pre-hook on a good tree must add no noise')
  // A tree it had to repair still reports what it did, verbose or not.
  const repaired = runner([probe({ installed: () => null }), probe()], 0, false)
  assert.equal(repaired.code, 0)
  assert.match(repaired.log.join(' '), /2 dependencies not installed: typescript@\^5\.9\.3, zustand@\^5\.0\.15/)
  // And a failure is never silent, or the start would look clean.
  const broken = runner([probe({ treePresent: false, installed: () => null })], 0, false)
  assert.equal(broken.code, 1)
  assert.match(broken.log.join(' '), /make init/)
})

test('a failed install blocks the start instead of handing over a broken tree', () => {
  const { code, log, installs } = runner([probe({ installed: () => null })], 1)
  assert.equal(code, 1)
  assert.deepEqual(installs, ['/repo'])
  assert.match(log.at(-1) as string, /npm install failed/)
})

test('an install that resolves everything but leaves the lockfile timestamps starts anyway', () => {
  // Guards against a loop if some npm stops refreshing the hidden lockfile: the
  // inventory is authoritative once every dependency resolves.
  const drifted = probe({ lockMtime: 9000, installedLockMtime: 1000 })
  const { code, log, installs } = runner([drifted, drifted])
  assert.equal(code, 0)
  assert.deepEqual(installs, ['/repo'], 'it still only installs once')
  assert.match(log.join(' '), /lockfile timestamps unchanged/)
})

test('an absent tree is never installed over — make init owns that path', () => {
  const { code, log, installs } = runner([probe({ treePresent: false, installed: () => null })])
  assert.equal(code, 1)
  assert.deepEqual(installs, [], 'make init installs ttyd and checks the CLIs too')
  assert.match(log[0], /make init/)
})

test('--json reports the audit instead of the prose report', () => {
  const log: string[] = []
  const code = run({
    root: '/repo',
    json: true,
    log: (line: string) => log.push(line),
    probe: () => probe(),
    npm: () => assert.fail('no install without --install'),
  })
  assert.equal(code, 0)
  assert.deepEqual(JSON.parse(log[0]), { treePresent: true, missing: [], mismatched: [], stale: false, ok: true })
})
