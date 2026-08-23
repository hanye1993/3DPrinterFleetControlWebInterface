/**
 * GitHub release check + apply update (git pull 或下载源码包)。
 * Docker：把源码写到挂载的宿主机目录（UPDATE_GIT_ROOT=/host-repo），
 * 若已挂载 docker.sock 则自动重建并切换容器（正在跑的镜像不会被 ZIP 直接覆盖）。
 */
import { execFile, spawn } from 'child_process'
import { promisify } from 'util'
import http from 'http'
import {
  existsSync,
  readFileSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  copyFileSync,
  chmodSync,
  renameSync,
  unlinkSync,
  mkdtempSync,
  readdirSync,
  statSync
} from 'fs'
import { join, dirname } from 'path'
import { tmpdir } from 'os'
import { unzipSync } from 'fflate'
import {
  GITHUB_OWNER,
  GITHUB_RELEASES_URL,
  GITHUB_REPO,
  GITHUB_REPO_URL,
  getMirror,
  isUpdateMirrorId,
  listUpdateMirrors,
  readPreferredMirror,
  writePreferredMirror,
  type UpdateMirror,
  type UpdateMirrorId
} from './updateMirrors'

export {
  GITHUB_OWNER,
  GITHUB_REPO,
  GITHUB_REPO_URL,
  GITHUB_RELEASES_URL,
  listUpdateMirrors,
  readPreferredMirror,
  writePreferredMirror,
  isUpdateMirrorId,
  type UpdateMirrorId
}

const execFileAsync = promisify(execFile)

const CHECK_CACHE_MS = 24 * 60 * 60 * 1000
const DOCKER_SOCK = '/var/run/docker.sock'
const UPDATER_NAME = 'hanye-self-updater'

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
  canAutoRebuild: boolean
  updateRoot: string | null
  /** 本次检查使用的镜像 */
  mirror: UpdateMirrorId
  mirrorLabel: string
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
  rebuilding?: boolean
  mirror?: UpdateMirrorId
}

let lastCheckByMirror: Partial<Record<UpdateMirrorId, { at: number; result: UpdateCheckResult }>> =
  {}

let prefsDataRoot: string | null = null

/** 由 Node 服务注入 DATA_ROOT，用于读写用户选择的更新平台 */
export function setUpdatePrefsDataRoot(root: string | null | undefined) {
  prefsDataRoot = root ? String(root) : null
}

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

function dockerSockReady(): boolean {
  return existsSync(DOCKER_SOCK)
}

function autoRebuildEnabled(): boolean {
  const v = String(process.env.HANYE_SKIP_AUTO_REBUILD || '').trim()
  return v !== '1' && v.toLowerCase() !== 'true'
}

function isWritableDir(dir: string): boolean {
  const probe = join(dir, '.hanye-write-test')
  try {
    writeFileSync(probe, 'ok')
    rmSync(probe, { force: true })
    return true
  } catch {
    try {
      rmSync(probe, { force: true })
    } catch {
      /* ignore */
    }
    return false
  }
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

async function fetchMirrorJson(
  url: string,
  mirror: UpdateMirror,
  timeoutMs = 8_000
): Promise<{ ok: true; json: unknown } | { ok: false; message: string }> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), timeoutMs)
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'hanye-printer-monitor-update-check'
      }
    })
    clearTimeout(t)
    if (!res.ok) {
      return { ok: false, message: `${mirror.label} HTTP ${res.status}` }
    }
    return { ok: true, json: await res.json() }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/abort|timeout/i.test(msg)) {
      return { ok: false, message: `连接 ${mirror.hostHint} API 超时` }
    }
    return { ok: false, message: `无法连接 ${mirror.hostHint} API` }
  }
}

