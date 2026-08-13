import { useEffect, useMemo, useReducer, useState } from 'react'
import { Button, Empty, Modal, Select, Space, Table, Tabs, Tag, Typography, message } from 'antd'
import { useAuthStore } from '../stores/authStore'
import { usePrintQueueStore, type PrintJob } from '../stores/printQueueStore'
import { PluginSlot } from '../plugins/PluginSlot'
import { getHanyePlugin, type PrintPageCtx } from '../plugins/runtime'
import { confirmStartPrintJob } from './DeviceDetailDrawer'

function statusTagColor(s: string): string {
  switch (s) {
    case 'pending':
      return 'gold'
    case 'queued':
      return 'blue'
    case 'printing':
      return 'processing'
    case 'done':
      return 'green'
    case 'rejected':
    case 'failed':
      return 'red'
    default:
      return 'default'
  }
}

function statusLabel(s: string): string {
  const map: Record<string, string> = {
    pending: '待审核',
    queued: '排队中',
    printing: '打印中',
    done: '已下发',
    rejected: '已拒绝',
    cancelled: '已取消',
    failed: '失败',
    approved: '已通过'
  }
  return map[s] || s
}

function applyPrintFilters(jobs: PrintJob[], ctx: PrintPageCtx): PrintJob[] {
  const filters = getHanyePlugin().getPrintFilters()
  if (!filters.length) return jobs
  return jobs.filter((j) => {
    for (const f of filters) {
      try {
        if (!f.match(j as unknown as Record<string, unknown>, ctx)) return false
      } catch (e) {
        console.error('[print filter]', f.id, e)
      }
    }
    return true
  })
}

