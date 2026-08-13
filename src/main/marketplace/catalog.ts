/**
 * Remote plugin/theme marketplace (GitHub repo catalog).
 * Prefer github.com / jsDelivr — api.github.com often fails on some networks.
 */
import { createHash } from 'crypto'

export const MARKET_OWNER = 'hanye1993'
export const MARKET_REPO = 'ck3dckkzt11'
export const MARKET_BRANCH = 'main'
export const MARKET_REPO_URL = `https://github.com/${MARKET_OWNER}/${MARKET_REPO}`

export type MarketPackageKind = 'plugin' | 'theme'

export type MarketPackage = {
  kind: MarketPackageKind
  identifier: string
  name: string
  version: string
  description?: string
  /** Relative zip path, e.g. plugins/详情控制台/详情控制台.zip */
  path: string
  /** Relative icon path, e.g. plugins/详情控制台/tu.png */
  icon?: string
  /** Relative intro text path, e.g. plugins/详情控制台/js.txt */
  intro?: string
  size?: number
  sha256?: string
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
}

const CACHE_MS = 10 * 60 * 1000
let cache: { at: number; catalog: MarketCatalog } | null = null
/** Latest market-repo commit from git ls-remote; pins jsDelivr (avoids stale @main). */
let marketSha: { at: number; sha: string } | null = null

async function resolveMarketSha(force = false): Promise<string | null> {
  if (!force && marketSha && Date.now() - marketSha.at < CACHE_MS) return marketSha.sha
  try {
    const { execFile } = await import('child_process')
    const { promisify } = await import('util')
    const execFileAsync = promisify(execFile)
    const { stdout } = await execFileAsync(
      'git',
      ['ls-remote', `${MARKET_REPO_URL}.git`, `refs/heads/${MARKET_BRANCH}`],
      { timeout: 15_000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }
    )
    const sha = String(stdout || '')
      .trim()
      .split(/\s+/)[0]
    if (sha && /^[0-9a-f]{7,40}$/i.test(sha)) {
      marketSha = { at: Date.now(), sha }
      return sha
    }
  } catch {
    /* ignore — fall back to branch / GitHub raw */
  }
  return marketSha?.sha || null
}

async function catalogUrls(force = false): Promise<string[]> {
  const file = 'catalog.json'
  const bust = `t=${Date.now()}`
  const sha = await resolveMarketSha(force)
  const urls: string[] = []
  // Commit-pinned jsDelivr is fresh even when @main CDN lag / GitHub DNS fails.
  if (sha) {
    urls.push(`https://cdn.jsdelivr.net/gh/${MARKET_OWNER}/${MARKET_REPO}@${sha}/${file}`)
  }
  urls.push(
    `https://github.com/${MARKET_OWNER}/${MARKET_REPO}/raw/${MARKET_BRANCH}/${file}?${bust}`,
    `https://raw.githubusercontent.com/${MARKET_OWNER}/${MARKET_REPO}/${MARKET_BRANCH}/${file}?${bust}`,
    `https://cdn.jsdelivr.net/gh/${MARKET_OWNER}/${MARKET_REPO}@${MARKET_BRANCH}/${file}?${bust}`
  )
  return urls
}

export function packageDownloadUrls(relPath: string): string[] {
  const p = String(relPath || '')
    .replace(/^\/+/, '')
    .replace(/\\/g, '/')
  if (!p || p.includes('..')) return []
  // Encode each path segment for non-ASCII names (插件名.zip)
  const enc = p
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/')
  const bust = `t=${Date.now()}`
  const sha = marketSha?.sha
  const urls: string[] = []
  if (sha) {
    urls.push(`https://cdn.jsdelivr.net/gh/${MARKET_OWNER}/${MARKET_REPO}@${sha}/${enc}`)
  }
  urls.push(
    `https://github.com/${MARKET_OWNER}/${MARKET_REPO}/raw/${MARKET_BRANCH}/${enc}?${bust}`,
    `https://raw.githubusercontent.com/${MARKET_OWNER}/${MARKET_REPO}/${MARKET_BRANCH}/${enc}?${bust}`,
    `https://cdn.jsdelivr.net/gh/${MARKET_OWNER}/${MARKET_REPO}@${MARKET_BRANCH}/${enc}?${bust}`
  )
  return urls
}