async function latestTagViaGitRemote(
  mirror: UpdateMirror
): Promise<{ ok: true; tag: string } | { ok: false; message: string }> {
  try {
    const { stdout } = await execFileAsync('git', ['ls-remote', '--refs', '--tags', mirror.gitUrl], {
      timeout: 30_000,
      maxBuffer: 2 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
    })
    const tags: string[] = []
    for (const line of String(stdout || '').split('\n')) {
      const m = line.match(/refs\/tags\/([^\s^{]+)\s*$/)
      if (m?.[1]) tags.push(m[1])
    }
    if (!tags.length) {
      return { ok: false, message: `已连通 ${mirror.hostHint}，但仓库尚无 tag` }
    }
    tags.sort((a, b) => compareVersions(a, b))
    return { ok: true, tag: tags[tags.length - 1]! }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/abort|timeout|ETIMEDOUT|ENOTFOUND|EAI_AGAIN/i.test(msg)) {
      return { ok: false, message: `git 访问 ${mirror.hostHint} 失败（超时/DNS）` }
    }
    return { ok: false, message: `git ls-remote 失败，请确认服务器可访问 ${mirror.hostHint}` }
  }
}

async function latestTagViaAtom(
  mirror: UpdateMirror
): Promise<{ ok: true; tag: string; url?: string } | { ok: false; message: string }> {
  if (!mirror.atomUrl) return { ok: false, message: `${mirror.label} 无 releases.atom` }
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 15_000)
    const res = await fetch(mirror.atomUrl, {
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

function resolveMirrorId(opts?: { mirror?: string | null }): UpdateMirrorId {
  if (isUpdateMirrorId(opts?.mirror)) return opts.mirror
  return readPreferredMirror(prefsDataRoot)
}

function dockerManualHint(): string {
  return (
    ' 请到 Docker 项目点「重新构建并启动」' +
    '（或在 docker/ 目录执行：docker compose up -d --build）。'
  )
}

export async function checkGithubUpdate(opts?: {
  currentVersion?: string
  force?: boolean
  mirror?: string | null
}): Promise<UpdateCheckResult> {
  const mirrorId = resolveMirrorId(opts)
  const mirror = getMirror(mirrorId)
  const now = Date.now()
  const cached = lastCheckByMirror[mirrorId]
  if (!opts?.force && cached && now - cached.at < CHECK_CACHE_MS) {
    return { ...cached.result, cached: true }
  }

  const deployMode: DeployMode = isDockerDeploy() ? 'docker' : 'source'
  const updateRoot = resolveUpdateRoot()
  const writable = Boolean(updateRoot && isWritableDir(updateRoot))
  const canApplyUpdate = writable
  const canAutoRebuild = deployMode === 'docker' && dockerSockReady() && autoRebuildEnabled()

  const currentVersion = normalizeVersion(opts?.currentVersion || readLocalPackageVersion())
  const checkedAt = new Date().toISOString()
  const failNotes: string[] = []

  let latestTag: string | null = null
  let releaseUrl: string | null = mirror.releasesUrl
  let releaseNotes: string | null = null

  if (mirror.apiReleasesLatest) {
    const release = await fetchMirrorJson(mirror.apiReleasesLatest, mirror)
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
  }

  if (!latestTag) {
    const tags = await fetchMirrorJson(mirror.apiTags, mirror)
    if (tags.ok && tags.json && Array.isArray(tags.json)) {
      const names = tags.json
        .map((x) => (x && typeof x === 'object' ? (x as { name?: string }).name : null))
        .filter((x): x is string => Boolean(x))
      names.sort((a, b) => compareVersions(a, b))
      latestTag = names[names.length - 1] || null
      if (latestTag) {
        releaseUrl = `${mirror.webUrl}/releases/tag/${latestTag.startsWith('v') ? latestTag : `v${latestTag}`}`
      }
    } else if (!tags.ok) {
      failNotes.push(tags.message)
    }
  }

  if (!latestTag) {
    const viaGit = await latestTagViaGitRemote(mirror)
    if (viaGit.ok) {
      latestTag = viaGit.tag
      releaseUrl = `${mirror.webUrl}/releases/tag/${viaGit.tag}`
    } else {
      failNotes.push(viaGit.message)
      const viaAtom = await latestTagViaAtom(mirror)
      if (viaAtom.ok) {
        latestTag = viaAtom.tag
        releaseUrl = viaAtom.url || mirror.releasesUrl
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
      releaseUrl: mirror.webUrl,
      releaseNotes: null,
      checkedAt,
      message:
        failNotes.filter(Boolean).slice(0, 2).join('；') ||
        `检查不到更新：服务器无法访问 ${mirror.hostHint}`,
      deployMode,
      canApplyUpdate,
      canAutoRebuild,
      updateRoot,
      mirror: mirrorId,
      mirrorLabel: mirror.label
    }
    lastCheckByMirror[mirrorId] = { at: now, result }
    return result
  }

  const latestVersion = normalizeVersion(latestTag)
  const updateAvailable = compareVersions(latestVersion, currentVersion) > 0
  let message = updateAvailable
    ? `发现新版本 v${latestVersion}（当前 v${currentVersion}，来源 ${mirror.label}）`
    : `已是最新版本 v${currentVersion}（${mirror.label}）`
  if (updateAvailable && deployMode === 'docker' && !updateRoot) {
    message +=
      '。当前容器未挂载宿主机源码（UPDATE_GIT_ROOT=/host-repo），无法在设置里一键更新；请更新 compose 后重建，或手动替换源码再构建。'
  } else if (updateAvailable && deployMode === 'docker' && !writable) {
    message +=
      '。已挂载源码目录，但容器无法写入（只读挂载或权限不足），所以不能覆盖更新。请检查 /host-repo 挂载权限后重建。'
  } else if (updateAvailable && deployMode === 'docker' && canAutoRebuild) {
    message += '。点「更新」会下载源码并自动重建容器，新版本会替换当前镜像。'
  } else if (updateAvailable && deployMode === 'docker') {
    message +=
      '。点「更新」会下载源码到宿主机；当前未挂载 docker.sock，需手动重新构建镜像后新版本才会进容器。'
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
    canAutoRebuild,
    updateRoot,
    mirror: mirrorId,
    mirrorLabel: mirror.label
  }
  lastCheckByMirror[mirrorId] = { at: now, result }
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
  if (n.endsWith('.hanye-upd-tmp')) return true
  return false
}

function copyFileOverwrite(src: string, dest: string): void {
  mkdirSync(dirname(dest), { recursive: true })
  if (existsSync(dest)) {
    try {
      const st = statSync(dest)
      if (st.isDirectory()) {
        rmSync(dest, { recursive: true, force: true })
      } else {
        try {
          chmodSync(dest, 0o644)
        } catch {
          /* ignore */
        }
        try {
          unlinkSync(dest)
        } catch {
          /* rename 覆盖 */
        }
      }
    } catch {
      /* ignore */
    }
  }
  const tmp = `${dest}.hanye-upd-tmp`
  try {
    copyFileSync(src, tmp)
    try {
      renameSync(tmp, dest)
    } catch {
      try {
        unlinkSync(dest)
      } catch {
        /* ignore */
      }
      renameSync(tmp, dest)
    }
  } finally {
    try {
      if (existsSync(tmp)) unlinkSync(tmp)
    } catch {
      /* ignore */
    }
  }
}

function overlayCopyTree(srcRoot: string, destRoot: string): { ok: boolean; log: string } {
  let copied = 0
  const walk = (srcDir: string, relBase: string) => {
    for (const name of readdirSync(srcDir)) {
      const rel = relBase ? `${relBase}/${name}` : name
      if (shouldPreserveRel(rel)) continue
      const src = join(srcDir, name)
      const dest = join(destRoot, rel)
      let st
      try {
        st = statSync(src)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        mkdirSync(dest, { recursive: true })
        walk(src, rel)
      } else if (st.isFile()) {
        copyFileOverwrite(src, dest)
        copied += 1
      }
    }
  }
  try {
    mkdirSync(destRoot, { recursive: true })
    walk(srcRoot, '')
    if (!existsSync(join(destRoot, 'package.json'))) {
      return { ok: false, log: `覆盖后未找到 package.json（${destRoot}）` }
    }
    return { ok: true, log: `overwrote ${copied} files → ${destRoot}` }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/EACCES|EPERM|EROFS/i.test(msg)) {
      return {
        ok: false,
        log: `无法覆盖写入宿主机源码目录（权限/只读挂载）：${msg}`
      }
    }
    return { ok: false, log: msg }
  }
}

function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

function dockerApi(
  method: string,
  apiPath: string,
  body?: unknown
): Promise<{ status: number; json: unknown; text: string }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body)
    const req = http.request(
      {
        socketPath: DOCKER_SOCK,
        path: apiPath.startsWith('/v1.') ? apiPath : `/v1.41${apiPath}`,
        method,
        headers: payload
          ? {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(payload)
            }
          : undefined
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          let json: unknown = null
          if (text) {
            try {
              json = JSON.parse(text)
            } catch {
              json = null
            }
          }
          resolve({ status: res.statusCode || 0, json, text })
        })
      }
    )
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

