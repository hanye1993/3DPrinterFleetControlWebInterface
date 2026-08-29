/**
 * Spoolman REST API v1 客户端（默认端口 7912）
 * 文档：https://donkie.github.io/Spoolman/
 */
export type SpoolmanSpool = {
  id: number
  remaining_weight?: number | null
  initial_weight?: number | null
  used_weight?: number | null
  spool_weight?: number | null
  archived?: boolean
  comment?: string | null
  location?: string | null
  lot_nr?: string | null
  last_used?: string | null
  registered?: string | null
  filament?: {
    id?: number
    name?: string | null
    material?: string | null
    color_hex?: string | null
    density?: number | null
    diameter?: number | null
    weight?: number | null
    vendor?: { id?: number; name?: string | null } | null
  } | null
}

export type SpoolmanFilament = {
  id: number
  name?: string | null
  material?: string | null
  color_hex?: string | null
  density?: number | null
  diameter?: number | null
  weight?: number | null
  vendor_id?: number | null
  vendor?: { id?: number; name?: string | null } | null
}

function trimBase(url: string): string {
  return String(url || '')
    .trim()
    .replace(/\/+$/, '')
}

function apiRoot(baseUrl: string): string {
  const b = trimBase(baseUrl)
  if (!b) return ''
  if (/\/api\/v1$/i.test(b)) return b
  return `${b}/api/v1`
}

async function smFetch<T>(
  baseUrl: string,
  path: string,
  init?: RequestInit & { timeoutMs?: number }
): Promise<{ ok: true; data: T } | { ok: false; message: string }> {
  const root = apiRoot(baseUrl)
  if (!root) return { ok: false, message: '请填写 Spoolman 地址' }
  const timeoutMs = init?.timeoutMs ?? 20000
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const { timeoutMs: _t, ...rest } = init || {}
    const res = await fetch(`${root}${path}`, {
      ...rest,
      signal: ctrl.signal,
      headers: {
        Accept: 'application/json',
        ...(rest.body ? { 'Content-Type': 'application/json' } : {}),
        ...(rest.headers || {})
      }
    })
    const text = await res.text()
    let data: unknown = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      data = text
    }
    if (!res.ok) {
      const msg =
        data && typeof data === 'object' && data !== null && 'message' in data
          ? String((data as { message: unknown }).message)
          : `HTTP ${res.status}`
      return { ok: false, message: msg }
    }
    return { ok: true, data: data as T }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/abort/i.test(msg)) return { ok: false, message: '连接 Spoolman 超时' }
    return { ok: false, message: msg || '无法连接 Spoolman' }
  } finally {
    clearTimeout(t)
  }
}

export async function spoolmanHealth(baseUrl: string) {
  return smFetch<{ status?: string }>(baseUrl, '/health', { method: 'GET', timeoutMs: 8000 })
}

export async function spoolmanListSpools(baseUrl: string, opts?: { allowArchived?: boolean }) {
  const q = opts?.allowArchived ? '?allow_archived=true' : ''
  return smFetch<SpoolmanSpool[]>(baseUrl, `/spool${q}`, { method: 'GET' })
}

export async function spoolmanListFilaments(baseUrl: string) {
  return smFetch<SpoolmanFilament[]>(baseUrl, '/filament', { method: 'GET' })
}

export async function spoolmanListVendors(baseUrl: string) {
  return smFetch<Array<{ id: number; name?: string }>>(baseUrl, '/vendor', { method: 'GET' })
}

export async function spoolmanEnsureVendor(baseUrl: string, name: string) {
  const n = String(name || '').trim() || 'Other'
  const listed = await spoolmanListVendors(baseUrl)
  if (!listed.ok) return listed
  const hit = listed.data.find((v) => String(v.name || '').toLowerCase() === n.toLowerCase())
  if (hit) return { ok: true as const, id: hit.id }
  const created = await smFetch<{ id: number }>(baseUrl, '/vendor', {
    method: 'POST',
    body: JSON.stringify({ name: n })
  })
  if (!created.ok) return created
  return { ok: true as const, id: created.data.id }
}

export async function spoolmanEnsureFilament(
  baseUrl: string,
  opts: {
    vendorName: string
    material: string
    colorHex: string
    name?: string
    weight?: number
  }
) {
  const material = String(opts.material || '').trim() || 'PLA'
  const hex = String(opts.colorHex || '')
    .replace(/^#/, '')
    .slice(0, 6)
    .toUpperCase()
  const vendor = await spoolmanEnsureVendor(baseUrl, opts.vendorName)
  if (!vendor.ok) return vendor
  const listed = await spoolmanListFilaments(baseUrl)
  if (!listed.ok) return listed
  const hit = listed.data.find((f) => {
    const vName = String(f.vendor?.name || '').toLowerCase()
    const mat = String(f.material || '').toLowerCase()
    const color = String(f.color_hex || '')
      .replace(/^#/, '')
      .toUpperCase()
    return (
      vName === String(opts.vendorName || '').toLowerCase() &&
      mat === material.toLowerCase() &&
      color === hex
    )
  })
  if (hit) return { ok: true as const, id: hit.id }
  const body = {
    name: opts.name || `${opts.vendorName} ${material} #${hex}`,
    material,
    color_hex: hex,
    vendor_id: vendor.id,
    density: 1.24,
    diameter: 1.75,
    weight: Math.max(1, Number(opts.weight) || 1000)
  }
  const created = await smFetch<{ id: number }>(baseUrl, '/filament', {
    method: 'POST',
    body: JSON.stringify(body)
  })
  if (!created.ok) return created
  return { ok: true as const, id: created.data.id }
}

export async function spoolmanCreateSpool(
  baseUrl: string,
  body: {
    filament_id: number
    remaining_weight: number
    initial_weight?: number
    location?: string
    comment?: string
  }
) {
  return smFetch<SpoolmanSpool>(baseUrl, '/spool', {
    method: 'POST',
    body: JSON.stringify(body)
  })
}

export async function spoolmanUpdateSpool(
  baseUrl: string,
  id: number,
  body: Record<string, unknown>
) {
  return smFetch<SpoolmanSpool>(baseUrl, `/spool/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body)
  })
}

export function normalizeSpoolmanBaseUrl(raw: string): string {
  let u = String(raw || '').trim()
  if (!u) return ''
  if (!/^https?:\/\//i.test(u)) u = `http://${u}`
  return u.replace(/\/+$/, '')
}
