import type { IncomingMessage, ServerResponse } from 'http'
import type { VisionMonitor } from '../ai/visionMonitor'
import { runYoloSpaghetti, yoloWeightsExists } from '../ai/yoloDetect'
import { normalizeAiVisionSettings } from '../../shared/aiVision'

type SendJson = (res: ServerResponse, status: number, body: unknown) => void
type ReadBody = (req: IncomingMessage) => Promise<string>
type PluginMgr = {
  runHook: (name: string, value: unknown, ctx?: unknown) => Promise<unknown>
} | null

export async function handleAiVisionApi(opts: {
  method: string
  path: string
  req: IncomingMessage
  res: ServerResponse
  sendJson: SendJson
  readBody: ReadBody
  getAiVision: () => unknown
  getVisionMonitor: () => VisionMonitor | null
  getPluginManager?: () => PluginMgr
}): Promise<boolean> {
  const { method, path, req, res, sendJson, readBody, getAiVision, getVisionMonitor, getPluginManager } =
    opts
  const pm = getPluginManager?.() || null
  const ctx = { method, path }

  if (method === 'GET' && path === '/api/v1/ai/vision/status') {
    const mon = getVisionMonitor()
    const cfg = normalizeAiVisionSettings(getAiVision())
    const st = mon?.getStatus() || {
      running: false,
      lastTickAt: null,
      lastError: null,
      yoloReady: false,
      yoloMessage: null,
      alerts: []
    }
    let payload: Record<string, unknown> = {
      ok: true,
      enabled: cfg.enabled,
      yoloEnabled: cfg.yoloEnabled,
      cloudEnabled: cfg.cloudEnabled,
      yoloWeightsExists: yoloWeightsExists(cfg.yoloWeights),
      ...st
    }
    if (pm) {
      try {
        payload = (await pm.runHook('ai_settings_get', payload, ctx)) as Record<string, unknown>
      } catch {
        /* ignore */
      }
    }
    sendJson(res, 200, payload)
    return true
  }

  if (method === 'POST' && path === '/api/v1/ai/vision/test-yolo') {
    const cfg = normalizeAiVisionSettings(getAiVision())
    const raw = await readBody(req)
    let body: Record<string, unknown> = {}
    try {
      body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
    } catch {
      sendJson(res, 400, { ok: false, message: 'Invalid JSON' })
      return true
    }
    if (pm) {
      try {
        const before = (await pm.runHook(
          'ai_vision_before',
          { proceed: true, action: 'test-yolo', payload: body },
          ctx
        )) as {
          proceed?: boolean
          status?: number
          body?: unknown
          payload?: Record<string, unknown>
        }
        if (before && before.proceed === false) {
          sendJson(res, before.status || 403, before.body ?? { ok: false, message: 'blocked' })
          return true
        }
        if (before?.payload) body = before.payload
      } catch {
        /* ignore */
      }
    }
    const imageBase64 = typeof body.imageBase64 === 'string' ? body.imageBase64 : ''
    if (!imageBase64) {
      sendJson(res, 400, { ok: false, message: '请提供 imageBase64（摄像头截图）' })
      return true
    }
    let result = (await runYoloSpaghetti({
      python: typeof body.python === 'string' ? body.python : cfg.yoloPython,
      weights: typeof body.weights === 'string' ? body.weights : cfg.yoloWeights,
      imageBase64,
      conf: cfg.minConfidence
    })) as Record<string, unknown>
    if (pm) {
      try {
        const hooked = await pm.runHook('ai_vision_after', { action: 'test-yolo', result }, ctx)
        if (hooked && typeof hooked === 'object') result = hooked as Record<string, unknown>
      } catch {
        /* ignore */
      }
    }
    const ok = (result as { ok?: boolean; result?: { ok?: boolean } }).ok
      ?? (result as { result?: { ok?: boolean } }).result?.ok
    sendJson(res, ok === false ? 400 : 200, (result as { result?: unknown }).result ?? result)
    return true
  }

  if (method === 'POST' && path === '/api/v1/ai/vision/check') {
    const mon = getVisionMonitor()
    if (!mon) {
      sendJson(res, 503, { ok: false, message: 'AI 监控未启动' })
      return true
    }
    const raw = await readBody(req)
    let body: Record<string, unknown> = {}
    try {
      body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
    } catch {
      sendJson(res, 400, { ok: false, message: 'Invalid JSON' })
      return true
    }
    if (pm) {
      try {
        const before = (await pm.runHook(
          'ai_vision_before',
          { proceed: true, action: 'check', payload: body },
          ctx
        )) as {
          proceed?: boolean
          status?: number
          body?: unknown
          payload?: Record<string, unknown>
        }
        if (before && before.proceed === false) {
          sendJson(res, before.status || 403, before.body ?? { ok: false, message: 'blocked' })
          return true
        }
        if (before?.payload) body = before.payload
      } catch {
        /* ignore */
      }
    }
    const deviceId = String(body.deviceId || '')
    if (!deviceId) {
      sendJson(res, 400, { ok: false, message: '缺少 deviceId' })
      return true
    }
    let result = (await mon.checkDeviceNow(deviceId)) as Record<string, unknown>
    if (pm) {
      try {
        const hooked = await pm.runHook(
          'ai_vision_after',
          { action: 'check', result, deviceId },
          ctx
        )
        if (hooked && typeof hooked === 'object') result = hooked as Record<string, unknown>
      } catch {
        /* ignore */
      }
    }
    const ok =
      (result as { ok?: boolean }).ok ?? (result as { result?: { ok?: boolean } }).result?.ok
    sendJson(res, ok === false ? 400 : 200, (result as { result?: unknown }).result ?? result)
    return true
  }

  return false
}
