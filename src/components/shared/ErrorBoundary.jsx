import { Component } from 'react'

// Catches render-time exceptions so bad data in one view degrades to an
// inline error card instead of white-screening the whole app. Wrap broad
// (the app root) and narrow (a provider's main content area) — the nearest
// boundary wins, so a crash inside a tab leaves the sidebar usable.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('render error:', error, info?.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="m-4 rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-[13px]">
        <div className="text-red-300 font-semibold mb-1">Something broke while rendering{this.props.label ? ` ${this.props.label}` : ''}.</div>
        <pre className="text-[11.5px] text-red-200/80 font-mono whitespace-pre-wrap break-words max-h-40 overflow-y-auto">
          {String(this.state.error?.message || this.state.error)}
        </pre>
        <div className="mt-2 flex gap-2">
          <button
            onClick={() => this.setState({ error: null })}
            className="text-[11px] px-2 py-1 rounded bg-ink-700 border border-zinc-700 text-zinc-300 hover:text-zinc-100"
          >
            Try again
          </button>
          <button
            onClick={() => window.location.reload()}
            className="text-[11px] px-2 py-1 rounded bg-ink-700 border border-zinc-700 text-zinc-300 hover:text-zinc-100"
          >
            Reload app
          </button>
        </div>
      </div>
    )
  }
}
