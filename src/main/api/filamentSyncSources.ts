/**
 * 本地耗材库 ↔ 最多 3 个外部耗材库（目前支持 Spoolman）同步
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { randomUUID } from 'crypto'
import { filamentSyncMatchKey, rollsFromTotalGrams } from '../../shared/spoolCatalog'
import {
  normalizeSpoolmanBaseUrl,
  spoolmanCreateSpool,
  spoolmanEnsureFilament,
  spoolmanHealth,
  spoolmanListSpools,
  spoolmanUpdateSpool,
  type SpoolmanSpool
} from '../filament/spoolmanClient'

export const MAX_FILAMENT_SYNC_SOURCES = 3

export type FilamentSyncSourceType = 'none' | 'spoolman'

export type FilamentSyncDirection = 'pull' | 'push' | 'mutual'

export type FilamentSyncSource = {
  /** slot-1 / slot-2 / slot-3 */
  id: string
  type: FilamentSyncSourceType
  enabled: boolean
  name: string
  /** Spoolman base URL，如 http://192.168.1.10:7912 */
  baseUrl: string
  direction: FilamentSyncDirection
}

export type FilamentSyncSourcesState = {
  sources: FilamentSyncSource[]
}

type SpoolLike = Record<string, unknown>

type SyncPairsFile = {
  /** sourceId → { localSpoolId → remoteSpoolId } */
  pairs: Record<string, Record<string, string>>
}

type Deps = {
  filamentPath: string
}

function defaultSources(): FilamentSyncSource[] {
  return [1, 2, 3].map((n) => ({
    id: `slot-${n}`,
    type: 'none' as const,
    enabled: false,
    name: `耗材库 ${n}`,
    baseUrl: '',
    direction: 'mutual' as const
  }))
}

function sourcesPath(filamentPath: string) {
  return join(dirname(filamentPath), 'filament-sync-sources.json')
}

function pairsPath(filamentPath: string) {
  return join(dirname(filamentPath), 'filament-sync-pairs.json')
}

function readJson<T>(p: string, fallback: T): T {
  try {
    if (!existsSync(p)) return fallback
    return JSON.parse(readFileSync(p, 'utf8')) as T
  } catch {
    return fallback
  }
}

function writeJson(p: string, data: unknown) {
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify(data, null, 2), 'utf8')
}

function normalizeSource(raw: Partial<FilamentSyncSource>, index: number): FilamentSyncSource {
  const id = String(raw.id || `slot-${index + 1}`)
  const type: FilamentSyncSourceType = raw.type === 'spoolman' ? 'spoolman' : 'none'
  const direction: FilamentSyncDirection =
    raw.direction === 'pull' || raw.direction === 'push' || raw.direction === 'mutual'
      ? raw.direction
      : 'mutual'
  return {
    id,
    type,
    enabled: Boolean(raw.enabled) && type !== 'none',
    name: String(raw.name || `耗材库 ${index + 1}`).trim() || `耗材库 ${index + 1}`,
    baseUrl: type === 'spoolman' ? normalizeSpoolmanBaseUrl(String(raw.baseUrl || '')) : '',
    direction
  }
}

export function getFilamentSyncSources(deps: Deps): FilamentSyncSourcesState {
  const raw = readJson<{ sources?: Partial<FilamentSyncSource>[] }>(sourcesPath(deps.filamentPath), {
    sources: []
  })
  const list = Array.isArray(raw.sources) ? raw.sources : []
  const out = defaultSources().map((def, i) => normalizeSource(list[i] || def, i))
  return { sources: out.slice(0, MAX_FILAMENT_SYNC_SOURCES) }
}

export function setFilamentSyncSources(
  deps: Deps,
  sources: Partial<FilamentSyncSource>[]
): FilamentSyncSourcesState {
  const next = defaultSources().map((def, i) => normalizeSource(sources[i] || def, i))
  writeJson(sourcesPath(deps.filamentPath), { sources: next })
  return { sources: next }
}

function readLocal(deps: Deps): SpoolLike[] {
  try {
    if (!existsSync(deps.filamentPath)) return []
    const raw = JSON.parse(readFileSync(deps.filamentPath, 'utf8')) as unknown
    return Array.isArray(raw) ? (raw as SpoolLike[]) : []
  } catch {
    return []
  }
}

