import { networkInterfaces } from 'os'
import net from 'net'
import axios from 'axios'

export type LanDiscoverBrand =
  | 'klipper'
  | 'bambu'
  | 'creality'
  | 'elegoo'
  | 'anycubic'
  | 'snapmaker'
  | 'flashforge'
  | 'qidi'

export type LanDiscoverHit = {
  host: string
  brand: LanDiscoverBrand
  port: number
  label: string
  name?: string
  /** Prefill for Moonraker / Fluidd style forms */
  baseUrl?: string
  needsCredentials?: boolean
  detail?: string
}

export type LanDiscoverProgress = {
  phase: 'scanning' | 'done' | 'cancelled' | 'error'
  scanned: number
  total: number
  found: number
  message?: string
}

export type LanDiscoverOpts = {
  /** Limit to these brands; omit = all */
  brands?: LanDiscoverBrand[]
  concurrency?: number
  timeoutMs?: number
}

type ProbeDef = {
  port: number
  brand: LanDiscoverBrand
  label: string
  needsCredentials?: boolean
  detail?: string
  identify?: (host: string, port: number, timeoutMs: number) => Promise<Partial<LanDiscoverHit> | null>
}

let cancelFlag = false
let running = false

export function cancelLanDiscover(): void {
  cancelFlag = true
}

function isPrivateIpv4(ip: string): boolean {
  const p = ip.split('.').map(Number)
  if (p.length !== 4 || p.some((n) => !Number.isFinite(n))) return false
  if (p[0] === 10) return true
  if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true
  if (p[0] === 192 && p[1] === 168) return true
  return false
}

function tcpOpen(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    let settled = false
    const done = (ok: boolean) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
    socket.connect(port, host)
  })
}

async function httpGetJson(
  url: string,
  timeoutMs: number
): Promise<Record<string, unknown> | null> {
  try {
    const { data, status } = await axios.get(url, {
      timeout: timeoutMs,
      validateStatus: () => true,
      transitional: { clarifyTimeoutError: true }
    })
    if (status < 200 || status >= 400) return null
    if (data && typeof data === 'object') return data as Record<string, unknown>
    return null
  } catch {
    return null
  }
}

async function identifyMoonraker(
  host: string,
  port: number,
  timeoutMs: number
): Promise<Partial<LanDiscoverHit> | null> {
  const data = await httpGetJson(`http://${host}:${port}/server/info`, timeoutMs)
  if (!data) return null
  const klippy = String(data.klippy_state || data.klippy_connected || '')
  return {
    name: undefined,
    detail: klippy ? `Klippy: ${klippy}` : 'Moonraker',
    baseUrl: `http://${host}:${port}`
  }
}

async function identifyAnycubic(
  host: string,
  _port: number,
  timeoutMs: number
): Promise<Partial<LanDiscoverHit> | null> {
  const data = await httpGetJson(`http://${host}:18910/info`, timeoutMs)
  if (!data) return null
  const model = String(data.model || data.model_id || data.name || '')
  return {
    name: model || undefined,
    detail: 'LAN Mode',
    baseUrl: `http://${host}`
  }
}

async function identifyFlashforge(
  host: string,
  _port: number,
  timeoutMs: number
): Promise<Partial<LanDiscoverHit> | null> {
  // /detail needs serial; open port is enough signal
  const open = await tcpOpen(host, 8898, timeoutMs)
  if (!open) return null
  return {
    detail: '需填写序列号与 CheckCode',
    needsCredentials: true,
    baseUrl: host
  }
}

async function identifySnapmaker(
  host: string,
  _port: number,
  timeoutMs: number
): Promise<Partial<LanDiscoverHit> | null> {
  // Avoid false positives on random :8080 — require Snapmaker-ish endpoint
  try {
    const { status } = await axios.get(`http://${host}:8080/api/v1/status`, {
      timeout: timeoutMs,
      validateStatus: () => true
    })
    // 200/401/403/204 all suggest the Snapmaker API exists
    if (status === 200 || status === 401 || status === 403 || status === 204) {
      return {
        detail: '可能需要屏幕授权或 Token',
        needsCredentials: true,
        baseUrl: host
      }
    }
  } catch {
    // ignore
  }
  return null
}