function hostRepoFromMountinfo(): string | null {
  try {
    const text = readFileSync('/proc/self/mountinfo', 'utf8')
    for (const line of text.split('\n')) {
      const left = line.split(' - ')[0]
      if (!left) continue
      const fields = left.split(' ')
      if (fields[4] === '/host-repo' && fields[3]) {
        return fields[3]
      }
    }
  } catch {
    /* ignore */
  }
  return null
}

type ComposeCtx = {
  hostRepo: string
  workDir: string
  composeFile: string
  project: string
  image: string
}

type ContainerInspect = {
  Config?: { Image?: string; Labels?: Record<string, string> }
  Mounts?: Array<{ Source?: string; Destination?: string }>
}

async function resolveComposeContext(): Promise<ComposeCtx | null> {
  const names = ['hanye-app', process.env.HOSTNAME || ''].filter(Boolean)
  let inspect: ContainerInspect | null = null
  for (const name of names) {
    try {
      const r = await dockerApi('GET', `/containers/${encodeURIComponent(name)}/json`)
      if (r.status === 200 && r.json && typeof r.json === 'object') {
        inspect = r.json as ContainerInspect
        break
      }
    } catch {
      /* try next */
    }
  }
  const labels = inspect?.Config?.Labels || {}
  const hostRepo =
    inspect?.Mounts?.find((m) => m.Destination === '/host-repo')?.Source ||
    hostRepoFromMountinfo()
  if (!hostRepo) return null

  const workDir = labels['com.docker.compose.project.working_dir'] || join(hostRepo, 'docker')
  const fromLabel = (labels['com.docker.compose.project.config_files'] || '')
    .split(',')[0]
    ?.trim()
  const fromEnv = String(process.env.HANYE_COMPOSE_FILE || '').trim()
  const picked = fromLabel || fromEnv || 'docker-compose.yml'
  const composeFile =
    picked.startsWith('/') || /^[A-Za-z]:[\\/]/.test(picked) ? picked : join(workDir, picked)
  const project = labels['com.docker.compose.project'] || 'docker'
  const image = inspect?.Config?.Image || 'hanye-printer-monitor:latest'
  return { hostRepo, workDir, composeFile, project, image }
}

