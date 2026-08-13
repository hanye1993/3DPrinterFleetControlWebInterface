import type { BambuRegion } from '../types/printer'
import { serverGet, serverSend } from './serverClient'

export async function probeMoonraker(baseUrl: string, apiKey?: string) {
  return serverSend<{ ok: boolean; message: string }>('/api/v1/onboard/moonraker/probe', 'POST', {
    baseUrl,
    apiKey
  })
}

export async function probeCreality(
  url: string,
  opts?: { apiKey?: string; username?: string; password?: string }
) {
  return serverSend<{
    ok: boolean
    message: string
    baseUrl?: string
    token?: string
  }>('/api/v1/onboard/creality/probe', 'POST', { url, ...opts })
}

export async function probeQidi(
  url: string,
  opts?: { apiKey?: string; username?: string; password?: string }
) {
  return serverSend<{
    ok: boolean
    message: string
    baseUrl?: string
    token?: string
  }>('/api/v1/onboard/qidi/probe', 'POST', { url, ...opts })
}

export async function bambuSendCode(region: BambuRegion, account: string) {
  return serverSend<{ ok: boolean; message?: string; via?: string }>(
    '/api/v1/onboard/bambu/send-code',
    'POST',
    { region, account }
  )
}

export async function bambuLogin(region: BambuRegion, account: string, password: string) {
  return serverSend<{
    ok: boolean
    message?: string
    accessToken?: string
    needCode?: boolean
    via?: string
  }>('/api/v1/onboard/bambu/login', 'POST', { region, account, password })
}

export async function bambuLoginWithCode(region: BambuRegion, account: string, code: string) {
  return serverSend<{ ok: boolean; message?: string; accessToken?: string }>(
    '/api/v1/onboard/bambu/login-code',
    'POST',
    { region, account, code }
  )
}

export type BambuCloudDevice = {
  dev_id: string
  name?: string
  dev_product_name?: string
  dev_model_name?: string
  online?: boolean
}

export async function bambuFetchDevices(region: BambuRegion, token: string) {
  return serverSend<{
    ok: boolean
    devices: BambuCloudDevice[]
    uid: string | null
    message?: string
  }>('/api/v1/onboard/bambu/devices', 'POST', { region, token })
}

export async function bambuProbeLan(serial: string, host: string, accessCode: string) {
  return serverSend<{ ok: boolean; message?: string }>(
    '/api/v1/onboard/bambu/probe-lan',
    'POST',
    { serial, host, accessCode }
  )
}

export async function anycubicProbeLan(host: string) {
  return serverSend<{ ok: boolean; message?: string }>('/api/v1/onboard/anycubic/probe', 'POST', {
    host
  })
}

export async function elegooProbe(host: string) {
  return serverSend<{ ok: boolean; message?: string }>('/api/v1/onboard/elegoo/probe', 'POST', {
    host
  })
}

export async function flashforgeProbe(host: string, serial: string, checkCode: string) {
  return serverSend<{ ok: boolean; message?: string; token?: string }>(
    '/api/v1/onboard/flashforge/probe',
    'POST',
    { host, serial, checkCode }
  )
}

export async function snapmakerProbe(host: string, token?: string) {
  return serverSend<{ ok: boolean; message?: string; token?: string }>(
    '/api/v1/onboard/snapmaker/probe',
    'POST',
    { host, token }
  )
}
