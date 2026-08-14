import { randomUUID } from 'crypto'
import type { AiFaultKind, AiVisionAlert, AiVisionSettings } from '../../shared/aiVision'
import {
  AI_FAULT_LABELS,
  isDeviceAiVisionEnabled,
  normalizeAiVisionSettings
} from '../../shared/aiVision'
import { camerasForAiPatrol, type CameraCandidate } from '../../shared/deviceExtraCameras'
import { runYoloSpaghetti, yoloWeightsExists } from './yoloDetect'
import { runCloudVision } from './cloudVision'

export type VisionMonitorDeps = {
  getSettings: () => { aiVision?: unknown }
  getDevices?: () => Array<{ id: string; name?: string; aiVisionEnabled?: boolean }>
  listWallCameras: () => Promise<
    Array<{
      deviceId: string
      name: string
      cameras: CameraCandidate[]
    }>
  >
  takeCameraSnapshot: (
    url: string
  ) => Promise<{ ok: true; contentType?: string; base64: string } | { ok: false; message?: string }>
  controlDevice: (
    deviceId: string,
    payload: { action: string }
  ) => Promise<{ ok: boolean; message?: string }>
  /** Fired when an AI anomaly alert is raised */
  onAlert?: (alert: AiVisionAlert) => void
}

type RuntimeStatus = {
  running: boolean
  lastTickAt: string | null
  lastError: string | null
  yoloReady: boolean
  yoloMessage: string | null
  alerts: AiVisionAlert[]
}

const MAX_ALERTS = 40

export class VisionMonitor {
  private timer: ReturnType<typeof setInterval> | null = null
  private busy = false
  private readonly deps: VisionMonitorDeps
  private cooldown = new Map<string, number>()
  private status: RuntimeStatus = {
    running: false,
    lastTickAt: null,
    lastError: null,
    yoloReady: false,
    yoloMessage: null,
    alerts: []
  }

  constructor(deps: VisionMonitorDeps) {
    this.deps = deps
  }

  getStatus(): RuntimeStatus {
    return {
      ...this.status,
      alerts: this.status.alerts.slice()
    }
  }

  start(): void {
    this.stop()
    this.status.running = true
    const tick = () => {
      void this.runTick()
    }
    tick()
    this.timer = setInterval(tick, 3000)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.status.running = false
  }