async function fetchText(url: string, timeoutMs = 12_000): Promise<{ ok: true; text: string } | { ok: false; message: string }> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), timeoutMs)
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'hanye-printer-monitor-marketplace', Accept: '*/*' },
      redirect: 'follow'
    })
    clearTimeout(t)
    if (!res.ok) return { ok: false, message: `HTTP ${res.status} @ ${url}` }
    return { ok: true, text: await res.text() }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, message: /abort|timeout/i.test(msg) ? `超时 ${url}` : `失败 ${url}` }
  }
}

export async function fetchBinary(
  urls: string[],
  timeoutMs = 60_000
): Promise<{ ok: true; buf: Buffer; url: string } | { ok: false; message: string }> {
  const notes: string[] = []
  for (const url of urls) {
    try {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), timeoutMs)
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: { 'User-Agent': 'hanye-printer-monitor-marketplace', Accept: 'application/zip,*/*' },
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

function normalizeCatalog(raw: unknown): MarketCatalog {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const list = Array.isArray(o.packages) ? o.packages : []
  const packages: MarketPackage[] = []
  for (const row of list) {
    if (!row || typeof row !== 'object') continue
    const r = row as Record<string, unknown>
    const kind = r.kind === 'theme' ? 'theme' : r.kind === 'plugin' ? 'plugin' : null
    const identifier = String(r.identifier || '').trim()
    const pathRel = String(r.path || '').trim().replace(/^\/+/, '')
    if (!kind || !identifier || !pathRel || pathRel.includes('..')) continue
    const icon = r.icon ? String(r.icon).replace(/^\/+/, '') : undefined
    const intro = r.intro ? String(r.intro).replace(/^\/+/, '') : undefined
    packages.push({
      kind,
      identifier,
      name: String(r.name || identifier),
      version: String(r.version || '0.0.0'),
      description: r.description ? String(r.description) : '',
      path: pathRel,
      icon: icon && !icon.includes('..') ? icon : undefined,
      intro: intro && !intro.includes('..') ? intro : undefined,
      size: typeof r.size === 'number' ? r.size : undefined,
      sha256: r.sha256 ? String(r.sha256) : undefined
    })
  }
  return {
    version: typeof o.version === 'number' ? o.version : 1,
    name: o.name ? String(o.name) : '应用市场',
    repo: o.repo ? String(o.repo) : MARKET_REPO_URL,
    updatedAt: o.updatedAt ? String(o.updatedAt) : undefined,
    layout: o.layout ? String(o.layout) : undefined,
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
  for (const url of await catalogUrls(force)) {
    const r = await fetchText(url)
    if (!r.ok) {
      notes.push(r.message)
      continue
    }
    try {
      const catalog = normalizeCatalog(JSON.parse(r.text))
      if (!catalog.packages.length) {
        notes.push('目录为空')
        continue
      }
      cache = { at: Date.now(), catalog }
      return {
        ok: true,
        reachable: true,
        catalog,
        source: url,
        message: 'ok'
      }
    } catch {
      notes.push('catalog.json 解析失败')
    }
  }
  return {
    ok: false,
    reachable: false,
    catalog: { version: 1, packages: [] },
    message:
      notes.slice(0, 2).join('；') ||
      `无法读取应用市场目录（${MARKET_REPO_URL}）`
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
  installed: { plugins: Map<string, string>; themes: Map<string, string> }
): MarketPackageView[] {
  return catalog.packages.map((p) => {
    const map = p.kind === 'plugin' ? installed.plugins : installed.themes
    // match identifier case-insensitively
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
      installedOk && marketVer
        ? compareVersions(marketVer, localVer || '0') > 0
        : false
    const iconPath =
      p.icon ||
      (p.path.includes('/')
        ? `${p.path.split('/').slice(0, -1).join('/')}/tu.png`
        : undefined)
    return {
      ...p,
      version: marketVer || p.version,
      icon: iconPath,
      installed: installedOk,
      installedVersion: localVer || null,
      updateAvailable,
      downloadUrls: packageDownloadUrls(p.path),
      iconUrls: iconPath ? packageDownloadUrls(iconPath) : []
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
