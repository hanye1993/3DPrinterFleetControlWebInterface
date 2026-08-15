/**
 * GitHub release check + apply update (git pull 或下载源码包)。
 * Docker：更新挂载的宿主机源码目录（UPDATE_GIT_ROOT=/host-repo），再提示重建镜像。
 */
import { execFile } from 'child_process'
import { promisify } from 'util'
import {
  existsSync,
  readFileSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  cpSync,
  mkdtempSync,
  readdirSync,
  statSync
} from 'fs'
import { join, dirname } from 'path'
import { tmpdir } from 'os'
import { unzipSync } from 'fflate'

const execFileAsync = promisify(execFile)

export const GITHUB_OWNER = 'hanye1993'
export const GITHUB_REPO = '3DPrinterFleetControlWebInterface'
export const GITHUB_REPO_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}`
export const GITHUB_RELEASES_URL = `${GITHUB_REPO_URL}/releases`

const CHECK_CACHE_MS = 24 * 60 * 60 * 1000

export type DeployMode = 'docker' | 'source'

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
  deployMode: DeployMode
  canApplyUpdate: boolean
  updateRoot: string | null
}

export type UpdateApplyResult = {
  ok: boolean
  reachable: boolean
  updated: boolean
  currentVersion: string
  latestVersion: string | null
  message: string
  log?: string
  deployMode: DeployMode
  needsRebuild?: boolean
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

export function isDockerDeploy(): boolean {
  if (process.env.RUNNING_IN_DOCKER === '1' || process.env.RUNNING_IN_DOCKER === 'true') return true
  if (existsSync('/.dockerenv')) return true
  if (String(process.env.UPDATE_GIT_ROOT || '').trim()) return true
  return false
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

/** Writable host/source tree used for Soft Settings update */
export function resolveUpdateRoot(): string | null {
  const envRoot = String(process.env.UPDATE_GIT_ROOT || '').trim()
  if (envRoot && existsSync(envRoot) && existsSync(join(envRoot, 'package.json'))) {
    return envRoot
  }
  if (existsSync('/host-repo/package.json')) return '/host-repo'
  const git = findGitRoot()
  if (git) return git
  if (existsSync(join(process.cwd(), 'package.json')) && existsSync(join(process.cwd(), 'src'))) {
    return process.cwd()
  }
  return null
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
    const tag = title
      ? title.replace(/^v/i, '').includes('.')
        ? title.match(/v?\d[\w.-]*/)?.[0] || title
        : title
      : null
    if (!tag) return { ok: false, message: 'releases.atom 无法解析版本' }
    return { ok: true, tag, url: link }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return {
      ok: false,
      message: /abort|timeout/i.test(msg) ? '读取 releases.atom 超时' : '无法读取 releases.atom'
    }
  }
}

function dockerHint(needsRebuild: boolean): string {
  if (!needsRebuild) return ''
  return (
    ' Docker 部署：源码已写到宿主机目录后，请到飞牛 Docker 项目点「重新构建并启动」' +
    '（或在宿主机 docker/ 目录执行：docker compose -f docker-compose.fnos.yml up -d --build）。'
  )
}

export async function checkGithubUpdate(opts?: {
  currentVersion?: string
  force?: boolean
}): Promise<UpdateCheckResult> {
  const now = Date.now()
  if (!opts?.force && lastCheck && now - lastCheck.at < CHECK_CACHE_MS) {
    return { ...lastCheck.result, cached: true }
  }

  const deployMode: DeployMode = isDockerDeploy() ? 'docker' : 'source'
  const updateRoot = resolveUpdateRoot()
  const canApplyUpdate = Boolean(updateRoot)

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
        '检查不到更新：服务器无法访问 GitHub（api.github.com / git）',
      deployMode,
      canApplyUpdate,
      updateRoot
    }
    lastCheck = { at: now, result }
    return result
  }

  const latestVersion = normalizeVersion(latestTag)
  const updateAvailable = compareVersions(latestVersion, currentVersion) > 0
  let message = updateAvailable
    ? `发现新版本 v${latestVersion}（当前 v${currentVersion}）`
    : `已是最新版本 v${currentVersion}`
  if (updateAvailable && deployMode === 'docker' && !canApplyUpdate) {
    message +=
      '。当前容器未挂载宿主机源码（UPDATE_GIT_ROOT=/host-repo），无法在设置里一键更新；请更新 compose 后重建，或手动替换源码再构建。'
  } else if (updateAvailable && deployMode === 'docker') {
    message += '。点「更新」会下载源码到宿主机目录，然后请重新构建 Docker 镜像。'
  }

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
    message,
    deployMode,
    canApplyUpdate,
    updateRoot
  }
  lastCheck = { at: now, result }
  return result
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

function shouldPreserveRel(rel: string): boolean {
  const n = rel.replace(/\\/g, '/').replace(/^\.\//, '')
  if (n === 'data' || n.startsWith('data/')) return true
  if (n === 'docker/.env' || n === '.env') return true
  if (n === 'node_modules' || n.startsWith('node_modules/')) return true
  if (n === '.git' || n.startsWith('.git/')) return true
  return false
}

async function downloadAndExtractTag(tag: string, destRoot: string): Promise<{ ok: boolean; log: string }> {
  const tagName = tag.startsWith('v') ? tag : `v${tag}`
  const urls = [
    `https://codeload.github.com/${GITHUB_OWNER}/${GITHUB_REPO}/zip/refs/tags/${tagName}`,
    `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/archive/refs/tags/${tagName}.zip`
  ]
  let buf: Uint8Array | null = null
  const notes: string[] = []
  for (const url of urls) {
    try {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), 180_000)
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: { 'User-Agent': 'hanye-printer-monitor-update-apply', Accept: 'application/zip' },
        redirect: 'follow'
      })
      clearTimeout(t)
      if (!res.ok) {
        notes.push(`${url} → HTTP ${res.status}`)
        continue
      }
      buf = new Uint8Array(await res.arrayBuffer())
      notes.push(`downloaded ${url} (${buf.byteLength} bytes)`)
      break
    } catch (e) {
      notes.push(`${url} → ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  if (!buf) {
    return { ok: false, log: notes.join('\n') || '下载源码包失败' }
  }

  const tmp = mkdtempSync(join(tmpdir(), 'hanye-upd-'))
  try {
    const files = unzipSync(buf)
    for (const [name, data] of Object.entries(files)) {
      if (name.endsWith('/')) continue
      const norm = name.replace(/^[/\\]+/, '').replace(/\\/g, '/')
      if (norm.includes('..')) continue
      const out = join(tmp, ...norm.split('/'))
      mkdirSync(dirname(out), { recursive: true })
      writeFileSync(out, data)
    }
    const top = readdirSync(tmp).filter((n) => {
      try {
        return statSync(join(tmp, n)).isDirectory()
      } catch {
        return false
      }
    })
    const srcRoot = top.length === 1 ? join(tmp, top[0]!) : tmp
    if (!existsSync(join(srcRoot, 'package.json'))) {
      return { ok: false, log: `${notes.join('\n')}\n解压后未找到 package.json` }
    }

    mkdirSync(destRoot, { recursive: true })
    cpSync(srcRoot, destRoot, {
      recursive: true,
      force: true,
      filter: (src) => {
        const rel = src.slice(srcRoot.length).replace(/^[/\\]+/, '').replace(/\\/g, '/')
        if (!rel) return true
        return !shouldPreserveRel(rel)
      }
    })
    return { ok: true, log: `${notes.join('\n')}\nextracted → ${destRoot}` }
  } catch (e) {
    return {
      ok: false,
      log: `${notes.join('\n')}\n${e instanceof Error ? e.message : String(e)}`
    }
  } finally {
    try {
      rmSync(tmp, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
}

async function applyViaGit(root: string, check: UpdateCheckResult): Promise<UpdateApplyResult> {
  const deployMode: DeployMode = isDockerDeploy() ? 'docker' : 'source'
  const fetch = await runGit(root, ['fetch', '--tags', 'origin'])
  if (!fetch.ok) {
    const tag = check.latestTag || check.latestVersion
    if (!tag) {
      return {
        ok: false,
        reachable: false,
        updated: false,
        currentVersion: check.currentVersion,
        latestVersion: check.latestVersion,
        message: '拉取失败：请确认能否访问 GitHub（git fetch / 下载源码包）',
        log: fetch.out,
        deployMode
      }
    }
    const arch = await downloadAndExtractTag(tag, root)
    if (!arch.ok) {
      return {
        ok: false,
        reachable: false,
        updated: false,
        currentVersion: check.currentVersion,
        latestVersion: check.latestVersion,
        message: '拉取失败：git 与源码包下载均不可用',
        log: `${fetch.out}\n${arch.log}`.trim(),
        deployMode
      }
    }
    const ver = readLocalPackageVersion(root)
    return {
      ok: true,
      reachable: true,
      updated: true,
      currentVersion: ver,
      latestVersion: check.latestVersion,
      message: `源码已更新到 v${ver}（源码包）。${dockerHint(deployMode === 'docker')}`.trim(),
      log: `${fetch.out}\n${arch.log}`.trim(),
      deployMode,
      needsRebuild: deployMode === 'docker'
    }
  }

  if (check.latestTag) {
    const tag = check.latestTag.startsWith('v') ? check.latestTag : `v${check.latestTag}`
    const co = await runGit(root, ['checkout', '--force', tag])
    if (co.ok) {
      const ver = readLocalPackageVersion(root)
      return {
        ok: true,
        reachable: true,
        updated: true,
        currentVersion: ver,
        latestVersion: check.latestVersion,
        message: `源码已更新到 ${tag}。${
          deployMode === 'docker' ? dockerHint(true) : '请执行 npm run build 并重启服务后生效。'
        }`.trim(),
        log: `${fetch.out}\n${co.out}`.trim(),
        deployMode,
        needsRebuild: deployMode === 'docker'
      }
    }
  }

  const ref = await runGit(root, ['rev-parse', '--abbrev-ref', 'HEAD'])
  const branch = ref.ok && ref.out && ref.out !== 'HEAD' ? ref.out.trim() : 'main'
  let pull = await runGit(root, ['pull', '--ff-only', 'origin', branch])
  if (!pull.ok && branch !== 'main') {
    pull = await runGit(root, ['pull', '--ff-only', 'origin', 'main'])
  }
  if (!pull.ok) {
    return {
      ok: false,
      reachable: true,
      updated: false,
      currentVersion: check.currentVersion,
      latestVersion: check.latestVersion,
      message: '源码更新失败（可能有本地未提交改动或非快进）。请到服务器手动处理。',
      log: pull.out,
      deployMode
    }
  }
  const ver = readLocalPackageVersion(root)
  return {
    ok: true,
    reachable: true,
    updated: true,
    currentVersion: ver,
    latestVersion: check.latestVersion,
    message: `源码已更新到 v${ver}。${
      deployMode === 'docker' ? dockerHint(true) : '请执行 npm run build 并重启服务后生效。'
    }`.trim(),
    log: pull.out,
    deployMode,
    needsRebuild: deployMode === 'docker'
  }
}

export async function applyGithubSourceUpdate(opts?: {
  currentVersion?: string
}): Promise<UpdateApplyResult> {
  const deployMode: DeployMode = isDockerDeploy() ? 'docker' : 'source'
  const currentVersion = normalizeVersion(opts?.currentVersion || readLocalPackageVersion())
  const check = await checkGithubUpdate({ currentVersion, force: true })
  if (!check.reachable) {
    return {
      ok: false,
      reachable: false,
      updated: false,
      currentVersion,
      latestVersion: check.latestVersion,
      message: check.message || '无法连接 GitHub，请确认网络后再试',
      deployMode
    }
  }

  const root = resolveUpdateRoot()
  if (!root) {
    return {
      ok: false,
      reachable: true,
      updated: false,
      currentVersion,
      latestVersion: check.latestVersion,
      message:
        deployMode === 'docker'
          ? 'Docker 镜像内没有可写源码目录。请使用新版 compose（挂载 ..:/host-repo 并设置 UPDATE_GIT_ROOT），重建后再点更新；或在宿主机手动替换源码后重新构建。'
          : '当前部署目录不是可更新的源码目录。请用 git clone 部署，或设置 UPDATE_GIT_ROOT。',
      deployMode
    }
  }

  if (existsSync(join(root, '.git'))) {
    return applyViaGit(root, check)
  }

  const tag = check.latestTag || check.latestVersion
  if (!tag) {
    return {
      ok: false,
      reachable: true,
      updated: false,
      currentVersion,
      latestVersion: check.latestVersion,
      message: '没有可用的版本标签，无法下载源码包',
      deployMode
    }
  }

  const arch = await downloadAndExtractTag(tag, root)
  if (!arch.ok) {
    return {
      ok: false,
      reachable: false,
      updated: false,
      currentVersion,
      latestVersion: check.latestVersion,
      message: '下载/解压源码包失败：请确认服务器能访问 github.com / codeload.github.com',
      log: arch.log,
      deployMode
    }
  }

  const ver = readLocalPackageVersion(root)
  return {
    ok: true,
    reachable: true,
    updated: true,
    currentVersion: ver,
    latestVersion: check.latestVersion,
    message: `源码已更新到 v${ver}（ZIP 解压，已保留 data/ 与 docker/.env）。${dockerHint(
      deployMode === 'docker'
    )}`.trim(),
    log: arch.log,
    deployMode,
    needsRebuild: deployMode === 'docker'
  }
}
