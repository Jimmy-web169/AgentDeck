import { useMemo } from 'react'
import { MarkdownBare } from './Markdown.jsx'

// Split markdown into stable blocks on blank lines (never inside a code fence).
// While a message streams in, only the last block's text keeps changing — every
// earlier block hits the memoized <Markdown> and skips re-parsing/highlighting.
function splitBlocks(src) {
  const lines = src.split('\n')
  const blocks = []
  let cur = []
  let inFence = false
  for (const line of lines) {
    if (/^(```|~~~)/.test(line.trimStart())) inFence = !inFence
    cur.push(line)
    if (!inFence && line.trim() === '' && cur.length > 1) {
      blocks.push(cur.join('\n'))
      cur = []
    }
  }
  if (cur.length) blocks.push(cur.join('\n'))
  return blocks
}

export default function StreamingMarkdown({ children }) {
  const blocks = useMemo(() => splitBlocks(children || ''), [children])
  return (
    <div className="md">
      {blocks.map((b, i) => (
        <MarkdownBare key={i}>{b}</MarkdownBare>
      ))}
    </div>
  )
}
