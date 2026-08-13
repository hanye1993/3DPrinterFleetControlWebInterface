/**
 * GitHub release check + optional git pull for source updates.
 */
import { execFile } from 'child_process'
import { promisify } from 'util'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

const execFileAsync = promisify(execFile)

export const GITHUB_OWNER = 'hanye1993'
export const GITHUB_REPO = '3DPrinterFleetControlWebInterface'
export const GITHUB_REPO_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}`
export const GITHUB_RELEASES_URL = `${GITHUB_REPO_URL}/releases`

const CHECK_CACHE_MS = 24 * 60 * 60 * 1000

export type UpdateCheckResult = {
  ok: boolean
  reachable: boolean
  updateAvailable: boolean
  currentVersion: string
  latestVersion: string | null
  latestTag: string | null
  releaseUrl: string | null
  releaseNotes: string | null
  checkedAt: string
  message: string
  cached?: boolean
}

export type UpdateApplyResult = {
  ok: boolean
  reachable: boolean
  updated: boolean
  currentVersion: string
  latestVersion: string | null
  message: string
  log?: string
}

let lastCheck: { at: number; result: UpdateCheckResult } | null = null

function normalizeVersion(v: string): string {
  return String(v || '')
    .trim()
    .replace(/^v/i, '')
}

/** Compare semver-ish a vs b; return 1 if a>b, -1 if a<b, 0 if equal/unknown */
export function compareVersions(a: string, b: string): number {
  const pa = normalizeVersion(a)
    .split(/[.+-]/)
    .map((x) => parseInt(x, 10))
  const pb = normalizeVersion(b)
    .split(/[.+-]/)
    .map((x) => parseInt(x, 10))
  const n = Math.max(pa.length, pb.length)
  for (let i = 0; i < n; i++) {
    const x = Number.isFinite(pa[i]!) ? pa[i]! : 0
    const y = Number.isFinite(pb[i]!) ? pb[i]! : 0
    if (x > y) return 1
    if (x < y) return -1
  }
  return 0
}

export function readLocalPackageVersion(cwd = process.cwd()): string {
  try {
    const p = join(cwd, 'package.json')
    if (!existsSync(p)) return '0.0.0'
    const j = JSON.parse(readFileSync(p, 'utf8')) as { version?: string }
    return normalizeVersion(j.version || '0.0.0') || '0.0.0'
  } catch {
    return '0.0.0'
  }
}

async function fetchGithubJson(
  url: string,
  timeoutMs = 5_000
): Promise<{ ok: true; json: unknown } | { ok: false; message: string }> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), timeoutMs)
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'hanye-printer-monitor-update-check'
      }
    })
    clearTimeout(t)
    if (!res.ok) {
      return { ok: false, message: `GitHub HTTP ${res.status}` }
    }
    return { ok: true, json: await res.json() }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/abort|timeout/i.test(msg)) {
      return { ok: false, message: '连接 GitHub API 超时（api.github.com）' }
    }
    return { ok: false, message: '无法连接 GitHub API（api.github.com）' }
  }
}

/** When api.github.com is blocked/DNS-broken, use git over github.com (often still works). */
async function latestTagViaGitRemote(): Promise<
  { ok: true; tag: string } | { ok: false; message: string }
> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['ls-remote', '--refs', '--tags', `${GITHUB_REPO_URL}.git`],
      {
        timeout: 30_000,
        maxBuffer: 2 * 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
      }
    )
    const tags: string[] = []
    for (const line of String(stdout || '').split('\n')) {
      const m = line.match(/refs\/tags\/([^\s^{]+)\s*$/)
      if (m?.[1]) tags.push(m[1])
    }
    if (!tags.length) {
      return { ok: false, message: '已连通 github.com，但仓库尚无 tag' }
    }
    tags.sort((a, b) => compareVersions(a, b))
    return { ok: true, tag: tags[tags.length - 1]! }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/abort|timeout|ETIMEDOUT|ENOTFOUND|EAI_AGAIN/i.test(msg)) {
      return { ok: false, message: 'git 访问 github.com 失败（超时/DNS）' }
    }
    return { ok: false, message: 'git ls-remote 失败，请确认服务器可访问 github.com' }
  }
}

/** Parse releases.atom on github.com (no api.github.com). */
async function latestTagViaAtom(): Promise<
  { ok: true; tag: string; url?: string } | { ok: false; message: string }
> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 15_000)
    const res = await fetch(`${GITHUB_REPO_URL}/releases.atom`, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'hanye-printer-monitor-update-check', Accept: 'application/atom+xml' }
    })
    clearTimeout(t)
    if (!res.ok) return { ok: false, message: `releases.atom HTTP ${res.status}` }
    const xml = await res.text()
    const entry = xml.match(/<entry[\s\S]*?<\/entry>/i)
    if (!entry) return { ok: false, message: 'releases.atom 无正式 Release（可仅用 tag）' }
    const title = entry[0].match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim()
    const link = entry[0].match(/<link[^>]*href="([^"]+)"/i)?.[1]
    const tag = title ? title.replace(/^v/i, '').includes('.') ? (title.match(/v?\d[\w.-]*/)?.[0] || title) : title : null
    if (!tag) return { ok: false, message: 'releases.atom 无法解析版本' }
    return { ok: true, tag, url: link }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, message: /abort|timeout/i.test(msg) ? '读取 releases.atom 超时' : '无法读取 releases.atom' }
  }
}

export async function checkGithubUpdate(opts?: {
  currentVersion?: string
  force?: boolean
}): Promise<UpdateCheckResult> {
  const now = Date.now()
  if (!opts?.force && lastCheck && now - lastCheck.at < CHECK_CACHE_MS) {
    return { ...lastCheck.result, cached: true }
  }

  const currentVersion = normalizeVersion(opts?.currentVersion || readLocalPackageVersion())
  const checkedAt = new Date().toISOString()
  const failNotes: string[] = []

  let latestTag: string | null = null
  let releaseUrl: string | null = GITHUB_RELEASES_URL
  let releaseNotes: string | null = null

  const release = await fetchGithubJson(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`
  )
  if (release.ok && release.json && typeof release.json === 'object') {
    const j = release.json as {
      tag_name?: string
      html_url?: string
      body?: string
    }
    if (j.tag_name) {
      latestTag = j.tag_name
      releaseUrl = j.html_url || releaseUrl
      releaseNotes = typeof j.body === 'string' ? j.body.slice(0, 2000) : null
    }
  } else if (!release.ok) {
    failNotes.push(release.message)
  }

  if (!latestTag) {
    const tags = await fetchGithubJson(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/tags?per_page=20`
    )
    if (tags.ok && tags.json && Array.isArray(tags.json)) {
      const names = tags.json
        .map((x) => (x && typeof x === 'object' ? (x as { name?: string }).name : null))
        .filter((x): x is string => Boolean(x))
      names.sort((a, b) => compareVersions(a, b))
      latestTag = names[names.length - 1] || null
    } else if (!tags.ok) {
      failNotes.push(tags.message)
    }
  }

  // Fallback: github.com works in many networks where api.github.com DNS fails
  if (!latestTag) {
    const viaGit = await latestTagViaGitRemote()
    if (viaGit.ok) {
      latestTag = viaGit.tag
      releaseUrl = `${GITHUB_REPO_URL}/releases/tag/${viaGit.tag}`
    } else {
      failNotes.push(viaGit.message)
      const viaAtom = await latestTagViaAtom()
      if (viaAtom.ok) {
        latestTag = viaAtom.tag
        releaseUrl = viaAtom.url || `${GITHUB_REPO_URL}/releases`
      } else {
        failNotes.push(viaAtom.message)
      }
    }
  }

  if (!latestTag) {
    const result: UpdateCheckResult = {
      ok: false,
      reachable: false,
      updateAvailable: false,
      currentVersion,
      latestVersion: null,
      latestTag: null,
      releaseUrl: GITHUB_REPO_URL,
      releaseNotes: null,
      checkedAt,
      message:
        failNotes.filter(Boolean).slice(0, 2).join('；') ||
        '检查不到更新：服务器无法访问 GitHub（api.github.com / git）'
    }
    lastCheck = { at: now, result }
    return result
  }

  const latestVersion = normalizeVersion(latestTag)
  const updateAvailable = compareVersions(latestVersion, currentVersion) > 0
  const result: UpdateCheckResult = {
    ok: true,
    reachable: true,
    updateAvailable,
    currentVersion,
    latestVersion,
    latestTag,
    releaseUrl,
    releaseNotes,
    checkedAt,
    message: updateAvailable
      ? `发现新版本 v${latestVersion}（当前 v${currentVersion}）`
      : `已是最新版本 v${currentVersion}`
  }
  lastCheck = { at: now, result }
  return result
}

function findGitRoot(start = process.cwd()): string | null {
  let dir = start
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, '.git'))) return dir
    const parent = join(dir, '..')
    if (parent === dir) break
    dir = parent
  }
  return null
}

async function runGit(cwd: string, args: string[]): Promise<{ ok: boolean; out: string }> {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd,
      timeout: 120_000,
      maxBuffer: 2 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
    })
    return { ok: true, out: `${stdout || ''}${stderr || ''}`.trim() }
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string }
    return {
      ok: false,
      out: `${err.stderr || ''}${err.stdout || ''}${err.message || ''}`.trim() || 'git 失败'
    }
  }
}

export async function applyGithubSourceUpdate(opts?: {
  currentVersion?: string
}): Promise<UpdateApplyResult> {
  const currentVersion = normalizeVersion(opts?.currentVersion || readLocalPackageVersion())
  const check = await checkGithubUpdate({ currentVersion, force: true })
  if (!check.reachable) {
    return {
      ok: false,
      reachable: false,
      updated: false,
      currentVersion,
      latestVersion: check.latestVersion,
      message: check.message || '无法连接 GitHub，请确认网络后再试'
    }
  }

  const root = findGitRoot()
  if (!root) {
    return {
      ok: false,
      reachable: true,
      updated: false,
      currentVersion,
      latestVersion: check.latestVersion,
      message: '当前部署目录不是 git 仓库，无法自动拉源码。请手动 git clone/pull 后重新构建。'
    }
  }

  const fetch = await runGit(root, ['fetch', '--tags', 'origin'])
  if (!fetch.ok) {
    return {
      ok: false,
      reachable: false,
      updated: false,
      currentVersion,
      latestVersion: check.latestVersion,
      message: '拉取失败：请确认能否访问 GitHub（git fetch origin）',
      log: fetch.out
    }
  }

  const ref = await runGit(root, ['rev-parse', '--abbrev-ref', 'HEAD'])
  const branch = ref.ok && ref.out && ref.out !== 'HEAD' ? ref.out.trim() : 'main'
  const pull = await runGit(root, ['pull', '--ff-only', 'origin', branch])
  if (!pull.ok && branch !== 'main') {
    const pullMain = await runGit(root, ['pull', '--ff-only', 'origin', 'main'])
    if (!pullMain.ok) {
      return {
        ok: false,
        reachable: true,
        updated: false,
        currentVersion,
        latestVersion: check.latestVersion,
        message: '源码更新失败（可能有本地未提交改动或非快进）。请到服务器手动处理 git pull。',
        log: `${pull.out}\n${pullMain.out}`.trim()
      }
    }
    const ver = readLocalPackageVersion(root)
    return {
      ok: true,
      reachable: true,
      updated: true,
      currentVersion: ver,
      latestVersion: check.latestVersion,
      message: `源码已更新到 v${ver}。请执行 npm run build 并重启服务后生效。`,
      log: pullMain.out
    }
  }
  if (!pull.ok) {
    return {
      ok: false,
      reachable: true,
      updated: false,
      currentVersion,
      latestVersion: check.latestVersion,
      message: '源码更新失败（可能有本地未提交改动或非快进）。请到服务器手动处理 git pull。',
      log: pull.out
    }
  }

  const ver = readLocalPackageVersion(root)
  return {
    ok: true,
    reachable: true,
    updated: true,
    currentVersion: ver,
    latestVersion: check.latestVersion,
    message: `源码已更新到 v${ver}。请执行 npm run build 并重启服务后生效。`,
    log: pull.out
  }
}
