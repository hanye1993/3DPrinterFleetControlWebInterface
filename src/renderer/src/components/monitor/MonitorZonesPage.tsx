import { useEffect, useMemo, useReducer, useState } from 'react'
import {
  Button,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Spin,
  Tabs,
  Typography,
  message
} from 'antd'
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons'
import type { CameraSource } from '../../adapters/base'
import { isClientMode } from '../../api/serverClient'
import { useMonitorStore } from '../../stores/monitorStore'
import type { ZoneCamera } from '../../types/monitor'
import { PluginSlot } from '../../plugins/PluginSlot'
import { getHanyePlugin } from '../../plugins/runtime'
import { newId } from '../../utils/id'
import { SnapshotCam } from './SnapshotCam'
import {
  MonitorCameraPluginFields,
  MonitorCameraSourceForm,
  MonitorTilePluginFooter,
  MonitorTilePluginHeader,
  applyMonitorCameraFieldCollect,
  listPluginZoneTiles,
  resolveZoneCameraSources
} from './MonitorPluginHosts'

function toSources(cam: ZoneCamera, zoneId: string, zoneName?: string): CameraSource[] {
  const fromPlugin = resolveZoneCameraSources(cam, zoneId, zoneName)
  if (fromPlugin.length) return fromPlugin

  const sourceType = String(cam.sourceType || 'http')
  const isPlugin =
    sourceType !== 'http' &&
    sourceType !== 'stream' &&
    !String(cam.url || '').startsWith('http')
  if (isClientMode() || isPlugin || String(cam.url || '').startsWith('plugin://')) {
    return [
      {
        id: cam.id,
        name: cam.name,
        streamUrl: '',
        remoteSnapshotUrl: `server-api:/api/v1/monitor/zones/${encodeURIComponent(zoneId)}/cameras/${encodeURIComponent(cam.id)}/snapshot?format=json`
      }
    ]
  }
  const snap = cam.snapshotUrl || cam.url
  return [
    {
      id: cam.id,
      name: cam.name,
      streamUrl: cam.url,
      snapshotUrl: snap,
      remoteStreamUrl: cam.url,
      remoteSnapshotUrl: snap
    }
  ]
}

