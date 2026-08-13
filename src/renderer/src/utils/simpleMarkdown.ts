/**
 * Lightweight Markdown → HTML for in-app docs (PLUGIN.md / THEME.md).
 * Covers headings, tables, fences, lists, quotes, links, inline code/bold.
 */
export function simpleMarkdownToHtml(md: string): string {
  const src = String(md || '').replace(/\r\n/g, '\n')
  const lines = src.split('\n')
  const out: string[] = []
  let i = 0
  let inFence = false
  let fenceLang = ''
  let fence: string[] = []

  const esc = (s: string) =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')

  const inline = (s: string) => {
    let t = esc(s)
    t = t.replace(/`([^`]+)`/g, '<code>$1</code>')
    t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, href) => {
      const h = String(href)
      const safe = /^(https?:|mailto:|\/|#)/i.test(h) ? h : '#'
      return `<a href="${esc(safe)}" target="_blank" rel="noreferrer">${label}</a>`
    })
    return t
  }

  const flushFence = () => {
    out.push(
      `<pre class="docs-pre"><code class="language-${esc(fenceLang)}">${esc(fence.join('\n'))}</code></pre>`
    )
    fence = []
    fenceLang = ''
    inFence = false
  }

  while (i < lines.length) {
    const line = lines[i] ?? ''

    if (line.startsWith('```')) {
      if (inFence) {
        flushFence()
      } else {
        inFence = true
        fenceLang = line.slice(3).trim()
        fence = []
      }
      i++
      continue
    }
    if (inFence) {
      fence.push(line)
      i++
      continue
    }

    if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-/.test(lines[i + 1] || '')) {
      const rows: string[][] = []
      while (i < lines.length && /^\s*\|/.test(lines[i] || '')) {
        const raw = lines[i] || ''
        if (/^\s*\|?\s*:?-/.test(raw)) {
          i++
          continue
        }
        const cells = raw
          .replace(/^\s*\|/, '')
          .replace(/\|\s*$/, '')
          .split('|')
          .map((c) => c.trim())
        rows.push(cells)
        i++
      }
      if (rows.length) {
        const head = rows[0]
        const body = rows.slice(1)
        out.push('<div class="docs-table-wrap"><table class="docs-table"><thead><tr>')
        head.forEach((c) => out.push(`<th>${inline(c)}</th>`))
        out.push('</tr></thead><tbody>')
        body.forEach((r) => {
          out.push('<tr>')
          r.forEach((c) => out.push(`<td>${inline(c)}</td>`))
          out.push('</tr>')
        })
        out.push('</tbody></table></div>')
      }
      continue
    }

    if (/^---+\s*$/.test(line) || /^\*\*\*+\s*$/.test(line)) {
      out.push('<hr class="docs-hr" />')
      i++
      continue
    }

    const h = /^(#{1,4})\s+(.+)$/.exec(line)
    if (h) {
      const level = h[1].length
      out.push(`<h${level} class="docs-h${level}">${inline(h[2])}</h${level}>`)
      i++
      continue
    }

    if (/^>\s?/.test(line)) {
      const quote: string[] = []
      while (i < lines.length && /^>\s?/.test(lines[i] || '')) {
        quote.push((lines[i] || '').replace(/^>\s?/, ''))
        i++
      }
      out.push(`<blockquote class="docs-quote">${inline(quote.join(' '))}</blockquote>`)
      continue
    }

    if (/^\s*[-*]\s+/.test(line)) {
      out.push('<ul class="docs-ul">')
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i] || '')) {
        out.push(`<li>${inline((lines[i] || '').replace(/^\s*[-*]\s+/, ''))}</li>`)
        i++
      }
      out.push('</ul>')
      continue
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      out.push('<ol class="docs-ol">')
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i] || '')) {
        out.push(`<li>${inline((lines[i] || '').replace(/^\s*\d+\.\s+/, ''))}</li>`)
        i++
      }
      out.push('</ol>')
      continue
    }

    if (!line.trim()) {
      i++
      continue
    }

    const para: string[] = [line]
    i++
    while (i < lines.length) {
      const n = lines[i] || ''
      if (
        !n.trim() ||
        n.startsWith('#') ||
        n.startsWith('```') ||
        n.startsWith('>') ||
        /^\s*\|/.test(n) ||
        /^\s*[-*]\s+/.test(n) ||
        /^\s*\d+\.\s+/.test(n) ||
        /^---+\s*$/.test(n)
      ) {
        break
      }
      para.push(n)
      i++
    }
    out.push(`<p class="docs-p">${inline(para.join(' '))}</p>`)
  }

  if (inFence) flushFence()
  return out.join('\n')
}
