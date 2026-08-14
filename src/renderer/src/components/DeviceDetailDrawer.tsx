import { useEffect, useState } from 'react'
import {
  Alert,
  Button,
  Descriptions,
  Drawer,
  Dropdown,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Progress,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  Upload,
  message
} from 'antd'
import {
  CloudDownloadOutlined,
  PlayCircleOutlined,
  SaveOutlined,
  UploadOutlined
} from '@ant-design/icons'
import type { CameraSource } from '../adapters/base'
import type { DeviceConfig, PrinterFileInfo } from '../types/printer'
import { deviceTech, useDeviceStore } from '../stores/deviceStore'
import { deviceStatusLabel } from '../utils/statusLabel'
import { formatEtaFinish, formatRemain } from '../utils/timeFormat'
import { AmsSlotChip } from './AmsSlotChip'
import { BambuDevModeHelp } from './BambuDevModeHelp'
import { CameraPanel } from './CameraPanel'
import { useFilamentStore } from '../stores/filamentStore'
import { useAuthStore, useAuthGrants } from '../stores/authStore'
import { isDeviceAiVisionEnabled } from '@shared/aiVision'
import { findBrand } from '../data/filamentBrands'
import { materialLabel } from '../data/filamentMaterials'
import {
  findSpoolBoundToSlot,
  spoolBindings,
  spoolBindSlotsLeft,
  spoolRolls
} from '../utils/spoolBinding'
import {
  isClientMode,
  serverDownloadDeviceFile,
  serverGet,
  serverListDeviceCameras,
  serverListDeviceFiles,
  serverSend,
  serverUploadDeviceFile
} from '../api/serverClient'
import { downloadBlob } from '../utils/openExternal'
import { usePrintQueueStore, type PrintJob } from '../stores/printQueueStore'
import { PluginSlot } from '../plugins/PluginSlot'
import { getHanyePlugin } from '../plugins/runtime'

function fileNameOf(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || path
}

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

/** Bed-clear confirmation before starting a queued print */
export function confirmStartPrintJob(
  job: { filename: string; deviceName?: string },
  onOk: () => Promise<void>
): void {
  Modal.confirm({
    title: '确认开始打印',
    width: 480,
    content: (
      <div>
        <Typography.Paragraph>
          即将向 <Typography.Text strong>{job.deviceName || '打印机'}</Typography.Text> 下发：
          <Typography.Text code>{job.filename}</Typography.Text>
        </Typography.Paragraph>
        <Typography.Paragraph type="warning" style={{ marginBottom: 0 }}>
          请确认：上一盘模型已取下，打印板上没有残留模型，热床清空后再发送打印。
        </Typography.Paragraph>
      </div>
    ),
    okText: '床已清空，开始打印',
    cancelText: '取消',
    onOk
  })
}

