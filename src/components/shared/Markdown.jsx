import { memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'

// stable references so react-markdown can skip re-parsing when children is unchanged
const REMARK_PLUGINS = [remarkGfm]
const REHYPE_PLUGINS = [rehypeHighlight]

// wrapper-less variant so callers (StreamingMarkdown) can compose several
// memoized chunks inside ONE .md container — separate .md divs would zero out
// the between-paragraph margins via .md > *:first/last-child rules.
export const MarkdownBare = memo(function MarkdownBare({ children }) {
  return (
    <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS}>
      {children || ''}
    </ReactMarkdown>
  )
})

function Markdown({ children, disallowedElements, components }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
        disallowedElements={disallowedElements}
        components={components}
      >
        {typeof children === 'string' ? children : ''}
      </ReactMarkdown>
    </div>
  )
}

export default memo(Markdown)