export function MonitorZonesPage() {
  const loading = useMonitorStore((s) => s.loading)
  const zones = useMonitorStore((s) => s.zones)
  const activeZoneId = useMonitorStore((s) => s.activeZoneId)
  const init = useMonitorStore((s) => s.init)
  const setActiveZoneId = useMonitorStore((s) => s.setActiveZoneId)
  const addZone = useMonitorStore((s) => s.addZone)
  const renameZone = useMonitorStore((s) => s.renameZone)
  const removeZone = useMonitorStore((s) => s.removeZone)
  const addCamera = useMonitorStore((s) => s.addCamera)
  const removeCamera = useMonitorStore((s) => s.removeCamera)

  const [zoneModal, setZoneModal] = useState<'add' | 'rename' | null>(null)
  const [camModal, setCamModal] = useState(false)
  const [zoneName, setZoneName] = useState('')
  const [camSourceType, setCamSourceType] = useState('http')
  const [camForm] = Form.useForm<{
    name: string
    url: string
    snapshotUrl?: string
    sourceType?: string
    [key: string]: unknown
  }>()
  const [pluginTick, bumpPlugin] = useReducer((n: number) => n + 1, 0)

  useEffect(() => {
    return getHanyePlugin().on('monitor:change', () => bumpPlugin())
  }, [])

  useEffect(() => {
    void init()
  }, [init])

  const active = useMemo(
    () => zones.find((z) => z.id === activeZoneId) || zones[0] || null,
    [zones, activeZoneId]
  )

  const toolbarActions = useMemo(
    () => getHanyePlugin().getMonitorToolbarActions('zones'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pluginTick]
  )

  const cameraSources = useMemo(
    () => getHanyePlugin().getMonitorCameraSources(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pluginTick]
  )

  const activeSourceDef = useMemo(
    () =>
      camSourceType !== 'http'
        ? getHanyePlugin().getMonitorCameraSource(camSourceType)
        : undefined,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [camSourceType, pluginTick]
  )

  const hideUrlFields = !!(
    activeSourceDef && activeSourceDef.hideUrlFields !== false
  )

  const pluginTiles = useMemo(
    () =>
      active
        ? listPluginZoneTiles(active.id, active.name)
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [active?.id, active?.name, pluginTick]
  )

  const slotCtx = useMemo(
    () => ({
      scope: 'zones' as const,
      zoneId: active?.id || null,
      zoneCount: zones.length,
      cameraCount: (active?.cameras.length || 0) + pluginTiles.length
    }),
    [active?.id, active?.cameras.length, zones.length, pluginTiles.length]
  )

  const formCtxHelpers = useMemo(
    () => ({
      getFieldValue: (name: string) => camForm.getFieldValue(name),
      getFieldsValue: () => camForm.getFieldsValue(true) as Record<string, unknown>,
      setFieldsValue: (values: Record<string, unknown>) =>
        camForm.setFieldsValue(values as never),
      validateFields: (names?: string[]) =>
        camForm.validateFields(names) as Promise<Record<string, unknown>>,
      newId
    }),
    [camForm]
  )

  if (loading) {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <Spin tip="加载区域监控…" />
      </div>
    )
  }

  return (
    <div className="monitor-page">
      <PluginSlot name="monitor.zones.header.before" context={slotCtx} />
      <div className="monitor-page-head">
        <div>
          <Typography.Title level={5} style={{ margin: 0 }}>
            区域监控 · 第三方摄像头
          </Typography.Title>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            按区域管理外接画面：HTTP 快照/MJPEG，或通过插件对接厂家/云平台；离开本页自动停止拉流。
          </Typography.Text>
        </div>
        <Space wrap>
          {toolbarActions.map((a) => (
            <Button
              key={a.id}
              size="small"
              onClick={() => {
                void Promise.resolve(
                  a.run({
                    scope: 'zones',
                    slotCount: active?.cameras.length || 0,
                    zoneId: active?.id || null
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
            icon={<PlusOutlined />}
            onClick={() => {
              setZoneName('')
              setZoneModal('add')
            }}
          >
            新建区域
          </Button>
          {active ? (
            <>
              <Button
                icon={<EditOutlined />}
                onClick={() => {
                  setZoneName(active.name)
                  setZoneModal('rename')
                }}
              >
                重命名
              </Button>
              <Popconfirm
                title={`删除区域「${active.name}」？`}
                onConfirm={() => void removeZone(active.id)}
              >
                <Button danger icon={<DeleteOutlined />}>
                  删除区域
                </Button>
              </Popconfirm>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => {
                  camForm.resetFields()
                  setCamModal(true)
                }}
              >
                添加摄像头
              </Button>
            </>
          ) : null}
        </Space>
      </div>
      <PluginSlot name="monitor.zones.header.after" context={slotCtx} />
      <PluginSlot name="monitor.zones.toolbar.after" context={slotCtx} />

      {!zones.length ? (
        <PluginSlot name="monitor.zones.empty" replace context={slotCtx}>
          <Empty
            description="还没有区域。例如先建「A区」，再添加该区摄像头地址。"
            style={{ marginTop: 48 }}
          >
            <Button
              type="primary"
              onClick={() => {
                setZoneName('A区')
                setZoneModal('add')
              }}
            >
              创建 A区
            </Button>
          </Empty>
        </PluginSlot>
      ) : (
        <>
          <Tabs
            activeKey={active?.id}
            onChange={(k) => setActiveZoneId(k)}
            items={zones.map((z) => ({
              key: z.id,
              label: `${z.name}（${z.cameras.length}）`
            }))}
          />
          <PluginSlot name="monitor.zones.grid.before" context={slotCtx} />
          {active && !active.cameras.length && !pluginTiles.length ? (
            <PluginSlot name="monitor.zones.empty" replace context={slotCtx}>
              <Empty description={`「${active.name}」暂无摄像头，点击右上角添加`} />
            </PluginSlot>
          ) : active ? (
            <div className="monitor-wall-grid">
              {active.cameras.map((cam) => {
                const tileCtx = {
                  scope: 'zones' as const,
                  zoneId: active.id,
                  zoneName: active.name,
                  cameraId: cam.id,
                  cameraName: cam.name,
                  title: cam.name,
                  subtitle: active.name
                }
                return (
                  <div key={cam.id}>
                    <PluginSlot
                      name="monitor.tile.before"
                      context={{ ...slotCtx, cameraId: cam.id }}
                    />
                    <SnapshotCam
                      title={cam.name}
                      subtitle={`${active.name}${cam.sourceType && cam.sourceType !== 'http' ? ` · ${cam.sourceType}` : ''}`}
                      cameras={toSources(cam, active.id, active.name)}
                      intervalMs={1200}
                      headerExtra={
                        <MonitorTilePluginHeader
                          ctx={tileCtx}
                          extra={
                            <Popconfirm
                              title="移除此摄像头？"
                              onConfirm={() => void removeCamera(active.id, cam.id)}
                            >
                              <Button
                                size="small"
                                danger
                                type="link"
                                className="monitor-tile-remove-btn"
                              >
                                移除
                              </Button>
                            </Popconfirm>
                          }
                        />
                      }
                      footerExtra={
                        <>
                          <PluginSlot
                            name="monitor.tile.footer"
                            context={{ ...slotCtx, cameraId: cam.id }}
                          />
                          <MonitorTilePluginFooter ctx={tileCtx} />
                        </>
                      }
                    />
                    <PluginSlot
                      name="monitor.tile.after"
                      context={{ ...slotCtx, cameraId: cam.id }}
                    />
                  </div>
                )
              })}
              {pluginTiles.map((tile) => {
                const tileCtx = {
                  scope: 'zones' as const,
                  zoneId: active.id,
                  zoneName: active.name,
                  cameraId: tile.id,
                  cameraName: tile.title,
                  title: tile.title,
                  subtitle: tile.subtitle || active.name
                }
                return (
                  <div key={tile.id}>
                    <SnapshotCam
                      title={tile.title}
                      subtitle={tile.subtitle || active.name}
                      cameras={tile.cameras}
                      intervalMs={1200}
                      headerExtra={<MonitorTilePluginHeader ctx={tileCtx} />}
                      footerExtra={<MonitorTilePluginFooter ctx={tileCtx} />}
                    />
                  </div>
                )
              })}
            </div>
          ) : null}
          <PluginSlot name="monitor.zones.grid.after" context={slotCtx} />
        </>
      )}

      <Modal
        title={zoneModal === 'rename' ? '重命名区域' : '新建区域'}
        open={!!zoneModal}
        onCancel={() => setZoneModal(null)}
        onOk={() => {
          const n = zoneName.trim()
          if (!n) {
            message.warning('请填写区域名称')
            return
          }
          if (zoneModal === 'rename' && active) {
            void renameZone(active.id, n).then(() => setZoneModal(null))
          } else {
            void addZone(n).then(() => setZoneModal(null))
          }
        }}
        destroyOnHidden
      >
        <PluginSlot name="monitor.zones.form.before" context={slotCtx} />
        <Input
          placeholder="例如 A区、一楼车间"
          value={zoneName}
          onChange={(e) => setZoneName(e.target.value)}
          onPressEnter={() => {
            /* ok via modal */
          }}
        />
        <PluginSlot name="monitor.zones.form.after" context={slotCtx} />
      </Modal>

      <Modal
        title={`添加摄像头${active ? ` · ${active.name}` : ''}`}
        open={camModal}
        onCancel={() => setCamModal(false)}
        onOk={() => {
          void (async () => {
            if (!active) return
            try {
              await camForm.validateFields(hideUrlFields ? ['name'] : ['name', 'url'])
            } catch {
              return
            }
            const sourceDef =
              camSourceType !== 'http'
                ? getHanyePlugin().getMonitorCameraSource(camSourceType)
                : undefined
            const formCtx = {
              zoneId: active.id,
              zoneName: active.name,
              mode: 'create' as const,
              camera: null,
              ...formCtxHelpers
            }
            let payload: Record<string, unknown>
            try {
              if (sourceDef?.submit) {
                const result = await sourceDef.submit(formCtx)
                payload = { ...(result?.camera || {}) }
              } else {
                const v = camForm.getFieldsValue(true) as Record<string, unknown>
                payload = {
                  name: v.name,
                  url: v.url,
                  snapshotUrl:
                    typeof v.snapshotUrl === 'string'
                      ? v.snapshotUrl.trim() || undefined
                      : undefined,
                  sourceType: 'http'
                }
              }
            } catch (e) {
              message.error(e instanceof Error ? e.message : '表单校验失败')
              return
            }
            if (!payload.sourceType && camSourceType !== 'http') {
              payload.sourceType = camSourceType
            }
            payload = applyMonitorCameraFieldCollect(
              active.id,
              active.name,
              (name) => camForm.getFieldValue(name),
              payload
            )
            const cam = await addCamera(active.id, {
              name: String(payload.name || '').trim() || '摄像头',
              url: String(payload.url || ''),
              snapshotUrl:
                payload.snapshotUrl != null ? String(payload.snapshotUrl) : undefined,
              sourceType:
                payload.sourceType != null ? String(payload.sourceType) : camSourceType,
              pluginData:
                payload.pluginData && typeof payload.pluginData === 'object'
                  ? (payload.pluginData as Record<string, unknown>)
                  : undefined,
              ...Object.fromEntries(
                Object.entries(payload).filter(
                  ([k]) =>
                    k.startsWith('x_') ||
                    k.startsWith('plugin_') ||
                    k === 'demoNote'
                )
              )
            } as Omit<ZoneCamera, 'id'>)
            if (!cam) {
              message.error('请填写有效的画面地址，或选择插件对接并完成配置')
              return
            }
            message.success('已添加')
            setCamModal(false)
          })()
        }}
        destroyOnHidden
        afterOpenChange={(open) => {
          if (open) {
            setCamSourceType('http')
            camForm.resetFields()
            camForm.setFieldsValue({ sourceType: 'http' })
          }
        }}
      >
        <PluginSlot
          name="monitor.zones.form.before"
          context={{
            ...slotCtx,
            zoneId: active?.id,
            zoneName: active?.name,
            sourceType: camSourceType
          }}
        />
        <Form form={camForm} layout="vertical" initialValues={{ sourceType: 'http' }}>
          <Form.Item label="对接方式" required>
            <Select
              value={camSourceType}
              options={[
                { value: 'http', label: 'HTTP 流 / 快照 URL' },
                ...cameraSources.map((s) => ({
                  value: s.id,
                  label: s.label
                }))
              ]}
              onChange={(v) => {
                setCamSourceType(v)
                camForm.setFieldsValue({ sourceType: v })
              }}
            />
          </Form.Item>
          <Form.Item
            name="name"
            label="名称"
            rules={[{ required: true, message: '请输入名称' }]}
          >
            <Input placeholder="门口摄像头" />
          </Form.Item>
          {!hideUrlFields ? (
            <>
              <Form.Item
                name="url"
                label="画面 URL"
                rules={[{ required: true, message: '请输入 URL' }]}
                extra="支持 HTTP 快照或 MJPEG，例如 http://192.168.1.50:8080/?action=snapshot"
              >
                <Input placeholder="http://..." />
              </Form.Item>
              <Form.Item
                name="snapshotUrl"
                label="快照 URL（可选）"
                extra="不填则使用上面的地址"
              >
                <Input placeholder="http://..." />
              </Form.Item>
            </>
          ) : (
            <Typography.Paragraph type="secondary" style={{ marginTop: -8 }}>
              当前为插件对接：由插件表单填写厂家账号、通道等，画面经服务端
              <code> monitor_camera_snapshot </code>
              拉取，无需填写裸 URL。
            </Typography.Paragraph>
          )}
          {active && activeSourceDef ? (
            <MonitorCameraSourceForm
              sourceId={activeSourceDef.id}
              zoneId={active.id}
              zoneName={active.name}
              mode="create"
              camera={null}
              getFieldValue={formCtxHelpers.getFieldValue}
              getFieldsValue={formCtxHelpers.getFieldsValue}
              setFieldsValue={formCtxHelpers.setFieldsValue}
              validateFields={formCtxHelpers.validateFields}
              newId={formCtxHelpers.newId}
            />
          ) : null}
          {active ? (
            <>
              <PluginSlot
                name="monitor.zones.form.camera.fields"
                context={{
                  zoneId: active.id,
                  zoneName: active.name,
                  sourceType: camSourceType
                }}
              />
              <MonitorCameraPluginFields
                zoneId={active.id}
                zoneName={active.name}
                getFieldValue={(name) => camForm.getFieldValue(name)}
                setFieldsValue={(values) => camForm.setFieldsValue(values as never)}
              />
              <PluginSlot
                name="monitor.zones.form.camera.footer"
                context={{
                  zoneId: active.id,
                  zoneName: active.name,
                  sourceType: camSourceType
                }}
              />
            </>
          ) : null}
        </Form>
        <PluginSlot
          name="monitor.zones.form.after"
          context={{
            ...slotCtx,
            zoneId: active?.id,
            zoneName: active?.name,
            sourceType: camSourceType
          }}
        />
      </Modal>
    </div>
  )
}
