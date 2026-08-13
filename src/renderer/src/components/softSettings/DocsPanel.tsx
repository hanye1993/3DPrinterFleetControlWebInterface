import { useEffect, useState } from 'react'
import { Card, Spin, Typography, Collapse } from 'antd'
import { BookOutlined } from '@ant-design/icons'
import { simpleMarkdownToHtml } from '../../utils/simpleMarkdown'

type DocId = 'PLUGIN' | 'PLUGIN_KERNEL_V2' | 'THEME'

const TITLES: Record<DocId, string> = {
  PLUGIN: '插件开发文档',
  PLUGIN_KERNEL_V2: '微内核插件 v2',
  THEME: '主题开发文档'
}

async function fetchDoc(id: DocId): Promise<string> {
  const res = await fetch(`/api/v1/docs/${id}.md`, { headers: { Accept: 'text/markdown, text/plain' } })
  if (!res.ok) throw new Error(`无法加载 ${id}.md（${res.status}）`)
  return res.text()
}

/** Renders full PLUGIN.md / THEME.md inside settings panels. */
export function DocsPanel({
  doc,
  defaultOpen = true,
  compact = false
}: {
  doc: DocId
  defaultOpen?: boolean
  /** When true, only Collapse (no outer Card title duplication) */
  compact?: boolean
}) {
  const [md, setMd] = useState<string>('')
  const [err, setErr] = useState<string>('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setErr('')
    void fetchDoc(doc)
      .then((text) => {
        if (!cancelled) setMd(text)
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [doc])

  const body = loading ? (
    <div style={{ padding: 24, textAlign: 'center' }}>
      <Spin tip="加载文档…" />
    </div>
  ) : err ? (
    <Typography.Text type="danger">{err}</Typography.Text>
  ) : (
    <div
      className="docs-md"
      dangerouslySetInnerHTML={{ __html: simpleMarkdownToHtml(md) }}
    />
  )

  const panel = (
    <Collapse
      defaultActiveKey={defaultOpen ? ['doc'] : []}
      items={[
        {
          key: 'doc',
          label: (
            <span>
              <BookOutlined /> {TITLES[doc]}（完整）
            </span>
          ),
          children: body
        }
      ]}
    />
  )

  if (compact) return <div className="docs-panel">{panel}</div>

  return (
    <Card className="settings-card docs-panel" title={TITLES[doc]}>
      {panel}
    </Card>
  )
}

export function DocsPanelStack({ docs }: { docs: DocId[] }) {
  return (
    <div className="docs-panel-stack">
      {docs.map((d) => (
        <DocsPanel key={d} doc={d} defaultOpen={d === 'PLUGIN'} />
      ))}
    </div>
  )
}
