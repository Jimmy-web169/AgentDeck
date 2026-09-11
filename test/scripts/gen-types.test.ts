import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { generateDeclarations } from '../../scripts/gen-types.ts'
import { temporaryDirectory } from '../helpers/tmpConfigDir.ts'

test('generated API contracts resolve all nested timeline parts without skipLibCheck', async () => {
  const dir = temporaryDirectory('agentdeck-declarations-')
  const { output } = await generateDeclarations('spec/api')
  const file = path.join(dir, 'contracts.d.ts')
  fs.writeFileSync(file, output)
  const program = ts.createProgram([file], { strict: true, noEmit: true, skipLibCheck: false, types: [], target: ts.ScriptTarget.ES2023 })
  assert.deepEqual(
    ts.getPreEmitDiagnostics(program).map((error) => ts.flattenDiagnosticMessageText(error.messageText, '\n')),
    []
  )
  assert.match(output, /export interface TextPart/)
  assert.match(output, /export interface ToolCallPart/)
})

test('conflicting named schema declarations fail generation', async () => {
  const dir = temporaryDirectory('agentdeck-declaration-conflict-')
  fs.writeFileSync(path.join(dir, 'a.schema.json'), JSON.stringify({ title: 'Clash', type: 'object', properties: { value: { type: 'string' } } }))
  fs.writeFileSync(path.join(dir, 'b.schema.json'), JSON.stringify({ title: 'Clash', type: 'object', properties: { value: { type: 'number' } } }))
  await assert.rejects(generateDeclarations(dir), /Conflicting generated declarations: Clash/)
})
