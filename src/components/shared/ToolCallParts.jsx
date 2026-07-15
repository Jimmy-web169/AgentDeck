import Markdown from './Markdown.jsx'

// Shared building blocks for both providers' tool-call cards.

export function Pre({ children }) {
  return (
    <pre className="bg-ink-900 rounded-md p-2.5 mt-1 overflow-x-auto text-[12px] leading-5 font-mono text-zinc-300 whitespace-pre-wrap break-words max-h-96">
      {children}
    </pre>
  )
}

// A label:value row for input fields that are paths, patterns, flags…
export function Field({ label, mono = true, children }) {
  if (children == null || children === '' || children === false) return null
  return (
    <div className="flex gap-2 mt-1 text-[12px] leading-5">
      <span className="text-zinc-500 shrink-0 w-16">{label}</span>
      <span className={`${mono ? 'font-mono' : ''} text-zinc-300 break-all min-w-0`}>{String(children)}</span>
    </div>
  )
}

// Natural-language content (prompts, agent results) rendered as Markdown.
export function MdBox({ children }) {
  if (!children) return null
  return (
    <div className="mt-1 bg-ink-900/50 rounded-md px-3 py-1 max-h-96 overflow-y-auto [&_.md]:text-[12.5px] [&_.md]:leading-5">
      <Markdown>{children}</Markdown>
    </div>
  )
}