async function scheduleComposeRebuild(): Promise<{ ok: boolean; log: string }> {
  if (!dockerSockReady()) {
    return { ok: false, log: '未挂载 /var/run/docker.sock，无法自动重建容器' }
  }
  if (!autoRebuildEnabled()) {
    return { ok: false, log: '已设置 HANYE_SKIP_AUTO_REBUILD，跳过自动重建' }
  }
  const ctx = await resolveComposeContext()
  if (!ctx) {
    return { ok: false, log: '无法解析宿主机源码路径 / Compose 项目，无法自动重建' }
  }

  try {
    await dockerApi('DELETE', `/containers/${UPDATER_NAME}?force=1`)
  } catch {
    /* ignore */
  }

  const script = [
    'sleep 8',
    `docker compose -p ${shQuote(ctx.project)} -f ${shQuote(ctx.composeFile)} --project-directory ${shQuote(ctx.workDir)} up -d --build`
  ].join(' && ')

  const create = await dockerApi('POST', `/containers/create?name=${UPDATER_NAME}`, {
    Image: ctx.image,
    Entrypoint: ['/bin/sh', '-c'],
    Cmd: [script],
    WorkingDir: ctx.workDir,
    Env: [
      'DOCKER_HOST=unix:///var/run/docker.sock',
      'DOCKER_CLI_PLUGIN_EXTRA_DIRS=/usr/local/libexec/docker/cli-plugins'
    ],
    HostConfig: {
      Binds: [`${DOCKER_SOCK}:${DOCKER_SOCK}`, `${ctx.hostRepo}:${ctx.hostRepo}`],
      AutoRemove: true,
      RestartPolicy: { Name: 'no' }
    }
  })
  if (create.status !== 201 || !create.json || typeof create.json !== 'object') {
    return {
      ok: false,
      log: `创建重建助手失败 HTTP ${create.status}: ${(create.text || '').slice(0, 400)}`
    }
  }
  const id = (create.json as { Id?: string }).Id
  if (!id) return { ok: false, log: '创建重建助手失败：无容器 ID' }

  const start = await dockerApi('POST', `/containers/${id}/start`)
  if (start.status !== 204 && start.status !== 200) {
    return {
      ok: false,
      log: `启动重建助手失败 HTTP ${start.status}: ${(start.text || '').slice(0, 400)}`
    }
  }
  return {
    ok: true,
    log: `scheduled ${UPDATER_NAME} compose -p ${ctx.project} -f ${ctx.composeFile} in ${ctx.workDir}`
  }
}

