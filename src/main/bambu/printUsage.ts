import { mkdirSync, readFileSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { Client } from 'basic-ftp'
import { unzipSync } from 'fflate'

export type BambuPrintUsageResult =
  | { ok: true; grams: number; source: string; path?: string }
  | { ok: false; message: string }

/**
 * Download current job file from printer FTPS (:990) and parse filament grams
 * from 3MF plate metadata or G-code comments.
 */
export async function fetchBambuPrintUsageGrams(opts: {
  host: string
  accessCode: string
  /** MQTT gcode_file / subtask path hint */
  gcodeFile?: string
  filename?: string
}): Promise<BambuPrintUsageResult> {
  const host = String(opts.host || '').trim()
  const code = String(opts.accessCode || '').trim()
  if (!host) return { ok: false, message: '缺少打印机 IP' }
  if (!code) return { ok: false, message: '缺少访问码' }

  const candidates = buildPathCandidates(opts.gcodeFile, opts.filename)
  if (!candidates.length) {
    return { ok: false, message: '无任务文件名，无法拉取用量' }
  }

  const workDir = join(tmpdir(), `pm-bambu-usage-${randomUUID()}`)
  mkdirSync(workDir, { recursive: true })
  const client = new Client(25_000)
  client.ftp.verbose = false

  try {
    await client.access({
      host,
      port: 990,
      user: 'bblp',
      password: code,
      secure: 'implicit',
      secureOptions: { rejectUnauthorized: false }
    })

    let lastErr = ''
    for (const remote of candidates) {
      const local = join(workDir, safeLocalName(remote))
      try {
        await client.downloadTo(local, remote)
        if (!existsSync(local)) continue
        const buf = readFileSync(local)
        const parsed = parseUsageFromBuffer(buf, remote)
        if (parsed) {
          return { ok: true, grams: parsed.grams, source: parsed.source, path: remote }
        }
        lastErr = `已下载 ${remote} 但未解析到用量`
      } catch (err) {
        lastErr = err instanceof Error ? err.message : String(err)
      }
    }
    return { ok: false, message: lastErr || '无法从打印机下载任务文件' }
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err)
    }
  } finally {
    try {
      client.close()
    } catch {
      /* ignore */
    }
    try {
      rmSync(workDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
}

function safeLocalName(remote: string): string {
  return remote.replace(/[\\/:*?"<>|]+/g, '_').replace(/^\.+/, '') || 'job.bin'
}

function buildPathCandidates(gcodeFile?: string, filename?: string): string[] {
  const raw = [gcodeFile, filename].filter(Boolean).map((s) => String(s).trim())
  const out: string[] = []
  const push = (p: string) => {
    const n = p.replace(/\\/g, '/').replace(/^\/+/, '')
    if (!n || out.includes(n)) return
    out.push(n)
    if (!n.startsWith('cache/') && !n.startsWith('sdcard/')) {
      out.push(`cache/${n}`)
      out.push(`sdcard/${n}`)
    }
  }
  for (const r of raw) {
    push(r)
    const base = r.split('/').pop()
    if (base && base !== r) push(base)
    if (base && !/\.3mf$/i.test(base) && !/\.gcode$/i.test(base)) {
      push(`${base}.gcode.3mf`)
      push(`${base}.3mf`)
    }
  }
  return out
}

function parseUsageFromBuffer(
  buf: Buffer,
  pathHint: string
): { grams: number; source: string } | null {
  const lower = pathHint.toLowerCase()
  if (buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b) {
    try {
      const files = unzipSync(new Uint8Array(buf))
      let best: number | null = null
      for (const [name, data] of Object.entries(files)) {
        const text = Buffer.from(data).toString('utf8')
        const g = parsePlateWeightXml(text) ?? parseGcodeFilamentComments(text)
        if (g != null && g > 0) {
          if (/plate_\d+\.gcode$/i.test(name) || /slice_info/i.test(name)) {
            return { grams: g, source: `3mf:${name}` }
          }
          if (best == null || g > best) best = g
        }
      }
      if (best != null) return { grams: best, source: '3mf' }
    } catch {
      /* fall through */
    }
  }

  const text = buf.toString('utf8')
  const fromXml = parsePlateWeightXml(text)
  if (fromXml != null) return { grams: fromXml, source: 'xml' }
  const fromGc = parseGcodeFilamentComments(text)
  if (fromGc != null) return { grams: fromGc, source: lower.endsWith('.gcode') ? 'gcode' : 'text' }
  return null
}

function parsePlateWeightXml(text: string): number | null {
  const weightMeta = text.match(/<metadata\s+key="weight"\s+value="([\d.]+)"/i)
  if (weightMeta) {
    const n = Number(weightMeta[1])
    if (Number.isFinite(n) && n > 0) return Math.round(n * 100) / 100
  }
  let sum = 0
  let found = false
  const re = /used_g="([\d.]+)"/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const n = Number(m[1])
    if (Number.isFinite(n) && n > 0) {
      sum += n
      found = true
    }
  }
  return found ? Math.round(sum * 100) / 100 : null
}

function parseGcodeFilamentComments(text: string): number | null {
  if (!text) return null
  const lines = String(text).split(/\r?\n/)
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    const total = line.match(/;\s*total filament used \[g\]\s*=\s*([\d.]+)/i)
    if (total) {
      const n = Number(total[1])
      if (Number.isFinite(n) && n > 0) return Math.round(n * 100) / 100
    }
  }
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    const multi = line.match(/;\s*filament used \[g\]\s*=\s*([\d.,\s]+)/i)
    if (multi) {
      let sum = 0
      let any = false
      for (const part of multi[1].split(/[,\s]+/)) {
        if (!part) continue
        const n = Number(part)
        if (Number.isFinite(n) && n > 0) {
          sum += n
          any = true
        }
      }
      if (any) return Math.round(sum * 100) / 100
    }
  }
  const patterns = [
    /;\s*filament used\s*[:=]\s*([\d.]+)\s*g\b/i,
    /;\s*filament_weight(?:_g)?\s*[:=]\s*([\d.]+)/i,
    /;\s*total filament weight \[g\]\s*[:=]\s*([\d.]+)/i
  ]
  for (let i = lines.length - 1; i >= 0; i--) {
    for (const re of patterns) {
      const m = lines[i].match(re)
      if (!m) continue
      const n = Number(m[1])
      if (Number.isFinite(n) && n > 0) return Math.round(n * 100) / 100
    }
  }
  return null
}
