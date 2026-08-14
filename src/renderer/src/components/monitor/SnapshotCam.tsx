import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Switch, Typography } from 'antd'
import type { CameraSource } from '../../adapters/base'
import { isClientMode, serverGet, serverSend } from '../../api/serverClient'

function remoteOf(c: CameraSource): string {
  return c.remoteSnapshotUrl || c.remoteStreamUrl || c.snapshotUrl || c.streamUrl || ''
}

/** Snapshot poll tile; clears timer on unmount (nav leave). */
export function SnapshotCam({
  cameras,
  title,
  subtitle,
  intervalMs = 2500,
  active = true,
  alertLabel,
  aiEnabled,
  onAiEnabledChange,
  aiToggleDisabled,
  headerExtra,
  footerExtra
}: {
  cameras: CameraSource[]
  title: string
  subtitle?: string
  intervalMs?: number
  /** When false, stop polling (parent keeps mount but pauses) */
  active?: boolean
  /** AI vision alert badge text */
  alertLabel?: string
  /** Per-device AI patrol switch (omit to hide) */
  aiEnabled?: boolean
  onAiEnabledChange?: (enabled: boolean) => void
  aiToggleDisabled?: boolean
  /** Actions in header (e.g. remove) — avoids overlapping status text */
  headerExtra?: ReactNode
  /** Plugin / host content under the frame */
  footerExtra?: ReactNode
}) {
  const [imgSrc, setImgSrc] = useState('')
  const [phase, setPhase] = useState<'boot' | 'live' | 'fail'>('boot')
  const [err, setErr] = useState('')
  const idxRef = useRef(0)
  const failRef = useRef(0)
  const aliveRef = useRef(false)
  const camsRef = useRef(cameras)
  camsRef.current = cameras
  const lastSrcRef = useRef('')
  const pullBusy = useRef(false)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const camKey = useMemo(
    () => cameras.map((c) => `${c.id}|${remoteOf(c)}`).join(';'),
    [cameras]
  )

  useEffect(() => {
    idxRef.current = 0
    failRef.current = 0
    aliveRef.current = false
    // Keep last frame while reconnecting — clearing causes visible flash
    setPhase((p) => (lastSrcRef.current ? 'live' : 'boot'))
    setErr('')
    if (timer.current) {
      clearInterval(timer.current)
      timer.current = null
    }
    if (!active || !cameras.length) return

    const pull = async () => {
      if (pullBusy.current) return
      const list = camsRef.current
      if (!list.length) return
      if (idxRef.current >= list.length) idxRef.current = 0
      const cam = list[idxRef.current]
      const remote = remoteOf(cam)
      if (!remote) {
        idxRef.current += 1
        return
      }
      pullBusy.current = true
      try {
        if (remote.startsWith('server-api:')) {
          const path = remote.slice('server-api:'.length)
          const data = await serverGet<{
            ok?: boolean
            contentType?: string
            base64?: string
            message?: string
          }>(path)
          if (data.base64) {
            failRef.current = 0
            aliveRef.current = true
            setPhase('live')
            setErr('')
            const next = `data:${data.contentType || 'image/jpeg'};base64,${data.base64}`
            if (next !== lastSrcRef.current) {
              lastSrcRef.current = next
              setImgSrc(next)
            }
            return
          }
          if (data.message) setErr(data.message)
        } else if (isClientMode()) {
          const data = await serverSend<{
            ok?: boolean
            contentType?: string
            base64?: string
            message?: string
          }>('/api/v1/camera/snapshot', 'POST', { url: remote })
          if (data.base64) {
            failRef.current = 0
            aliveRef.current = true
            setPhase('live')
            setErr('')
            const next = `data:${data.contentType || 'image/jpeg'};base64,${data.base64}`
            if (next !== lastSrcRef.current) {
              lastSrcRef.current = next
              setImgSrc(next)
            }
            return
          }
          if (data.message) setErr(data.message)
        } else {
          setErr('请通过网页服务访问摄像头')
        }
      } catch {
        /* ignore */
      } finally {
        pullBusy.current = false
      }
      failRef.current += 1
      if (failRef.current % 2 === 0) idxRef.current += 1
      if (!aliveRef.current && failRef.current >= list.length * 3) setPhase('fail')
    }

    void pull()
    timer.current = setInterval(() => void pull(), intervalMs)
    return () => {
      if (timer.current) {
        clearInterval(timer.current)
        timer.current = null
      }
    }
  }, [camKey, intervalMs, active, cameras.length])

  return (
    <div className={`monitor-tile${alertLabel ? ' has-ai-alert' : ''}${aiEnabled === false ? ' ai-off' : ''}`}>
      <div className="monitor-tile-head">
        <Typography.Text
          strong
          ellipsis
          style={{
            maxWidth: onAiEnabledChange || headerExtra ? '38%' : '55%',
            minWidth: 0,
            flex: 1
          }}
        >
          {title}
        </Typography.Text>
        <div className="monitor-tile-head-right">
          {onAiEnabledChange ? (
            <label className="monitor-ai-toggle" title="本机 AI 巡检">
              <span>AI</span>
              <Switch
                size="small"
                checked={aiEnabled !== false}
                disabled={aiToggleDisabled}
                onChange={(v) => onAiEnabledChange(v)}
              />
            </label>
          ) : null}
          <Typography.Text type="secondary" style={{ fontSize: 11 }} ellipsis>
            {phase === 'live' ? '直播' : phase === 'fail' ? '离线' : '连接中'}
            {subtitle ? ` · ${subtitle}` : ''}
          </Typography.Text>
          {headerExtra ? <div className="monitor-tile-head-extra">{headerExtra}</div> : null}
        </div>
      </div>
      {alertLabel ? <div className="monitor-ai-badge">{alertLabel}</div> : null}
      <div className={`monitor-tile-frame${!imgSrc ? ' empty' : ''}`}>
        {imgSrc ? (
          <img src={imgSrc} alt={title} draggable={false} decoding="async" />
        ) : (
          <Typography.Text type="secondary" style={{ fontSize: 12, padding: 8, textAlign: 'center' }}>
            {phase === 'fail' ? err || '无法取流' : '加载画面…'}
          </Typography.Text>
        )}
      </div>
      {footerExtra || null}
    </div>
  )
}