const PROBES: ProbeDef[] = [
  {
    port: 7125,
    brand: 'klipper',
    label: 'Moonraker / Klipper',
    identify: identifyMoonraker
  },
  {
    port: 4408,
    brand: 'creality',
    label: '创想 Fluidd',
    identify: identifyMoonraker
  },
  {
    port: 10088,
    brand: 'qidi',
    label: '启迪 Fluidd',
    identify: identifyMoonraker
  },
  {
    port: 9999,
    brand: 'creality',
    label: '创想原生通道',
    detail: '检测到 :9999，建议用 Fluidd 地址添加'
  },
  {
    port: 3030,
    brand: 'elegoo',
    label: '爱乐库 SDCP'
  },
  {
    port: 18910,
    brand: 'anycubic',
    label: '纵维 LAN Mode',
    identify: identifyAnycubic
  },
  {
    port: 8898,
    brand: 'flashforge',
    label: '闪铸',
    needsCredentials: true,
    identify: identifyFlashforge
  },
  {
    port: 8080,
    brand: 'snapmaker',
    label: 'Snapmaker',
    needsCredentials: true,
    identify: identifySnapmaker
  },
  {
    port: 8883,
    brand: 'bambu',
    label: 'Bambu Lab MQTT',
    needsCredentials: true,
    detail: '需填写序列号与访问码'
  }
]

/** True for typical Docker / container bridge nets (not home LAN). */
function isLikelyContainerNet(ip: string): boolean {
  const p = ip.split('.').map(Number)
  if (p.length !== 4) return false
  // docker0 default 172.17.0.0/16；compose bridge 常为 172.18–172.31
  if (p[0] === 172 && p[1] >= 17 && p[1] <= 31) return true
  // 部分环境自定义 172.16.x 也当容器网，优先跳过
  if (p[0] === 172 && p[1] === 16) return true
  return false
}

function hostsForPrefix(prefix: string): string[] {
  const hosts: string[] = []
  for (let i = 1; i <= 254; i++) hosts.push(`${prefix}.${i}`)
  return hosts
}

/**
 * Parse LAN_SCAN_SUBNETS env, e.g.:
 *   192.168.1
 *   192.168.1.0/24
 *   192.168.1,192.168.0
 *   10.0.0.0/24
 */
function prefixesFromEnv(): string[] {
  const raw = String(process.env.LAN_SCAN_SUBNETS || '').trim()
  if (!raw) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const part of raw.split(/[,;\s]+/)) {
    const s = part.trim()
    if (!s) continue
    let prefix = ''
    const cidr = s.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/)
    if (cidr) {
      prefix = `${cidr[1]}.${cidr[2]}.${cidr[3]}`
    } else {
      const m = s.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?:\.\d{1,3})?$/)
      if (!m) continue
      prefix = `${m[1]}.${m[2]}.${m[3]}`
    }
    if (!isPrivateIpv4(`${prefix}.1`)) continue
    if (seen.has(prefix)) continue
    seen.add(prefix)
    out.push(prefix)
  }
  return out
}

function collectSubnets(): string[][] {
  const ranges: string[][] = []
  const seen = new Set<string>()

  const pushPrefix = (prefix: string) => {
    if (seen.has(prefix)) return
    seen.add(prefix)
    ranges.push(hostsForPrefix(prefix))
  }

  // 1) 显式指定（NAS / Docker 推荐）：扫你家局域网而不是容器网段
  for (const p of prefixesFromEnv()) pushPrefix(p)

  // 2) 自动从网卡收集
  const preferred: string[] = []
  const containerish: string[] = []
  const nets = networkInterfaces()
  for (const list of Object.values(nets)) {
    if (!list) continue
    for (const n of list) {
      const family = String(n.family)
      if ((family !== 'IPv4' && family !== '4') || n.internal) continue
      if (!isPrivateIpv4(n.address)) continue
      const parts = n.address.split('.').map(Number)
      const prefix = `${parts[0]}.${parts[1]}.${parts[2]}`
      if (isLikelyContainerNet(n.address)) containerish.push(prefix)
      else preferred.push(prefix)
    }
  }

  for (const p of preferred) pushPrefix(p)
  // 仅当没有任何家用网段时，才退回扫容器网（几乎找不到打印机）
  if (!ranges.length) {
    for (const p of containerish) pushPrefix(p)
  }

  // Cap at 3 /24s to keep scan time reasonable
  return ranges.slice(0, 3)
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
  onEach?: () => void
): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let idx = 0
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (!cancelFlag) {
      const i = idx++
      if (i >= items.length) break
      out[i] = await fn(items[i])
      onEach?.()
    }
  })
  await Promise.all(workers)
  return out
}

