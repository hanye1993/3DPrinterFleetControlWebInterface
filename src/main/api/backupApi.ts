/**
 * Admin backup export/import of curated DATA_ROOT JSON files + quote gcode.
 */
import type { IncomingMessage, ServerResponse } from 'http'
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { unzipSync, zipSync, strToU8 } from 'fflate'
import type { AuthContext } from '../auth/authApi'
import { effectivePermissions, hasPerm } from '../../shared/permissions'

type SendJson = (res: ServerResponse, status: number, body: unknown) => void
type ReadBody = (req: IncomingMessage) => Promise<string>

const BACKUP_FILES = [
  'app-settings.json',
  'devices.json',
  'filament-spools.json',
  'filament-backend.json',
  'filament-bambu-overlay.json',
  'filament-sync-sources.json',
  'filament-sync-pairs.json',
  'users.json',
  'user-groups.json',
  'nav-config.json',
  'monitor-zones.json',
  'plugins-state.json',
  'themes-state.json',
  'plugin-notices.json',
  'update-mirror.json',
  'market-auth.json',
  'market-licenses.json',
  'quote-history.json',
  'quote-schemes.json',
  'print-requests.json',
  'print-requests.jsonl',
  'alert-history.json'
] as const

const OPTIONAL_SECRET_FILES = ['secrets.json'] as const

function requireAdmin(
  auth: AuthContext | null | undefined,
  res: ServerResponse,
  sendJson: SendJson
): boolean {
  if (!auth || auth.kind === 'local') return true
  if (auth.kind === 'user') {
    if (auth.user.level === 'admin') return true
    if (hasPerm(effectivePermissions(auth.user), '*')) return true
  }
  sendJson(res, 403, { ok: false, message: '仅管理员可备份 / 恢复' })
  return false
}

function dataRootFromDeps(getFilamentPath: () => string): string {
  return dirname(resolve(getFilamentPath()))
}

function collectDirFiles(
  root: string,
  relDir: string,
  out: Array<{ name: string; data: Uint8Array }>,
  opts?: { ext?: string }
): void {
  const abs = join(root, relDir)
  if (!existsSync(abs) || !statSync(abs).isDirectory()) return
  for (const ent of readdirSync(abs)) {
    if (ent.startsWith('.')) continue
    const fp = join(abs, ent)
    if (!statSync(fp).isFile()) continue
    if (opts?.ext && !ent.endsWith(opts.ext)) continue
    out.push({
      name: `${relDir.replace(/\/$/, '')}/${ent}`,
      data: new Uint8Array(readFileSync(fp))
    })
  }
}

function collectFiles(
  root: string,
  includeSecrets: boolean
): Array<{ name: string; data: Uint8Array }> {
  const names: string[] = [...BACKUP_FILES]
  if (includeSecrets) names.push(...OPTIONAL_SECRET_FILES)
  const out: Array<{ name: string; data: Uint8Array }> = []
  for (const name of names) {
    const p = join(root, name)
    if (!existsSync(p) || !statSync(p).isFile()) continue
    out.push({ name, data: new Uint8Array(readFileSync(p)) })
  }
  collectDirFiles(root, 'plugin-data', out, { ext: '.json' })
  // Quote scheme gcode payloads referenced by quote-schemes.json
  collectDirFiles(root, 'quote-schemes', out, { ext: '.gcode' })
  return out
}

function isAllowedBackupPath(norm: string): boolean {
  if (BACKUP_FILES.includes(norm as (typeof BACKUP_FILES)[number])) return true
  if ((OPTIONAL_SECRET_FILES as readonly string[]).includes(norm)) return true
  if (norm.startsWith('plugin-data/') && norm.endsWith('.json') && !norm.includes('..')) return true
  if (norm.startsWith('quote-schemes/') && norm.endsWith('.gcode') && !norm.includes('..')) {
    return true
  }
  return false
}