export function DeviceDetailDrawer({
  device,
  open,
  onClose
}: {
  device: DeviceConfig | null
  open: boolean
  onClose: () => void
}) {
  const deviceId = device?.id
  const st = useDeviceStore((s) => (deviceId ? s.statuses[deviceId] : undefined))
  const control = useDeviceStore((s) => s.control)
  const removeDevice = useDeviceStore((s) => s.removeDevice)
  const updateDevice = useDeviceStore((s) => s.updateDevice)
  const adapters = useDeviceStore((s) => s.adapters)
  const [files, setFiles] = useState<PrinterFileInfo[]>([])
  const [loadingFiles, setLoadingFiles] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [temp, setTemp] = useState(200)
  const [chamberTemp, setChamberTemp] = useState(45)
  const [fanPct, setFanPct] = useState(100)
  const [chamberFanPct, setChamberFanPct] = useState(0)
  const [speedPct, setSpeedPct] = useState(100)
  const [flowPct, setFlowPct] = useState(100)
  const [extrudeMm, setExtrudeMm] = useState(5)
  const [zOffsetMm, setZOffsetMm] = useState(0.05)
  const [gcodeScript, setGcodeScript] = useState('')
  const [gcodeBusy, setGcodeBusy] = useState(false)
  const [caps, setCaps] = useState<{
    control: Record<string, boolean>
    gcode?: boolean
    files?: boolean
    resin?: boolean
  } | null>(null)
  const [filamentSlot, setFilamentSlot] = useState(0)
  const [busy, setBusy] = useState(false)
  const [fileBusy, setFileBusy] = useState<string | null>(null)
  const [cameras, setCameras] = useState<CameraSource[]>([])
  const [cameraLoading, setCameraLoading] = useState(false)
  const [queueSubmitting, setQueueSubmitting] = useState(false)
  const spools = useFilamentStore((s) => s.spools)
  const bindSpoolAms = useFilamentStore((s) => s.bindSpoolAms)
  const clearSlotBinding = useFilamentStore((s) => s.clearSlotBinding)
  const { can, canDevice } = useAuthGrants()
  const canEditDevice = can('device.edit')
  const [aiBusy, setAiBusy] = useState(false)
  const authUserId = useAuthStore((s) => s.user?.id)
  const printJobs = usePrintQueueStore((s) => s.jobs)
  const refreshPrintQueue = usePrintQueueStore((s) => s.refresh)
  const submitGcode = usePrintQueueStore((s) => s.submitGcode)
  const startPrintJob = usePrintQueueStore((s) => s.start)
  const cancelPrintJob = usePrintQueueStore((s) => s.cancel)
  const canManageQueue = usePrintQueueStore((s) => s.canManageQueue)

  const adapter = deviceId ? adapters[deviceId] : undefined
  const clientMode = isClientMode()

  const deviceQueue = printJobs
    .filter(
      (j) =>
        j.deviceId === deviceId &&
        (j.status === 'queued' || j.status === 'pending' || j.status === 'printing')
    )
    .sort((a, b) => {
      const ta = a.queuedAt || a.createdAt
      const tb = b.queuedAt || b.createdAt
      return ta.localeCompare(tb)
    })

  const myQueued = deviceQueue.find(
    (j) => j.requesterId === authUserId && j.status === 'queued'
  )

  const canSubmitPrint =
    Boolean(deviceId) &&
    (canDevice(deviceId!, 'print') || canDevice(deviceId!, 'print.request'))

  const loadFiles = async () => {
    if (!deviceId) return
    if (!clientMode && !adapter) return
    setLoadingFiles(true)
    try {
      const list = clientMode
        ? await serverListDeviceFiles(deviceId)
        : await adapter!.listFiles()
      setFiles(list || [])
    } catch (err) {
      message.error(err instanceof Error ? err.message : '读取文件失败')
    } finally {
      setLoadingFiles(false)
    }
  }

  const loadCameras = async () => {
    if (!deviceId || (!clientMode && !adapter)) {
      setCameras([])
      setCameraLoading(false)
      return
    }
    setCameraLoading(true)
    try {
      if (clientMode) {
        const list = await serverListDeviceCameras(deviceId)
        // Host collapses URL candidates; keep extras + one chamber (safety if old server)
        const extras = (list || []).filter((c) => String(c.id || '').startsWith('extra:'))
        const builtIn = (list || []).filter((c) => !String(c.id || '').startsWith('extra:'))
        const chamber =
          builtIn.find((c) => c.id === 'chamber') ||
          builtIn.find((c) => {
            const n = String(c.name || '').trim()
            return n === '机舱摄像头' || n === '摄像头'
          }) ||
          builtIn[0]
        const named = builtIn.filter((c) => {
          if (!chamber) return true
          if (c.id === chamber.id) return false
          const n = String(c.name || '').trim()
          return n && n !== '摄像头' && n !== '机舱摄像头'
        })
        const logical = [...(chamber ? [chamber] : []), ...named, ...extras]
        setCameras(
          logical.map((c) => ({
            id: c.id,
            name: c.name,
            streamUrl: c.streamUrl,
            snapshotUrl: c.snapshotUrl || c.streamUrl,
            remoteStreamUrl: c.streamUrl,
            remoteSnapshotUrl: `server-api:/api/v1/devices/${encodeURIComponent(deviceId)}/cameras/${encodeURIComponent(c.id)}/snapshot?format=json`
          }))
        )
      } else {
        const list = await adapter!.getCameras()
        const extras = Array.isArray(device?.pluginData?.extraCameras)
          ? (device!.pluginData!.extraCameras as Array<Record<string, unknown>>)
          : []
        const mappedExtras = extras
          .map((e, i) => {
            const streamUrl = String(e.streamUrl || e.url || e.snapshotUrl || '').trim()
            if (!streamUrl) return null
            const id = String(e.id || '').startsWith('extra:')
              ? String(e.id)
              : `extra:${String(e.id || i)}`
            return {
              id,
              name: String(e.name || `第三方摄像头 ${i + 1}`),
              streamUrl,
              snapshotUrl: String(e.snapshotUrl || streamUrl)
            }
          })
          .filter(Boolean) as CameraSource[]
        const byId = new Set((list || []).map((c) => c.id))
        setCameras([...(list || []), ...mappedExtras.filter((c) => !byId.has(c.id))])
      }
    } catch {
      setCameras([])
    } finally {
      setCameraLoading(false)
    }
  }

  useEffect(() => {
    if (!open || !deviceId) {
      setCaps(null)
      return
    }
    let cancelled = false
    void serverGet<{
      ok?: boolean
      capabilities?: { control?: Record<string, boolean>; gcode?: boolean; files?: boolean; resin?: boolean }
    }>(`/api/v1/devices/${encodeURIComponent(deviceId)}/capabilities`)
      .then((r) => {
        if (cancelled) return
        const c = r?.capabilities
        setCaps(
          c
            ? {
                control: { ...(c.control || {}) },
                gcode: Boolean(c.gcode),
                files: Boolean(c.files),
                resin: Boolean(c.resin)
              }
            : null
        )
      })
      .catch(() => {
        if (!cancelled) setCaps(null)
      })
    return () => {
      cancelled = true
    }
  }, [open, deviceId])

  /** Permission + capability gate for control actions */
  const allowCtrl = (ctrlKey: string, perm: Parameters<typeof canDevice>[1]) => {
    if (!deviceId || !canDevice(deviceId, perm)) return false
    if (!caps) return false
    return Boolean(caps.control[ctrlKey])
  }

  useEffect(() => {
    if (!open || !deviceId) return
    setFiles([])
    void loadFiles()
    void loadCameras()
    void refreshPrintQueue({ silent: true, deviceId })
    if (st?.fanSpeed != null) setFanPct(st.fanSpeed)
    if (st?.chamberFanSpeed != null) setChamberFanPct(st.chamberFanSpeed)
    if (st?.printSpeed != null) setSpeedPct(st.printSpeed)
    // Only re-run on open / device change — not on adapter identity churn
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, deviceId])

  useEffect(() => {
    if (!open || !deviceId) return
    return getHanyePlugin().on('device:cameras-reload', (payload) => {
      const id =
        payload && typeof payload === 'object' && payload !== null && 'deviceId' in payload
          ? String((payload as { deviceId?: unknown }).deviceId || '')
          : ''
      if (!id || id !== deviceId) return
      void (async () => {
        try {
          if (isClientMode()) {
            await useDeviceStore.getState().refreshFromServer()
          }
        } catch {
          /* ignore */
        }
        await loadCameras()
      })()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, deviceId])

  if (!device) return null

  // Plugin slots need imports — added below near return
  const deviceSlotCtx = {
    deviceId: device.id,
    deviceName: device.name,
    brand: device.brand,
    chamberTemp: st?.chamberTemp ?? null,
    health: st?.health ?? null,
    state: st?.state ?? null
  }

  const onSubmitToQueue = async (file: File) => {
    const name = String(file.name || '')
    if (!/\.gcode$/i.test(name)) {
      message.error('仅支持上传 .gcode 文件')
      return false
    }

    const confirmed = await new Promise<boolean>((resolve) => {
      Modal.confirm({
        title: '确认上传打印文件',
        width: 480,
        content: (
          <div>
            <Typography.Paragraph>
              即将向 <Typography.Text strong>{device.name}</Typography.Text> 提交：
              <Typography.Text code>{name}</Typography.Text>
            </Typography.Paragraph>
            <Typography.Paragraph type="warning" style={{ marginBottom: 0 }}>
              请确保 G 文件是正确的，是选择了这台打印机的切片软件切片的。
            </Typography.Paragraph>
          </div>
        ),
        okText: '确认上传',
        cancelText: '取消',
        onOk: () => resolve(true),
        onCancel: () => resolve(false)
      })
    })
    if (!confirmed) return false

    setQueueSubmitting(true)
    try {
      const res = await submitGcode({
        deviceId: device.id,
        deviceName: device.name,
        file,
        note: '网页提交'
      })
      if (res.queued) {
        message.success(
          res.queuePosition
            ? `已加入队列，当前第 ${res.queuePosition} 位`
            : '已加入打印队列'
        )
      } else {
        message.success('已提交，等待管理员审核通过后入队')
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : '提交失败')
    } finally {
      setQueueSubmitting(false)
    }
    return false
  }

  const onStartQueuedJob = (job: PrintJob) => {
    confirmStartPrintJob(
      { filename: job.filename, deviceName: job.deviceName || device.name },
      async () => {
        try {
          await startPrintJob(job.id)
          message.success(`已下发打印 ${job.filename}`)
        } catch (err) {
          message.error(err instanceof Error ? err.message : '开始打印失败')
          throw err
        }
      }
    )
  }

  const run = async (action: Parameters<typeof control>[1], label: string) => {
    setBusy(true)
    try {
      await control(device.id, action)
      message.success(`${label} 已发送`)
    } catch (err) {
      message.error(err instanceof Error ? err.message : '操作失败')
    } finally {
      setBusy(false)
    }
  }

  const sendGcode = async () => {
    if (!deviceId || !gcodeScript.trim()) {
      message.warning('请输入 G-code')
      return
    }
    setGcodeBusy(true)
    try {
      await serverSend(`/api/v1/devices/${encodeURIComponent(deviceId)}/gcode`, 'POST', {
        script: gcodeScript
      })
      message.success('G-code 已发送')
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'G-code 发送失败')
    } finally {
      setGcodeBusy(false)
    }
  }

  const onUpload = async (file: File) => {
    if (!clientMode) {
      const localAdapter = adapters[device.id]
      if (!localAdapter) {
        message.error('设备未连接')
        return false
      }
    }
    setUploading(true)
    try {
      if (clientMode) {
        await serverUploadDeviceFile(device.id, file)
      } else {
        await adapters[device.id]!.uploadFile(file)
      }
      if (!clientMode) {
        await window.electronAPI?.logs.append({
          time: new Date().toISOString(),
          deviceId: device.id,
          deviceName: device.name,
          action: 'upload',
          result: 'ok',
          detail: file.name
        })
      }
      message.success(`已上传 ${file.name}`)
      await loadFiles()
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      if (!clientMode) {
        await window.electronAPI?.logs.append({
          time: new Date().toISOString(),
          deviceId: device.id,
          deviceName: device.name,
          action: 'upload',
          result: 'error',
          detail
        })
      }
      message.error(detail)
    } finally {
      setUploading(false)
    }
    return false
  }

  const downloadRemote = async (remotePath: string, mode: 'app' | 'as') => {
    if (!clientMode && !adapters[device.id]) {
      message.error('设备未连接')
      return
    }
    setFileBusy(remotePath)
    try {
      const data = clientMode
        ? await serverDownloadDeviceFile(device.id, remotePath)
        : await adapters[device.id]!.downloadFile(remotePath)
      const name = fileNameOf(remotePath)
      if (clientMode) {
        downloadBlob(data, name)
        message.success(`已下载 ${name}`)
        return
      }
      const res =
        mode === 'as'
          ? await window.electronAPI?.localFiles.saveAs({ fileName: name, data })
          : await window.electronAPI?.localFiles.save({
              fileName: name,
              data,
              subdir: device.name
            })
      if (!res?.ok || !res.path) {
        if (mode === 'as') message.info('已取消保存')
        else message.error('保存失败')
        return
      }
      await window.electronAPI?.logs.append({
        time: new Date().toISOString(),
        deviceId: device.id,
        deviceName: device.name,
        action: 'download',
        result: 'ok',
        detail: `${remotePath} → ${res.path}`
      })
      message.success(`已保存到 ${res.path}`)
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      message.error(detail)
    } finally {
      setFileBusy(null)
    }
  }

  const startPrint = async (remotePath: string) => {
    if (!clientMode && !adapters[device.id]) {
      message.error('设备未连接')
      return
    }
    setFileBusy(remotePath)
    try {
      if (clientMode) {
        await control(device.id, { action: 'print_file', filename: remotePath })
      } else {
        await adapters[device.id]!.printFile(remotePath)
      }
      if (!clientMode) {
        await window.electronAPI?.logs.append({
          time: new Date().toISOString(),
          deviceId: device.id,
          deviceName: device.name,
          action: 'print_file',
          result: 'ok',
          detail: remotePath
        })
      }
      message.success(`已开始打印 ${remotePath}`)
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      if (!clientMode) {
        await window.electronAPI?.logs.append({
          time: new Date().toISOString(),
          deviceId: device.id,
          deviceName: device.name,
          action: 'print_file',
          result: 'error',
          detail
        })
      }
      message.error(detail)
    } finally {
      setFileBusy(null)
    }
  }

  const brandName =
    device.brand === 'klipper'
      ? 'Klipper'
      : device.brand === 'creality'
        ? '创想三维'
        : device.brand === 'elegoo'
          ? '爱乐库'
          : device.brand === 'anycubic'
            ? '纵维立方'
            : device.brand === 'snapmaker'
              ? 'Snapmaker'
              : device.brand === 'flashforge'
                ? '闪铸'
                : device.brand === 'qidi'
                  ? '启迪'
                  : 'Bambu Lab'

  const isMultiColor = Boolean(st?.amsSlots?.length)
  const isResin = deviceTech(device) === 'resin'

  return (
    <Drawer
      title={
        <Space size={8}>
          <span>
            {device.name} · 控制
          </span>
          <Tag className={isResin ? 'tech-tag resin' : 'tech-tag fdm'} bordered={false}>
            {isResin ? '光固化' : 'FDM'}
          </Tag>
          {!isResin && isMultiColor ? (
            <Tag className="multi-color-tag" bordered={false}>
              多色
            </Tag>
          ) : null}
        </Space>
      }
      width={typeof window !== 'undefined' && window.innerWidth < 768 ? '100%' : 720}
      open={open}
      onClose={onClose}
      destroyOnHidden
      extra={
        <Space>
          <PluginSlot name="device.detail.header.extra" context={deviceSlotCtx} />
          <Button
            size="small"
            onClick={() => {
              let model = device.model || ''
              Modal.confirm({
                title: '设置机型',
                content: (
                  <div>
                    <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
                      批量导入打印仅允许同品牌、同机型设备一起操作。
                    </Typography.Paragraph>
                    <Input
                      defaultValue={model}
                      placeholder="例如：K1 Max / X1C"
                      onChange={(e) => {
                        model = e.target.value
                      }}
                    />
                  </div>
                ),
                okText: '保存',
                onOk: async () => {
                  await updateDevice({
                    ...device,
                    model: model.trim() || undefined
                  })
                  message.success('机型已更新')
                }
              })
            }}
          >
            机型{device.model ? `·${device.model}` : ''}
          </Button>
          <Popconfirm
            title="删除此设备？"
            onConfirm={() => {
              void removeDevice(device.id).then(onClose)
            }}
          >
            <Button danger size="small">
              删除
            </Button>
          </Popconfirm>
        </Space>
      }
    >
      <PluginSlot name="device.detail" replace context={deviceSlotCtx}>
      <PluginSlot name="device.detail.before" context={deviceSlotCtx} />
      <PluginSlot name="device.detail.camera.before" context={deviceSlotCtx} />
      <CameraPanel cameras={cameras} loading={cameraLoading} brandHint={device.brand} />
      <PluginSlot name="device.detail.camera.after" context={deviceSlotCtx} />

      {canEditDevice ? (
        <div className="settings-row" style={{ marginBottom: 16, marginTop: 8 }}>
          <div className="settings-row-label">
            <Typography.Text strong>AI 视频巡检</Typography.Text>
            <Typography.Text type="secondary">
              仅本机；需在「软件设置 → AI 对接」打开总开关后才会巡检
            </Typography.Text>
          </div>
          <Switch
            checked={isDeviceAiVisionEnabled(device)}
            loading={aiBusy}
            onChange={(v) => {
              setAiBusy(true)
              void updateDevice({ ...device, aiVisionEnabled: v })
                .then(() => message.success(v ? '已开启本机 AI 巡检' : '已关闭本机 AI 巡检'))
                .catch((e) => message.error(e instanceof Error ? e.message : '保存失败'))
                .finally(() => setAiBusy(false))
            }}
          />
        </div>
      ) : null}
      <PluginSlot name="device.detail.ai.after" context={deviceSlotCtx} />

      {device.brand === 'bambu' && (device.connectionMode || 'lan') === 'lan' ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={
            st?.message && String(st.message).includes('MQTT')
              ? '拓竹控制被拒（需开发者模式）'
              : '拓竹局域网控制说明'
          }
          description={
            <>
              {st?.message && String(st.message).includes('MQTT') ? (
                <div style={{ marginBottom: 8 }}>{String(st.message)}</div>
              ) : null}
              <BambuDevModeHelp compact={!String(st?.message || '').includes('MQTT')} />
            </>
          }
        />
      ) : null}

      <PluginSlot name="device.detail.status.before" context={deviceSlotCtx} />
      <div style={{ marginBottom: 16 }}>
        <Space wrap size={16} style={{ width: '100%', justifyContent: 'space-between' }}>
          <Space direction="vertical" size={0}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {brandName} · {isResin ? '光固化' : 'FDM'} · {st?.state || '--'} ·{' '}
              {device.connectionMode || 'lan'}
            </Typography.Text>
            <Typography.Text ellipsis style={{ maxWidth: 360 }}>
              {deviceStatusLabel(st)}
            </Typography.Text>
          </Space>
          <div style={{ minWidth: 160 }}>
            <Progress
              percent={Math.min(100, Math.round(st?.progress ?? 0))}
              size="small"
              status={st?.health === 'error' ? 'exception' : 'active'}
            />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {isResin
                ? `层 ${st?.layer ?? '--'} / ${st?.layerTotal ?? '--'}`
                : `挤出 ${st?.extruder ? `${st.extruder.actual.toFixed(0)}°` : '--'} · 热床 ${
                    st?.bed ? `${st.bed.actual.toFixed(0)}°` : '--'
                  } · 主板 ${Math.round(st?.boardTemp ?? 0)}° · 仓内 ${Math.round(st?.chamberTemp ?? 0)}°`}
              {st?.remainingSeconds != null && st.remainingSeconds > 0
                ? ` · 剩余 ${formatRemain(st.remainingSeconds)} · 约 ${formatEtaFinish(st.remainingSeconds)} 完成`
                : ''}
            </Typography.Text>
          </div>
        </Space>
      </div>

      <Descriptions size="small" column={2} bordered style={{ marginBottom: 16 }}>
        <Descriptions.Item label="健康">{st?.health || '--'}</Descriptions.Item>
        <Descriptions.Item label="层数">
          {st?.layer ?? '--'} / {st?.layerTotal ?? '--'}
        </Descriptions.Item>
        <Descriptions.Item label="剩余时间">{formatRemain(st?.remainingSeconds)}</Descriptions.Item>
        <Descriptions.Item label="预计完成">
          {st?.remainingSeconds != null && st.remainingSeconds > 0
            ? formatEtaFinish(st.remainingSeconds)
            : '--'}
        </Descriptions.Item>
        {!isResin ? (
          <>
            <Descriptions.Item label="主板温度">
              {Math.round(st?.boardTemp ?? 0)} °C
            </Descriptions.Item>
            <Descriptions.Item label="仓内温度">
              {Math.round(st?.chamberTemp ?? 0)} °C
            </Descriptions.Item>
          </>
        ) : null}
        <Descriptions.Item label="地址 / ID" span={2}>
          {device.baseUrl || device.bambuDeviceId || '--'}
        </Descriptions.Item>
        {st?.message ? (
          <Descriptions.Item label="提示" span={2}>
            {st.message}
          </Descriptions.Item>
        ) : null}
      </Descriptions>
      <PluginSlot name="device.detail.status.after" context={deviceSlotCtx} />

      {!isResin ? (
        <div style={{ marginBottom: 16 }}>
          <PluginSlot name="device.detail.filament.before" context={deviceSlotCtx} />
          <Typography.Title level={5} style={{ marginTop: 0 }}>
            耗材绑定
          </Typography.Title>
          <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
            绑定本地料卷后打印完成自动扣减。多色 AMS 按剩余%；单色/外挂自动读取任务用量，无需手填。
          </Typography.Paragraph>
          {device.brand === 'bambu' && st?.amsSlots?.length ? (
            <Space size={8} wrap style={{ marginBottom: 12 }}>
              {st.amsSlots.map((slot) => {
                const bound = findSpoolBoundToSlot(spools, device.id, slot.id)
                return (
                  <Space key={slot.id} direction="vertical" size={4}>
                    <AmsSlotChip slot={slot} />
                    <Select
                      size="small"
                      style={{ minWidth: 150 }}
                      placeholder="绑定料卷"
                      allowClear
                      value={bound?.id}
                      onChange={(spoolId) => {
                        void (async () => {
                          if (!spoolId) {
                            try {
                              await clearSlotBinding(device.id, slot.id)
                              message.success('已解除绑定')
                            } catch (e) {
                              message.error(e instanceof Error ? e.message : '解绑失败')
                            }
                            return
                          }
                          const ok = await bindSpoolAms(spoolId, {
                            deviceId: device.id,
                            slotId: slot.id
                          })
                          if (!ok) {
                            const s = spools.find((x) => x.id === spoolId)
                            message.warning(
                              `该料卷仅 ${spoolRolls(s || { rolls: 1 })} 卷，已绑满，无法再绑`
                            )
                            return
                          }
                          message.success(`已绑定 AMS ${slot.id}`)
                        })()
                      }}
                      options={spools
                        .filter((s) => s.tech === 'fdm' && !s.archived)
                        .map((s) => {
                          const left = spoolBindSlotsLeft(s)
                          const already = spoolBindings(s).some(
                            (b) => b.deviceId === device.id && Number(b.slotId) === slot.id
                          )
                          return {
                            value: s.id,
                            disabled: left <= 0 && !already,
                            label: `${findBrand(s.brandId)?.name || s.brandId} ${materialLabel(s.material)} ${s.color} (${Math.round(s.remainGrams)}g · ${spoolBindings(s).length}/${spoolRolls(s)}卷)`
                          }
                        })}
                    />
                  </Space>
                )
              })}
            </Space>
          ) : null}
          {(() => {
            const extBound = findSpoolBoundToSlot(spools, device.id, 0)
            return (
              <Space wrap align="center">
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  外挂 / 单色料架
                </Typography.Text>
                <Select
                  size="small"
                  style={{ minWidth: 200 }}
                  placeholder="绑定料卷"
                  allowClear
                  value={extBound?.id}
                  onChange={(spoolId) => {
                    void (async () => {
                      if (!spoolId) {
                        try {
                          await clearSlotBinding(device.id, 0)
                          message.success('已解除绑定')
                        } catch (e) {
                          message.error(e instanceof Error ? e.message : '解绑失败')
                        }
                        return
                      }
                      const ok = await bindSpoolAms(spoolId, {
                        deviceId: device.id,
                        slotId: 0
                      })
                      if (!ok) {
                        const s = spools.find((x) => x.id === spoolId)
                        message.warning(
                          `该料卷仅 ${spoolRolls(s || { rolls: 1 })} 卷，已绑满，无法再绑`
                        )
                        return
                      }
                      message.success('已绑定外挂/单色料架')
                    })()
                  }}
                  options={spools
                    .filter((s) => s.tech === 'fdm' && !s.archived)
                    .map((s) => {
                      const left = spoolBindSlotsLeft(s)
                      const already = spoolBindings(s).some(
                        (b) => b.deviceId === device.id && Number(b.slotId) === 0
                      )
                      return {
                        value: s.id,
                        disabled: left <= 0 && !already,
                        label: `${findBrand(s.brandId)?.name || s.brandId} ${materialLabel(s.material)} ${s.color} (${Math.round(s.remainGrams)}g · ${spoolBindings(s).length}/${spoolRolls(s)}卷)`
                      }
                    })}
                />
              </Space>
            )
          })()}
          <PluginSlot name="device.detail.filament.after" context={deviceSlotCtx} />
        </div>
      ) : null}

      <Typography.Title level={5}>远程控制</Typography.Title>
      <PluginSlot name="device.detail.control.before" context={deviceSlotCtx} />
      <PluginSlot name="device.detail.control" replace context={deviceSlotCtx}>
      <Space wrap style={{ marginBottom: 16 }}>
        {allowCtrl('pause', 'pause') ? (
          <Popconfirm title="确认暂停打印？" onConfirm={() => void run({ action: 'pause' }, '暂停')}>
            <Button disabled={busy}>暂停</Button>
          </Popconfirm>
        ) : null}
        {allowCtrl('resume', 'resume') ? (
          <Popconfirm title="确认恢复打印？" onConfirm={() => void run({ action: 'resume' }, '恢复')}>
            <Button disabled={busy}>恢复</Button>
          </Popconfirm>
        ) : null}
        {allowCtrl('cancel', 'cancel') ? (
          <Popconfirm
            title="确认取消打印？此操作不可恢复"
            onConfirm={() => void run({ action: 'cancel' }, '取消')}
          >
            <Button danger disabled={busy}>
              取消打印
            </Button>
          </Popconfirm>
        ) : null}
        {allowCtrl('emergency_stop', 'emergency_stop') ? (
          <Button
            danger
            type="primary"
            disabled={busy}
            onClick={() => {
              Modal.confirm({
                title: '紧急停止',
                content: '将发送紧急停止指令，确认继续？',
                okButtonProps: { danger: true },
                onOk: () => run({ action: 'emergency_stop' }, '紧急停止')
              })
            }}
          >
            紧急停止
          </Button>
        ) : null}
        {allowCtrl('home', 'home') ? (
          <Popconfirm title="确认归零？" onConfirm={() => void run({ action: 'home' }, '归零')}>
            <Button disabled={busy}>归零</Button>
          </Popconfirm>
        ) : null}
      </Space>
      </PluginSlot>
      <PluginSlot name="device.detail.control.after" context={deviceSlotCtx} />

      {allowCtrl('jog', 'jog') ? (
        <div style={{ marginBottom: 16 }}>
          <Typography.Title level={5}>轴点动</Typography.Title>
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            {(['X', 'Y', 'Z'] as const).map((axis) => (
              <Space key={axis} wrap>
                <Typography.Text style={{ width: 28 }}>{axis}</Typography.Text>
                {([-10, -1, 1, 10] as const).map((amount) => (
                  <Button
                    key={`${axis}-${amount}`}
                    disabled={busy}
                    onClick={() =>
                      void run(
                        { action: 'jog', axis, amount },
                        `点动 ${axis}${amount > 0 ? '+' : ''}${amount}`
                      )
                    }
                  >
                    {amount > 0 ? '+' : ''}
                    {amount}
                  </Button>
                ))}
              </Space>
            ))}
          </Space>
        </div>
      ) : null}

      {allowCtrl('set_temp', 'set_temp') ? (
        <>
          <Space wrap style={{ marginBottom: 12 }}>
            <InputNumber value={temp} onChange={(v) => setTemp(Number(v || 0))} addonAfter="°C" />
            <Button
              disabled={busy}
              onClick={() =>
                void run(
                  { action: 'set_temp', heater: 'extruder', temperature: temp },
                  '设置挤出机温度'
                )
              }
            >
              挤出机温度
            </Button>
            <Button
              disabled={busy}
              onClick={() =>
                void run({ action: 'set_temp', heater: 'bed', temperature: temp }, '设置热床温度')
              }
            >
              热床温度
            </Button>
          </Space>
          {allowCtrl('set_chamber_temp', 'set_chamber_temp') ? (
            <Space wrap style={{ marginBottom: 12 }}>
              <InputNumber
                value={chamberTemp}
                onChange={(v) => setChamberTemp(Number(v || 0))}
                addonAfter="仓温°C"
              />
              <Button
                disabled={busy}
                onClick={() =>
                  void run(
                    { action: 'set_chamber_temp', temperature: chamberTemp },
                    '设置仓内温度'
                  )
                }
              >
                仓内温度
              </Button>
            </Space>
          ) : null}
          <PluginSlot name="device.detail.temps.after" context={deviceSlotCtx} />
        </>
      ) : isResin && !allowCtrl('set_fan', 'set_fan') && !allowCtrl('set_speed', 'set_speed') ? (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="光固化控制"
          description="本机深控以机型能力为准；切片上传与曝光参数视品牌支持情况接入。"
        />
      ) : null}

      {(allowCtrl('extrude', 'extrude') || allowCtrl('retract', 'retract')) ? (
        <div style={{ marginBottom: 16 }}>
          <Typography.Title level={5}>挤出 / 回抽</Typography.Title>
          <Space wrap>
            <InputNumber
              min={0.1}
              max={50}
              step={0.5}
              value={extrudeMm}
              onChange={(v) => setExtrudeMm(Number(v || 5))}
              addonAfter="mm"
            />
            {allowCtrl('extrude', 'extrude') ? (
              <Popconfirm
                title="确认挤出？"
                description="请确认喷嘴已加热到耗材温度"
                onConfirm={() =>
                  void run({ action: 'extrude', amount: extrudeMm }, `挤出 ${extrudeMm}mm`)
                }
              >
                <Button disabled={busy}>挤出</Button>
              </Popconfirm>
            ) : null}
            {allowCtrl('retract', 'retract') ? (
              <Popconfirm
                title="确认回抽？"
                onConfirm={() =>
                  void run({ action: 'retract', amount: extrudeMm }, `回抽 ${extrudeMm}mm`)
                }
              >
                <Button disabled={busy}>回抽</Button>
              </Popconfirm>
            ) : null}
          </Space>
        </div>
      ) : null}

      {(allowCtrl('load_filament', 'filament_load') ||
        allowCtrl('unload_filament', 'filament_unload')) ? (
        <div style={{ marginBottom: 24 }}>
          <PluginSlot name="device.detail.filament.load.before" context={deviceSlotCtx} />
          <Typography.Title level={5}>进料 / 退料</Typography.Title>
          <Space wrap align="center">
            {device.brand === 'bambu' && st?.amsSlots && st.amsSlots.length > 0 ? (
              <Select
                size="middle"
                style={{ minWidth: 140 }}
                value={filamentSlot}
                onChange={setFilamentSlot}
                options={[
                  { value: 0, label: '外挂料架' },
                  ...st.amsSlots.map((s) => ({
                    value: s.id,
                    label: `AMS ${s.id} · ${s.material}`
                  }))
                ]}
              />
            ) : null}
            <Popconfirm
              title="确认进料？"
              description={
                device.brand === 'bambu'
                  ? '将加热喷嘴并执行进料（请确认耗材已就绪）'
                  : '将调用 LOAD_FILAMENT 宏（需打印机已配置）'
              }
              onConfirm={() =>
                void run(
                  {
                    action: 'load_filament',
                    temperature: temp > 0 ? temp : 220,
                    slot:
                      device.brand === 'bambu' && filamentSlot > 0 ? filamentSlot : undefined
                  },
                  '进料'
                )
              }
            >
              <Button disabled={busy}>进料</Button>
            </Popconfirm>
            <Popconfirm
              title="确认退料？"
              description={
                device.brand === 'bambu'
                  ? '将加热喷嘴并退出当前耗材'
                  : '将调用 UNLOAD_FILAMENT 宏（需打印机已配置）'
              }
              onConfirm={() =>
                void run(
                  {
                    action: 'unload_filament',
                    temperature: temp > 0 ? temp : 220
                  },
                  '退料'
                )
              }
            >
              <Button disabled={busy}>退料</Button>
            </Popconfirm>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              使用上方温度（默认 220°C）
            </Typography.Text>
          </Space>
          <PluginSlot name="device.detail.filament.load.after" context={deviceSlotCtx} />
        </div>
      ) : null}

      {allowCtrl('set_fan', 'set_fan') ||
      allowCtrl('set_speed', 'set_speed') ||
      allowCtrl('set_flow', 'set_flow') ? (
        <>
          <Space wrap style={{ marginBottom: 24 }}>
            {allowCtrl('set_fan', 'set_fan') && st?.chamberFanSpeed != null ? (
              <>
                <InputNumber
                  min={0}
                  max={100}
                  value={chamberFanPct}
                  onChange={(v) => setChamberFanPct(Number(v || 0))}
                  addonAfter="仓内%"
                />
                <Button
                  disabled={busy}
                  onClick={() =>
                    void run(
                      {
                        action: 'set_fan',
                        fan: 'chamber',
                        percent: chamberFanPct,
                        fanName: st.chamberFanName
                      },
                      '设置仓内风扇'
                    )
                  }
                >
                  应用仓内风扇
                </Button>
              </>
            ) : null}
            {allowCtrl('set_fan', 'set_fan') ? (
              <>
                <InputNumber
                  min={0}
                  max={100}
                  value={fanPct}
                  onChange={(v) => setFanPct(Number(v || 0))}
                  addonAfter="风扇%"
                />
                <Button
                  disabled={busy}
                  onClick={() =>
                    void run({ action: 'set_fan', fan: 'part', percent: fanPct }, '设置风扇')
                  }
                >
                  应用风扇
                </Button>
              </>
            ) : null}
            {allowCtrl('set_speed', 'set_speed') ? (
              <>
                <InputNumber
                  min={1}
                  max={200}
                  value={speedPct}
                  onChange={(v) => setSpeedPct(Number(v || 100))}
                  addonAfter="速度%"
                />
                <Button
                  disabled={busy}
                  onClick={() => void run({ action: 'set_speed', percent: speedPct }, '设置速度')}
                >
                  应用速度
                </Button>
              </>
            ) : null}
            {allowCtrl('set_flow', 'set_flow') ? (
              <>
                <InputNumber
                  min={1}
                  max={200}
                  value={flowPct}
                  onChange={(v) => setFlowPct(Number(v || 100))}
                  addonAfter="流量%"
                />
                <Button
                  disabled={busy}
                  onClick={() => void run({ action: 'set_flow', percent: flowPct }, '设置流量')}
                >
                  应用流量
                </Button>
              </>
            ) : null}
          </Space>
          <PluginSlot name="device.detail.fans.after" context={deviceSlotCtx} />
        </>
      ) : null}

      {allowCtrl('set_z_offset', 'set_z_offset') ||
      allowCtrl('restart', 'restart') ||
      allowCtrl('firmware_restart', 'firmware_restart') ? (
        <div style={{ marginBottom: 24 }}>
          <Typography.Title level={5}>调参 / 重启</Typography.Title>
          <Space wrap>
            {allowCtrl('set_z_offset', 'set_z_offset') ? (
              <>
                <InputNumber
                  min={0.01}
                  max={2}
                  step={0.01}
                  value={zOffsetMm}
                  onChange={(v) => setZOffsetMm(Number(v || 0.05))}
                  addonAfter="Z±mm"
                />
                <Button
                  disabled={busy}
                  onClick={() =>
                    void run(
                      { action: 'set_z_offset', amount: -Math.abs(zOffsetMm) },
                      `Z 偏移 -${Math.abs(zOffsetMm)}`
                    )
                  }
                >
                  Z-
                </Button>
                <Button
                  disabled={busy}
                  onClick={() =>
                    void run(
                      { action: 'set_z_offset', amount: Math.abs(zOffsetMm) },
                      `Z 偏移 +${Math.abs(zOffsetMm)}`
                    )
                  }
                >
                  Z+
                </Button>
              </>
            ) : null}
            {allowCtrl('restart', 'restart') ? (
              <Popconfirm
                title="确认重启主机（Klipper/Moonraker）？"
                onConfirm={() => void run({ action: 'restart' }, '重启主机')}
              >
                <Button disabled={busy}>重启主机</Button>
              </Popconfirm>
            ) : null}
            {allowCtrl('firmware_restart', 'firmware_restart') ? (
              <Popconfirm
                title="确认固件重启？"
                onConfirm={() => void run({ action: 'firmware_restart' }, '固件重启')}
              >
                <Button danger disabled={busy}>
                  固件重启
                </Button>
              </Popconfirm>
            ) : null}
          </Space>
        </div>
      ) : null}

      {canDevice(device.id, 'gcode') && caps?.gcode ? (
        <div style={{ marginBottom: 24 }}>
          <Typography.Title level={5}>任意 G-code</Typography.Title>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
            仅 Moonraker 类设备（Klipper / 部分创想等）。请确认指令安全后再发送。
          </Typography.Paragraph>
          <Input.TextArea
            rows={3}
            value={gcodeScript}
            onChange={(e) => setGcodeScript(e.target.value)}
            placeholder="例如：M118 Hello&#10;G28"
            style={{ marginBottom: 8, fontFamily: 'ui-monospace, monospace' }}
          />
          <Button type="primary" loading={gcodeBusy} disabled={busy} onClick={() => void sendGcode()}>
            发送 G-code
          </Button>
        </div>
      ) : null}

      {!isResin && canSubmitPrint ? (
        <div style={{ marginBottom: 24 }}>
          <PluginSlot name="device.detail.queue.before" context={deviceSlotCtx} />
          <Typography.Title level={5}>发送 G 文件打印</Typography.Title>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
            仅支持 .gcode；提交后按权限进入该机队列（需审核则先审核）；管理员确认床清空后再开打。
            请确保 G 文件是正确的，是选择了这台打印机的切片软件切片的。
            {myQueued?.queuePosition ? (
              <>
                {' '}
                你当前排队第 <Typography.Text strong>{myQueued.queuePosition}</Typography.Text> 位。
              </>
            ) : null}
          </Typography.Paragraph>
          <Space wrap style={{ marginBottom: 8 }}>
            <Upload
              accept=".gcode"
              showUploadList={false}
              beforeUpload={(file) => {
                void onSubmitToQueue(file as unknown as File)
                return false
              }}
            >
              <Button type="primary" icon={<UploadOutlined />} loading={queueSubmitting}>
                选择 .gcode 加入队列
              </Button>
            </Upload>
            <Button onClick={() => void refreshPrintQueue({ silent: true, deviceId: device.id })}>
              刷新队列
            </Button>
          </Space>
          <Table
            size="small"
            rowKey="id"
            pagination={false}
            locale={{ emptyText: '本机暂无排队/待审任务' }}
            dataSource={deviceQueue}
            columns={[
              {
                title: '状态',
                dataIndex: 'status',
                width: 90,
                render: (s: string, row: PrintJob) => (
                  <Space size={4}>
                    <Tag color={statusTagColor(s)}>{statusLabel(s)}</Tag>
                    {s === 'queued' && row.queuePosition ? (
                      <Typography.Text type="secondary">#{row.queuePosition}</Typography.Text>
                    ) : null}
                  </Space>
                )
              },
              { title: '文件', dataIndex: 'filename', ellipsis: true },
              { title: '申请人', dataIndex: 'requesterName', width: 90 },
              {
                title: '操作',
                key: 'op',
                width: 140,
                render: (_: unknown, row: PrintJob) => (
                  <Space size={0}>
                    {canManageQueue() && row.status === 'queued' ? (
                      <Button type="link" size="small" onClick={() => onStartQueuedJob(row)}>
                        开始
                      </Button>
                    ) : null}
                    {(canManageQueue() || row.requesterId === authUserId) &&
                    (row.status === 'queued' || row.status === 'pending') ? (
                      <Button
                        type="link"
                        size="small"
                        danger
                        onClick={() => {
                          void cancelPrintJob(row.id)
                            .then(() => message.success('已取消'))
                            .catch((e) =>
                              message.error(e instanceof Error ? e.message : '取消失败')
                            )
                        }}
                      >
                        取消
                      </Button>
                    ) : null}
                  </Space>
                )
              }
            ]}
          />
          <PluginSlot name="device.detail.queue.after" context={deviceSlotCtx} />
        </div>
      ) : null}

      <PluginSlot name="device.detail.files.before" context={deviceSlotCtx} />
      <Typography.Title level={5}>{isResin ? '切片文件' : '文件'}</Typography.Title>
      <PluginSlot name="device.detail.files.toolbar" context={deviceSlotCtx}>
      <Space style={{ marginBottom: 8 }} wrap>
        <Button onClick={() => void loadFiles()} loading={loadingFiles}>
          刷新文件列表
        </Button>
        <Upload
          accept={
            isResin
              ? '.ctb,.goo,.pwmo,.pws,.photon,.phz,.zip,.slc'
              : '.gcode,.gco,.nc,.bgcode,.3mf'
          }
          showUploadList={false}
          beforeUpload={(file) => {
            void onUpload(file as unknown as File)
            return false
          }}
        >
          <Button icon={<UploadOutlined />} loading={uploading}>
            上传文件
          </Button>
        </Upload>
        {!clientMode ? (
          <Button
            onClick={async () => {
              await window.electronAPI?.localFiles.openDir()
            }}
          >
            打开本地下载目录
          </Button>
        ) : null}
        <PluginSlot name="device.detail.files.row.actions" context={deviceSlotCtx} />
      </Space>
      </PluginSlot>
      <Table
        size="small"
        rowKey="path"
        pagination={{ pageSize: 6 }}
        loading={loadingFiles}
        dataSource={files}
        columns={[
          { title: '路径', dataIndex: 'path', ellipsis: true },
          {
            title: '大小',
            dataIndex: 'size',
            width: 90,
            render: (v: number) => `${(v / 1024).toFixed(0)} KB`
          },
          {
            title: '操作',
            key: 'actions',
            width: 120,
            render: (_: unknown, row: PrinterFileInfo) => (
              <Space size={0}>
                <Popconfirm
                  title={`确认打印 ${row.path}？`}
                  onConfirm={() => void startPrint(row.path)}
                >
                  <Button
                    type="link"
                    size="small"
                    icon={<PlayCircleOutlined />}
                    loading={fileBusy === row.path}
                  />
                </Popconfirm>
                <Dropdown
                  menu={{
                    items: [
                      {
                        key: 'app',
                        icon: <SaveOutlined />,
                        label: '保存到应用目录',
                        onClick: () => void downloadRemote(row.path, 'app')
                      },
                      {
                        key: 'as',
                        icon: <CloudDownloadOutlined />,
                        label: '另存为…',
                        onClick: () => void downloadRemote(row.path, 'as')
                      }
                    ]
                  }}
                >
                  <Button
                    type="link"
                    size="small"
                    icon={<CloudDownloadOutlined />}
                    loading={fileBusy === row.path}
                  />
                </Dropdown>
              </Space>
            )
          }
        ]}
      />
      <PluginSlot name="device.detail.files.after" context={deviceSlotCtx} />
      <PluginSlot name="device.detail.footer" context={deviceSlotCtx} />
      <PluginSlot name="device.detail.after" context={deviceSlotCtx} />
      </PluginSlot>
    </Drawer>
  )
}