function writeLocal(deps: Deps, spools: SpoolLike[]) {
  mkdirSync(dirname(deps.filamentPath), { recursive: true })
  writeFileSync(deps.filamentPath, JSON.stringify(spools, null, 2), 'utf8')
}

function readPairs(deps: Deps): SyncPairsFile {
  const j = readJson<SyncPairsFile>(pairsPath(deps.filamentPath), { pairs: {} })
  return { pairs: j.pairs && typeof j.pairs === 'object' ? j.pairs : {} }
}

function writePairs(deps: Deps, pairs: SyncPairsFile) {
  writeJson(pairsPath(deps.filamentPath), pairs)
}

function asMatchInput(s: SpoolLike) {
  return {
    brandId: s.brandId != null ? String(s.brandId) : undefined,
    vendor: s.vendor != null ? String(s.vendor) : undefined,
    brandName: s.brandName != null ? String(s.brandName) : undefined,
    material: s.material != null ? String(s.material) : undefined,
    colorHex: s.colorHex != null ? String(s.colorHex) : undefined,
    tech: s.tech != null ? String(s.tech) : 'fdm'
  }
}

function isSyncable(s: SpoolLike): boolean {
  if (s.archived) return false
  if (String(s.tech || 'fdm') === 'resin') return false
  return Boolean(filamentSyncMatchKey(asMatchInput(s)))
}

