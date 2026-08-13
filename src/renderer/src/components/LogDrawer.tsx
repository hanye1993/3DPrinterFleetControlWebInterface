import { useEffect, useState } from 'react'
import { Button, Drawer, Space, Table, message } from 'antd'
import type { OperationLog } from '@shared/operationLog'
import { isClientMode, serverGet } from '../api/serverClient'
import { downloadBlob } from '../utils/openExternal'
import { PluginSlot } from '../plugins/PluginSlot'

export function LogDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [logs, setLogs] = useState<OperationLog[]>([])
  const [loading, setLoading] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      if (isClientMode()) {
        const data = await serverGet<{ logs?: OperationLog[] }>('/api/v1/logs?limit=200')
        setLogs(data.logs || [])
      } else {
        const data = (await window.electronAPI?.logs.read()) || []
        setLogs(data)
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) void load()
  }, [open])

  return (
    <Drawer
      title="操作日志"
      width={typeof window !== 'undefined' && window.innerWidth < 768 ? '100%' : 640}
      open={open}
      onClose={onClose}
      extra={
        <>
          <PluginSlot name="logs.toolbar.before" />
          <Space>
            <Button onClick={() => void load()}>刷新</Button>
            {!isClientMode() ? (
              <Button
                type="primary"
                onClick={async () => {
                  const res = await window.electronAPI?.logs.export()
                  if (res?.ok && res.path) message.success(`已导出到 ${res.path}`)
                  else message.warning('暂无日志可导出')
                }}
              >
                导出
              </Button>
            ) : (
              <Button
                type="primary"
                onClick={async () => {
                  try {
                    const data = await serverGet<{ logs?: OperationLog[] }>('/api/v1/logs?limit=500')
                    const lines = (data.logs || []).map((l) => JSON.stringify(l)).join('\n')
                    if (!lines) {
                      message.warning('暂无日志可导出')
                      return
                    }
                    downloadBlob(new TextEncoder().encode(`${lines}\n`), 'operation-logs.jsonl')
                    message.success('已下载 operation-logs.jsonl')
                  } catch (e) {
                    message.error(e instanceof Error ? e.message : '导出失败')
                  }
                }}
              >
                导出
              </Button>
            )}
          </Space>
          <PluginSlot name="logs.toolbar.after" />
        </>
      }
    >
      <PluginSlot name="logs.drawer.before" />
      <PluginSlot name="logs.drawer" replace>
        <PluginSlot name="logs.table.before" />
        <Table
          size="small"
          loading={loading}
          rowKey={(r) => `${r.time}-${r.deviceId}-${r.action}`}
          dataSource={logs}
          pagination={{ pageSize: 12 }}
          columns={[
            { title: '时间', dataIndex: 'time', width: 160 },
            { title: '设备', dataIndex: 'deviceName', width: 120 },
            { title: '操作', dataIndex: 'action', width: 100 },
            { title: '详情', dataIndex: 'detail', ellipsis: true }
          ]}
        />
        <PluginSlot name="logs.table.after" />
      </PluginSlot>
      <PluginSlot name="logs.drawer.after" />
    </Drawer>
  )
}
