import type { IncomingMessage, ServerResponse } from 'http'
import { existsSync, readFileSync, statSync } from 'fs'
import { basename, join, resolve } from 'path'
import { docsRootCandidates } from '../../shared/repoLayout'

type SendJson = (res: ServerResponse, status: number, body: unknown) => void

const ALLOWED_MD = new Set([
  'PLUGIN.md',
  'PLUGIN_KERNEL_V2.md',
  'THEME.md',
  'NODE_DEPLOY.md',
  'MYSQL.md',
  'BAOTA.md'
])
const ALLOWED_DOWNLOADS = new Set([
  'hanye-theme-sample-topnav.zip',
  'hanye-plugin-sample-hello.zip',
  'hanye-plugin-kernel-v2.zip'
])

function docsRoot(): string {
  const candidates = docsRootCandidates(__dirname)
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  return candidates[0]
}

function sendFile(
  res: ServerResponse,
  full: string,
  contentType: string,
  downloadName?: string
): void {
  const data = readFileSync(full)
  const headers: Record<string, string | number> = {
    'Content-Type': contentType,
    'Content-Length': data.length,
    'Cache-Control': 'no-cache',
    'Access-Control-Allow-Origin': '*'
  }
  if (downloadName) {
    headers['Content-Disposition'] = `attachment; filename="${downloadName}"`
  }
  res.writeHead(200, headers)
  res.end(data)
}

/** Docs markdown + sample download ZIP for settings UI / THEME.md links. */
export async function handleDocsApi(opts: {
  method: string
  path: string
  res: ServerResponse
  sendJson: SendJson
}): Promise<boolean> {
  const { method, path, res, sendJson } = opts
  if (method !== 'GET') return false

  const dl = path.match(/^\/api\/v1\/docs\/downloads\/([A-Za-z0-9_.-]+)$/)
  if (dl) {
    const name = dl[1]
    if (!ALLOWED_DOWNLOADS.has(name)) {
      sendJson(res, 404, { ok: false, message: '下载文件不存在' })
      return true
    }
    const root = resolve(docsRoot())
    const full = resolve(root, 'downloads', name)
    if (!full.startsWith(resolve(root, 'downloads')) || !existsSync(full) || !statSync(full).isFile()) {
      sendJson(res, 404, { ok: false, message: '文件未找到' })
      return true
    }
    sendFile(res, full, 'application/zip', basename(name))
    return true
  }

  const m = path.match(/^\/api\/v1\/docs\/([A-Za-z0-9_.-]+\.md)$/)
  if (!m) return false
  const name = m[1]
  if (!ALLOWED_MD.has(name)) {
    sendJson(res, 404, { ok: false, message: '文档不存在' })
    return true
  }
  const root = resolve(docsRoot())
  const full = resolve(root, name)
  if (!full.startsWith(root) || !existsSync(full)) {
    sendJson(res, 404, { ok: false, message: '文档文件未找到（请确认仓库 docs/ 已部署）' })
    return true
  }
  sendFile(res, full, 'text/markdown; charset=utf-8')
  return true
}
