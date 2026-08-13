import { existsSync, readFileSync, statSync } from 'fs'
import { extname, join, normalize, resolve } from 'path'
import type { ServerResponse } from 'http'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.map': 'application/json'
}

let cachedRoot: string | null | undefined

/** Resolve bundled web UI (dist/web). */
export function resolveWebClientRoot(): string | null {
  if (cachedRoot !== undefined) return cachedRoot
  const here = typeof __dirname !== 'undefined' ? __dirname : process.cwd()
  const candidates = [
    join(process.cwd(), 'dist/web'),
    join(process.cwd(), 'out/web-app'),
    // dist/server/main/api → ../../web
    join(here, '../../web'),
    join(here, '../web'),
    join(here, '../../web-app'),
    join(here, '../web-app')
  ]
  for (const dir of candidates) {
    if (existsSync(join(dir, 'index.html'))) {
      cachedRoot = resolve(dir)
      return cachedRoot
    }
  }
  cachedRoot = null
  return null
}

function safeFilePath(root: string, urlPath: string): string | null {
  let rel = urlPath.replace(/\\/g, '/').split('?')[0] || '/'
  if (rel === '/' || rel === '') rel = '/index.html'
  if (!rel.startsWith('/')) rel = `/${rel}`
  const abs = normalize(resolve(root, '.' + rel))
  const rootNorm = normalize(root)
  if (!abs.startsWith(rootNorm)) return null
  if (!existsSync(abs) || !statSync(abs).isFile()) return null
  return abs
}

function serveFile(file: string, res: ServerResponse): void {
  const ext = extname(file).toLowerCase()
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600'
  })
  res.end(readFileSync(file))
}

function serveIndex(root: string, res: ServerResponse): boolean {
  const index = safeFilePath(root, '/index.html')
  if (!index) return false
  serveFile(index, res)
  return true
}

/** Paths without a file extension fall back to index.html (React SPA). */
function isSpaFallbackPath(urlPath: string): boolean {
  const p = (urlPath.split('?')[0] || '/').replace(/\\/g, '/')
  if (p.startsWith('/api')) return false
  const ext = extname(p).toLowerCase()
  return !ext || ext === '.html'
}

/** Serve GET / web UI assets. Returns true if handled. */
export function serveWebStatic(urlPath: string, res: ServerResponse): boolean {
  const root = resolveWebClientRoot()
  if (!root) return false

  const file = safeFilePath(root, urlPath)
  if (file) {
    serveFile(file, res)
    return true
  }

  if (isSpaFallbackPath(urlPath)) {
    return serveIndex(root, res)
  }

  return false
}

export function webClientAvailable(): boolean {
  return resolveWebClientRoot() != null
}
