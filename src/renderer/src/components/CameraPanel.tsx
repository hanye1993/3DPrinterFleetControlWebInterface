import { useEffect, useRef, useState, type TouchEvent } from 'react'
import { Typography } from 'antd'
import type { CameraSource } from '../adapters/base'
import { isClientMode, serverSend } from '../api/serverClient'
import { PluginSlot } from '../plugins/PluginSlot'

/**
 * Try each candidate URL until one yields frames.
 * Multi-cam: swipe / arrows switch; fail-over only within current selection retries.
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
  const [camIdx, setCamIdx] = useState(0)
  const failRef = useRef(0)
  const aliveRef = useRef(false)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const camsRef = useRef(cameras)
  camsRef.current = cameras
  const camIdxRef = useRef(camIdx)
  camIdxRef.current = camIdx
  const touchX = useRef<number | null>(null)

  const isBambu = (brandHint || '').toLowerCase() === 'bambu'
  const multi = cameras.length > 1
  const slotCtx = { title, phase, brandHint, camIdx, cameraCount: cameras.length }

  useEffect(() => {
    setCamIdx((i) => (cameras.length ? Math.min(i, cameras.length - 1) : 0))
  }, [cameras])

  useEffect(() => {
    failRef.current = 0
    aliveRef.current = false
    setImgSrc('')
    setPhase('boot')
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
      const idx = Math.max(0, Math.min(camIdxRef.current, list.length - 1))
      const cam = list[idx]
      if (!cam) return
      const remote = remoteOf(cam)
      if (!remote) {
        setPhase('fail')
        setErrHint('摄像头地址为空')
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
          setErrHint('请通过网页服务访问摄像头')
        }
      } catch (e) {
        if (e instanceof Error && e.message) setErrHint(e.message)
      }
      failRef.current += 1
      if (!aliveRef.current && failRef.current >= 3) {
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
  }, [cameras, camIdx])

  const go = (delta: number) => {
    if (cameras.length <= 1) return
    setCamIdx((i) => {
      const n = cameras.length
      return ((i + delta) % n + n) % n
    })
  }

  const onTouchStart = (e: TouchEvent) => {
    touchX.current = e.changedTouches[0]?.clientX ?? null
  }
  const onTouchEnd = (e: TouchEvent) => {
    const start = touchX.current
    touchX.current = null
    if (start == null || cameras.length <= 1) return
    const end = e.changedTouches[0]?.clientX
    if (end == null) return
    const dx = end - start
    if (Math.abs(dx) < 48) return
    go(dx < 0 ? 1 : -1)
  }

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
            {multi ? ` · ${camIdx + 1}/${cameras.length}` : ''}
            {phase === 'live' ? ' · 实时画面' : phase === 'fail' ? ' · 无法连接' : ' · 连接中…'}
          </Typography.Text>
          <div
            className={`camera-frame ${!imgSrc ? 'camera-frame-placeholder' : ''}`}
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
          >
            {imgSrc ? (
              <>
                <img src={imgSrc} alt={title} className="camera-stream" draggable={false} />
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
            {multi ? (
              <>
                <button
                  type="button"
                  className="camera-nav camera-nav-prev"
                  aria-label="上一路摄像头"
                  onClick={() => go(-1)}
                >
                  ‹
                </button>
                <button
                  type="button"
                  className="camera-nav camera-nav-next"
                  aria-label="下一路摄像头"
                  onClick={() => go(1)}
                >
                  ›
                </button>
                <div className="camera-dots" aria-hidden>
                  {cameras.map((c, i) => (
                    <button
                      key={c.id}
                      type="button"
                      className={`camera-dot${i === camIdx ? ' is-on' : ''}`}
                      title={c.name}
                      onClick={() => setCamIdx(i)}
                    />
                  ))}
                </div>
              </>
            ) : null}
          </div>
        </div>
      </PluginSlot>
      <PluginSlot name="device.camera.after" context={slotCtx} />
    </>
  )
}
