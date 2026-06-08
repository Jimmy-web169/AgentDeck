import { useState } from 'react'

// Renders an AskUserQuestion prompt as selectable options (like the terminal),
// collects the answer(s), and submits them. answers = { questionText: "label" }
// (multi-select → comma-separated; an "Other" free-text box is always available).
export default function AskQuestionForm({ questions = [], onSubmit, onSkip, decided }) {
  const [sel, setSel] = useState({}) // qText -> label | [labels]
  const [other, setOther] = useState({}) // qText -> custom text

  if (decided) {
    return <div className={`ml-10 mt-1 text-[12px] ${decided === 'allow' ? 'text-emerald-300' : 'text-red-300'}`}>{decided === 'allow' ? '✓ answered' : '✕ skipped'}</div>
  }

  const pick = (q, label) => {
    if (q.multiSelect) {
      setSel((s) => {
        const cur = new Set(Array.isArray(s[q.question]) ? s[q.question] : [])
        cur.has(label) ? cur.delete(label) : cur.add(label)
        return { ...s, [q.question]: [...cur] }
      })
    } else {
      setSel((s) => ({ ...s, [q.question]: label }))
    }
  }
  const isPicked = (q, label) => (q.multiSelect ? (sel[q.question] || []).includes(label) : sel[q.question] === label)

  const answerFor = (q) => {
    const v = sel[q.question]
    let a = q.multiSelect ? (Array.isArray(v) ? v.join(', ') : '') : v || ''
    const o = (other[q.question] || '').trim()
    if (o) a = a ? `${a}, ${o}` : o
    return a
  }
  const ready = questions.every((q) => answerFor(q))

  const submit = () => {
    if (!ready) return
    const answers = {}
    for (const q of questions) answers[q.question] = answerFor(q)
    onSubmit(answers)
  }

  return (
    <div className="ml-10 min-w-0 max-w-2xl overflow-hidden rounded-lg border border-sky-500/40 bg-sky-500/5 px-3 py-2.5 text-[13px]">
      <div className="text-sky-200 mb-1">Claude is asking you{questions.length > 1 ? ` ${questions.length} questions` : ''}:</div>
      {questions.map((q, qi) => (
        <div key={qi} className="mt-2 first:mt-1">
          <div className="text-zinc-100">
            {q.header && <span className="text-[10px] uppercase tracking-wide text-sky-400/70 mr-2">{q.header}</span>}
            {q.question}
            {q.multiSelect && <span className="text-[11px] text-zinc-500"> (choose any)</span>}
          </div>
          <div className="mt-1.5 flex flex-col gap-1">
            {q.options?.map((o, oi) => (
              <button
                key={oi}
                onClick={() => pick(q, o.label)}
                className={`text-left text-[12px] px-2.5 py-1.5 rounded border ${isPicked(q, o.label) ? 'border-sky-400 bg-sky-500/25 text-sky-100' : 'border-zinc-700 bg-ink-700/40 text-zinc-300 hover:border-zinc-500'}`}
              >
                <span className="text-zinc-500 mr-1.5">{isPicked(q, o.label) ? '◉' : `${oi + 1}`}</span>
                <span className="font-medium">{o.label}</span>
                {o.description && <span className="text-zinc-500"> — {o.description}</span>}
              </button>
            ))}
            <input
              value={other[q.question] || ''}
              onChange={(e) => setOther((s) => ({ ...s, [q.question]: e.target.value }))}
              placeholder="Other… (type your own)"
              className="mt-0.5 bg-ink-700 border border-zinc-700 rounded px-2 py-1 text-[12px] text-zinc-200 placeholder-zinc-600"
            />
          </div>
        </div>
      ))}
      <div className="mt-2.5 flex gap-2">
        <button onClick={submit} disabled={!ready} className="text-[12px] px-3 py-1.5 rounded bg-sky-500/25 text-sky-100 hover:bg-sky-500/35 disabled:opacity-40">Submit answer{questions.length > 1 ? 's' : ''}</button>
        <button onClick={onSkip} className="text-[12px] px-3 py-1.5 rounded bg-ink-700 text-zinc-400 hover:text-zinc-200">Skip</button>
      </div>
    </div>
  )
}
