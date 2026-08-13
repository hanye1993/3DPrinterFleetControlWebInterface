import { Fragment, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  List,
  Modal,
  Progress,
  Space,
  Typography,
  Upload,
  message
} from 'antd'
import { InboxOutlined, PlayCircleOutlined } from '@ant-design/icons'
import {
  canBatchPrint,
  deviceTech,
  useDeviceStore,
  type BatchPrintResult
} from '../stores/deviceStore'
import type { PrinterTech } from '../types/printer'
import { assertSameBrandAndModel, deviceModelLabel } from '../utils/batchPrintGroup'
import { PluginSlot } from '../plugins/PluginSlot'

const FDM_ACCEPT = '.gcode,.gco,.g,.bgcode,.nc'
const RESIN_ACCEPT = '.ctb,.goo,.pwmo,.pws,.photon,.phz,.zip,.slc'

export function BatchPrintModal({
  open,
  tech,
  onClose
}: {
  open: boolean
  tech: PrinterTech
  onClose: () => void
}) {
  const devices = useDeviceStore((s) => s.devices)
  const checkedIds = useDeviceStore((s) => s.checkedIds)
  const clearChecked = useDeviceStore((s) => s.clearChecked)
  const batchUploadAndPrint = useDeviceStore((s) => s.batchUploadAndPrint)
  const isResin = tech === 'resin'
  const slotCtx = { tech }

  const [files, setFiles] = useState<File[]>([])
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [results, setResults] = useState<BatchPrintResult[]>([])

  const selected = useMemo(
    () =>
      checkedIds
        .map((id) => devices.find((d) => d.id === id))
        .filter((d): d is NonNullable<typeof d> => !!d && deviceTech(d) === tech),
    [checkedIds, devices, tech]
  )

  const supported = selected.filter(canBatchPrint)
  const unsupported = selected.filter((d) => !canBatchPrint(d))
  const groupCheck = useMemo(() => assertSameBrandAndModel(supported), [supported])

  const reset = () => {
    setFiles([])
    setRunning(false)
    setProgress({ done: 0, total: 0 })
    setResults([])
  }

  const handleClose = () => {
    if (running) return
    reset()
    onClose()
  }

  const start = async () => {
    if (isResin) {
      message.info('光固化批量上传切片功能开发中，请先使用批量暂停/继续/停止，或在单机详情中操作')
      return
    }
    if (!supported.length) {
      message.warning('没有可批量打印的设备（需 Klipper / 创想局域网 / 启迪）')
      return
    }
    if (!groupCheck.ok) {
      message.warning(groupCheck.message)
      return
    }
    if (!files.length) {
      message.warning('请先选择 G-code 文件')
      return
    }
    if (files.length > 1 && files.length !== supported.length) {
      message.warning(
        `多文件模式需与打印机数量一致：当前 ${files.length} 个文件、${supported.length} 台可打印设备`
      )
      return
    }

    setRunning(true)
    setResults([])
    setProgress({ done: 0, total: supported.length })
    try {
      const list = await batchUploadAndPrint(
        supported.map((d) => d.id),
        files,
        (done, total, result) => {
          setProgress({ done, total })
          setResults((prev) => [...prev, result])
        }
      )
      const ok = list.filter((r) => r.ok).length
      const fail = list.length - ok
      if (fail === 0) {
        message.success(`已在 ${ok} 台打印机启动打印`)
        clearChecked()
      } else {
        message.warning(`完成：成功 ${ok} · 失败 ${fail}`)
      }
    } finally {
      setRunning(false)
    }
  }

  return (
    <Modal
      title={isResin ? '批量导入光固化切片' : '批量导入 G-code 并打印'}
      open={open}
      onCancel={handleClose}
      width={640}
      destroyOnHidden
      footer={[
        <Button key="cancel" onClick={handleClose} disabled={running}>
          关闭
        </Button>,
        <Fragment key="footer-actions">
          <PluginSlot name="device.batch.modal.footer.actions" context={slotCtx} />
        </Fragment>,
        <Button
          key="start"
          type="primary"
          icon={<PlayCircleOutlined />}
          loading={running}
          onClick={() => void start()}
          disabled={isResin || !supported.length || !files.length || !groupCheck.ok}
        >
          {isResin ? '上传（开发中）' : '上传并开打'}
        </Button>
      ]}
    >
      <PluginSlot name="device.batch.modal.before" context={slotCtx} />
      <PluginSlot name="device.batch.modal" replace context={slotCtx}>
        <Alert
          type={isResin ? 'info' : 'success'}
          showIcon
          style={{ marginBottom: 12 }}
          message={isResin ? '当前为光固化工作区' : '当前为 FDM 工作区'}
          description={
            isResin
              ? '与 FDM 隔离：仅操作光固化设备。切片上传对接开发中；批量暂停/继续/停止已可用。'
              : '与光固化隔离：仅操作 FDM 设备。批量导入打印要求所选设备品牌与机型完全一致。'
          }
        />
        <PluginSlot name="device.batch.modal.alert.after" context={slotCtx} />

        <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
          {isResin
            ? '请勾选光固化打印机。切片格式与 FDM 的 G-code 不同，不会混用。'
            : '勾选打印机后导入 G-code：单个文件发到全部所选设备；多个文件需与可打印设备一一对应。暂停/继续/停止可跨品牌，导入打印不可混品牌或混机型。'}
        </Typography.Paragraph>

        <Typography.Text strong>已选设备（{selected.length}）</Typography.Text>
        <PluginSlot name="device.batch.modal.devices.before" context={slotCtx} />
        <List
          size="small"
          style={{ marginTop: 8, marginBottom: 16, maxHeight: 160, overflow: 'auto' }}
          dataSource={selected}
          locale={{ emptyText: '请先在卡片上勾选打印机' }}
          renderItem={(d) => (
            <List.Item>
              <Space wrap>
                <span>{d.name}</span>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {d.brand} · {deviceModelLabel(d)}
                </Typography.Text>
                {!canBatchPrint(d) ? (
                  <Typography.Text type="warning" style={{ fontSize: 12 }}>
                    {isResin ? '切片上传开发中' : '不支持批量上传'}
                  </Typography.Text>
                ) : null}
              </Space>
            </List.Item>
          )}
        />
        <PluginSlot name="device.batch.modal.devices.after" context={slotCtx} />

        {!isResin && supported.length > 0 && groupCheck.ok ? (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            message={`同品牌同机型：${groupCheck.brand} · ${groupCheck.modelLabel}（${supported.length} 台）`}
          />
        ) : null}

        {!isResin && supported.length > 0 && !groupCheck.ok ? (
          <Alert type="error" showIcon style={{ marginBottom: 12 }} message={groupCheck.message} />
        ) : null}

        {!isResin && unsupported.length ? (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 12 }}
            message={`${unsupported.length} 台设备不支持批量上传（Bambu / 云端 / 非 Moonraker），将被跳过`}
          />
        ) : null}

        <PluginSlot name="device.batch.modal.upload.before" context={slotCtx} />
        <Upload.Dragger
          multiple
          accept={isResin ? RESIN_ACCEPT : FDM_ACCEPT}
          disabled={running || isResin}
          fileList={files.map((f, i) => ({
            uid: `${f.name}-${i}`,
            name: f.name,
            status: 'done' as const
          }))}
          beforeUpload={(file) => {
            setFiles((prev) => [...prev, file])
            return false
          }}
          onRemove={(item) => {
            setFiles((prev) => prev.filter((f) => f.name !== item.name))
          }}
        >
          <p className="ant-upload-drag-icon">
            <InboxOutlined />
          </p>
          <p className="ant-upload-text">
            {isResin ? '光固化切片上传开发中' : '点击或拖拽 G-code 到此处'}
          </p>
          <p className="ant-upload-hint">
            {isResin ? '预留格式：.ctb / .goo / .pwmo / .pws' : '支持 .gcode / .gco / .bgcode'}
          </p>
        </Upload.Dragger>
        <PluginSlot name="device.batch.modal.upload.after" context={slotCtx} />

        {progress.total > 0 ? (
          <div style={{ marginTop: 16 }}>
            <Progress
              percent={Math.round((progress.done / progress.total) * 100)}
              status={running ? 'active' : undefined}
            />
            <List
              size="small"
              style={{ marginTop: 8, maxHeight: 140, overflow: 'auto' }}
              dataSource={results}
              renderItem={(r) => (
                <List.Item>
                  <Typography.Text type={r.ok ? 'success' : 'danger'}>
                    {r.deviceName}：{r.ok ? `已开打 ${r.message || ''}` : r.message || '失败'}
                  </Typography.Text>
                </List.Item>
              )}
            />
          </div>
        ) : null}
        <PluginSlot name="device.batch.modal.progress.after" context={slotCtx} />
      </PluginSlot>
      <PluginSlot name="device.batch.modal.after" context={slotCtx} />
    </Modal>
  )
}
