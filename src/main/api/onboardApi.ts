import type { IncomingMessage, ServerResponse } from 'http'
import { randomUUID } from 'crypto'
import {
  bambuGetUserId,
  bambuListDevices,
  bambuLogin,
  bambuLoginWithCode,
  bambuSendVerifyCode,
  type BambuRegion
} from '../bambu/cloud'
import { createBambuMqttBridge } from '../bambu/mqtt'
import { createAnycubicLanBridge } from '../anycubic/lan'
import { createElegooSdcpBridge } from '../elegoo/sdcp'
import { flashforgeProbe } from '../flashforge/lan'
import { snapmakerProbe } from '../snapmaker/lan'
import { probeCreality, probeMoonraker, probeQidi } from './moonrakerProbe'

type SendJson = (res: ServerResponse, status: number, body: unknown) => void
type ReadBody = (req: IncomingMessage) => Promise<string>

async function parseBody(
  req: IncomingMessage,
  readBody: ReadBody
): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; message: string }> {
  try {
    const raw = await readBody(req)
    const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
    return { ok: true, body }
  } catch {
    return { ok: false, message: 'Invalid JSON body' }
  }
}

const noopWin = () => null
const bambuMqtt = createBambuMqttBridge(noopWin)
const anycubicLan = createAnycubicLanBridge(noopWin)
const elegooSdcp = createElegooSdcpBridge(noopWin)

function hostOnly(input: string): string {
  return input
    .trim()
    .replace(/^https?:\/\//, '')
    .split('/')[0]
    .split(':')[0]
}

export async function handleOnboardApi(opts: {
  method: string
  path: string
  req: IncomingMessage
  res: ServerResponse
  sendJson: SendJson
  readBody: ReadBody
}): Promise<boolean> {
  const { method, path, req, res, sendJson, readBody } = opts
  if (!path.startsWith('/api/v1/onboard/')) return false

  const parsed = await parseBody(req, readBody)
  if (!parsed.ok) {
    sendJson(res, 400, { ok: false, message: parsed.message })
    return true
  }
  const body = parsed.body

  if (method === 'POST' && path === '/api/v1/onboard/moonraker/probe') {
    const baseUrl = String(body.baseUrl || '').trim()
    const apiKey = typeof body.apiKey === 'string' ? body.apiKey : undefined
    if (!baseUrl) {
      sendJson(res, 400, { ok: false, message: 'baseUrl is required' })
      return true
    }
    sendJson(res, 200, await probeMoonraker(baseUrl, apiKey))
    return true
  }

  if (method === 'POST' && path === '/api/v1/onboard/creality/probe') {
    const url = String(body.url || body.baseUrl || '').trim()
    sendJson(
      res,
      200,
      await probeCreality(url, {
        apiKey: typeof body.apiKey === 'string' ? body.apiKey : undefined,
        username: typeof body.username === 'string' ? body.username : undefined,
        password: typeof body.password === 'string' ? body.password : undefined
      })
    )
    return true
  }

  if (method === 'POST' && path === '/api/v1/onboard/qidi/probe') {
    const url = String(body.url || body.baseUrl || '').trim()
    sendJson(
      res,
      200,
      await probeQidi(url, {
        apiKey: typeof body.apiKey === 'string' ? body.apiKey : undefined,
        username: typeof body.username === 'string' ? body.username : undefined,
        password: typeof body.password === 'string' ? body.password : undefined
      })
    )
    return true
  }

  if (method === 'POST' && path === '/api/v1/onboard/bambu/send-code') {
    const region = (body.region === 'global' ? 'global' : 'china') as BambuRegion
    const account = String(body.account || '').trim()
    sendJson(res, 200, await bambuSendVerifyCode(region, account))
    return true
  }

  if (method === 'POST' && path === '/api/v1/onboard/bambu/login') {
    const region = (body.region === 'global' ? 'global' : 'china') as BambuRegion
    sendJson(
      res,
      200,
      await bambuLogin(region, String(body.account || '').trim(), String(body.password || ''))
    )
    return true
  }

  if (method === 'POST' && path === '/api/v1/onboard/bambu/login-code') {
    const region = (body.region === 'global' ? 'global' : 'china') as BambuRegion
    sendJson(
      res,
      200,
      await bambuLoginWithCode(
        region,
        String(body.account || '').trim(),
        String(body.code || '').trim()
      )
    )
    return true
  }

  if (method === 'POST' && path === '/api/v1/onboard/bambu/devices') {
    const region = (body.region === 'global' ? 'global' : 'china') as BambuRegion
    const token = String(body.token || '').trim()
    const uidRes = await bambuGetUserId(region, token)
    if (!uidRes.ok || !uidRes.uid) {
      sendJson(res, 200, {
        ok: false,
        devices: [],
        uid: null,
        message: uidRes.message || '获取用户失败'
      })
      return true
    }
    const list = await bambuListDevices(region, token)
    sendJson(res, 200, { ...list, uid: uidRes.uid })
    return true
  }

  if (method === 'POST' && path === '/api/v1/onboard/bambu/probe-lan') {
    const serial = String(body.serial || '').trim()
    const host = String(body.host || '').trim()
    const password = String(body.accessCode || body.password || '').trim()
    const probeId = `probe-${randomUUID()}`
    const result = await bambuMqtt.connect({
      connectionId: probeId,
      serial,
      mode: 'lan',
      host,
      password
    })
    await bambuMqtt.disconnect(probeId)
    sendJson(res, 200, result)
    return true
  }

  if (method === 'POST' && path === '/api/v1/onboard/anycubic/probe') {
    const host = hostOnly(String(body.host || ''))
    const probeId = `probe-anycubic-${randomUUID()}`
    const result = await anycubicLan.connect({ connectionId: probeId, host })
    await anycubicLan.disconnect(probeId)
    sendJson(res, 200, result)
    return true
  }

  if (method === 'POST' && path === '/api/v1/onboard/elegoo/probe') {
    const host = hostOnly(String(body.host || ''))
    const probeId = `probe-elegoo-${randomUUID()}`
    const result = await elegooSdcp.connect({ connectionId: probeId, host })
    await elegooSdcp.disconnect(probeId)
    sendJson(res, 200, result)
    return true
  }

  if (method === 'POST' && path === '/api/v1/onboard/flashforge/probe') {
    const host = hostOnly(String(body.host || ''))
    const serial = String(body.serial || '').trim()
    const checkCode = String(body.checkCode || '').trim()
    sendJson(res, 200, await flashforgeProbe(host, serial, checkCode))
    return true
  }

  if (method === 'POST' && path === '/api/v1/onboard/snapmaker/probe') {
    const host = hostOnly(String(body.host || ''))
    const token = typeof body.token === 'string' ? body.token : undefined
    sendJson(res, 200, await snapmakerProbe(host, token))
    return true
  }

  sendJson(res, 404, { ok: false, message: 'Unknown onboard route' })
  return true
}
