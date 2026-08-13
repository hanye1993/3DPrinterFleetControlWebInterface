/**
 * Bambu LAN FTPS (:990) file list / upload / download for plugin + host deviceOp.
 */
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { Client, type FileInfo } from 'basic-ftp'

export type BambuFileEntry = { path: string; size: number; modified?: number }

async function withBambuFtp<T>(
  host: string,
  accessCode: string,
  fn: (client: Client) => Promise<T>
): Promise<T> {
  const h = String(host || '').trim()
  const code = String(accessCode || '').trim()
  if (!h) throw new Error('缺少打印机 IP')
  if (!code) throw new Error('缺少访问码')
  const client = new Client(60_000)
  client.ftp.verbose = false
  try {
    await client.access({
      host: h,
      port: 990,
      user: 'bblp',
      password: code,
      secure: 'implicit',
      secureOptions: { rejectUnauthorized: false }
    })
    return await fn(client)
  } finally {
    try {
      client.close()
    } catch {
      /* ignore */
    }
  }
}

function mapListing(list: FileInfo[], prefix: string): BambuFileEntry[] {
  const out: BambuFileEntry[] = []
  for (const f of list) {
    if (f.name === '.' || f.name === '..') continue
    const path = prefix ? `${prefix.replace(/\/$/, '')}/${f.name}` : f.name
    if (f.isDirectory) continue
    out.push({
      path,
      size: Number(f.size) || 0,
      modified: f.modifiedAt ? Math.floor(f.modifiedAt.getTime() / 1000) : undefined
    })
  }
  return out
}

export async function bambuListFiles(opts: {
  host: string
  accessCode: string
  dirs?: string[]
}): Promise<BambuFileEntry[]> {
  const dirs = opts.dirs?.length ? opts.dirs : ['', 'cache', 'sdcard']
  return withBambuFtp(opts.host, opts.accessCode, async (client) => {
    const all: BambuFileEntry[] = []
    const seen = new Set<string>()
    for (const dir of dirs) {
      try {
        if (dir) await client.cd('/')
        const list = dir ? await client.list(dir) : await client.list()
        for (const e of mapListing(list, dir)) {
          if (seen.has(e.path)) continue
          seen.add(e.path)
          all.push(e)
        }
      } catch {
        /* dir may not exist */
      }
    }
    return all.sort((a, b) => (b.modified || 0) - (a.modified || 0))
  })
}

export async function bambuUploadFile(opts: {
  host: string
  accessCode: string
  filename: string
  content: Buffer
  /** remote dir; default cache */
  remoteDir?: string
}): Promise<{ remotePath: string }> {
  const name = String(opts.filename || 'upload.gcode.3mf').replace(/^\/+/, '').split('/').pop()!
  const remoteDir = (opts.remoteDir || 'cache').replace(/^\/+|\/+$/g, '')
  const remotePath = `${remoteDir}/${name}`
  const workDir = join(tmpdir(), `pm-bambu-up-${randomUUID()}`)
  mkdirSync(workDir, { recursive: true })
  const local = join(workDir, name)
  try {
    writeFileSync(local, opts.content)
    await withBambuFtp(opts.host, opts.accessCode, async (client) => {
      try {
        await client.ensureDir(remoteDir)
      } catch {
        /* ignore */
      }
      await client.uploadFrom(local, remotePath)
    })
    return { remotePath }
  } finally {
    try {
      rmSync(workDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
}

export async function bambuDownloadFile(opts: {
  host: string
  accessCode: string
  remotePath: string
}): Promise<{ filename: string; content: Buffer }> {
  const remote = String(opts.remotePath || '').replace(/^\/+/, '')
  if (!remote) throw new Error('缺少远程路径')
  const workDir = join(tmpdir(), `pm-bambu-dl-${randomUUID()}`)
  mkdirSync(workDir, { recursive: true })
  const filename = remote.split('/').pop() || 'download.bin'
  const local = join(workDir, filename)
  try {
    await withBambuFtp(opts.host, opts.accessCode, async (client) => {
      await client.downloadTo(local, remote)
    })
    if (!existsSync(local)) throw new Error('下载失败')
    return { filename, content: readFileSync(local) }
  } finally {
    try {
      rmSync(workDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
}