function hexOf(s: string | null | undefined): string {
  return String(s || '')
    .replace(/^#/, '')
    .slice(0, 6)
    .toUpperCase()
}

function spoolmanToLocal(sm: SpoolmanSpool, sourceId: string): SpoolLike {
  const vendor = String(sm.filament?.vendor?.name || 'other').trim() || 'other'
  const material = String(sm.filament?.material || 'PLA').trim() || 'PLA'
  const hex = hexOf(sm.filament?.color_hex)
  const total = Math.max(
    1,
    Number(sm.initial_weight) || Number(sm.filament?.weight) || Number(sm.remaining_weight) || 1000
  )
  const remain = Math.max(0, Number(sm.remaining_weight != null ? sm.remaining_weight : total) || 0)
  const now = new Date().toISOString()
  return {
    id: randomUUID(),
    brandId: vendor.toLowerCase().replace(/\s+/g, '_').slice(0, 32) || 'other',
    brandName: vendor,
    vendor,
    material,
    color: material,
    colorHex: hex ? `#${hex}` : '#888888',
    totalGrams: total,
    remainGrams: remain,
    rolls: rollsFromTotalGrams(total),
    location: sm.location || '',
    notes: sm.comment || '',
    tech: 'fdm',
    archived: Boolean(sm.archived),
    createdAt: sm.registered || now,
    updatedAt: sm.last_used || now,
    pluginData: {
      spoolman: {
        sourceId,
        spoolId: sm.id,
        filamentId: sm.filament?.id ?? null
      }
    }
  }
}

function vendorNameOf(local: SpoolLike): string {
  return String(local.vendor || local.brandName || local.brandId || 'Other').trim() || 'Other'
}

export async function testFilamentSyncSource(
  deps: Deps,
  sourceId: string
): Promise<{ ok: boolean; message: string }> {
  const src = getFilamentSyncSources(deps).sources.find((s) => s.id === sourceId)
  if (!src) return { ok: false, message: '槽位不存在' }
  if (src.type !== 'spoolman' || !src.baseUrl) return { ok: false, message: '请先配置 Spoolman 地址' }
  const r = await spoolmanHealth(src.baseUrl)
  if (!r.ok) return { ok: false, message: r.message }
  return { ok: true, message: 'Spoolman 连接正常' }
}

export type SyncOneResult = {
  ok: boolean
  sourceId: string
  name: string
  message: string
  pushed: number
  pulled: number
  updated: number
  skipped: number
}

async function syncSpoolmanOne(deps: Deps, src: FilamentSyncSource): Promise<SyncOneResult> {
  const empty: SyncOneResult = {
    ok: false,
    sourceId: src.id,
    name: src.name,
    message: '',
    pushed: 0,
    pulled: 0,
    updated: 0,
    skipped: 0
  }
  if (!src.baseUrl) return { ...empty, message: '未填写 Spoolman 地址' }

  const listed = await spoolmanListSpools(src.baseUrl, { allowArchived: false })
  if (!listed.ok) return { ...empty, message: listed.message }

  const remote = (listed.data || []).filter((s) => !s.archived)
  const localAll = readLocal(deps)
  const localFdm = localAll.filter(isSyncable)
  const pairsFile = readPairs(deps)
  const pairs = { ...(pairsFile.pairs[src.id] || {}) }
  const usedRemote = new Set<string>()

  let pushed = 0
  let pulled = 0
  let updated = 0
  let skipped = 0
  let localMut = [...localAll]

  const remoteByKey = new Map<string, SpoolmanSpool[]>()
  for (const rs of remote) {
    const key = filamentSyncMatchKey({
      vendor: rs.filament?.vendor?.name || undefined,
      material: rs.filament?.material || undefined,
      colorHex: rs.filament?.color_hex ? `#${hexOf(rs.filament.color_hex)}` : undefined,
      tech: 'fdm'
    })
    if (!key) {
      skipped++
      continue
    }
    const arr = remoteByKey.get(key) || []
    arr.push(rs)
    remoteByKey.set(key, arr)
  }

  const findRemote = (local: SpoolLike): SpoolmanSpool | null => {
    const lid = String(local.id || '')
    const pd = local.pluginData as { spoolman?: { sourceId?: string; spoolId?: number } } | undefined
    if (pd?.spoolman?.sourceId === src.id && pd.spoolman.spoolId != null) {
      const hit = remote.find((x) => Number(x.id) === Number(pd.spoolman!.spoolId))
      if (hit && !usedRemote.has(String(hit.id))) return hit
    }
    const paired = pairs[lid]
    if (paired) {
      const hit = remote.find((x) => String(x.id) === paired)
      if (hit && !usedRemote.has(String(hit.id))) return hit
    }
    const key = filamentSyncMatchKey(asMatchInput(local))
    if (!key) return null
    const cands = (remoteByKey.get(key) || []).filter((x) => !usedRemote.has(String(x.id)))
    if (!cands.length) return null
    const localRemain = Number(local.remainGrams) || 0
    cands.sort(
      (a, b) =>
        Math.abs(Number(a.remaining_weight) - localRemain) -
        Math.abs(Number(b.remaining_weight) - localRemain)
    )
    return cands[0] || null
  }

  const doPush = src.direction === 'push' || src.direction === 'mutual'
  const doPull = src.direction === 'pull' || src.direction === 'mutual'

  if (doPush) {
    for (const local of localFdm) {
      const lid = String(local.id || '')
      const remoteHit = findRemote(local)
      if (remoteHit) {
        usedRemote.add(String(remoteHit.id))
        pairs[lid] = String(remoteHit.id)
        const remain = Number(local.remainGrams)
        const total = Number(local.totalGrams)
        const patch: Record<string, unknown> = {}
        if (Number.isFinite(remain)) patch.remaining_weight = remain
        if (Number.isFinite(total) && total > 0) patch.initial_weight = total
        if (local.location) patch.location = String(local.location)
        if (Object.keys(patch).length) {
          const up = await spoolmanUpdateSpool(src.baseUrl, remoteHit.id, patch)
          if (up.ok) updated++
          else skipped++
        }
        continue
      }
      const fil = await spoolmanEnsureFilament(src.baseUrl, {
        vendorName: vendorNameOf(local),
        material: String(local.material || 'PLA'),
        colorHex: String(local.colorHex || '#888888'),
        weight: Number(local.totalGrams) || 1000
      })
      if (!fil.ok) {
        skipped++
        continue
      }
      const created = await spoolmanCreateSpool(src.baseUrl, {
        filament_id: fil.id,
        remaining_weight: Number(local.remainGrams) || Number(local.totalGrams) || 1000,
        initial_weight: Number(local.totalGrams) || 1000,
        location: local.location ? String(local.location) : undefined,
        comment: local.notes ? String(local.notes) : undefined
      })
      if (!created.ok) {
        skipped++
        continue
      }
      pairs[lid] = String(created.data.id)
      const idx = localMut.findIndex((x) => String(x.id) === lid)
      if (idx >= 0) {
        const prevPd =
          localMut[idx].pluginData && typeof localMut[idx].pluginData === 'object'
            ? (localMut[idx].pluginData as Record<string, unknown>)
            : {}
        localMut[idx] = {
          ...localMut[idx],
          pluginData: {
            ...prevPd,
            spoolman: { sourceId: src.id, spoolId: created.data.id, filamentId: fil.id }
          },
          updatedAt: new Date().toISOString()
        }
      }
      pushed++
    }
  }

  if (doPull) {
    for (const rs of remote) {
      if (usedRemote.has(String(rs.id))) continue
      const key = filamentSyncMatchKey({
        vendor: rs.filament?.vendor?.name || undefined,
        material: rs.filament?.material || undefined,
        colorHex: rs.filament?.color_hex ? `#${hexOf(rs.filament.color_hex)}` : undefined,
        tech: 'fdm'
      })
      if (!key) {
        skipped++
        continue
      }
      // already paired?
      const pairedLocalId = Object.entries(pairs).find(([, rid]) => rid === String(rs.id))?.[0]
      if (pairedLocalId) {
        const idx = localMut.findIndex((x) => String(x.id) === pairedLocalId)
        if (idx >= 0) {
          const remain = Number(rs.remaining_weight)
          const total = Number(rs.initial_weight) || Number(rs.filament?.weight) || undefined
          localMut[idx] = {
            ...localMut[idx],
            remainGrams: Number.isFinite(remain)
              ? remain
              : localMut[idx].remainGrams,
            ...(total && Number.isFinite(total) ? { totalGrams: total, rolls: rollsFromTotalGrams(total) } : {}),
            updatedAt: new Date().toISOString()
          }
          updated++
        }
        usedRemote.add(String(rs.id))
        continue
      }
      const localNew = spoolmanToLocal(rs, src.id)
      localMut.push(localNew)
      pairs[String(localNew.id)] = String(rs.id)
      usedRemote.add(String(rs.id))
      pulled++
    }
  }

  writeLocal(deps, localMut)
  const allPairs = readPairs(deps)
  allPairs.pairs[src.id] = pairs
  writePairs(deps, allPairs)

  return {
    ok: true,
    sourceId: src.id,
    name: src.name,
    message: `推送 ${pushed}，拉取 ${pulled}，更新 ${updated}，跳过 ${skipped}`,
    pushed,
    pulled,
    updated,
    skipped
  }
}

export async function syncFilamentSource(
  deps: Deps,
  sourceId: string
): Promise<SyncOneResult> {
  const src = getFilamentSyncSources(deps).sources.find((s) => s.id === sourceId)
  if (!src) {
    return {
      ok: false,
      sourceId,
      name: '',
      message: '槽位不存在',
      pushed: 0,
      pulled: 0,
      updated: 0,
      skipped: 0
    }
  }
  if (!src.enabled || src.type === 'none') {
    return {
      ok: false,
      sourceId: src.id,
      name: src.name,
      message: '该槽位未启用',
      pushed: 0,
      pulled: 0,
      updated: 0,
      skipped: 0
    }
  }
  if (src.type === 'spoolman') return syncSpoolmanOne(deps, src)
  return {
    ok: false,
    sourceId: src.id,
    name: src.name,
    message: '不支持的类型',
    pushed: 0,
    pulled: 0,
    updated: 0,
    skipped: 0
  }
}

export async function syncAllFilamentSources(deps: Deps): Promise<{
  ok: boolean
  message: string
  results: SyncOneResult[]
}> {
  const enabled = getFilamentSyncSources(deps).sources.filter((s) => s.enabled && s.type !== 'none')
  if (!enabled.length) {
    return { ok: false, message: '没有已启用的外部耗材库（最多可配置 3 个）', results: [] }
  }
  const results: SyncOneResult[] = []
  for (const src of enabled) {
    results.push(await syncFilamentSource(deps, src.id))
  }
  const okN = results.filter((r) => r.ok).length
  return {
    ok: okN > 0,
    message: `已同步 ${okN}/${results.length} 个耗材库`,
    results
  }
}
