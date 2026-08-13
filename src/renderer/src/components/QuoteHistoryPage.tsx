import { useEffect, useMemo, useReducer, useState } from 'react'
import { Button, Empty, Input, Modal, Select, Space, Table, Tag, Typography, message } from 'antd'
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons'
import type { QuoteHistoryRecord } from '@shared/quoteHistory'
import {
  deleteQuoteHistoryRecord,
  fetchQuoteHistoryList
} from '../api/quoteHistoryApi'
import { PluginSlot } from '../plugins/PluginSlot'
import { getHanyePlugin, type QuoteHistoryPageCtx } from '../plugins/runtime'
import {
  QuoteHistoryPluginFilters,
  QuoteHistoryPluginDetailFields,
  applyQuoteHistoryClientFilters
} from './QuoteHistoryPluginHosts'

function yuan(n: number) {
  return `¥${(Number(n) || 0).toFixed(2)}`
}

function fmtTime(iso: string) {
  return String(iso || '')
    .replace('T', ' ')
    .slice(0, 19)
}

/** Server-only: search all users' quote copy/export history */
export function QuoteHistoryPage() {
  const [q, setQ] = useState('')
  const [action, setAction] = useState<string>('all')
  const [loading, setLoading] = useState(false)
  const [records, setRecords] = useState<QuoteHistoryRecord[]>([])
  const [detail, setDetail] = useState<QuoteHistoryRecord | null>(null)
  const [pluginFilters, setPluginFiltersState] = useState<Record<string, unknown>>({})
  const [pluginTick, bumpPlugin] = useReducer((n: number) => n + 1, 0)

  useEffect(() => {
    return getHanyePlugin().on('quote-history:change', () => bumpPlugin())
  }, [])

  const reload = async (query = q, act = action) => {
    setLoading(true)
    try {
      const res = await fetchQuoteHistoryList({
        q: query.trim() || undefined,
        action: act === 'all' ? undefined : act,
        limit: 500
      })
      if (!res.ok) {
        message.error(res.message || '加载失败')
        setRecords([])
        return
      }
      setRecords(res.data)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载失败')
      setRecords([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const historyCtxBase = useMemo(() => {
    const setPluginFilter = (key: string, value: unknown) => {
      setPluginFiltersState((prev) => ({ ...prev, [key]: value }))
    }
    return {
      q,
      setQ,
      action,
      setAction,
      records: records as unknown as Record<string, unknown>[],
      reload: () => void reload(),
      openDetail: (record: Record<string, unknown>) =>
        setDetail(record as unknown as QuoteHistoryRecord),
      detail: detail as unknown as Record<string, unknown> | null,
      pluginFilters,
      setPluginFilter,
      setPluginFilters: (patch: Record<string, unknown>) =>
        setPluginFiltersState((prev) => ({ ...prev, ...patch }))
    }
  }, [q, action, records, detail, pluginFilters])

  const visibleRecords = useMemo(() => {
    const ctx = {
      ...historyCtxBase,
      visibleRecords: records as unknown as Record<string, unknown>[]
    } as QuoteHistoryPageCtx
    return applyQuoteHistoryClientFilters(
      records as unknown as Record<string, unknown>[],
      ctx
    ) as unknown as QuoteHistoryRecord[]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records, pluginFilters, pluginTick, historyCtxBase])

  const historyCtx: QuoteHistoryPageCtx = useMemo(
    () => ({
      ...historyCtxBase,
      visibleRecords: visibleRecords as unknown as Record<string, unknown>[]
    }),
    [historyCtxBase, visibleRecords]
  )

  const pluginColumns = useMemo(
    () => getHanyePlugin().getQuoteHistoryColumns(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pluginTick]
  )
  const rowActions = useMemo(
    () => getHanyePlugin().getQuoteHistoryRowActions(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pluginTick]
  )
  const toolbarActions = useMemo(
    () => getHanyePlugin().getQuoteHistoryToolbarActions(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pluginTick]
  )

  const slotCtx = useMemo(
    () => ({
      q,
      action,
      recordCount: visibleRecords.length,
      detailId: detail?.id || null
    }),
    [q, action, visibleRecords.length, detail?.id]
  )

  const columns = useMemo(
    () => [
      {
        title: '时间',
        width: 160,
        render: (_: unknown, r: QuoteHistoryRecord) => fmtTime(r.createdAt)
      },
      {
        title: '用户',
        width: 120,
        render: (_: unknown, r: QuoteHistoryRecord) => (
          <Space direction="vertical" size={0}>
            <span>{r.displayName || r.username}</span>
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>
              {r.username}
            </Typography.Text>
          </Space>
        )
      },
      {
        title: '操作',
        width: 80,
        dataIndex: 'action',
        render: (a: string) =>
          a === 'export' ? <Tag color="blue">导出</Tag> : <Tag color="green">复制</Tag>
      },
      {
        title: '客户/项目',
        ellipsis: true,
        render: (_: unknown, r: QuoteHistoryRecord) =>
          [r.customer, r.jobName].filter(Boolean).join(' · ') || '—'
      },
      {
        title: '工艺',
        width: 80,
        render: (_: unknown, r: QuoteHistoryRecord) => (r.tech === 'resin' ? '光固化' : 'FDM')
      },
      {
        title: '重量/时长',
        width: 120,
        render: (_: unknown, r: QuoteHistoryRecord) =>
          `${r.weightG}g · ${Number(r.printHours).toFixed(1)}h`
      },
      {
        title: '价格',
        width: 160,
        render: (_: unknown, r: QuoteHistoryRecord) => {
          if (r.minGrand === r.maxGrand) return yuan(r.minGrand)
          return `${yuan(r.minGrand)} ~ ${yuan(r.maxGrand)}`
        }
      },
      {
        title: '方案数',
        width: 70,
        render: (_: unknown, r: QuoteHistoryRecord) => r.options?.length || 0
      },
      ...pluginColumns.map((c) => ({
        title: c.title,
        key: `plugin_${c.id}`,
        width: c.width || 100,
        render: (_: unknown, r: QuoteHistoryRecord) => {
          try {
            return c.render(r as unknown as Record<string, unknown>, historyCtx)
          } catch (e) {
            console.error('[quote history column]', c.id, e)
            return '—'
          }
        }
      })),
      {
        title: '操作',
        width: 120 + Math.min(160, rowActions.length * 72),
        render: (_: unknown, r: QuoteHistoryRecord) => (
          <Space wrap size={4}>
            <Button type="link" size="small" onClick={() => setDetail(r)}>
              详情
            </Button>
            {rowActions.map((a) => (
              <Button
                key={a.id}
                type="link"
                size="small"
                danger={a.danger}
                onClick={() => {
                  void Promise.resolve(
                    a.run({
                      ...historyCtx,
                      record: r as unknown as Record<string, unknown>
                    })
                  ).catch((err) =>
                    message.error(err instanceof Error ? err.message : '插件动作失败')
                  )
                }}
              >
                {a.label}
              </Button>
            ))}
            <Button
              type="link"
              size="small"
              danger
              onClick={() => {
                Modal.confirm({
                  title: '删除该条报价记录？',
                  okType: 'danger',
                  onOk: async () => {
                    const res = await deleteQuoteHistoryRecord(r.id)
                    if (res.ok) {
                      message.success('已删除')
                      void reload()
                    } else message.error(res.message || '删除失败')
                  }
                })
              }}
            >
              删除
            </Button>
            <PluginSlot
              name="quote.history.row.actions"
              context={{ ...slotCtx, recordId: r.id, record: r }}
            />
          </Space>
        )
      }
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [q, action, pluginColumns, rowActions, historyCtx, slotCtx]
  )

  return (
    <div style={{ padding: 16 }}>
      <PluginSlot name="quote.history.header.before" context={slotCtx} />
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <Typography.Title level={4} style={{ marginTop: 0 }}>
            报价记录
          </Typography.Title>
          <Typography.Paragraph type="secondary">
            每次「复制报价 / 导出 Excel」都会自动写入记录。可按用户、客户、项目、价格等关键词搜索。
          </Typography.Paragraph>
        </div>
        {toolbarActions.length > 0 ? (
          <Space wrap size={8}>
            {toolbarActions.map((a) => (
              <Button
                key={a.id}
                size="small"
                onClick={() => {
                  void Promise.resolve(a.run(historyCtx)).catch((err) =>
                    message.error(err instanceof Error ? err.message : '插件动作失败')
                  )
                }}
              >
                {a.label}
              </Button>
            ))}
          </Space>
        ) : null}
      </div>
      <PluginSlot name="quote.history.header.after" context={slotCtx} />

      <PluginSlot name="quote.history.toolbar.before" context={slotCtx} />
      <Space wrap style={{ marginBottom: 12 }}>
        <Input
          allowClear
          style={{ width: 280 }}
          prefix={<SearchOutlined />}
          placeholder="搜索用户/客户/项目/价格…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onPressEnter={() => void reload()}
        />
        <Select
          style={{ width: 120 }}
          value={action}
          onChange={(v) => {
            setAction(v)
            void reload(q, v)
          }}
          options={[
            { value: 'all', label: '全部操作' },
            { value: 'copy', label: '仅复制' },
            { value: 'export', label: '仅导出' }
          ]}
        />
        <QuoteHistoryPluginFilters ctx={historyCtx} />
        <Button type="primary" icon={<SearchOutlined />} onClick={() => void reload()}>
          搜索
        </Button>
        <Button icon={<ReloadOutlined />} onClick={() => void reload()}>
          刷新
        </Button>
        <Typography.Text type="secondary">{visibleRecords.length} 条</Typography.Text>
      </Space>
      <PluginSlot name="quote.history.toolbar.after" context={slotCtx} />
      <PluginSlot name="quote.history.filters.after" context={slotCtx} />

      <PluginSlot name="quote.history.list.before" context={slotCtx} />
      <Table
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={visibleRecords}
        columns={columns}
        pagination={{ pageSize: 20, showSizeChanger: true }}
        scroll={{ x: 1100 + pluginColumns.length * 100 }}
        locale={{
          emptyText: (
            <PluginSlot name="quote.history.empty" replace context={slotCtx}>
              <Empty
                description={
                  loading
                    ? '加载中…'
                    : '暂无记录。请在「常用工具」复制或导出报价，操作会自动同步到这里。'
                }
              />
            </PluginSlot>
          )
        }}
      />
      <PluginSlot name="quote.history.list.after" context={slotCtx} />

      <Modal
        title="报价详情"
        open={!!detail}
        onCancel={() => setDetail(null)}
        width={720}
        footer={[
          <PluginSlot
            key="actions"
            name="quote.history.detail.actions"
            context={{ ...slotCtx, recordId: detail?.id }}
          />,
          <Button key="close" type="primary" onClick={() => setDetail(null)}>
            关闭
          </Button>
        ]}
      >
        {detail ? (
          <PluginSlot
            name="quote.history.detail"
            replace
            context={{ ...slotCtx, recordId: detail.id }}
          >
            <PluginSlot
              name="quote.history.detail.before"
              context={{ ...slotCtx, recordId: detail.id }}
            />
            <div>
              <Typography.Paragraph>
                <Typography.Text strong>时间：</Typography.Text>
                {fmtTime(detail.createdAt)}
                <br />
                <Typography.Text strong>用户：</Typography.Text>
                {detail.displayName}（{detail.username}）
                <br />
                <Typography.Text strong>操作：</Typography.Text>
                {detail.action === 'export' ? '导出 Excel' : '复制报价'}
                <br />
                <Typography.Text strong>客户/项目：</Typography.Text>
                {[detail.customer, detail.jobName].filter(Boolean).join(' · ') || '—'}
                <br />
                <Typography.Text strong>参数：</Typography.Text>
                {detail.tech === 'resin' ? '光固化' : 'FDM'} · {detail.weightG}g ·{' '}
                {Number(detail.printHours).toFixed(2)}h · ×{detail.qty}
                {detail.gcodeFileName ? (
                  <>
                    <br />
                    <Typography.Text strong>G码：</Typography.Text>
                    {detail.gcodeFileName}
                  </>
                ) : null}
              </Typography.Paragraph>
              <QuoteHistoryPluginDetailFields
                ctx={historyCtx}
                record={detail as unknown as Record<string, unknown>}
              />
              <Table
                size="small"
                pagination={false}
                rowKey={(_, i) => String(i)}
                dataSource={detail.options}
                columns={[
                  { title: '方案', dataIndex: 'name' },
                  {
                    title: '规格',
                    render: (_: unknown, o: QuoteHistoryRecord['options'][0]) =>
                      `${o.brandLabel} ${o.materialLabel} ${o.color}`.trim()
                  },
                  {
                    title: '材料单价',
                    render: (_: unknown, o: QuoteHistoryRecord['options'][0]) =>
                      `${o.pricePerKg} 元/kg`
                  },
                  {
                    title: '报价单价',
                    render: (_: unknown, o: QuoteHistoryRecord['options'][0]) => yuan(o.perUnit)
                  },
                  {
                    title: '合计',
                    render: (_: unknown, o: QuoteHistoryRecord['options'][0]) => (
                      <Typography.Text strong>{yuan(o.grand)}</Typography.Text>
                    )
                  }
                ]}
              />
              <PluginSlot
                name="quote.history.detail.options.after"
                context={{ ...slotCtx, recordId: detail.id }}
              />
              {detail.textPreview ? (
                <Typography.Paragraph
                  type="secondary"
                  style={{
                    marginTop: 12,
                    whiteSpace: 'pre-wrap',
                    maxHeight: 160,
                    overflow: 'auto',
                    fontSize: 12
                  }}
                >
                  {detail.textPreview}
                </Typography.Paragraph>
              ) : null}
            </div>
            <PluginSlot
              name="quote.history.detail.footer"
              context={{ ...slotCtx, recordId: detail.id }}
            />
            <PluginSlot
              name="quote.history.detail.after"
              context={{ ...slotCtx, recordId: detail.id }}
            />
          </PluginSlot>
        ) : null}
      </Modal>
    </div>
  )
}
