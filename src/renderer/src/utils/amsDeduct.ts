import type { PrinterLiveStatus } from '../types/printer'
import type { SpoolRecord } from '../types/filament'
import { deviceStatusKind } from './statusLabel'
import { useFilamentStore, isLowStock } from '../stores/filamentStore'
import { useSettingsStore } from '../stores/settingsStore'
import { isClientMode, serverGet, serverSend } from '../api/serverClient'
import { findBrand } from '../data/filamentBrands'
import { materialLabel } from '../data/filamentMaterials'
import { spoolBindings } from './spoolBinding'

type SlotRemain = Record<number, number>

type JobTrack = {
  deviceId: string
  deviceName: string
  brand: string
  filename: string
  gcodeFile?: string
  progress: number
  startedAt: number
  remainStart: SlotRemain
  filamentUsedGrams?: number
  deductedKey: string | null
}

const tracks = new Map<string, JobTrack>()
const recentDeductKeys = new Set<string>()
const RECENT_CAP = 80

function snapshotRemains(st: PrinterLiveStatus): SlotRemain {
  const out: SlotRemain = {}
  for (const slot of st.amsSlots || []) {
    if (!slot || !Number.isFinite(slot.id)) continue
    const r = Number(slot.remain)
    if (!Number.isFinite(r)) continue
    out[slot.id] = Math.max(0, Math.min(100, r))
  }
  return out
}

function jobKey(deviceId: string, filename: string, startedAt: number): string {
  return `${deviceId}|${filename || '-'}|${startedAt}`
}

function rememberKey(key: string): void {
  recentDeductKeys.add(key)
  if (recentDeductKeys.size > RECENT_CAP) {
    const first = recentDeductKeys.values().next().value
    if (first != null) recentDeductKeys.delete(first)
  }
}

function boundSpoolsForDevice(deviceId: string): SpoolRecord[] {
  return useFilamentStore
    .getState()
    .spools.filter(
      (s) =>
        !s.archived &&
        spoolBindings(s).some(
          (b) => b.deviceId === deviceId && Number.isFinite(Number(b.slotId)) && Number(b.slotId) >= 0
        )
    )
}

export function onStatusBatchForAmsDeduct(
  batch: Record<string, PrinterLiveStatus>,
  devicesById: Record<string, { id: string; name: string; brand: string }>
): void {
  const settings = useSettingsStore.getState().settings
  if (settings.amsAutoDeduct === false) return

  for (const id of Object.keys(batch)) {
    const st = batch[id]
    const device = devicesById[id]
    if (!device) continue
    const hasBind = boundSpoolsForDevice(id).length > 0
    if (!hasBind && !tracks.has(id)) continue

    const kind = deviceStatusKind(st)
    const prevTrack = tracks.get(id)
    const usedG = Number(st.filamentUsedGrams)
    const progress = Math.max(0, Math.min(100, Number(st.progress) || 0))

    if (kind === 'printing') {
      const remains = snapshotRemains(st)
      if (!prevTrack) {
        tracks.set(id, {
          deviceId: id,
          deviceName: device.name,
          brand: device.brand,
          filename: (st.filename || '').trim(),
          gcodeFile: (st.gcodeFile || '').trim() || undefined,
          progress,
          startedAt: Date.now(),
          remainStart: remains,
          filamentUsedGrams: Number.isFinite(usedG) && usedG > 0 ? usedG : undefined,
          deductedKey: null
        })
      } else {
        const merged = { ...prevTrack.remainStart }
        for (const [k, v] of Object.entries(remains)) {
          const sid = Number(k)
          if (!(sid in merged)) merged[sid] = v
        }
        tracks.set(id, {
          ...prevTrack,
          filename: (st.filename || '').trim() || prevTrack.filename,
          gcodeFile: (st.gcodeFile || '').trim() || prevTrack.gcodeFile,
          progress: progress > 0 ? progress : prevTrack.progress,
          remainStart: Object.keys(prevTrack.remainStart).length ? merged : remains,
          filamentUsedGrams:
            Number.isFinite(usedG) && usedG > 0 ? usedG : prevTrack.filamentUsedGrams
        })
      }
      continue
    }

    if (kind === 'finished' && prevTrack && !prevTrack.deductedKey) {
      const key = jobKey(id, prevTrack.filename, prevTrack.startedAt)
      if (recentDeductKeys.has(key)) {
        tracks.delete(id)
        continue
      }
      const endUsed =
        Number.isFinite(usedG) && usedG > 0 ? usedG : prevTrack.filamentUsedGrams
      const finalTrack = {
        ...prevTrack,
        progress: progress > 0 ? progress : prevTrack.progress || 100,
        gcodeFile: (st.gcodeFile || '').trim() || prevTrack.gcodeFile,
        filename: (st.filename || '').trim() || prevTrack.filename
      }
      void settleDeduct(finalTrack, snapshotRemains(st), key, endUsed)
      tracks.delete(id)
      continue
    }

    if (kind === 'idle' || kind === 'offline' || kind === 'error') {
      tracks.delete(id)
    }
  }
}

