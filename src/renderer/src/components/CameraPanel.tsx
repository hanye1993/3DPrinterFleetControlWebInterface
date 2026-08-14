import { useEffect, useRef, useState } from 'react'
import { Typography } from 'antd'
import type { CameraSource } from '../adapters/base'
import { isClientMode, serverSend } from '../api/serverClient'
import { PluginSlot } from '../plugins/PluginSlot'

/**
 * Try each candidate URL until one yields frames.
 * Camera frame stays visible while detecting / connecting.
 */
export function CameraPanel({
  cameras,
  loading,
  brandHint
}: {
  cameras: CameraSource[]
  loading: boolean
  brandHint?: string
}) {
  const [imgSrc, setImgSrc] = useState('')
  const [phase, setPhase] = useState<'boot' | 'live' | 'fail'>('boot')
  const [title, setTitle] = useState('摄像头')
  const [errHint, setErrHint] = useState('')
  const idxRef = useRef(0)
  const failRef = useRef(0)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const aliveRef = useRef(false)
  const camsRef = useRef(cameras)
  camsRef.current = cameras

  const isBambu = (brandHint || '').toLowerCase() === 'bambu'
  const slotCtx = { title, phase, brandHint }

  useEffect(() => {
    idxRef.current = 0
    failRef.current = 0
    aliveRef.current = false
    setImgSrc('')
    setPhase('boot')
    setTitle('摄像头')
    setErrHint('')
    if (timer.current) {
      clearInterval(timer.current)
      timer.current = null
    }
    if (!cameras.length) return

    const remoteOf = (c: CameraSource) =>
      c.remoteSnapshotUrl || c.remoteStreamUrl || c.snapshotUrl || c.streamUrl

    const pull = async () => {
      const list = camsRef.current
      if (!list.length) return
      if (idxRef.current >= list.length) idxRef.current = 0
      const cam = list[idxRef.current]
      const remote = remoteOf(cam)
      if (!remote) {
        idxRef.current += 1
        return
      }
      setTitle(cam.name || '摄像头')
      try {
        if (remote.startsWith('server-api:')) {
          const path = remote.slice('server-api:'.length)
          const { serverGet } = await import('../api/serverClient')
          const data = await serverGet<{
            ok?: boolean
            contentType?: string
            base64?: string
            message?: string
          }>(path)
          if (data?.ok && data.base64) {
            failRef.current = 0
            aliveRef.current = true
            setPhase('live')
            setErrHint('')
            setImgSrc(`data:${data.contentType || 'image/jpeg'};base64,${data.base64}`)
            return
          }
          if (data?.message) setErrHint(data.message)
        } else if (isClientMode()) {
          const data = await serverSend<{
            ok?: boolean
            contentType?: string
            base64?: string
            message?: string
          }>('/api/v1/camera/snapshot', 'POST', { url: remote })
          if (data?.ok && data.base64) {
            failRef.current = 0
            aliveRef.current = true
            setPhase('live')
            setErrHint('')
            setImgSrc(`data:${data.contentType || 'image/jpeg'};base64,${data.base64}`)
            return
          }
          if (data?.message) setErrHint(data.message)
        } else {
          // 纯网页版：无 Electron 摄像头通道
          setErrHint('请通过网页服务访问摄像头')
        }
      } catch (e) {
        if (e instanceof Error && e.message) setErrHint(e.message)
      }
      failRef.current += 1
      if (failRef.current % 2 === 0) {
        idxRef.current += 1
      }
      if (!aliveRef.current && failRef.current >= list.length * 3) {
        setPhase('fail')
      }
    }

    void pull()
    const intervalMs = cameras.some((c) => (c.snapshotUrl || '').startsWith('bambu-cam://'))
      ? 3000
      : 2500
    const tick = () => {
      if (typeof document !== 'undefined' && document.hidden) return
      void pull()
    }
    timer.current = setInterval(tick, intervalMs)

    return () => {
      if (timer.current) {
        clearInterval(timer.current)
        timer.current = null
      }
    }
  }, [cameras])

  if (loading) {
    return (
      <>
        <PluginSlot name="device.camera.before" context={slotCtx} />
        <PluginSlot name="device.camera" replace context={slotCtx}>
          <div className="camera-panel">
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              摄像头
            </Typography.Text>
            <div className="camera-frame camera-frame-placeholder">
              <Typography.Text type="secondary">正在检测摄像头…</Typography.Text>
            </div>
          </div>
        </PluginSlot>
        <PluginSlot name="device.camera.after" context={slotCtx} />
      </>
    )
  }

  if (!cameras.length) {
    if (!isBambu) return null
    return (
      <>
        <PluginSlot name="device.camera.before" context={slotCtx} />
        <PluginSlot name="device.camera" replace context={slotCtx}>
          <div className="camera-panel">
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              摄像头 · 未配置
            </Typography.Text>
            <div className="camera-frame camera-frame-placeholder">
              <Typography.Text type="secondary">
                拓竹机舱摄像头需要局域网 IP 与访问码（局域网模式添加）。云端设备不支持机舱画面。X1 系列暂不支持。
              </Typography.Text>
            </div>
          </div>
        </PluginSlot>
        <PluginSlot name="device.camera.after" context={slotCtx} />
      </>
    )
  }

  const bambuFail =
    isBambu ||
    cameras.some(
      (c) => c.id.startsWith('bambu') || (c.snapshotUrl || '').startsWith('bambu-cam://')
    )

  return (
    <>
      <PluginSlot name="device.camera.before" context={slotCtx} />
      <PluginSlot name="device.camera" replace context={slotCtx}>
        <div className="camera-panel">
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {title}
            {phase === 'live' ? ' · 实时画面' : phase === 'fail' ? ' · 无法连接' : ' · 连接中…'}
          </Typography.Text>
          <div className={`camera-frame ${!imgSrc ? 'camera-frame-placeholder' : ''}`}>
            {imgSrc ? (
              <>
                <img src={imgSrc} alt={title} className="camera-stream" />
                <PluginSlot name="device.camera.overlay" context={slotCtx} />
              </>
            ) : (
              <Typography.Text type="secondary">
                {phase === 'fail'
                  ? errHint ||
                    (bambuFail
                      ? '拓竹摄像头无法连接：需局域网 IP + 访问码，机舱摄像头已开（P1/A1；X1 暂不支持）'
                      : '摄像头无法连接（请确认已开启摄像头，或在 Fluidd 中查看摄像头地址）')
                  : '正在拉取画面…'}
              </Typography.Text>
            )}
          </div>
        </div>
      </PluginSlot>
      <PluginSlot name="device.camera.after" context={slotCtx} />
    </>
  )
}