function sendZip(res: ServerResponse, filename: string, buf: Uint8Array): void {
  res.writeHead(200, {
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Content-Length': String(buf.byteLength),
    'Cache-Control': 'no-store'
  })
  res.end(Buffer.from(buf))
}

export async function handleBackupApi(opts: {
  method: string
  path: string
  url: URL
  req: IncomingMessage
  res: ServerResponse
  auth?: AuthContext | null
  getFilamentPath: () => string
  sendJson: SendJson
  readBody: ReadBody
  /** Reload in-memory stores after successful import */
  onImported?: (written: string[]) => void | Promise<void>
}): Promise<boolean> {
  const { method, path, url, req, res, auth, getFilamentPath, sendJson, readBody, onImported } =
    opts
  if (!path.startsWith('/api/v1/backup')) return false
  if (!requireAdmin(auth, res, sendJson)) return true

  const root = dataRootFromDeps(getFilamentPath)

  if (method === 'GET' && path === '/api/v1/backup/export') {
    const includeSecrets = url.searchParams.get('includeSecrets') === '1'
    const files = collectFiles(root, includeSecrets)
    const manifest = {
      version: 2,
      createdAt: new Date().toISOString(),
      includeSecrets,
      files: files.map((f) => f.name)
    }
    const zipObj: Record<string, Uint8Array> = {
      'manifest.json': strToU8(JSON.stringify(manifest, null, 2))
    }
    for (const f of files) zipObj[f.name] = f.data
    const zipped = zipSync(zipObj, { level: 6 })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    sendZip(res, `hanye-backup-${stamp}.zip`, zipped)
    return true
  }

  if (method === 'POST' && path === '/api/v1/backup/import') {
    const raw = await readBody(req)
    let body: { zipBase64?: string; confirm?: boolean } = {}
    try {
      body = raw ? (JSON.parse(raw) as typeof body) : {}
    } catch {
      sendJson(res, 400, { ok: false, message: 'Invalid JSON' })
      return true
    }
    if (!body.confirm) {
      sendJson(res, 400, { ok: false, message: '请确认覆盖导入（confirm: true）' })
      return true
    }
    const b64 = String(body.zipBase64 || '').replace(/^data:.*?;base64,/, '').trim()
    if (!b64) {
      sendJson(res, 400, { ok: false, message: '缺少 zipBase64' })
      return true
    }
    let buf: Uint8Array
    try {
      buf = new Uint8Array(Buffer.from(b64, 'base64'))
    } catch {
      sendJson(res, 400, { ok: false, message: 'zipBase64 无效' })
      return true
    }
    let unzipped: Record<string, Uint8Array>
    try {
      unzipped = unzipSync(buf)
    } catch (e) {
      sendJson(res, 400, {
        ok: false,
        message: `解压失败：${e instanceof Error ? e.message : String(e)}`
      })
      return true
    }
    const written: string[] = []
    for (const [name, data] of Object.entries(unzipped)) {
      const norm = name.replace(/^[/\\]+/, '').replace(/\\/g, '/')
      if (norm === 'manifest.json' || norm.endsWith('/')) continue
      if (norm.includes('..')) continue
      if (!isAllowedBackupPath(norm)) continue
      const dest = join(root, norm)
      if (!dest.startsWith(root)) continue
      mkdirSync(dirname(dest), { recursive: true })
      writeFileSync(dest, Buffer.from(data))
      written.push(norm)
    }
    if (!written.length) {
      sendJson(res, 400, { ok: false, message: '备份包中没有可导入的配置文件' })
      return true
    }
    let reloadOk = false
    try {
      await onImported?.(written)
      reloadOk = true
    } catch {
      reloadOk = false
    }
    sendJson(res, 200, {
      ok: true,
      written,
      reloaded: reloadOk,
      message: reloadOk
        ? `已导入 ${written.length} 个文件，设置/用户/设备已热加载。插件与主题建议刷新页面；若仍异常请重启服务。`
        : `已导入 ${written.length} 个文件。请刷新页面；若状态未更新请重启服务。`
    })
    return true
  }

  return false
}