async function maybeScheduleDockerRebuild(result: UpdateApplyResult): Promise<UpdateApplyResult> {
  if (!result.ok || !result.updated || !isDockerDeploy()) return result
  try {
    const scheduled = await scheduleComposeRebuild()
    if (scheduled.ok) {
      return {
        ...result,
        needsRebuild: false,
        rebuilding: true,
        message: `源码已更新到 v${result.currentVersion}，正在自动重建并切换容器（约 1～3 分钟）。页面可能会短暂断开，请稍后刷新。`,
        log: `${result.log || ''}\n${scheduled.log}`.trim()
      }
    }
    return {
      ...result,
      needsRebuild: true,
      rebuilding: false,
      message: `源码已更新到 v${result.currentVersion}，但未能自动覆盖当前容器：${scheduled.log}。${dockerManualHint()}`,
      log: `${result.log || ''}\n${scheduled.log}`.trim()
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return {
      ...result,
      needsRebuild: true,
      rebuilding: false,
      message: `源码已更新到 v${result.currentVersion}，自动重建出错：${msg}。${dockerManualHint()}`,
      log: `${result.log || ''}\n${msg}`.trim()
    }
  }
}

function isZipMagic(buf: Uint8Array): boolean {
  // PK\x03\x04 / PK\x05\x06 / PK\x07\x08
  return (
    buf.length >= 4 &&
    buf[0] === 0x50 &&
    buf[1] === 0x4b &&
    (buf[2] === 0x03 || buf[2] === 0x05 || buf[2] === 0x07)
  )
}

function looksLikeHtml(buf: Uint8Array): boolean {
  const head = Buffer.from(buf.subarray(0, Math.min(buf.length, 200)))
    .toString('utf8')
    .trimStart()
    .toLowerCase()
  return head.startsWith('<!doctype') || head.startsWith('<html') || head.includes('<html')
}

async function cloneTagToTemp(
  tagName: string,
  mirror: UpdateMirror
): Promise<{ ok: boolean; srcRoot?: string; tmp?: string; log: string }> {
  const tmp = mkdtempSync(join(tmpdir(), 'hanye-upd-git-'))
  const dest = join(tmp, 'repo')
  const candidates = Array.from(
    new Set([tagName, tagName.replace(/^v/i, ''), `v${tagName.replace(/^v/i, '')}`].filter(Boolean))
  )
  const notes: string[] = []
  for (const branch of candidates) {
    try {
      rmSync(dest, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
    try {
      const { stdout, stderr } = await execFileAsync(
        'git',
        ['clone', '--depth', '1', '--branch', branch, mirror.gitUrl, dest],
        {
          timeout: 180_000,
          maxBuffer: 8 * 1024 * 1024,
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
        }
      )
      const out = `${stdout || ''}${stderr || ''}`.trim()
      if (!existsSync(join(dest, 'package.json'))) {
        notes.push(`git clone ${branch} → 无 package.json\n${out}`)
        continue
      }
      notes.push(`git clone --depth 1 --branch ${branch} ${mirror.gitUrl} ok`)
      return { ok: true, srcRoot: dest, tmp, log: notes.join('\n') }
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string; message?: string }
      notes.push(
        `git clone ${branch} → ${(err.stderr || err.stdout || err.message || '失败').trim()}`
      )
    }
  }
  try {
    rmSync(tmp, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
  return { ok: false, log: notes.join('\n') || `git clone ${mirror.label} 失败` }
}

async function downloadAndExtractTag(
  tag: string,
  destRoot: string,
  mirror: UpdateMirror
): Promise<{ ok: boolean; log: string }> {
  const tagName = tag.startsWith('v') ? tag : `v${tag}`
  const urls = mirror.zipUrls(tagName)
  let buf: Uint8Array | null = null
  const notes: string[] = []
  for (const url of urls) {
    try {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), 180_000)
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (compatible; hanye-printer-monitor-update/4.0; +https://gitee.com)',
          Accept: 'application/zip,application/octet-stream,*/*'
        },
        redirect: 'follow'
      })
      clearTimeout(t)
      if (!res.ok) {
        notes.push(`${url} → HTTP ${res.status}`)
        continue
      }
      const next = new Uint8Array(await res.arrayBuffer())
      const ctype = String(res.headers.get('content-type') || '')
      if (!isZipMagic(next) || looksLikeHtml(next) || /text\/html/i.test(ctype)) {
        notes.push(
          `${url} → 非 ZIP（${ctype || 'unknown'}, ${next.byteLength} bytes；Gitee/GitCode 常返回网页反爬页）`
        )
        continue
      }
      buf = next
      notes.push(`downloaded zip ${url} (${buf.byteLength} bytes)`)
      break
    } catch (e) {
      notes.push(`${url} → ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  if (buf) {
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
        notes.push('解压后未找到 package.json，改试 git clone')
      } else {
        const overlay = overlayCopyTree(srcRoot, destRoot)
        if (!overlay.ok) {
          return { ok: false, log: `${notes.join('\n')}\n${overlay.log}` }
        }
        return { ok: true, log: `${notes.join('\n')}\n${overlay.log}` }
      }
    } catch (e) {
      notes.push(`解压失败：${e instanceof Error ? e.message : String(e)}，改试 git clone`)
    } finally {
      try {
        rmSync(tmp, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    }
  } else {
    notes.push(`ZIP 不可用，改用 git clone（${mirror.label}）`)
  }

  const cloned = await cloneTagToTemp(tagName, mirror)
  notes.push(cloned.log)
  if (!cloned.ok || !cloned.srcRoot) {
    return {
      ok: false,
      log:
        notes.join('\n') ||
        `下载 ${mirror.label} 源码失败（ZIP 与 git clone 均不可用）`
    }
  }
  try {
    const overlay = overlayCopyTree(cloned.srcRoot, destRoot)
    if (!overlay.ok) {
      return { ok: false, log: `${notes.join('\n')}\n${overlay.log}` }
    }
    return { ok: true, log: `${notes.join('\n')}\n${overlay.log}` }
  } finally {
    if (cloned.tmp) {
      try {
        rmSync(cloned.tmp, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    }
  }
}

function clearGitIndexLock(root: string): void {
  try {
    rmSync(join(root, '.git', 'index.lock'), { force: true })
  } catch {
    /* ignore */
  }
}

async function applyViaGit(root: string, check: UpdateCheckResult): Promise<UpdateApplyResult> {
  const deployMode: DeployMode = isDockerDeploy() ? 'docker' : 'source'
  const mirror = getMirror(check.mirror || resolveMirrorId())
  const fail = (
    ok: boolean,
    reachable: boolean,
    message: string,
    log?: string
  ): UpdateApplyResult => ({
    ok,
    reachable,
    updated: false,
    currentVersion: check.currentVersion,
    latestVersion: check.latestVersion,
    message,
    log,
    deployMode,
    mirror: mirror.id
  })

  const zipFallback = async (reason: string): Promise<UpdateApplyResult> => {
    const tag = check.latestTag || check.latestVersion
    if (!tag) {
      return fail(false, true, reason, reason)
    }
    const arch = await downloadAndExtractTag(tag, root, mirror)
    if (!arch.ok) {
      return fail(false, false, `${reason}；源码包覆盖也失败`, `${reason}\n${arch.log}`)
    }
    const ver = readLocalPackageVersion(root)
    return {
      ok: true,
      reachable: true,
      updated: true,
      currentVersion: ver,
      latestVersion: check.latestVersion,
      message: `源码已更新到 v${ver}（${mirror.label} 源码包，已保留 data/ 与 docker/.env）。`,
      log: `${reason}\n${arch.log}`.trim(),
      deployMode,
      needsRebuild: deployMode === 'docker',
      mirror: mirror.id
    }
  }

  clearGitIndexLock(root)
  const fetch = await runGit(root, ['fetch', '--tags', mirror.gitUrl])
  if (!fetch.ok) {
    return zipFallback(`git fetch（${mirror.label}）失败，改用源码包覆盖：${fetch.out}`)
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
        message: `源码已更新到 ${tag}（${mirror.label}）。${
          deployMode === 'docker' ? '' : '请执行 npm run build 并重启服务后生效。'
        }`.trim(),
        log: `${fetch.out}\n${co.out}`.trim(),
        deployMode,
        needsRebuild: deployMode === 'docker',
        mirror: mirror.id
      }
    }
    return zipFallback(`git checkout ${tag} 无法覆盖本地文件，改用源码包：${co.out}`)
  }

  const ref = await runGit(root, ['rev-parse', '--abbrev-ref', 'HEAD'])
  const branch = ref.ok && ref.out && ref.out !== 'HEAD' ? ref.out.trim() : 'main'
  let pull = await runGit(root, ['pull', '--ff-only', mirror.gitUrl, branch])
  if (!pull.ok && branch !== 'main') {
    pull = await runGit(root, ['pull', '--ff-only', mirror.gitUrl, 'main'])
  }
  if (!pull.ok) {
    return zipFallback(`git pull 非快进/无法覆盖，改用源码包：${pull.out}`)
  }
  const ver = readLocalPackageVersion(root)
  return {
    ok: true,
    reachable: true,
    updated: true,
    currentVersion: ver,
    latestVersion: check.latestVersion,
    message: `源码已更新到 v${ver}（${mirror.label}）。${
      deployMode === 'docker' ? '' : '请执行 npm run build 并重启服务后生效。'
    }`.trim(),
    log: pull.out,
    deployMode,
    needsRebuild: deployMode === 'docker',
    mirror: mirror.id
  }
}

async function maybeRunSourceRebuild(result: UpdateApplyResult): Promise<UpdateApplyResult> {
  if (!result.ok || !result.updated || result.deployMode !== 'source' || result.rebuilding) {
    return result
  }
  const script = '/home/hanye/update-hanye.sh'
  if (!existsSync(script)) {
    return {
      ...result,
      needsRebuild: true,
      message: `${result.message} 请 SSH 到 NAS 执行 /home/hanye/update-hanye.sh（或 npm run build 后重启服务）。`
    }
  }
  try {
    const child = spawn(script, [], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, HANYE_SKIP_BOOT_SLEEP: '1' }
    })
    child.unref()
    return {
      ...result,
      needsRebuild: false,
      rebuilding: true,
      message: `源码已更新到 v${result.currentVersion}，正在后台执行 update-hanye.sh 构建并重启（约 1～3 分钟）。`,
      log: `${result.log || ''}\nspawn ${script}`.trim()
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return {
      ...result,
      needsRebuild: true,
      message: `${result.message} 未能自动执行 update-hanye.sh：${msg}`,
      log: `${result.log || ''}\n${msg}`.trim()
    }
  }
}

export async function applyGithubSourceUpdate(opts?: {
  currentVersion?: string
  mirror?: string | null
}): Promise<UpdateApplyResult> {
  const result = await applyGithubSourceUpdateCore(opts)
  const afterDocker = await maybeScheduleDockerRebuild(result)
  return maybeRunSourceRebuild(afterDocker)
}

async function applyGithubSourceUpdateCore(opts?: {
  currentVersion?: string
  mirror?: string | null
}): Promise<UpdateApplyResult> {
  const deployMode: DeployMode = isDockerDeploy() ? 'docker' : 'source'
  const mirrorId = resolveMirrorId(opts)
  const mirror = getMirror(mirrorId)
  const currentVersion = normalizeVersion(opts?.currentVersion || readLocalPackageVersion())
  const check = await checkGithubUpdate({ currentVersion, force: true, mirror: mirrorId })
  if (!check.reachable) {
    return {
      ok: false,
      reachable: false,
      updated: false,
      currentVersion,
      latestVersion: check.latestVersion,
      message: check.message || `无法连接 ${mirror.hostHint}，请确认网络后再试`,
      deployMode,
      mirror: mirrorId
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

  if (deployMode === 'docker' && !isWritableDir(root)) {
    return {
      ok: false,
      reachable: true,
      updated: false,
      currentVersion,
      latestVersion: check.latestVersion,
      message:
        '容器无法写入宿主机源码目录（只读挂载或权限不足），所以不能覆盖更新。请检查 /host-repo 是否可写后重建。',
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
      deployMode,
      mirror: mirrorId
    }
  }

  const arch = await downloadAndExtractTag(tag, root, mirror)
  if (!arch.ok) {
    const perm = /无法覆盖|EACCES|EPERM|EROFS/.test(arch.log)
    const hint = perm
      ? arch.log
      : `从 ${mirror.label} 拉取源码失败：请确认服务器已安装 git，且能访问 ${mirror.hostHint}（浏览器能打开不等于本机服务能下载）`
    return {
      ok: false,
      reachable: false,
      updated: false,
      currentVersion,
      latestVersion: check.latestVersion,
      message: hint,
      log: arch.log,
      deployMode,
      mirror: mirrorId
    }
  }

  const ver = readLocalPackageVersion(root)
  return {
    ok: true,
    reachable: true,
    updated: true,
    currentVersion: ver,
    latestVersion: check.latestVersion,
    message: `源码已更新到 v${ver}（${mirror.label} ZIP，已保留 data/ 与 docker/.env）。`,
    log: arch.log,
    deployMode,
    needsRebuild: deployMode === 'docker',
    mirror: mirrorId
  }
}