async function resolveAutoJobGrams(
  track: JobTrack,
  knownGrams?: number
): Promise<{ grams: number; how: string } | null> {
  if (Number.isFinite(Number(knownGrams)) && Number(knownGrams) > 0) {
    return scaleByProgress(Number(knownGrams), track.progress, '任务用量')
  }

  if (track.brand === 'bambu') {
    const device = useDeviceStore.getState().devices.find((d) => d.id === track.deviceId)
    if (!device || (device.connectionMode || 'lan') !== 'lan' || !device.bambuHost) {
      return null
    }
    if (isClientMode()) {
      try {
        const res = await serverSend<{
          ok: boolean
          grams?: number
          source?: string
          message?: string
        }>(`/api/v1/devices/${encodeURIComponent(track.deviceId)}/bambu/print-usage`, 'POST', {
          gcodeFile: track.gcodeFile,
          filename: track.filename
        })
        if (res.ok && Number(res.grams) > 0) {
          return scaleByProgress(Number(res.grams), track.progress, `自动(${res.source || 'ftps'})`)
        }
      } catch {
        /* server-side FTPS unavailable */
      }
      return null
    }
    const code = device.secretKey
      ? await window.electronAPI?.secrets?.get(device.secretKey)
      : null
    if (!code) return null
    const res = await window.electronAPI?.bambu?.fetchPrintUsage?.({
      host: device.bambuHost,
      accessCode: code,
      gcodeFile: track.gcodeFile,
      filename: track.filename
    })
    if (res && 'ok' in res && res.ok && res.grams > 0) {
      return scaleByProgress(res.grams, track.progress, `自动(${res.source})`)
    }
  }

  return null
}

function scaleByProgress(
  fullGrams: number,
  progress: number,
  how: string
): { grams: number; how: string } {
  const pct = Number.isFinite(progress) ? Math.max(0, Math.min(100, progress)) : 100
  // Near-complete prints use full slicer weight; partial scales down
  const grams =
    pct >= 98 ? Math.round(fullGrams) : Math.max(1, Math.round((fullGrams * pct) / 100))
  return { grams, how: pct >= 98 ? how : `${how}·${Math.round(pct)}%` }
}

async function settleDeduct(
  track: JobTrack,
  remainEnd: SlotRemain,
  key: string,
  filamentUsedGrams?: number
): Promise<void> {
  rememberKey(key)
  const bound = boundSpoolsForDevice(track.deviceId)
  if (!bound.length) return

  const store = useFilamentStore.getState()
  const threshold = store.lowStockThreshold
  const settings = useSettingsStore.getState().settings
  const lines: string[] = []
  let hitLow = false
  let missingUsage = false

  const auto = await resolveAutoJobGrams(track, filamentUsedGrams)

  for (const spool of bound) {
    const deviceBinds = spoolBindings(spool).filter((b) => b.deviceId === track.deviceId)
    let remain = spool.remainGrams
    let changed = false

    for (const binding of deviceBinds) {
      const slotId = Number(binding.slotId)
      let usedG = 0
      let how = ''

      if (slotId > 0) {
        const startPct = track.remainStart[slotId]
        const endPct = remainEnd[slotId]
        if (Number.isFinite(startPct) && Number.isFinite(endPct)) {
          const deltaPct = startPct - endPct
          if (deltaPct >= 0.5) {
            usedG = Math.round((deltaPct / 100) * spool.totalGrams)
            how = `AMS${slotId}`
          }
        }
      }

      if (usedG < 1) {
        if (auto && auto.grams > 0) {
          usedG = auto.grams
          how = slotId > 0 ? `AMS${slotId}·${auto.how}` : auto.how
        } else if (slotId === 0) {
          missingUsage = true
          continue
        } else {
          continue
        }
      }

      if (usedG < 1) continue

      const after = Math.max(0, Math.round(remain - usedG))
      const brand = findBrand(spool.brandId)
      const mat = materialLabel(spool.material)
      lines.push(
        `${how} ${brand?.name || spool.brandId} ${mat} ${spool.color} −${usedG}g → ${after}g`
      )
      if (isLowStock({ ...spool, remainGrams: after }, threshold)) hitLow = true
      remain = after
      changed = true
    }

    if (changed) {
      await store.updateSpool({
        ...spool,
        remainGrams: remain,
        openedAt: spool.openedAt || new Date().toISOString().slice(0, 10)
      })
    }
  }

  if (lines.length) {
    void window.electronAPI?.notify?.show(
      `${track.deviceName} · 耗材扣减`,
      `${track.filename || '打印任务'}\n${lines.join('\n')}`
    )
  } else if (missingUsage) {
    void window.electronAPI?.notify?.show(
      `${track.deviceName} · 未扣减`,
      '未能自动读取打印用量（拓竹需局域网可访问 FTPS；Klipper 需切片元数据含 filament_weight）。'
    )
  }

  if (hitLow && settings.notifyOnLowFilament !== false) {
    void window.electronAPI?.notify?.show(
      '耗材低库存',
      `${track.deviceName} 绑定料卷已低于 ${threshold}g，请及时更换`
    )
    if (isClientMode()) {
      void serverSend('/api/v1/alert-notify/emit', 'POST', {
        kind: 'lowFilament',
        title: `耗材低库存：${track.deviceName}`,
        content: `${track.deviceName} 绑定料卷已低于 ${threshold}g，请及时更换`,
        deviceId: track.deviceId,
        deviceName: track.deviceName
      }).catch(() => undefined)
    }
  }
}

export function formatAmsBinding(spool: SpoolRecord, deviceName?: string): string {
  const b = spoolBindings(spool)[0] || spool.amsBinding
  if (!b?.deviceId || !Number.isFinite(Number(b.slotId)) || Number(b.slotId) < 0) return '—'
  const name = deviceName || b.deviceId.slice(0, 8)
  const slot = Number(b.slotId)
  const slotLabel = slot === 0 ? '外挂/单色' : `AMS ${slot}`
  return `${name} · ${slotLabel}`
}
