import axios from 'axios'

function authHeaders(secret?: string): Record<string, string> {
  if (!secret) return {}
  if (secret.split('.').length >= 3) return { Authorization: `Bearer ${secret}` }
  return { 'X-Api-Key': secret }
}

export async function probeMoonraker(
  baseUrl: string,
  apiKey?: string
): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await axios.get(`${baseUrl.replace(/\/$/, '')}/server/info`, {
      timeout: 8000,
      headers: authHeaders(apiKey)
    })
    const klippy = res.data?.result?.klippy_state
    return { ok: true, message: `已连接${klippy ? `（Klippy: ${klippy}）` : ''}` }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : '探测失败' }
  }
}

export async function moonrakerLogin(
  baseUrl: string,
  username: string,
  password: string
): Promise<{ ok: boolean; message: string; token?: string }> {
  try {
    const { data } = await axios.post(
      `${baseUrl.replace(/\/$/, '')}/access/login`,
      { username, password, source: 'printer-monitor' },
      { timeout: 10000 }
    )
    const token = data?.result?.token || data?.result
    if (typeof token === 'string' && token) {
      return { ok: true, message: '登录成功', token }
    }
    return { ok: false, message: '登录响应无效' }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : '登录失败' }
  }
}

export function normalizeCrealityUrl(input: string): string {
  let raw = input.trim()
  if (!raw) return ''
  if (!/^https?:\/\//i.test(raw)) raw = `http://${raw}`
  const u = new URL(raw)
  if (!u.port) u.port = '4408'
  return u.origin
}

export function crealityProbeCandidates(input: string): string[] {
  const primary = normalizeCrealityUrl(input)
  if (!primary) return []
  const u = new URL(primary)
  const host = u.hostname
  const list = [primary]
  for (const p of ['4408', '4409', '7125', '80']) {
    const e = `http://${host}:${p}`
    if (!list.includes(e)) list.push(e)
  }
  return list
}

export async function probeCreality(
  urlOrHost: string,
  opts?: { apiKey?: string; username?: string; password?: string }
): Promise<{ ok: boolean; message: string; baseUrl?: string; token?: string }> {
  const candidates = crealityProbeCandidates(urlOrHost)
  const errors: string[] = []
  for (const url of candidates) {
    let token = opts?.apiKey?.trim() || undefined
    if (opts?.username && opts?.password) {
      const login = await moonrakerLogin(url, opts.username, opts.password)
      if (login.ok) token = login.token
      else errors.push(`${url} 登录: ${login.message}`)
    }
    const probe = await probeMoonraker(url, token)
    if (probe.ok) {
      return { ok: true, message: `${probe.message} @ ${url}`, baseUrl: url, token }
    }
    errors.push(`${url}: ${probe.message}`)
  }
  return {
    ok: false,
    message:
      errors.slice(0, 3).join('；') ||
      '无法连接。请确认打印机与电脑同网，地址形如 http://192.168.1.178:4408'
  }
}

export function normalizeQidiUrl(input: string): string {
  let raw = input.trim()
  if (!raw) return ''
  if (!/^https?:\/\//i.test(raw)) raw = `http://${raw}`
  const u = new URL(raw)
  if (!u.port) u.port = '10088'
  return u.origin
}

export function qidiProbeCandidates(input: string): string[] {
  const primary = normalizeQidiUrl(input)
  if (!primary) return []
  const u = new URL(primary)
  const host = u.hostname
  const list = [primary]
  for (const p of ['10088', '7125', '80']) {
    const e = `http://${host}:${p}`
    if (!list.includes(e)) list.push(e)
  }
  return list
}

export async function probeQidi(
  urlOrHost: string,
  opts?: { apiKey?: string; username?: string; password?: string }
): Promise<{ ok: boolean; message: string; baseUrl?: string; token?: string }> {
  const candidates = qidiProbeCandidates(urlOrHost)
  const errors: string[] = []
  for (const url of candidates) {
    let token = opts?.apiKey?.trim() || undefined
    if (opts?.username && opts?.password) {
      const login = await moonrakerLogin(url, opts.username, opts.password)
      if (login.ok) token = login.token
      else errors.push(`${url} 登录: ${login.message}`)
    }
    const probe = await probeMoonraker(url, token)
    if (probe.ok) {
      return { ok: true, message: `${probe.message} @ ${url}`, baseUrl: url, token }
    }
    errors.push(`${url}: ${probe.message}`)
  }
  return { ok: false, message: errors.slice(0, 3).join('；') || '无法连接 QIDI 设备' }
}
