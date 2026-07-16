import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'

export default function Markdown({ children, disallowedElements, components }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        disallowedElements={disallowedElements}
        components={components}
      >
        {typeof children === 'string' ? children : ''}
      </ReactMarkdown>
    </div>
  )
}
