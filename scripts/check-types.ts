#!/usr/bin/env node
// A nonempty strict project is required; no empty bootstrap escape hatch.
import ts from 'typescript'

// Our generated declarations are a checked boundary. skipLibCheck in the
// application projects must not hide unresolved or conflicting contract names.
const contracts = ts.createProgram(['shared/types.d.ts'], {
  strict: true,
  noEmit: true,
  skipLibCheck: false,
  types: [],
  target: ts.ScriptTarget.ES2023,
})
const contractErrors = ts.getPreEmitDiagnostics(contracts)
if (contractErrors.length) {
  console.error(
    ts.formatDiagnosticsWithColorAndContext(contractErrors, {
      getCurrentDirectory: ts.sys.getCurrentDirectory,
      getCanonicalFileName: (name) => name,
      getNewLine: () => '\n',
    })
  )
  process.exitCode = 1
} else console.log('check:types: generated declarations checked independently')

for (const configPath of ['tsconfig.json', 'tsconfig.ui.json', 'tsconfig.tools.json', 'tsconfig.test.json']) {
  const config = ts.readConfigFile(configPath, ts.sys.readFile)
  const parsed = ts.parseJsonConfigFileContent(config.config ?? {}, ts.sys, process.cwd())
  const errors = [config.error, ...parsed.errors].filter((error): error is ts.Diagnostic => !!error)
  if (
    parsed.options.strict !== true ||
    parsed.options.allowJs !== false ||
    parsed.options.erasableSyntaxOnly !== true ||
    parsed.options.verbatimModuleSyntax !== true
  )
    errors.push({
      file: undefined,
      start: undefined,
      length: undefined,
      category: ts.DiagnosticCategory.Error,
      code: 90001,
      messageText: `${configPath} must enable strict, erasableSyntaxOnly and verbatimModuleSyntax, and disable allowJs.`,
    })
  if (!parsed.fileNames.length)
    errors.push({
      file: undefined,
      start: undefined,
      length: undefined,
      category: ts.DiagnosticCategory.Error,
      code: 18003,
      messageText: `${configPath} must contain at least one root source file; a reference-only project does not check this layer.`,
    })
  if (!errors.length && parsed.fileNames.length) {
    const program = ts.createProgram(parsed.fileNames, parsed.options)
    errors.push(...ts.getPreEmitDiagnostics(program))
  }
  if (errors.length) {
    console.error(
      ts.formatDiagnosticsWithColorAndContext(errors, {
        getCurrentDirectory: ts.sys.getCurrentDirectory,
        getCanonicalFileName: (name) => name,
        getNewLine: () => ts.sys.newLine,
      })
    )
    process.exitCode = 1
  } else {
    console.log(`check:types: ${configPath}: ${parsed.fileNames.length} root files checked`)
  }
}
