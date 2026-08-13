import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { Button, Popconfirm, Space, Typography, message } from 'antd'
import {
  CaretRightOutlined,
  ClearOutlined,
  CloudUploadOutlined,
  PauseOutlined,
  StopOutlined
} from '@ant-design/icons'
import { deviceTech, useDeviceStore } from '../stores/deviceStore'
import type { PrinterTech } from '../types/printer'
import { PluginSlot } from '../plugins/PluginSlot'
import { getHanyePlugin, type BatchBarCtx } from '../plugins/runtime'

export function BatchPrintBar({
  tech,
  onBatchPrint
}: {
  tech: PrinterTech
  onBatchPrint: () => void
}) {
  const devices = useDeviceStore((s) => s.devices)
  const statuses = useDeviceStore((s) => s.statuses)
  const checkedIds = useDeviceStore((s) => s.checkedIds)
  const setCheckedIds = useDeviceStore((s) => s.setCheckedIds)
  const clearChecked = useDeviceStore((s) => s.clearChecked)
  const batchControl = useDeviceStore((s) => s.batchControl)
  const filter = useDeviceStore((s) => s.filter)
  const search = useDeviceStore((s) => s.search)
  const [busy, setBusy] = useState<'pause' | 'resume' | 'cancel' | string | null>(null)
  const [pluginTick, bumpPlugin] = useReducer((n: number) => n + 1, 0)
  const statusHostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    return getHanyePlugin().on('batch:change', () => bumpPlugin())
  }, [])

  const sectionDevices = useMemo(
    () => devices.filter((d) => deviceTech(d) === tech),
    [devices, tech]
  )

  const sectionCheckedIds = useMemo(
    () => checkedIds.filter((id) => sectionDevices.some((d) => d.id === id)),
    [checkedIds, sectionDevices]
  )

  const pluginActions = useMemo(
    () => getHanyePlugin().getBatchActions(tech),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tech, pluginTick]
  )
  const pluginStatuses = useMemo(
    () => getHanyePlugin().getBatchStatuses(tech),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tech, pluginTick]
  )

  const batchCtx: BatchBarCtx = useMemo(
    () => ({
      tech,
      checkedIds: sectionCheckedIds,
      devices: sectionDevices.map((d) => ({
        id: d.id,
        name: d.name,
        brand: String(d.brand),
        tech: deviceTech(d)
      })),
      statuses: statuses as Record<string, unknown>,
      busy: busy != null,
      clearChecked,
      setCheckedIds,
      batchControl: async (ids, action) => batchControl(ids, action)
    }),
    [
      tech,
      sectionCheckedIds,
      sectionDevices,
      statuses,
      busy,
      clearChecked,
      setCheckedIds,
      batchControl
    ]
  )

  useEffect(() => {
    const el = statusHostRef.current
    if (!el) return
    el.innerHTML = ''
    const cleanups: Array<() => void> = []
    for (const st of pluginStatuses) {
      const wrap = document.createElement('span')
      wrap.dataset.pluginBatchStatus = st.id
      wrap.style.marginRight = '8px'
      el.appendChild(wrap)
      try {
        const ret = st.render(wrap, batchCtx)
        if (typeof ret === 'function') cleanups.push(ret)
      } catch (e) {
        console.error('[BatchPrintBar status]', st.id, e)
      }
    }
    return () => {
      cleanups.forEach((fn) => {
        try {
          fn()
        } catch {
          /* ignore */
        }
      })
      el.innerHTML = ''
    }
  }, [pluginStatuses, batchCtx])

  if (!sectionDevices.length) return null

  const visibleIds = sectionDevices
    .filter((d) => {
      if (filter !== 'all' && d.brand !== filter) return false
      const q = search.trim().toLowerCase()
      if (!q) return true
      return (
        d.name.toLowerCase().includes(q) ||
        (d.group || '').toLowerCase().includes(q) ||
        (d.tags || []).some((t) => t.toLowerCase().includes(q))
      )
    })
    .map((d) => d.id)

  const allVisibleChecked =
    visibleIds.length > 0 && visibleIds.every((id) => checkedIds.includes(id))

  const runBatch = async (action: 'pause' | 'resume' | 'cancel', label: string) => {
    const ids = sectionCheckedIds
    if (!ids.length) {
      message.warning('请先勾选当前工作区的打印机')
      return
    }
    setBusy(action)
    try {
      const results = await batchControl(ids, action)
      const ok = results.filter((r) => r.ok).length
      const skipped = results.filter((r) => r.skipped).length
      const fail = results.filter((r) => !r.ok && !r.skipped).length
      if (ok === 0 && skipped > 0 && fail === 0) {
        message.info(`${label}：全部跳过（${skipped} 台状态不适用）`)
      } else if (fail === 0 && skipped === 0) {
        message.success(`已对 ${ok} 台设备执行${label}`)
      } else if (fail === 0) {
        message.success(`${label}完成：成功 ${ok} · 跳过 ${skipped}`)
      } else {
        message.warning(`${label}完成：成功 ${ok} · 跳过 ${skipped} · 失败 ${fail}`)
      }
    } finally {
      setBusy(null)
    }
  }

  const runPluginAction = async (id: string, label: string) => {
    const def = pluginActions.find((a) => a.id === id)
    if (!def) return
    setBusy(id)
    try {
      await def.run(batchCtx)
    } catch (e) {
      message.error(e instanceof Error ? e.message : `${label}失败`)
    } finally {
      setBusy(null)
    }
  }

  const disabled = !sectionCheckedIds.length || busy != null
  const importLabel = tech === 'resin' ? '批量导入切片' : '批量导入打印'
  const slotCtx = {
    tech,
    checkedIds: sectionCheckedIds,
    checkedCount: sectionCheckedIds.length,
    busy: busy != null
  }

  return (
    <div className={`batch-print-bar tech-${tech}`}>
      <PluginSlot name="device.batch.before" context={slotCtx} />
      <Space wrap size={10} align="center">
        <Typography.Text type="secondary">
          {tech === 'resin' ? '光固化' : 'FDM'}已选{' '}
          <Typography.Text strong>{sectionCheckedIds.length}</Typography.Text> 台
        </Typography.Text>
        <div ref={statusHostRef} className="plugin-batch-status" style={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center' }} />
        <PluginSlot name="device.batch.status" context={slotCtx} />

        <Button
          size="small"
          onClick={() => setCheckedIds(allVisibleChecked ? [] : visibleIds)}
        >
          {allVisibleChecked ? '取消全选' : '全选当前列表'}
        </Button>
        {sectionCheckedIds.length ? (
          <Button size="small" icon={<ClearOutlined />} onClick={() => clearChecked()}>
            清空选择
          </Button>
        ) : null}

        <Button
          size="small"
          icon={<PauseOutlined />}
          disabled={disabled}
          loading={busy === 'pause'}
          onClick={() => void runBatch('pause', '暂停')}
        >
          批量暂停
        </Button>
        <Button
          size="small"
          icon={<CaretRightOutlined />}
          disabled={disabled}
          loading={busy === 'resume'}
          onClick={() => void runBatch('resume', '继续')}
        >
          批量继续
        </Button>
        <Popconfirm
          title={`确认停止所选打印机？`}
          description="将取消适用设备的当前打印任务；空闲/已停止的设备会自动跳过"
          okButtonProps={{ danger: true }}
          disabled={disabled}
          onConfirm={() => void runBatch('cancel', '停止')}
        >
          <Button
            size="small"
            danger
            icon={<StopOutlined />}
            disabled={disabled}
            loading={busy === 'cancel'}
          >
            批量停止
          </Button>
        </Popconfirm>

        <Button
          type="primary"
          size="small"
          icon={<CloudUploadOutlined />}
          disabled={disabled}
          onClick={onBatchPrint}
        >
          {importLabel}
        </Button>

        <PluginSlot name="device.batch.actions" context={slotCtx} />
        {pluginActions.map((a) => {
          const needChecked = a.requireChecked !== false
          const extraDisabled = typeof a.disabled === 'function' ? Boolean(a.disabled(batchCtx)) : false
          const btnDisabled =
            busy != null || extraDisabled || (needChecked && !sectionCheckedIds.length)
          return (
            <Button
              key={a.id}
              size="small"
              danger={a.danger}
              disabled={btnDisabled}
              loading={busy === a.id}
              onClick={() => void runPluginAction(a.id, a.label)}
            >
              {a.label}
            </Button>
          )
        })}
      </Space>
      <PluginSlot name="device.batch.after" context={slotCtx} />
    </div>
  )
}
