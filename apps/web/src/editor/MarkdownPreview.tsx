import type { ReactNode } from 'react'

// 마크다운 미리보기: 외부 라이브러리 없이 안전하게(HTML 삽입 없이) 렌더링합니다.
// 한글 텍스트는 그대로 문자열로 다루므로 인코딩 변환 과정에서 깨지지 않습니다.
function inline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = []
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\(https?:[^)\s]+\))/g
  let last = 0
  let index = 0
  for (const match of text.matchAll(pattern)) {
    const at = match.index ?? 0
    if (at > last) nodes.push(text.slice(last, at))
    const token = match[0]
    const key = `${keyPrefix}-${index++}`
    if (token.startsWith('`')) nodes.push(<code key={key}>{token.slice(1, -1)}</code>)
    else if (token.startsWith('**')) nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>)
    else if (token.startsWith('*')) nodes.push(<em key={key}>{token.slice(1, -1)}</em>)
    else {
      const label = token.slice(1, token.indexOf(']'))
      const url = token.slice(token.indexOf('(') + 1, -1)
      nodes.push(<a key={key} href={url} target="_blank" rel="noreferrer">{label}</a>)
    }
    last = at + token.length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

export function MarkdownPreview({ text }: { text: string }) {
  const blocks: ReactNode[] = []
  const lines = text.split('\n')
  let paragraph: string[] = []
  let list: { ordered: boolean; items: string[] } | null = null
  let key = 0

  const flushParagraph = () => {
    if (paragraph.length === 0) return
    blocks.push(<p key={key++}>{inline(paragraph.join(' '), `p${key}`)}</p>)
    paragraph = []
  }
  const flushList = () => {
    if (!list) return
    const items = list.items.map((item, i) => <li key={i}>{inline(item, `li${key}-${i}`)}</li>)
    blocks.push(list.ordered ? <ol key={key++}>{items}</ol> : <ul key={key++}>{items}</ul>)
    list = null
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    if (line.startsWith('```')) {
      flushParagraph(); flushList()
      const code: string[] = []
      i++
      while (i < lines.length && !(lines[i] ?? '').startsWith('```')) code.push(lines[i++] ?? '')
      blocks.push(<pre key={key++} className="md-code">{code.join('\n')}</pre>)
      continue
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      flushParagraph(); flushList()
      const level = heading[1]!.length
      const content = inline(heading[2] ?? '', `h${key}`)
      if (level === 1) blocks.push(<h1 key={key++}>{content}</h1>)
      else if (level === 2) blocks.push(<h2 key={key++}>{content}</h2>)
      else if (level === 3) blocks.push(<h3 key={key++}>{content}</h3>)
      else blocks.push(<h4 key={key++}>{content}</h4>)
      continue
    }
    if (/^\s*(-{3,}|_{3}|\*{3,})\s*$/.test(line)) { flushParagraph(); flushList(); blocks.push(<hr key={key++} />); continue }
    if (line.startsWith('> ')) { flushParagraph(); flushList(); blocks.push(<blockquote key={key++}>{inline(line.slice(2), `q${key}`)}</blockquote>); continue }
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line)
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    if (bullet || numbered) {
      flushParagraph()
      const ordered = Boolean(numbered)
      if (!list || list.ordered !== ordered) { flushList(); list = { ordered, items: [] } }
      list.items.push((bullet ?? numbered)![1] ?? '')
      continue
    }
    if (line.trim() === '') { flushParagraph(); flushList(); continue }
    flushList()
    paragraph.push(line.trim())
  }
  flushParagraph(); flushList()
  if (blocks.length === 0) return <div className="md-preview"><p className="muted"> </p></div>
  return <div className="md-preview">{blocks}</div>
}
