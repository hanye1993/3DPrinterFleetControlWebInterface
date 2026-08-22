import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Switch, Typography } from 'antd'
import type { CameraSource } from '../../adapters/base'
import { isClientMode, serverGet, serverSend } from '../../api/serverClient'
import { useSettingsStore } from '../../stores/settingsStore'
import {
  noteSnapshotFailure,
  noteSnapshotSuccess,
  scheduleSnapshot
} from './snapshotScheduler'

const OFFLINE_EMIT_COOLDOWN_DEFAULT_MS = 10 * 60 * 1000
const lastOfflineEmitAt = new Map<string, number>()

function remoteOf(c: CameraSource): string {
  return c.remoteSnapshotUrl || c.remoteStreamUrl || c.snapshotUrl || c.streamUrl || ''
}

function offlineCooldownMs(): number {
  const sec = useSettingsStore.getState().settings.alertNotify?.monitorOfflineCooldownSec
  const n = Math.round(Number(sec))
  if (Number.isFinite(n) && n >= 60) return n * 1000
  return OFFLINE_EMIT_COOLDOWN_DEFAULT_MS
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
  footerExtra,
  /** Optional device id for monitorOffline alerts */
  alertDeviceId,
  alertDeviceName,
  onUnavailable
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
  alertDeviceId?: string
  alertDeviceName?: string
  /** Called once when all camera URLs failed to yield a frame (wall can hide the tile). */
  onUnavailable?: () => void
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
  const offlineEmitted = useRef(false)
  const lastErrRef = useRef('')
  const unavailableEmitted = useRef(false)
  const onUnavailableRef = useRef(onUnavailable)
  onUnavailableRef.current = onUnavailable

  const camKey = useMemo(
    () => cameras.map((c) => `${c.id}|${remoteOf(c)}`).join(';'),
    [cameras]
  )
  const schedKey = useMemo(
    () => `snap:${alertDeviceId || title}:${camKey.slice(0, 120)}`,
    [alertDeviceId, title, camKey]
  )

  useEffect(() => {
    idxRef.current = 0
    failRef.current = 0
    aliveRef.current = false
    offlineEmitted.current = false
    unavailableEmitted.current = false
    setPhase((p) => (lastSrcRef.current ? 'live' : 'boot'))
    setErr('')
    if (timer.current) {
      clearInterval(timer.current)
      timer.current = null
    }
    if (!active || !cameras.length) return

    const pullOnce = async () => {
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
        await scheduleSnapshot(schedKey, async () => {
          let ok = false
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
                ok = true
                failRef.current = 0
                aliveRef.current = true
                offlineEmitted.current = false
                noteSnapshotSuccess(schedKey)
                setPhase('live')
                setErr('')
                const next = `data:${data.contentType || 'image/jpeg'};base64,${data.base64}`
                if (next !== lastSrcRef.current) {
                  lastSrcRef.current = next
                  setImgSrc(next)
                }
                return
              }
              if (data.message) {
                lastErrRef.current = data.message
                setErr(data.message)
              }
            } else if (isClientMode()) {
              const data = await serverSend<{
                ok?: boolean
                contentType?: string
                base64?: string
                message?: string
              }>('/api/v1/camera/snapshot', 'POST', { url: remote })
              if (data.base64) {
                ok = true
                failRef.current = 0
                aliveRef.current = true
                offlineEmitted.current = false
                noteSnapshotSuccess(schedKey)
                setPhase('live')
                setErr('')
                const next = `data:${data.contentType || 'image/jpeg'};base64,${data.base64}`
                if (next !== lastSrcRef.current) {
                  lastSrcRef.current = next
                  setImgSrc(next)
                }
                return
              }
              if (data.message) {
                lastErrRef.current = data.message
                setErr(data.message)
              }
            } else {
              lastErrRef.current = '请通过网页服务访问摄像头'
              setErr('请通过网页服务访问摄像头')
            }
          } finally {
            if (!ok) {
              failRef.current += 1
              noteSnapshotFailure(schedKey, failRef.current)
              if (failRef.current % 2 === 0) idxRef.current += 1
              if (!aliveRef.current && failRef.current >= list.length * 3) {
                setPhase('fail')
                if (!unavailableEmitted.current) {
                  unavailableEmitted.current = true
                  onUnavailableRef.current?.()
                }
                const emitKey = alertDeviceId || schedKey
                const now = Date.now()
                const last = lastOfflineEmitAt.get(emitKey) || 0
                if (
                  now - last >= offlineCooldownMs() &&
                  (isClientMode() || window.electronAPI)
                ) {
                  lastOfflineEmitAt.set(emitKey, now)
                  offlineEmitted.current = true
                  void serverSend('/api/v1/alert-notify/emit', 'POST', {
                    kind: 'monitorOffline',
                    title: `监控离线：${alertDeviceName || title}`,
                    content: `摄像头持续取帧失败（${lastErrRef.current || '无法取流'}）`,
                    deviceId: alertDeviceId,
                    deviceName: alertDeviceName || title
                  }).catch(() => undefined)
                }
              }
            }
          }
        })
      } catch {
        /* ignore */
      } finally {
        pullBusy.current = false
      }
    }

    void pullOnce()
    timer.current = setInterval(() => void pullOnce(), intervalMs)
    return () => {
      if (timer.current) {
        clearInterval(timer.current)
        timer.current = null
      }
    }
  }, [camKey, schedKey, intervalMs, active, cameras.length, alertDeviceId, alertDeviceName, title])

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