async function probeHost(
  host: string,
  brands: Set<LanDiscoverBrand> | null,
  timeoutMs: number
): Promise<LanDiscoverHit[]> {
  const defs = PROBES.filter((p) => !brands || brands.has(p.brand))
  const hits: LanDiscoverHit[] = []
  const openPorts = await Promise.all(
    defs.map(async (d) => ({ def: d, open: await tcpOpen(host, d.port, timeoutMs) }))
  )

  for (const { def, open } of openPorts) {
    if (!open || cancelFlag) continue
    let extra: Partial<LanDiscoverHit> | null = {}
    if (def.identify) {
      extra = await def.identify(host, def.port, Math.max(timeoutMs, 800))
      if (extra === null) continue
    }
    const baseUrl =
      extra?.baseUrl ||
      (def.brand === 'elegoo' || def.brand === 'anycubic' || def.brand === 'bambu'
        ? `http://${host}`
        : def.brand === 'flashforge' || def.brand === 'snapmaker'
          ? host
          : def.port === 9999
            ? `http://${host}:4408`
            : `http://${host}:${def.port}`)

    hits.push({
      host,
      brand: def.brand,
      port: def.port,
      label: def.label,
      name: extra?.name,
      baseUrl,
      needsCredentials: def.needsCredentials || extra?.needsCredentials,
      detail: extra?.detail || def.detail
    })
  }

  // Prefer Fluidd over bare :9999 for same creality host
  const hasFluidd = hits.some((h) => h.brand === 'creality' && h.port === 4408)
  return hits.filter((h) => !(hasFluidd && h.port === 9999))
}

function dedupeHits(hits: LanDiscoverHit[]): LanDiscoverHit[] {
  const map = new Map<string, LanDiscoverHit>()
  for (const h of hits) {
    const key = `${h.host}|${h.brand}`
    const prev = map.get(key)
    if (!prev) {
      map.set(key, h)
      continue
    }
    // Prefer identified moonraker / credential-ready entries
    const score = (x: LanDiscoverHit) =>
      (x.baseUrl ? 2 : 0) + (x.name ? 1 : 0) + (x.port === 4408 || x.port === 7125 || x.port === 10088 ? 1 : 0)
    if (score(h) > score(prev)) map.set(key, h)
  }
  return Array.from(map.values()).sort(
    (a, b) => a.host.localeCompare(b.host) || a.brand.localeCompare(b.brand)
  )
}

export async function scanLanPrinters(
  opts: LanDiscoverOpts = {},
  onProgress?: (p: LanDiscoverProgress) => void
): Promise<{ ok: boolean; hits: LanDiscoverHit[]; message?: string }> {
  if (running) {
    return { ok: false, hits: [], message: '已有扫描任务在进行' }
  }
  running = true
  cancelFlag = false
  const concurrency = opts.concurrency ?? 64
  const timeoutMs = opts.timeoutMs ?? 280
  const brandSet = opts.brands?.length ? new Set(opts.brands) : null

  try {
    const subnets = collectSubnets()
    if (!subnets.length) {
      onProgress?.({ phase: 'error', scanned: 0, total: 0, found: 0, message: '未找到可用局域网网卡' })
      return { ok: false, hits: [], message: '未找到可用局域网网卡（需连接私有网段）' }
    }

    const hosts = subnets.flat()
    const total = hosts.length
    let scanned = 0
    const found: LanDiscoverHit[] = []

    onProgress?.({ phase: 'scanning', scanned: 0, total, found: 0, message: `扫描 ${subnets.length} 个网段…` })

    await mapPool(
      hosts,
      concurrency,
      async (host) => {
        if (cancelFlag) return
        try {
          const hits = await probeHost(host, brandSet, timeoutMs)
          if (hits.length) found.push(...hits)
        } catch {
          // ignore host errors
        }
      },
      () => {
        scanned += 1
        if (scanned % 8 === 0 || scanned === total) {
          onProgress?.({
            phase: 'scanning',
            scanned,
            total,
            found: dedupeHits(found).length
          })
        }
      }
    )

    const hits = dedupeHits(found)
    if (cancelFlag) {
      onProgress?.({
        phase: 'cancelled',
        scanned,
        total,
        found: hits.length,
        message: '扫描已取消'
      })
      return { ok: true, hits, message: `已取消，目前发现 ${hits.length} 台` }
    }

    onProgress?.({
      phase: 'done',
      scanned: total,
      total,
      found: hits.length,
      message: hits.length ? `发现 ${hits.length} 台设备` : '未发现可识别的打印机端口'
    })
    return {
      ok: true,
      hits,
      message: hits.length ? `发现 ${hits.length} 台设备` : '未发现可识别的打印机端口'
    }
  } finally {
    running = false
    cancelFlag = false
  }
}