  /** Force one device check (for settings test). */
  async checkDeviceNow(deviceId: string): Promise<{
    ok: boolean
    message?: string
    alerts?: AiVisionAlert[]
  }> {
    const cfg = this.readCfg()
    if (!cfg.enabled && !cfg.yoloEnabled && !cfg.cloudEnabled) {
      return { ok: false, message: '请先启用 AI 监控或 YOLO / 云端检测' }
    }
    try {
      const alerts = await this.inspectDevice(deviceId, cfg, true)
      return { ok: true, alerts }
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) }
    }
  }

  private readCfg(): AiVisionSettings {
    return normalizeAiVisionSettings(this.deps.getSettings().aiVision)
  }

  private async runTick(): Promise<void> {
    if (this.busy) return
    const cfg = this.readCfg()
    if (!cfg.enabled) return
    if (!cfg.yoloEnabled && !cfg.cloudEnabled) return

    const last = this.status.lastTickAt ? Date.parse(this.status.lastTickAt) : 0
    const gap = Math.max(5, cfg.intervalSec) * 1000
    if (Date.now() - last < gap) return

    this.busy = true
    this.status.lastTickAt = new Date().toISOString()
    try {
      this.status.yoloReady = cfg.yoloEnabled ? yoloWeightsExists(cfg.yoloWeights) : false
      this.status.yoloMessage = cfg.yoloEnabled
        ? this.status.yoloReady
          ? null
          : `找不到权重 ${cfg.yoloWeights}`
        : null

      const wall = await this.deps.listWallCameras()
      const deviceMap = new Map(
        (this.deps.getDevices?.() || []).map((d) => [d.id, d] as const)
      )
      const filtered = wall.filter((d) => {
        if (!isDeviceAiVisionEnabled(deviceMap.get(d.deviceId))) return false
        if (cfg.deviceIds.length && !cfg.deviceIds.includes(d.deviceId)) return false
        return true
      })
      for (const row of filtered) {
        await this.inspectDevice(row.deviceId, cfg, false, row)
      }
      this.status.lastError = null
    } catch (e) {
      this.status.lastError = e instanceof Error ? e.message : String(e)
    } finally {
      this.busy = false
    }
  }

  private async inspectDevice(
    deviceId: string,
    cfg: AiVisionSettings,
    force: boolean,
    wallRow?: {
      deviceId: string
      name: string
      cameras: CameraCandidate[]
    }
  ): Promise<AiVisionAlert[]> {
    let row = wallRow
    if (!row) {
      const wall = await this.deps.listWallCameras()
      row = wall.find((d) => d.deviceId === deviceId)
    }
    const patrolCams = camerasForAiPatrol(row?.cameras || [])
    if (!patrolCams.length) {
      if (force) throw new Error('该设备无可用摄像头')
      return []
    }

    const alerts: AiVisionAlert[] = []
    let anySnapOk = false
    let lastSnapErr = ''

    for (const cam of patrolCams) {
      const url = (cam.snapshotUrl || cam.streamUrl || '').trim()
      if (!url) continue
      const snap = await this.deps.takeCameraSnapshot(url)
      if (!snap.ok || !snap.base64) {
        lastSnapErr = snap.ok === false ? snap.message || '抓拍失败' : '抓拍失败'
        continue
      }
      anySnapOk = true

      const found = new Map<AiFaultKind, { confidence: number; source: 'yolo' | 'cloud' }>()

      if (cfg.yoloEnabled) {
        const yolo = await runYoloSpaghetti({
          python: cfg.yoloPython,
          weights: cfg.yoloWeights,
          imageBase64: snap.base64,
          conf: Math.min(cfg.minConfidence, 0.25)
        })
        if (yolo.ok && yolo.maxConfidence >= cfg.minConfidence) {
          found.set('spaghetti', {
            confidence: yolo.maxConfidence,
            source: 'yolo'
          })
        } else if (!yolo.ok && force) {
          this.status.yoloMessage = yolo.message
        }
      }

      if (cfg.cloudEnabled) {
        const cloud = await runCloudVision({
          baseUrl: cfg.cloudBaseUrl,
          apiKey: cfg.cloudApiKey,
          model: cfg.cloudModel,
          imageBase64: snap.base64
        })
        if (cloud.ok) {
          for (const hit of cloud.hits) {
            if (hit.confidence < cfg.minConfidence) continue
            const prev = found.get(hit.kind)
            if (!prev || hit.confidence > prev.confidence) {
              found.set(hit.kind, { confidence: hit.confidence, source: 'cloud' })
            }
          }
        } else if (force) {
          throw new Error(cloud.message)
        }
      }

      for (const [kind, info] of found) {
        const action = cfg.actions[kind] || 'none'
        const cdKey = `${deviceId}:${cam.id}:${kind}`
        const until = this.cooldown.get(cdKey) || 0
        if (!force && Date.now() < until) continue

        let actionOk: boolean | undefined
        let actionMessage: string | undefined
        if (action === 'pause' || action === 'stop') {
          const payload =
            action === 'pause' ? { action: 'pause' } : { action: 'cancel' }
          const res = await this.deps.controlDevice(deviceId, payload)
          actionOk = res.ok
          actionMessage = res.message
        }

        const alert: AiVisionAlert = {
          id: randomUUID(),
          deviceId,
          deviceName: row!.name,
          kind,
          label: AI_FAULT_LABELS[kind],
          confidence: info.confidence,
          source: info.source,
          action,
          actionOk,
          actionMessage,
          at: new Date().toISOString()
        }
        alerts.push(alert)
        this.pushAlert(alert)
        this.cooldown.set(cdKey, Date.now() + Math.max(gapMs(cfg.intervalSec) * 2, 60_000))
      }
    }

    if (force && !anySnapOk) {
      throw new Error(lastSnapErr || '抓拍失败')
    }
    return alerts
  }

  private pushAlert(alert: AiVisionAlert): void {
    this.status.alerts = [alert, ...this.status.alerts].slice(0, MAX_ALERTS)
    try {
      this.deps.onAlert?.(alert)
    } catch {
      /* ignore */
    }
  }
}

function gapMs(intervalSec: number): number {
  return Math.max(5, intervalSec) * 1000
}
