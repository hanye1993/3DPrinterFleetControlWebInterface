/**
 * 应用集市远程目录：GET {MARKET_BASE}/api/apps
 * 安装包：{MARKET_BASE}{packagePath}（通常 /uploads/xxx.zip）
 *
 * 多线路：环境变量优先，源码内置备用地址；探测通哪条用哪条。
 */
import { createHash } from 'crypto'
import dns from 'dns'

// FRP / 部分运营商 IPv6 不通时，Node 默认先试 AAAA 会直接 fetch failed；浏览器却正常
try {
  dns.setDefaultResultOrder('ipv4first')
} catch {
  /* ignore older node */
}

/** 源码内置备用线路（勿写入对外文档） */
const BUILTIN_MARKET_BASES = [
  'http://124.221.92.32:3001',
  'http://sc1.dpfrp.top:3001',
  'http://sc1.dpfrp.top:3000'
] as const

const RESOLVE_TTL_MS = 60_000
let resolvedBase: { url: string; at: number } | null = null

function normalizeBase(raw: string): string {
  return String(raw || '')
    .trim()
    .replace(/\/+$/, '')
}

/** 候选市场根地址：MARKET_BASE_URL / MARKET_BASE_URLS + 内置线路（去重保序） */
export function listMarketBaseCandidates(): string[] {
  const out: string[] = []
  const push = (raw: string) => {
    const b = normalizeBase(raw)
    if (!b || !/^https?:\/\//i.test(b)) return
    if (!out.includes(b)) out.push(b)
  }
  const envBase = normalizeBase(String(process.env.MARKET_BASE_URL || ''))
  push(envBase)
  for (const part of String(process.env.MARKET_BASE_URLS || '').split(/[,;\s]+/)) {
    push(part)
  }
  // 已显式配置市场地址时，只走这条（及 MARKET_BASE_URLS），不再扫公网备用/本机端口
  if (envBase) return out
  for (const b of BUILTIN_MARKET_BASES) push(b)
  push('http://127.0.0.1:3001')
  push('http://127.0.0.1:3000')
  return out
}

/** 同步：最近探测成功的地址，否则返回候选第一条 */
export function getMarketBaseUrl(): string {
  if (resolvedBase && Date.now() - resolvedBase.at < RESOLVE_TTL_MS * 5) {
    return resolvedBase.url
  }
  return listMarketBaseCandidates()[0] || 'http://124.221.92.32:3001'
}

function rememberMarketBase(url: string): string {
  const b = normalizeBase(url)
  if (b) resolvedBase = { url: b, at: Date.now() }
  return b || getMarketBaseUrl()
}

/** 外部在探测成功后锁定当前线路 */
export function setMarketBaseUrl(url: string): string {
  return rememberMarketBase(url)
}

async function probeMarketBase(base: string, timeoutMs = 2_500): Promise<boolean> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), timeoutMs)
    const res = await fetch(`${normalizeBase(base)}/api/apps`, {
      signal: ctrl.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'hanye-printer-monitor-marketplace'
      },
      redirect: 'follow'
    })
    clearTimeout(t)
    return res.ok
  } catch {
    return false
  }
}

/** 探测候选线路，缓存可通地址；force 时重新探测 */
export async function resolveMarketBaseUrl(force = false): Promise<string> {
  if (!force && resolvedBase && Date.now() - resolvedBase.at < RESOLVE_TTL_MS) {
    return resolvedBase.url
  }
  const candidates = listMarketBaseCandidates()
  const fallback = candidates[0] || 'http://124.221.92.32:3001'
  const preferred = normalizeBase(String(process.env.MARKET_BASE_URL || ''))

  if (preferred && (await probeMarketBase(preferred, 3_000))) {
    return rememberMarketBase(preferred)
  }
  if (!force && resolvedBase?.url && resolvedBase.url !== preferred) {
    if (await probeMarketBase(resolvedBase.url)) {
      return rememberMarketBase(resolvedBase.url)
    }
  }

  const rest = candidates.filter((b) => b !== preferred && b !== resolvedBase?.url)
  const probes = await Promise.all(
    rest.map(async (base) => ({ base, ok: await probeMarketBase(base) }))
  )
  const hit = probes.find((p) => p.ok)
  if (hit) return rememberMarketBase(hit.base)
  return rememberMarketBase(preferred || fallback)
}

