import Markdown from './Markdown.jsx'

// Shared building blocks for both providers' tool-call cards.

// Transcript data is untrusted and can be malformed (e.g. an object where a
// string is expected). Coerce anything non-string into readable JSON so bad
// data can never throw during React's render phase and white-screen the app.
export function asText(x) {
  if (typeof x === 'string') return x
  if (x == null) return ''
  try {
    return JSON.stringify(x, null, 2) ?? String(x)
  } catch {
    return String(x)
  }
}

// Above this size, fancy rendering (markdown parse, per-line diff divs) gets
// too expensive — fall back to a plain <Pre>.
const HUGE_CHARS = 100_000
const HUGE_LINES = 3000
export function isHuge(text) {
  if (typeof text !== 'string') return false
  if (text.length > HUGE_CHARS) return true
  let lines = 0
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10 && ++lines > HUGE_LINES) return true
  }
  return false
}

export function Pre({ children }) {
  return (
    <pre className="bg-ink-900 rounded-md p-2.5 mt-1 overflow-x-auto text-[12px] leading-5 font-mono text-zinc-300 whitespace-pre-wrap break-words max-h-96">
      {asText(children)}
    </pre>
  )
}

// A label:value row for input fields that are paths, patterns, flags…
export function Field({ label, mono = true, children }) {
  if (children == null || children === '' || children === false) return null
  return (
    <div className="flex gap-2 mt-1 text-[12px] leading-5">
      <span className="text-zinc-500 shrink-0 w-16">{label}</span>
      <span className={`${mono ? 'font-mono' : ''} text-zinc-300 break-all min-w-0`}>{asText(children)}</span>
    </div>
  )
}

// Open links in a new tab without handing the opener to the target page.
const MD_COMPONENTS = {
  a: ({ node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
}

// Natural-language content (prompts, agent results) rendered as Markdown.
// Content can be attacker-influenced (WebFetch pages, subagent output), so
// images are disallowed to block remote-image beacons/tracking pixels.
export function MdBox({ children }) {
  if (typeof children !== 'string' || !children) return null
  if (isHuge(children)) return <Pre>{children}</Pre>
  return (
    <div className="mt-1 bg-ink-900/50 rounded-md px-3 py-1 max-h-96 overflow-y-auto [&_.md]:text-[12.5px] [&_.md]:leading-5">
      <Markdown disallowedElements={['img']} components={MD_COMPONENTS}>
        {children}
      </Markdown>
    </div>
  )
}