export function PrintApprovalPage() {
  const role = useAuthStore((s) => s.role)
  const jobs = usePrintQueueStore((s) => s.jobs)
  const loading = usePrintQueueStore((s) => s.loading)
  const refresh = usePrintQueueStore((s) => s.refresh)
  const approve = usePrintQueueStore((s) => s.approve)
  const reject = usePrintQueueStore((s) => s.reject)
  const start = usePrintQueueStore((s) => s.start)
  const cancel = usePrintQueueStore((s) => s.cancel)
  const canManage = usePrintQueueStore((s) => s.canManageQueue)
  const [deviceFilter, setDeviceFilter] = useState<string | 'all'>('all')
  const [tab, setTab] = useState('pending')
  const [pluginTick, bumpPlugin] = useReducer((n: number) => n + 1, 0)

  useEffect(() => {
    return getHanyePlugin().on('print:change', () => bumpPlugin())
  }, [])

  const reload = async () => {
    await refresh()
  }

  useEffect(() => {
    void reload()
  }, [role])

  const manage = canManage()

  const pageCtxBase = useMemo((): Omit<PrintPageCtx, 'tab'> => {
    return {
      canManage: manage,
      jobs: jobs as unknown as Record<string, unknown>[],
      pendingCount: jobs.filter((j) => j.status === 'pending').length,
      queuedCount: jobs.filter((j) => j.status === 'queued').length,
      historyCount: jobs.filter((j) =>
        ['done', 'rejected', 'cancelled', 'failed', 'printing'].includes(j.status)
      ).length,
      reload: () => void reload()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs, manage, pluginTick])

  const pageCtx: PrintPageCtx = useMemo(
    () => ({ ...pageCtxBase, tab }),
    [pageCtxBase, tab]
  )

  const pendingRaw = useMemo(
    () =>
      jobs
        .filter((j) => j.status === 'pending')
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [jobs]
  )

  const queuedRaw = useMemo(() => {
    let list = jobs.filter((j) => j.status === 'queued')
    if (deviceFilter !== 'all') list = list.filter((j) => j.deviceId === deviceFilter)
    return list.sort((a, b) => {
      if (a.deviceName !== b.deviceName) return a.deviceName.localeCompare(b.deviceName)
      return (a.queuedAt || a.createdAt).localeCompare(b.queuedAt || b.createdAt)
    })
  }, [jobs, deviceFilter])

  const historyRaw = useMemo(
    () =>
      jobs
        .filter((j) =>
          ['done', 'rejected', 'cancelled', 'failed', 'printing'].includes(j.status)
        )
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [jobs]
  )

  const pending = useMemo(
    () => applyPrintFilters(pendingRaw, { ...pageCtx, tab: 'pending' }),
    [pendingRaw, pageCtx]
  )
  const queued = useMemo(
    () => applyPrintFilters(queuedRaw, { ...pageCtx, tab: 'queued' }),
    [queuedRaw, pageCtx]
  )
  const history = useMemo(
    () => applyPrintFilters(historyRaw, { ...pageCtx, tab: 'history' }),
    [historyRaw, pageCtx]
  )
  const mineJobs = useMemo(
    () => applyPrintFilters(jobs, { ...pageCtx, tab: 'mine' }),
    [jobs, pageCtx]
  )

  const deviceOptions = useMemo(() => {
    const map = new Map<string, string>()
    for (const j of jobs) {
      if (j.status === 'queued') map.set(j.deviceId, j.deviceName)
    }
    return Array.from(map.entries()).map(([id, name]) => ({ value: id, label: name }))
  }, [jobs])

  const toolbarActions = useMemo(
    () => getHanyePlugin().getPrintToolbarActions(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pluginTick]
  )

  const onStart = (row: PrintJob) => {
    confirmStartPrintJob({ filename: row.filename, deviceName: row.deviceName }, async () => {
      try {
        await start(row.id)
        message.success('已下发打印')
      } catch (e) {
        message.error(e instanceof Error ? e.message : '开始打印失败')
        throw e
      }
    })
  }

  const pluginCols = (t: string) =>
    getHanyePlugin()
      .getPrintColumns(t)
      .map((c) => ({
        title: c.title,
        width: c.width,
        render: (_: unknown, r: PrintJob) =>
          c.render(r as unknown as Record<string, unknown>, { ...pageCtx, tab: t })
      }))

  const pluginRowBtns = (t: string, r: PrintJob) =>
    getHanyePlugin()
      .getPrintRowActions(t)
      .map((a) => (
        <Button
          key={a.id}
          type="link"
          size="small"
          danger={a.danger}
          onClick={() => {
            void Promise.resolve(
              a.run({
                ...pageCtx,
                tab: t,
                job: r as unknown as Record<string, unknown>
              })
            ).catch((e) => message.error(e instanceof Error ? e.message : String(e)))
          }}
        >
          {a.label}
        </Button>
      ))

  const columnsPending = [
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (s: string) => <Tag color={statusTagColor(s)}>{statusLabel(s)}</Tag>
    },
    { title: '申请人', dataIndex: 'requesterName', width: 100 },
    { title: '设备', dataIndex: 'deviceName' },
    { title: '文件', dataIndex: 'filename', ellipsis: true },
    { title: '备注', dataIndex: 'note', ellipsis: true },
    { title: '时间', dataIndex: 'createdAt', width: 180 },
    ...pluginCols('pending'),
    {
      title: '操作',
      key: 'op',
      width: 220,
      render: (_: unknown, r: PrintJob) => (
        <Space wrap>
          {manage && r.status === 'pending' ? (
            <>
              <Button
                type="link"
                size="small"
                onClick={() => {
                  void approve(r.id)
                    .then(() => message.success('已通过并加入队列'))
                    .catch((e) => message.error(e instanceof Error ? e.message : '失败'))
                }}
              >
                通过入队
              </Button>
              <Button
                type="link"
                size="small"
                danger
                onClick={() => {
                  Modal.confirm({
                    title: '拒绝该申请？',
                    onOk: () =>
                      reject(r.id)
                        .then(() => message.success('已拒绝'))
                        .catch((e) => message.error(e instanceof Error ? e.message : '失败'))
                  })
                }}
              >
                拒绝
              </Button>
            </>
          ) : null}
          {pluginRowBtns('pending', r)}
          <PluginSlot
            name="print.approve.row.actions"
            context={{ tab: 'pending', job: r, reload: pageCtx.reload }}
          />
        </Space>
      )
    }
  ]

  const columnsQueued = [
    {
      title: '位次',
      dataIndex: 'queuePosition',
      width: 70,
      render: (p: number | undefined) => (p != null ? `#${p}` : '—')
    },
    { title: '设备', dataIndex: 'deviceName', width: 120 },
    { title: '文件', dataIndex: 'filename', ellipsis: true },
    { title: '申请人', dataIndex: 'requesterName', width: 100 },
    { title: '入队时间', dataIndex: 'queuedAt', width: 180 },
    ...pluginCols('queued'),
    {
      title: '操作',
      key: 'op',
      width: 200,
      render: (_: unknown, r: PrintJob) => (
        <Space wrap>
          {manage ? (
            <>
              <Button type="link" size="small" onClick={() => onStart(r)}>
                开始打印
              </Button>
              <Button
                type="link"
                size="small"
                danger
                onClick={() => {
                  void cancel(r.id)
                    .then(() => message.success('已取消'))
                    .catch((e) => message.error(e instanceof Error ? e.message : '失败'))
                }}
              >
                取消
              </Button>
            </>
          ) : null}
          {pluginRowBtns('queued', r)}
          <PluginSlot
            name="print.approve.row.actions"
            context={{ tab: 'queued', job: r, reload: pageCtx.reload }}
          />
        </Space>
      )
    }
  ]

  const columnsHistory = [
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (s: string) => <Tag color={statusTagColor(s)}>{statusLabel(s)}</Tag>
    },
    { title: '设备', dataIndex: 'deviceName', width: 120 },
    { title: '文件', dataIndex: 'filename', ellipsis: true },
    { title: '申请人', dataIndex: 'requesterName', width: 100 },
    { title: '更新', dataIndex: 'updatedAt', width: 180 },
    {
      title: '说明',
      key: 'info',
      ellipsis: true,
      render: (_: unknown, r: PrintJob) => r.errorMessage || r.reviewNote || r.startedByName || '—'
    },
    ...pluginCols('history'),
    {
      title: '操作',
      key: 'op',
      width: 120,
      render: (_: unknown, r: PrintJob) => (
        <Space wrap>
          {pluginRowBtns('history', r)}
          <PluginSlot
            name="print.approve.row.actions"
            context={{ tab: 'history', job: r, reload: pageCtx.reload }}
          />
        </Space>
      )
    }
  ]

  const header = (
    <>
      <PluginSlot name="print.approve.header.before" context={pageCtx} />
      <PluginSlot name="print.approve.toolbar.before" context={pageCtx} />
      <Space style={{ marginBottom: 16 }} wrap>
        <Typography.Title level={4} style={{ margin: 0 }}>
          {manage ? '打印审核 / 队列' : '我的打印任务'}
        </Typography.Title>
        <Button onClick={() => void reload()}>刷新</Button>
        {toolbarActions.map((a) => (
          <Button
            key={a.id}
            onClick={() => {
              void Promise.resolve(a.run(pageCtx)).catch((e) =>
                message.error(e instanceof Error ? e.message : String(e))
              )
            }}
          >
            {a.label}
          </Button>
        ))}
      </Space>
      <PluginSlot name="print.approve.toolbar.after" context={pageCtx} />
      <PluginSlot name="print.approve.header.after" context={pageCtx} />
    </>
  )

  if (!manage && role === 'client') {
    return (
      <div style={{ padding: 16 }}>
        {header}
        <Typography.Paragraph type="secondary">
          有直接打印权限的任务会直接入队；需审核的任务通过后入队。管理员确认床清空后才会真正开打。
        </Typography.Paragraph>
        <PluginSlot name="print.approve.pending.before" context={{ ...pageCtx, tab: 'mine' }} />
        <Table
          rowKey="id"
          loading={loading}
          dataSource={mineJobs}
          columns={[
            {
              title: '状态',
              dataIndex: 'status',
              render: (s: string, r: PrintJob) => (
                <Space>
                  <Tag color={statusTagColor(s)}>{statusLabel(s)}</Tag>
                  {s === 'queued' && r.queuePosition != null ? (
                    <Typography.Text type="secondary">第 {r.queuePosition} 位</Typography.Text>
                  ) : null}
                </Space>
              )
            },
            { title: '设备', dataIndex: 'deviceName' },
            { title: '文件', dataIndex: 'filename' },
            { title: '时间', dataIndex: 'createdAt' },
            ...pluginCols('mine'),
            {
              title: '操作',
              key: 'op',
              render: (_: unknown, r: PrintJob) => (
                <Space wrap>
                  {pluginRowBtns('mine', r)}
                  <PluginSlot
                    name="print.approve.row.actions"
                    context={{ tab: 'mine', job: r, reload: pageCtx.reload }}
                  />
                </Space>
              )
            }
          ]}
          locale={{
            emptyText: (
              <PluginSlot
                name="print.approve.empty"
                replace
                context={{ ...pageCtx, tab: 'mine' }}
              >
                <Empty description="暂无任务" />
              </PluginSlot>
            )
          }}
        />
        <PluginSlot name="print.approve.pending.after" context={{ ...pageCtx, tab: 'mine' }} />
      </div>
    )
  }

  return (
    <div style={{ padding: 16 }}>
      {header}
      <Typography.Paragraph type="secondary">
        待审核通过后加入对应打印机队列；管理员可任选队列任务开打（开打前需确认上一盘已取下、热床清空）。插件可扩展列、操作与过滤。
      </Typography.Paragraph>
      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          {
            key: 'pending',
            label: `待审核 (${pending.length})`,
            children: (
              <>
                <PluginSlot
                  name="print.approve.pending.before"
                  context={{ ...pageCtx, tab: 'pending' }}
                />
                <Table
                  rowKey="id"
                  loading={loading}
                  dataSource={pending}
                  columns={columnsPending}
                  pagination={{ pageSize: 12 }}
                  locale={{
                    emptyText: (
                      <PluginSlot
                        name="print.approve.empty"
                        replace
                        context={{ ...pageCtx, tab: 'pending' }}
                      >
                        <Empty description="暂无待审核" />
                      </PluginSlot>
                    )
                  }}
                />
                <PluginSlot
                  name="print.approve.pending.after"
                  context={{ ...pageCtx, tab: 'pending' }}
                />
              </>
            )
          },
          {
            key: 'queued',
            label: `各机队列 (${queued.length})`,
            children: (
              <>
                <PluginSlot
                  name="print.approve.filters.before"
                  context={{ ...pageCtx, tab: 'queued', deviceFilter }}
                />
                <Space style={{ marginBottom: 12 }} wrap>
                  <Typography.Text type="secondary">筛选设备</Typography.Text>
                  <Select
                    style={{ minWidth: 200 }}
                    value={deviceFilter}
                    onChange={setDeviceFilter}
                    options={[{ value: 'all', label: '全部设备' }, ...deviceOptions]}
                  />
                  <PluginSlot
                    name="print.approve.filters.after"
                    context={{ ...pageCtx, tab: 'queued', deviceFilter }}
                  />
                </Space>
                <PluginSlot
                  name="print.approve.queued.before"
                  context={{ ...pageCtx, tab: 'queued' }}
                />
                <Table
                  rowKey="id"
                  loading={loading}
                  dataSource={queued}
                  columns={columnsQueued}
                  pagination={{ pageSize: 12 }}
                  locale={{
                    emptyText: (
                      <PluginSlot
                        name="print.approve.empty"
                        replace
                        context={{ ...pageCtx, tab: 'queued' }}
                      >
                        <Empty description="队列为空" />
                      </PluginSlot>
                    )
                  }}
                />
                <PluginSlot
                  name="print.approve.queued.after"
                  context={{ ...pageCtx, tab: 'queued' }}
                />
              </>
            )
          },
          {
            key: 'history',
            label: '历史',
            children: (
              <>
                <PluginSlot
                  name="print.approve.history.before"
                  context={{ ...pageCtx, tab: 'history' }}
                />
                <Table
                  rowKey="id"
                  loading={loading}
                  dataSource={history}
                  columns={columnsHistory}
                  pagination={{ pageSize: 12 }}
                  locale={{
                    emptyText: (
                      <PluginSlot
                        name="print.approve.empty"
                        replace
                        context={{ ...pageCtx, tab: 'history' }}
                      >
                        <Empty description="暂无历史" />
                      </PluginSlot>
                    )
                  }}
                />
                <PluginSlot
                  name="print.approve.history.after"
                  context={{ ...pageCtx, tab: 'history' }}
                />
              </>
            )
          }
        ]}
      />
    </div>
  )
}
