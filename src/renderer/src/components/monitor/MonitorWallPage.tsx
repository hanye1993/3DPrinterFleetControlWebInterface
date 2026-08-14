import { useEffect, useMemo, useReducer, useState } from 'react'
import { Alert, Button, Empty, Space, Spin, Typography, message } from 'antd'
import type { CameraSource } from '../../adapters/base'
import type { DeviceConfig } from '../../types/printer'
import type { AiVisionAlert } from '@shared/aiVision'
import { isDeviceAiVisionEnabled } from '@shared/aiVision'
import { useDeviceStore } from '../../stores/deviceStore'
import { useAuthGrants } from '../../stores/authStore'
import { isClientMode, serverGet } from '../../api/serverClient'
import { PluginSlot } from '../../plugins/PluginSlot'
import { getHanyePlugin } from '../../plugins/runtime'
import { SnapshotCam } from './SnapshotCam'
import {
  MonitorTilePluginFooter,
  MonitorTilePluginHeader,
  applyMonitorWallFilters
} from './MonitorPluginHosts'

type WallSlot = {
  device: DeviceConfig
  cameras: CameraSource[]
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function wallFingerprint(slots: WallSlot[]): string {
  return slots
    .map(
      (s) =>
        `${s.device.id}/${s.cameras[0]?.id || ''}:${s.cameras.map((c) => `${c.id}|${c.remoteSnapshotUrl || c.snapshotUrl || c.streamUrl}`).join(',')}`
    )
    .join(';')
}

function wallTileKey(slot: WallSlot): string {
  return `${slot.device.id}::${slot.cameras[0]?.id || 'cam'}`
}

/**
 * Printer chamber-camera wall. Discovers one device at a time;
 * unmount (nav leave) stops all snapshot polls.
 * Client mode: load wall from server API (server talks to printers).
 */
export function MonitorWallPage() {
  const devices = useDeviceStore((s) => s.devices)
  const adapters = useDeviceStore((s) => s.adapters)
  const updateDevice = useDeviceStore((s) => s.updateDevice)
  const { can, canDevice, deviceAcl, permissions } = useAuthGrants()
  const [slots, setSlots] = useState<WallSlot[]>([])
  const [scanning, setScanning] = useState(true)
  const [progress, setProgress] = useState('')
  const [aiAlerts, setAiAlerts] = useState<AiVisionAlert[]>([])
  const [aiBusyId, setAiBusyId] = useState<string | null>(null)
  const [pluginTick, bumpPlugin] = useReducer((n: number) => n + 1, 0)

  useEffect(() => {
    return getHanyePlugin().on('monitor:change', () => bumpPlugin())
  }, [])

  const canToggleAi = can('device.edit')

  const setDeviceAi = async (device: DeviceConfig, enabled: boolean) => {
    setAiBusyId(device.id)
    try {
      await updateDevice({ ...device, aiVisionEnabled: enabled })
      message.success(enabled ? `${device.name}：已开启 AI 巡检` : `${device.name}：已关闭 AI 巡检`)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败')
    } finally {
      setAiBusyId(null)
    }
  }

  useEffect(() => {
    if (!isClientMode()) return
    let cancelled = false
    const pull = async () => {
      try {
        const data = await serverGet<{ alerts?: AiVisionAlert[]; enabled?: boolean }>(
          '/api/v1/ai/vision/status'
        )
        if (!cancelled) setAiAlerts(data.alerts || [])
      } catch {
        /* ignore */
      }
    }
    void pull()
    const t = window.setInterval(() => void pull(), 5000)
    return () => {
      cancelled = true
      window.clearInterval(t)
    }
  }, [])

  const latestByDevice = useMemo(() => {
    const map = new Map<string, AiVisionAlert>()
    for (const a of aiAlerts) {
      if (!map.has(a.deviceId)) map.set(a.deviceId, a)
    }
    return map
  }, [aiAlerts])

  const allowedDevices = useMemo(
    () => devices.filter((d) => canDevice(d.id, 'view')),
    [devices, canDevice, deviceAcl, permissions]
  )

  const deviceKey = useMemo(() => allowedDevices.map((d) => d.id).join('|'), [allowedDevices])
  const aclKey = useMemo(() => JSON.stringify(deviceAcl || {}), [deviceAcl])
  const adapterReadyKey = useMemo(() => {
    if (isClientMode()) return 'client'
    return allowedDevices.map((d) => (adapters[d.id] ? '1' : '0')).join('')
  }, [allowedDevices, adapters])

  useEffect(() => {
    let cancelled = false
    setScanning(true)
    setProgress('')

    const run = async () => {
      if (isClientMode()) {
        setProgress('加载摄像头墙…')
        try {
          const data = await serverGet<{
            devices?: Array<{
              deviceId: string
              name: string
              brand: string
              cameras: Array<{
                id: string
                name: string
                streamUrl: string
                snapshotUrl?: string
              }>
            }>
          }>('/api/v1/monitor/wall')
          if (cancelled) return
          const next: WallSlot[] = []
          for (const row of data.devices || []) {
            if (!row.cameras?.length) continue
            if (!canDevice(row.deviceId, 'view')) continue
            const device =
              allowedDevices.find((d) => d.id === row.deviceId) ||
              devices.find((d) => d.id === row.deviceId) ||
              ({
                id: row.deviceId,
                name: row.name,
                brand: row.brand as DeviceConfig['brand'],
                tech: 'fdm'
              } as DeviceConfig)
            for (const cam of row.cameras) {
              next.push({
                device,
                cameras: [
                  {
                    id: cam.id,
                    name: cam.name,
                    streamUrl: cam.streamUrl,
                    snapshotUrl: cam.snapshotUrl || cam.streamUrl,
                    remoteSnapshotUrl: `server-api:/api/v1/devices/${encodeURIComponent(row.deviceId)}/cameras/${encodeURIComponent(cam.id)}/snapshot?format=json`
                  }
                ]
              })
            }
          }
          setSlots((prev) => (wallFingerprint(prev) === wallFingerprint(next) ? prev : next))
        } catch {
          if (!cancelled) setSlots([])
        }
        if (!cancelled) {
          setScanning(false)
          setProgress('')
        }
        return
      }

      const list = [...allowedDevices]
      const next: WallSlot[] = []
      for (let i = 0; i < list.length; i++) {
        if (cancelled) return
        const device = list[i]
        setProgress(`探测 ${i + 1}/${list.length} · ${device.name}`)
        const adapter = adapters[device.id]
        if (!adapter) continue
        try {
          const cameras = await adapter.getCameras()
          if (cancelled) return
          if (cameras?.length) {
            next.push({ device, cameras: [cameras[0]!] })
            setSlots([...next])
          }
        } catch {
          /* no camera */
        }
        await delay(280)
      }
      if (!cancelled) {
        setSlots(next)
        setScanning(false)
        setProgress('')
      }
    }

    void run()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceKey, adapterReadyKey, aclKey, pluginTick])

  const visibleSlots = useMemo(() => {
    const filteredIds = new Set(
      applyMonitorWallFilters(
        slots.map((s) => ({
          deviceId: s.device.id,
          deviceName: s.device.name,
          brand: String(s.device.brand || '')
        }))
      ).map((s) => s.deviceId)
    )
    return slots.filter((s) => filteredIds.has(s.device.id))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots, pluginTick])

  const toolbarActions = useMemo(
    () => getHanyePlugin().getMonitorToolbarActions('wall'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pluginTick]
  )

  const slotCtx = useMemo(
    () => ({
      scope: 'wall' as const,
      slotCount: visibleSlots.length,
      scanning,
      alertCount: aiAlerts.length
    }),
    [visibleSlots.length, scanning, aiAlerts.length]
  )

  if (!allowedDevices.length) {
    return (
      <PluginSlot name="monitor.empty" replace context={slotCtx}>
        <Empty description="暂无已授权的打印机设备" />
      </PluginSlot>
    )
  }

  return (
    <div className="monitor-page">
      <PluginSlot name="monitor.header.before" context={slotCtx} />
      <div className="monitor-page-head">
        <div>
          <Typography.Title level={5} style={{ margin: 0 }}>
            内部监控 · 打印机摄像头墙
          </Typography.Title>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            已授权设备的机舱摄像头与第三方摄像头；离开本页自动停止拉流。可在每路画面上单独开关设备 AI 巡检（需先在「软件设置 → AI 对接」启用总开关）。
          </Typography.Text>
        </div>
        <PluginSlot name="monitor.toolbar.before" context={slotCtx} />
        <Space wrap size={8}>
          {toolbarActions.map((a) => (
            <Button
              key={a.id}
              size="small"
              onClick={() => {
                void Promise.resolve(
                  a.run({ scope: 'wall', slotCount: visibleSlots.length })
                ).catch((err) =>
                  message.error(err instanceof Error ? err.message : '插件动作失败')
                )
              }}
            >
              {a.label}
            </Button>
          ))}
          {scanning ? (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              <Spin size="small" style={{ marginRight: 8 }} />
              {progress || '探测中…'}
            </Typography.Text>
          ) : (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {visibleSlots.length} 路画面
              {aiAlerts.length ? ` · AI告警 ${aiAlerts.length}` : ''}
            </Typography.Text>
          )}
        </Space>
        <PluginSlot name="monitor.toolbar.after" context={slotCtx} />
      </div>
      <PluginSlot name="monitor.header.after" context={slotCtx} />

      <PluginSlot name="monitor.alerts.before" context={slotCtx} />
      {aiAlerts[0] ? (
        <Alert
          type="warning"
          showIcon
          closable
          style={{ marginBottom: 12 }}
          message={`最近异常：${aiAlerts[0].deviceName} · ${aiAlerts[0].label}（${Math.round(
            aiAlerts[0].confidence * 100
          )}%）`}
          description={
            aiAlerts[0].action === 'none'
              ? '仅告警'
              : `已尝试${aiAlerts[0].action === 'pause' ? '暂停' : '停止'}打印`
          }
        />
      ) : null}
      <PluginSlot name="monitor.alerts.after" context={slotCtx} />

      <PluginSlot name="monitor.grid.before" context={slotCtx} />
      {!visibleSlots.length && !scanning ? (
        <PluginSlot name="monitor.empty" replace context={slotCtx}>
          <Empty description="没有发现可用的打印机摄像头（需已授权且局域网机舱摄像头已开）" />
        </PluginSlot>
      ) : (
        <div className="monitor-wall-grid">
          {visibleSlots.map((slot) => {
            const alert = latestByDevice.get(slot.device.id)
            const live = devices.find((d) => d.id === slot.device.id) || slot.device
            const aiOn = isDeviceAiVisionEnabled(live)
            const camName = slot.cameras[0]?.name || slot.device.brand
            const multiLabel =
              slot.cameras[0]?.id?.startsWith('extra:') ||
              (camName && camName !== '摄像头' && camName !== '机舱摄像头')
            const tileTitle = multiLabel ? `${slot.device.name} · ${camName}` : slot.device.name
            const tileCtx = {
              scope: 'wall' as const,
              deviceId: live.id,
              deviceName: live.name,
              brand: String(live.brand || ''),
              cameraId: slot.cameras[0]?.id,
              cameraName: slot.cameras[0]?.name,
              title: tileTitle,
              subtitle: camName
            }
            return (
              <div key={wallTileKey(slot)}>
                <PluginSlot
                  name="monitor.tile.before"
                  context={{ ...slotCtx, deviceId: live.id }}
                />
                <PluginSlot
                  name="monitor.tile"
                  replace
                  context={{ ...slotCtx, ...tileCtx }}
                >
                  <SnapshotCam
                    title={tileTitle}
                    subtitle={camName}
                    cameras={slot.cameras}
                    alertLabel={
                      aiOn && alert
                        ? `${alert.label} ${Math.round(alert.confidence * 100)}%`
                        : undefined
                    }
                    intervalMs={
                      slot.cameras.some((c) => (c.snapshotUrl || '').startsWith('bambu-cam://'))
                        ? 2500
                        : 1500
                    }
                    aiEnabled={aiOn}
                    aiToggleDisabled={!canToggleAi || aiBusyId === live.id}
                    onAiEnabledChange={
                      canToggleAi ? (v) => void setDeviceAi(live, v) : undefined
                    }
                    headerExtra={<MonitorTilePluginHeader ctx={tileCtx} />}
                    footerExtra={
                      <>
                        <PluginSlot
                          name="monitor.tile.footer"
                          context={{ ...slotCtx, deviceId: live.id }}
                        />
                        <MonitorTilePluginFooter ctx={tileCtx} />
                      </>
                    }
                  />
                </PluginSlot>
                <PluginSlot
                  name="monitor.tile.after"
                  context={{ ...slotCtx, deviceId: live.id }}
                />
              </div>
            )
          })}
        </div>
      )}
      <PluginSlot name="monitor.grid.after" context={slotCtx} />
    </div>
  )
}