/** 兼容软件标识；空字符串表示不传 software 字段 */
export function getLicenseSoftware(): string {
  if (Object.prototype.hasOwnProperty.call(process.env, 'LICENSE_SOFTWARE')) {
    return String(process.env.LICENSE_SOFTWARE || '').trim()
  }
  if (Object.prototype.hasOwnProperty.call(process.env, 'MARKET_SOFTWARE')) {
    return String(process.env.MARKET_SOFTWARE || '').trim()
  }
  return 'hanye-printer-monitor'
}

/** 可选：部分桌面版市场下载接口需要 */
export function getMarketDesktopSecret(): string {
  return String(
    process.env.MARKET_DESKTOP_SECRET ||
      process.env.APP_MARKET_DESKTOP_SECRET ||
      'app-market-desktop-please-change-me'
  ).trim()
}

export const MARKET_REPO_URL = () => getMarketBaseUrl()

export type MarketPackageKind = 'plugin' | 'theme'

export type MarketPackage = {
  kind: MarketPackageKind
  identifier: string
  name: string
  version: string
  description?: string
  path: string
  icon?: string
  intro?: string
  size?: number
  sha256?: string
  pricingType?: string
  price?: number
  category?: string
  appId?: string
  compatibleSoftwares?: string[]
  /** 开发者展示名 */
  developerName?: string
  /** 开发者标签（如官方优选） */
  developerTags?: string[]
}

export type MarketCatalog = {
  version: number
  name?: string
  repo?: string
  updatedAt?: string
  layout?: string
  packages: MarketPackage[]
}

export type MarketPackageView = MarketPackage & {
  installed: boolean
  installedVersion: string | null
  updateAvailable: boolean
  downloadUrls: string[]
  iconUrls: string[]
  licensed?: boolean
  licenseKeyHint?: string
}

const CACHE_MS = 10 * 60 * 1000
let cache: { at: number; catalog: MarketCatalog } | null = null

function marketHeaders(extra?: Record<string, string>): Record<string, string> {
  const secret = getMarketDesktopSecret()
  const h: Record<string, string> = {
    'User-Agent': 'hanye-printer-monitor-marketplace',
    Accept: 'application/json, */*',
    ...(extra || {})
  }
  if (secret) {
    h['X-Desktop-Secret'] = secret
  }
  return h
}

function absUrl(pathOrUrl: string): string {
  const p = String(pathOrUrl || '').trim()
  if (!p) return ''
  if (/^https?:\/\//i.test(p)) return p
  const base = getMarketBaseUrl()
  return `${base}${p.startsWith('/') ? '' : '/'}${p}`
}

export function packageDownloadUrls(relPath: string): string[] {
  const p = String(relPath || '').trim()
  if (!p || p.includes('..')) return []
  const url = absUrl(p)
  return url ? [url] : []
}

/** 封面列表用缩略图参数，避免 1～2MB 原图把界面拖卡 */
export function packageIconUrls(relPath: string): string[] {
  return packageDownloadUrls(relPath).map((url) => {
    if (!/\.(png|jpe?g|webp|gif)(\?|$)/i.test(url) && !/\/uploads\/covers\//i.test(url)) {
      return url
    }
    return `${url}${url.includes('?') ? '&' : '?'}w=480&q=72`
  })
}

async function fetchText(
  url: string,
  timeoutMs = 25_000,
  retries = 3
): Promise<{ ok: true; text: string } | { ok: false; message: string }> {
  const notes: string[] = []
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), timeoutMs)
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: marketHeaders(),
        redirect: 'follow'
      })
      clearTimeout(t)
      if (!res.ok) {
        notes.push(`HTTP ${res.status}`)
        if (attempt < retries) await new Promise((r) => setTimeout(r, 400 * attempt))
        continue
      }
      return { ok: true, text: await res.text() }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const cause =
        e instanceof Error && e.cause instanceof Error
          ? e.cause.message
          : e instanceof Error && e.cause
            ? String(e.cause)
            : ''
      const detail = [msg, cause].filter(Boolean).join(' / ')
      notes.push(/abort|timeout/i.test(detail) ? '超时' : detail || '失败')
      if (attempt < retries) await new Promise((r) => setTimeout(r, 500 * attempt))
    }
  }
  return {
    ok: false,
    message: `失败 ${url}（${notes.slice(-2).join('；') || '网络异常'}）`
  }
}

