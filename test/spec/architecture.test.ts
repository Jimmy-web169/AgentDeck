function firstExpression(source: ts.SourceFile) {
  const first = source.statements[0]
  assert.ok(ts.isExpressionStatement(first))
  return first.expression
}
// Architectural constraints intentionally inspect syntax, not UI behavior.
// Legacy findings are pinned below; delete entries as their owning WP lands.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import ts from 'typescript'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const EXT = /\.(?:[cm]?[jt]s|[jt]sx)$/
function rootModules(root: string) {
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && EXT.test(entry.name))
    .map((entry) => entry.name)
}
test('all maintained code is TypeScript and belongs to a checked strict project', () => {
  const owned = ['src', 'server', 'shared', 'scripts', 'test'].flatMap(filesUnder).filter((file) => EXT.test(file))
  owned.push(...rootModules(ROOT))
  const checked = new Set<string>()
  for (const name of ['tsconfig.json', 'tsconfig.ui.json', 'tsconfig.tools.json', 'tsconfig.test.json']) {
    const config = ts.readConfigFile(path.join(ROOT, name), ts.sys.readFile)
    assert.equal(config.error, undefined)
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, ROOT)
    assert.deepEqual(parsed.errors, [])
    assert.equal(parsed.options.strict, true, name)
    assert.equal(parsed.options.allowJs, false, name)
    assert.equal(parsed.options.erasableSyntaxOnly, true, name)
    assert.equal(parsed.options.verbatimModuleSyntax, true, name)
    for (const file of parsed.fileNames) checked.add(path.relative(ROOT, file).split(path.sep).join('/'))
  }
  assert.deepEqual(
    owned.filter((file) => !/\.tsx?$/.test(file)),
    [],
    'maintained JavaScript must not bypass the TypeScript migration'
  )
  assert.deepEqual(
    owned.filter((file) => !checked.has(file)),
    [],
    'every maintained module must be a compiler root'
  )
})
test('root compiler coverage includes non-config modules and legacy JavaScript', (t) => {
  const root = fs.mkdtempSync(path.join(ROOT, 'tmp', 'root-coverage-test-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const modules = ['vite.config.ts', 'tools.ts', 'view.tsx', 'types.d.ts', 'legacy.js', 'legacy.jsx', 'legacy.mjs', 'legacy.cjs', 'module.mts', 'module.cts']
  for (const file of modules) fs.writeFileSync(path.join(root, file), 'export {}\n')
  fs.writeFileSync(path.join(root, 'README.md'), 'Not a module\n')
  fs.mkdirSync(path.join(root, 'directory.ts'))
  const owned = rootModules(root)
  assert.deepEqual(owned.toSorted(), modules.toSorted())
  const config = ts.parseJsonConfigFileContent({ compilerOptions: { strict: true, allowJs: false }, include: ['*.config.ts'] }, ts.sys, root)
  assert.deepEqual(config.errors, [])
  const checked = new Set(config.fileNames.map((file) => path.relative(root, file)))
  assert.deepEqual(owned.filter((file) => !checked.has(file)).toSorted(), modules.filter((file) => file !== 'vite.config.ts').toSorted())
  assert.deepEqual(owned.filter((file) => !/\.tsx?$/.test(file)).toSorted(), [
    'legacy.cjs',
    'legacy.js',
    'legacy.jsx',
    'legacy.mjs',
    'module.cts',
    'module.mts',
  ])
})
const PROVIDERS = new Set(['claude', 'codex', 'antigravity'])
const ALLOWED_ROOTS = new Set([
  '.git',
  '.github',
  '.claude',
  '.agents',
  '.codex',
  '.agentdeck',
  'node_modules',
  'src',
  'server',
  'shared',
  'spec',
  'test',
  'scripts',
  'skills',
  'docs',
  'demo',
  'dist',
  'tmp',
  'handoffs', // WP-9: data-preserving migration; never remove real state here.
  'dashboards', // WP-9: running-session identity must survive migration.
  'testproj', // WP-15: inventory maintainer fixture; removal needs explicit approval.
  '.vscode',
  '.idea',
])
const ROOT_JSON = /^(?:package(?:-lock)?|skills-lock|biome|tsconfig(?:\.(?:ui|tools|test))?|roots(?:\.[\w-]+)?|probe\.[\w-]+)\.json$/
// Only the actual browser bootstrap has a root-level owner.
const UI_ENTRY_OWNERS: Record<string, string> = { index: 'index.html' }
// why: WP-5 removes the existing bus; adding another name is never implicit.
const ALLOWED_EVENTS = new Set()
const REMEDY = {
  dependencies: 'use shared/ for cross-layer contracts; keep providers independent (rule 1)',
  io: 'use src/api hooks, src/store actions or existing preference stores (rule 4)',
  events: 'use a src/store/shell action instead of a window event (rule 5)',
  identity: 'use shared/identity helpers instead of constructing keys (rule 2)',
  providers: 'use a provider capability or registry entry (rule 8)',
  storage: 'use .agentdeck for private state and the approved owning directory (rule 7)',
  tests: 'move tests into a module-named file under the mirrored test layer (rule 9)',
  routes: 'use makeProviderRoutes(DATA) for common provider routes (rule 8)',
  instructions: 'keep local CLAUDE.md and AGENTS.md identical (rule 10)',
  components: 'define React components at module level and pass context (rule 6)',
}

// Exact non-key syntax exceptions. No namespace/name heuristic may hide a key.
const NON_KEY_PIPES = new Map([
  // biome-ignore lint/suspicious/noTemplateCurlyInString: Exact JavaScript syntax inspected by the guard, not an executable template.
  ['src/components/shared/InsightsPage.tsx', "`| ${w.weekStart} | ${w.sessions} | ${w.prompts} | ${w.activeDays} | ${w.projects ?? '—'} |`"], // Markdown export table.
  // biome-ignore lint/suspicious/noTemplateCurlyInString: Exact RegExp syntax inspected by the guard.
  ['server/providers/codex/resources.ts', '`(^|\\\\n)\\\\s*\\\\[mcp_servers\\\\.${id}\\\\]`'], // RegExp alternation.
])

function hasPipeTemplate(node: ts.Node) {
  return ts.isTemplateExpression(node) && [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].some((text) => text.includes('|'))
}

function hasScopedColonTemplate(node: ts.Node) {
  if (!ts.isTemplateExpression(node) || !node.templateSpans.some((span) => span.literal.text === ':')) return false
  const fields = node.templateSpans.map(({ expression }) =>
    ts.isPropertyAccessExpression(expression) ? expression.name.text : ts.isIdentifier(expression) ? expression.text : ''
  )
  return fields.some((field) => field === 'provider' || field === 'providerId') && fields.includes('root')
}

function hasArrayIdentity(node: ts.Node) {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return false
  const { expression, name } = node.expression
  return (
    (expression.getText() === 'JSON' && name.text === 'stringify' && !!node.arguments[0] && ts.isArrayLiteralExpression(node.arguments[0])) ||
    (name.text === 'join' && !!node.arguments[0] && ts.isStringLiteralLike(node.arguments[0]) && node.arguments[0].text === '|')
  )
}

function hasTemplateExpression(source: ts.SourceFile, expression: string) {
  let found = false
  const visit = (node: ts.Node) => {
    if (ts.isTemplateExpression(node) && node.getText(source) === expression) found = true
    if (!found) ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

function uiOwnerCandidates(module: string) {
  if (Object.hasOwn(UI_ENTRY_OWNERS, module)) return [UI_ENTRY_OWNERS[module]]
  return ['src', 'src/lib'].flatMap((directory) => ['js', 'jsx', 'ts', 'tsx', 'css'].map((extension) => `${directory}/${module}.${extension}`))
}

function filesUnder(dir: string): string[] {
  if (!fs.existsSync(path.join(ROOT, dir))) return []
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const file = `${dir}/${entry.name}`
    return entry.isDirectory() ? filesUnder(file) : entry.isFile() ? [file] : []
  })
}

function collectViolations() {
  const findings: { rule: string; file: string; detail: string; line: number; key: string }[] = []
  const add = (rule: string, file: string, detail: string, line = 1) => findings.push({ rule, file, detail, line, key: `${rule}|${file}|${detail}` })
  for (const file of [...filesUnder('src'), ...filesUnder('server'), ...filesUnder('shared')].filter((f) => EXT.test(f))) {
    const source = ts.createSourceFile(file, fs.readFileSync(path.join(ROOT, file), 'utf8'), ts.ScriptTarget.Latest, true)
    const frontend = file.startsWith('src/')
    const shared = file.startsWith('shared/')
    const ioAllowed = /^src\/(?:api\/|store\/|lib\/(?:prefs|pins|workspaces)\.ts$)/.test(file)
    const providerAllowed = /^src\/providers\/|^server\/registry\.[jt]s$/.test(file)
    const note = (rule: string, node: ts.Node, detail = node.getText(source).replace(/\s+/g, ' ')) =>
      add(rule, file, detail, source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1)
    const visit = (node: ts.Node, depth = 0) => {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        const specifier = node.moduleSpecifier
        if (specifier && ts.isStringLiteral(specifier)) {
          const spec = specifier.text
          const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), spec))
          const owner = file.match(/(?:^|\/)providers\/([^/]+)\//)?.[1]
          const target = resolved.match(/(?:^|\/)providers\/([^/]+)\//)?.[1]
          if (
            (shared && (!spec.startsWith('.') || !resolved.startsWith('shared/'))) ||
            (frontend && resolved.startsWith('server/')) ||
            (file.startsWith('server/') && resolved.startsWith('src/')) ||
            (owner && target && owner !== target)
          )
            note('dependencies', node)
        }
      }
      if (ts.isIdentifier(node)) {
        const memberName = ts.isPropertyAccessExpression(node.parent) && node.parent.name === node
        if (frontend && !ioAllowed && ['fetch', 'EventSource', 'setInterval', 'localStorage'].includes(node.text)) {
          // Ignore object keys/declarations; include bare calls and window.* access.
          const declarationName = (ts.isVariableDeclaration(node.parent) || ts.isPropertyAssignment(node.parent)) && node.parent.name === node
          if (!declarationName) note('io', node.parent, node.text + ': ' + node.parent.getText(source).replace(/\s+/g, ' '))
        }
        if (shared && !memberName && ['window', 'document', 'localStorage', 'process', 'Buffer', 'fetch'].includes(node.text)) note('dependencies', node)
      }
      if (frontend && ts.isStringLiteralLike(node) && node.text.startsWith('agentdeck:') && !ALLOWED_EVENTS.has(node.text)) note('events', node, node.text)
      if (hasPipeTemplate(node) && !/^shared\/identity\.[jt]s$/.test(file)) {
        const text = node.getText(source)
        if (text !== NON_KEY_PIPES.get(file)) note('identity', node)
      }
      if (hasArrayIdentity(node) && !/^shared\/identity\.[jt]s$/.test(file)) note('identity', node)
      if (hasScopedColonTemplate(node) && !/^shared\/identity\.[jt]s$/.test(file)) note('identity', node)
      if (
        !providerAllowed &&
        ts.isBinaryExpression(node) &&
        [
          ts.SyntaxKind.EqualsEqualsEqualsToken,
          ts.SyntaxKind.ExclamationEqualsEqualsToken,
          ts.SyntaxKind.EqualsEqualsToken,
          ts.SyntaxKind.ExclamationEqualsToken,
        ].includes(node.operatorToken.kind)
      ) {
        if ([node.left, node.right].some((side) => ts.isStringLiteral(side) && PROVIDERS.has(side.text))) note('providers', node)
      }
      if (/^server\/providers\/[^/]+\/api\.[jt]s$/.test(file) && ts.isPropertyAssignment(node) && ts.isStringLiteral(node.name)) {
        const route = node.name.text
        if (
          /^(?:GET|POST|DELETE) \/api\//.test(route) &&
          !['GET /api/subagent', 'POST /api/memory', 'DELETE /api/memory', 'GET /api/resource', 'POST /api/fork'].includes(route)
        )
          note('routes', node.name, route)
      }
      const fn = ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)
      if (fn && depth > 0 && frontend) {
        const name =
          ('name' in node ? node.name?.getText(source) : undefined) || (ts.isVariableDeclaration(node.parent) ? node.parent.name.getText(source) : '')
        if (/^[A-Z]/.test(name) && node.body && /<[A-Za-z]|createElement\(/.test(node.body.getText(source))) note('components', node, name)
      }
      ts.forEachChild(node, (child) => visit(child, depth + Number(fn)))
    }
    visit(source)
  }
  for (const entry of fs.readdirSync(ROOT, { withFileTypes: true })) {
    if (entry.isDirectory() && !ALLOWED_ROOTS.has(entry.name)) add('storage', entry.name, 'unapproved root directory')
    if (entry.isFile() && entry.name.endsWith('.json') && !ROOT_JSON.test(entry.name)) add('storage', entry.name, 'unapproved root JSON')
  }
  const testOwners = new Map()
  for (const file of filesUnder('test').filter((f: string) => /\.test\.[jt]sx?$/.test(f))) {
    if (file.split('/').length === 2) add('tests', file, 'root-level test')
    else if (!/^test\/(?:spec|integration)\//.test(file)) {
      const module = file.replace(/^test\//, '').replace(/\.test\.[jt]sx?$/, '')
      const owner = module.startsWith('ui/')
        ? uiOwnerCandidates(module.slice(3)).find((candidate) => fs.existsSync(path.join(ROOT, candidate)))
        : ['js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx'].map((extension) => `${module}.${extension}`).find((candidate) => fs.existsSync(path.join(ROOT, candidate)))
      if (!owner || !fs.existsSync(path.join(ROOT, owner))) add('tests', file, 'test must name an existing owning module')
      else if (testOwners.has(owner)) add('tests', file, `duplicate owner ${owner}; merge into ${testOwners.get(owner)}`)
      else testOwners.set(owner, file)
    }
  }
  // These files are local, so CI may have neither; a partial local pair is an error.
  const localFiles = ['CLAUDE.md', 'AGENTS.md'].map((file) => path.join(ROOT, file))
  if (
    localFiles.some((file) => fs.existsSync(file)) &&
    (!localFiles.every((file) => fs.existsSync(file)) || fs.readFileSync(localFiles[0], 'utf8') !== fs.readFileSync(localFiles[1], 'utf8'))
  )
    add('instructions', 'AGENTS.md', 'local instructions differ')
  return findings
}

// why: WP-1 identity/dependencies; WP-2/3 I/O; WP-4 components; WP-5 events;
// WP-6 routes/provider branches; WP-7 tests; WP-8 capabilities; WP-11 instructions.
const KNOWN_VIOLATIONS: Record<string, number> = {}

if (process.argv.includes('--inventory')) {
  console.log(JSON.stringify(collectViolations(), null, 2))
} else {
  test('architecture: Tailwind scans every JavaScript and TypeScript UI module', async () => {
    const { default: config } = await import('../../tailwind.config.ts')
    const scanned = new Set([...fs.globSync(config.content, { cwd: ROOT })].map((file) => file.replaceAll('\\', '/')))
    for (const file of filesUnder('src').filter((file: string) => /\.[jt]sx?$/.test(file))) {
      assert.ok(scanned.has(file), `${file} is missing from Tailwind content; moving classes here would silently remove their CSS`)
    }
  })
  test('architecture: identity detection includes legacy roots and fixed namespaces', () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: Parser inputs must contain literal template placeholders.
    for (const expression of ['`${root}|${id}`', '`pin|${key}`', '`${scope}|new|${folder}`', '`${a}|${b}|${c}`']) {
      const source = ts.createSourceFile('candidate.js', expression, ts.ScriptTarget.Latest, true)
      assert.equal(hasPipeTemplate(firstExpression(source)), true, expression)
    }
    // biome-ignore lint/suspicious/noTemplateCurlyInString: Parser input tests expression operators, not a pipe separator.
    const source = ts.createSourceFile('candidate.js', '`${value || fallback}`', ts.ScriptTarget.Latest, true)
    assert.equal(hasPipeTemplate(firstExpression(source)), false)
    // biome-ignore lint/suspicious/noTemplateCurlyInString: Literal source syntax for the AST guard.
    const colon = ts.createSourceFile('candidate.js', '`${p.provider}:${p.root}:${p.slug}`', ts.ScriptTarget.Latest, true)
    assert.equal(hasScopedColonTemplate(firstExpression(colon)), true)
    for (const expression of ['JSON.stringify([provider, root])', 'JSON.stringify(["folder", id])', 'parts.join("|")']) {
      const candidate = ts.createSourceFile('candidate.js', expression, ts.ScriptTarget.Latest, true)
      assert.equal(hasArrayIdentity(firstExpression(candidate)), true, expression)
    }
    for (const expression of ['JSON.stringify(payload)', 'parts.join(",")']) {
      const candidate = ts.createSourceFile('candidate.js', expression, ts.ScriptTarget.Latest, true)
      assert.equal(hasArrayIdentity(firstExpression(candidate)), false, expression)
    }
    for (const [file, expression] of NON_KEY_PIPES) {
      const source = ts.createSourceFile(file, fs.readFileSync(path.join(ROOT, file), 'utf8'), ts.ScriptTarget.Latest, true)
      assert.ok(hasTemplateExpression(source, expression), `remove stale non-key exception: ${file}`)
      for (const decoy of [`// ${expression}`, JSON.stringify(expression)]) {
        const candidate = ts.createSourceFile('decoy.js', decoy, ts.ScriptTarget.Latest, true)
        assert.equal(hasTemplateExpression(candidate, expression), false, 'comments and strings cannot keep an exception alive')
      }
    }
  })
  test('architecture: UI tests can own only source modules or the explicit browser entry', () => {
    assert.deepEqual(uiOwnerCandidates('index'), ['index.html'])
    for (const name of ['package', 'vite.config', 'postcss.config', 'unrelated'])
      assert.ok(uiOwnerCandidates(name).every((candidate) => candidate.startsWith('src/') && !candidate.endsWith('.html')))
  })
  const findings = collectViolations()
  for (const [rule, remedy] of Object.entries(REMEDY)) {
    test(`architecture: ${rule}`, () => {
      const counts = new Map()
      for (const finding of findings.filter((f) => f.rule === rule)) {
        const count = (counts.get(finding.key) || 0) + 1
        counts.set(finding.key, count)
        assert.ok(count <= (KNOWN_VIOLATIONS[finding.key] || 0), `${finding.file}:${finding.line} ${finding.detail}\n→ ${remedy}`)
      }
      for (const [key, count] of Object.entries(KNOWN_VIOLATIONS)) {
        if (key.startsWith(`${rule}|`)) assert.equal(counts.get(key) || 0, count, `${key} is resolved or reduced\n→ remove the stale baseline entry; ${remedy}`)
      }
    })
  }
}
