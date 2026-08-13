import type { SpoolAmsBinding, SpoolRecord } from '../types/filament'

export function spoolRolls(s: Pick<SpoolRecord, 'rolls'> | null | undefined): number {
  const n = Math.floor(Number(s?.rolls))
  if (!Number.isFinite(n) || n < 1) return 1
  return Math.min(99, n)
}

/** Normalize legacy amsBinding → amsBindings */
export function spoolBindings(s: SpoolRecord | null | undefined): SpoolAmsBinding[] {
  if (!s) return []
  // Prefer amsBindings whenever present (including empty) — empty must NOT
  // fall back to legacy amsBinding, or unbind appears to fail.
  if (Array.isArray(s.amsBindings)) {
    return s.amsBindings.filter(
      (b) =>
        b &&
        typeof b.deviceId === 'string' &&
        b.deviceId &&
        Number.isFinite(Number(b.slotId)) &&
        Number(b.slotId) >= 0
    )
  }
  if (s.amsBinding?.deviceId && Number.isFinite(Number(s.amsBinding.slotId))) {
    return [{ deviceId: s.amsBinding.deviceId, slotId: Number(s.amsBinding.slotId) }]
  }
  return []
}

export function bindingsForDevice(s: SpoolRecord, deviceId: string): SpoolAmsBinding[] {
  return spoolBindings(s).filter((b) => b.deviceId === deviceId)
}

export function findSpoolBoundToSlot(
  spools: SpoolRecord[],
  deviceId: string,
  slotId: number
): SpoolRecord | undefined {
  return spools.find(
    (s) =>
      !s.archived &&
      spoolBindings(s).some((b) => b.deviceId === deviceId && Number(b.slotId) === slotId)
  )
}

/** Free binding capacity left for this spool */
export function spoolBindSlotsLeft(s: SpoolRecord): number {
  return Math.max(0, spoolRolls(s) - spoolBindings(s).length)
}

export function migrateSpoolRecord(raw: SpoolRecord): SpoolRecord {
  const rolls = spoolRolls(raw)
  let bindings = spoolBindings(raw)
  if (bindings.length > rolls) bindings = bindings.slice(0, rolls)
  return {
    ...raw,
    rolls,
    amsBindings: bindings,
    amsBinding: bindings[0] || null
  }
}