export async function fetchBinary(
  urls: string[],
  timeoutMs = 60_000,
  opts?: { sessionCookie?: string }
): Promise<{ ok: true; buf: Buffer; url: string } | { ok: false; message: string }> {
  const notes: string[] = []
  const sessionCookie = String(opts?.sessionCookie || '').trim()
  for (const url of urls) {
    try {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), timeoutMs)
      const headers = marketHeaders({ Accept: 'application/zip,application/octet-stream,*/*' })
      if (sessionCookie) headers.Cookie = `am_session=${sessionCookie}`
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers,
        redirect: 'follow'
      })
      clearTimeout(t)
      if (!res.ok) {
        notes.push(`HTTP ${res.status}`)
        continue
      }
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.length < 64) {
        notes.push('文件过小')
        continue
      }
      const head = buf.subarray(0, 24).toString('utf8')
      if (/^\s*<(!DOCTYPE|html)/i.test(head)) {
        notes.push('返回了 HTML 而非 ZIP')
        continue
      }
      if (/^\s*\{/.test(head)) {
        // 可能是 download 元数据 JSON，尝试解析 packagePath 再下一次循环外处理
        try {
          const j = JSON.parse(buf.toString('utf8')) as {
            data?: { packagePath?: string; downloadUrl?: string }
            packagePath?: string
          }
          const next =
            j?.data?.packagePath || j?.data?.downloadUrl || j?.packagePath || ''
          if (next && absUrl(String(next)) && !urls.includes(absUrl(String(next)))) {
            urls.push(absUrl(String(next)))
            notes.push('解析到 packagePath')
            continue
          }
        } catch {
          /* ignore */
        }
        notes.push('返回了 JSON 而非 ZIP')
        continue
      }
      return { ok: true, buf, url }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      notes.push(/abort|timeout/i.test(msg) ? '超时' : '失败')
    }
  }
  return {
    ok: false,
    message: `下载失败：${notes.slice(0, 3).join('；') || '无可用镜像'}`
  }
}

function guessKind(row: Record<string, unknown>): MarketPackageKind {
  const raw = String(row.appType || row.kind || row.type || '').toUpperCase()
  if (raw === 'THEME' || raw === '主题') return 'theme'
  const cat = String(
    (row.category && typeof row.category === 'object'
      ? (row.category as { name?: string; slug?: string }).name ||
        (row.category as { slug?: string }).slug
      : row.category) || ''
  ).toLowerCase()
  if (cat.includes('theme') || cat.includes('主题')) return 'theme'
  return 'plugin'
}

function rowToPackage(row: Record<string, unknown>): MarketPackage | null {
  const identifier = String(row.identifier || row.appIdentifier || '').trim()
  if (!identifier) return null

  const latest =
    row.latestVersion && typeof row.latestVersion === 'object'
      ? (row.latestVersion as Record<string, unknown>)
      : Array.isArray(row.versions) && row.versions[0] && typeof row.versions[0] === 'object'
        ? (row.versions[0] as Record<string, unknown>)
        : null

  const pathRel = String(
    (latest && (latest.packagePath || latest.path || latest.downloadUrl)) ||
      row.packagePath ||
      row.path ||
      row.downloadUrl ||
      ''
  ).trim()
  if (!pathRel || pathRel.includes('..')) return null

  const version = String((latest && latest.version) || row.version || '0.0.0').trim() || '0.0.0'
  const summary = String(row.summary || '').trim()
  const description = String(row.description || summary || '').trim()
  const icon = String(row.iconUrl || row.coverUrl || row.icon || '').trim() || undefined
  const size =
    typeof latest?.fileSize === 'number'
      ? latest.fileSize
      : typeof row.size === 'number'
        ? row.size
        : undefined
  const category =
    row.category && typeof row.category === 'object'
      ? String((row.category as { name?: string }).name || '')
      : typeof row.category === 'string'
        ? row.category
        : undefined
  const softwares = Array.isArray(row.compatibleSoftwares)
    ? row.compatibleSoftwares.map((x) => String(x))
    : undefined

  const developer =
    row.developer && typeof row.developer === 'object' && !Array.isArray(row.developer)
      ? (row.developer as Record<string, unknown>)
      : null
  const developerName = developer
    ? String(developer.displayName || developer.username || '').trim() || undefined
    : undefined
  const rawTags = developer?.tags
  const developerTags = Array.isArray(rawTags)
    ? rawTags.map((t) => String(t).trim()).filter(Boolean)
    : typeof rawTags === 'string'
      ? (() => {
          try {
            const parsed = JSON.parse(rawTags) as unknown
            return Array.isArray(parsed)
              ? parsed.map((t) => String(t).trim()).filter(Boolean)
              : rawTags
                  .split(/[,，]/)
                  .map((t) => t.trim())
                  .filter(Boolean)
          } catch {
            return rawTags
              .split(/[,，]/)
              .map((t) => t.trim())
              .filter(Boolean)
          }
        })()
      : undefined

  return {
    kind: guessKind(row),
    identifier,
    name: String(row.name || identifier),
    version,
    description,
    path: pathRel,
    icon: icon && !icon.includes('..') ? icon : undefined,
    intro: summary || undefined,
    size,
    sha256: latest?.sha256 ? String(latest.sha256) : row.sha256 ? String(row.sha256) : undefined,
    pricingType: row.pricingType ? String(row.pricingType) : undefined,
    price: (() => {
      if (typeof row.price === 'number' && Number.isFinite(row.price)) return row.price
      const n = Number(row.price)
      return Number.isFinite(n) ? n : undefined
    })(),
    category: category || undefined,
    appId: row.id ? String(row.id) : undefined,
    compatibleSoftwares: softwares,
    developerName,
    developerTags: developerTags?.length ? developerTags : undefined
  }
}

function normalizeAppsPayload(raw: unknown): MarketCatalog {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const list = Array.isArray(o.data)
    ? o.data
    : Array.isArray(o.packages)
      ? o.packages
      : Array.isArray(o)
        ? o
        : []
  const packages: MarketPackage[] = []
  for (const row of list) {
    if (!row || typeof row !== 'object') continue
    const status = String((row as Record<string, unknown>).status || 'APPROVED').toUpperCase()
    if (status && status !== 'APPROVED' && status !== 'PUBLISHED') continue
    const pkg = rowToPackage(row as Record<string, unknown>)
    if (pkg) packages.push(pkg)
  }
  return {
    version: typeof o.version === 'number' ? o.version : 1,
    name: o.name ? String(o.name) : '应用集市',
    repo: getMarketBaseUrl(),
    updatedAt: o.updatedAt ? String(o.updatedAt) : new Date().toISOString(),
    layout: 'app-market:/api/apps',
    packages
  }
}

export async function loadMarketCatalog(force = false): Promise<{
  ok: boolean
  reachable: boolean
  catalog: MarketCatalog
  source?: string
  message: string
}> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) {
    return {
      ok: true,
      reachable: true,
      catalog: cache.catalog,
      source: 'cache',
      message: 'ok'
    }
  }
  if (force) cache = null

  const notes: string[] = []
  const resolved = await resolveMarketBaseUrl(false)
  const bases = force
    ? [resolved, ...listMarketBaseCandidates()]
    : [resolved]
  const tried = new Set<string>()
  const urls: string[] = []
  for (const base of bases) {
    const b = normalizeBase(base)
    if (!b || tried.has(b)) continue
    tried.add(b)
    urls.push(force ? `${b}/api/apps?t=${Date.now()}` : `${b}/api/apps`)
  }

  for (const url of urls) {
    const r = await fetchText(url, 8_000, 1)
    if (!r.ok) {
      notes.push(r.message)
      continue
    }
    try {
      const catalog = normalizeAppsPayload(JSON.parse(r.text))
      if (!catalog.packages.length) {
        notes.push('目录为空')
        continue
      }
      try {
        const u = new URL(url)
        rememberMarketBase(`${u.protocol}//${u.host}`)
      } catch {
        /* ignore */
      }
      cache = { at: Date.now(), catalog: { ...catalog, repo: getMarketBaseUrl() } }
      return {
        ok: true,
        reachable: true,
        catalog: cache.catalog,
        source: url,
        message: 'ok'
      }
    } catch {
      notes.push('目录解析失败')
    }
  }

  return {
    ok: false,
    reachable: false,
    catalog: { version: 1, packages: [], name: '应用集市', repo: getMarketBaseUrl() },
    message: notes.slice(0, 2).join('；') || `无法读取应用集市（${listMarketBaseCandidates().join(' | ')}）`
  }
}

function compareVersions(a: string, b: string): number {
  const pa = String(a || '')
    .trim()
    .replace(/^v/i, '')
    .split(/[.+-]/)
    .map((x) => parseInt(x, 10))
  const pb = String(b || '')
    .trim()
    .replace(/^v/i, '')
    .split(/[.+-]/)
    .map((x) => parseInt(x, 10))
  const n = Math.max(pa.length, pb.length, 1)
  for (let i = 0; i < n; i++) {
    const x = Number.isFinite(pa[i]!) ? pa[i]! : 0
    const y = Number.isFinite(pb[i]!) ? pb[i]! : 0
    if (x > y) return 1
    if (x < y) return -1
  }
  return 0
}

export function enrichPackages(
  catalog: MarketCatalog,
  installed: { plugins: Map<string, string>; themes: Map<string, string> },
  licenseHints?: Map<string, string>
): MarketPackageView[] {
  return catalog.packages.map((p) => {
    const map = p.kind === 'plugin' ? installed.plugins : installed.themes
    let installedVersion: string | null = map.get(p.identifier) || null
    if (!installedVersion) {
      for (const [k, v] of map.entries()) {
        if (k.toLowerCase() === p.identifier.toLowerCase()) {
          installedVersion = v
          break
        }
      }
    }
    const installedOk = Boolean(installedVersion)
    const marketVer = String(p.version || '').trim()
    const localVer = String(installedVersion || '').trim()
    const updateAvailable =
      installedOk && marketVer ? compareVersions(marketVer, localVer || '0') > 0 : false
    const iconPath = p.icon
    const lic = licenseHints?.get(p.identifier)
    return {
      ...p,
      version: marketVer || p.version,
      icon: iconPath,
      installed: installedOk,
      installedVersion: localVer || null,
      updateAvailable,
      downloadUrls: packageDownloadUrls(p.path),
      iconUrls: iconPath ? packageIconUrls(iconPath) : [],
      licensed: Boolean(lic),
      licenseKeyHint: lic ? `${lic.slice(0, 6)}…` : undefined
    }
  })
}

export function verifySha256(buf: Buffer, expect?: string): void {
  if (!expect || !expect.trim()) return
  const dig = createHash('sha256').update(buf).digest('hex')
  if (dig.toLowerCase() !== expect.trim().toLowerCase()) {
    throw new Error(`sha256 校验失败（期望 ${expect.trim()}，实际 ${dig}）`)
  }
}
