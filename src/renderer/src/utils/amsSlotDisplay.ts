import type { SpoolRecord } from '../types/filament'
import { materialLabel } from '../filament/filamentMaterials'
import { findSpoolBoundToSlot } from './spoolBinding'

export type DeviceAmsSlot = {
  id: number
  material: string
  color: string
  remain: number
}

/**
 * 自带 AMS/多色槽位的机器：若该槽已绑定「耗材管理」料卷，
 * 用料卷的颜色（colorHex）与材料类型覆盖机台上报的颜色/类型显示。
 */
export function amsSlotsSyncedWithSpools(
  deviceId: string,
  slots: DeviceAmsSlot[] | undefined,
  spools: SpoolRecord[]
): DeviceAmsSlot[] {
  if (!slots?.length) return []
  return slots.map((slot) => {
    const spool = findSpoolBoundToSlot(spools, deviceId, slot.id)
    if (!spool) return { ...slot }
    const mat = materialLabel(String(spool.material || '')) || String(spool.material || '')
    const color = String(spool.colorHex || spool.color || slot.color || '')
    return {
      ...slot,
      material: mat || slot.material,
      color: color || slot.color
    }
  })
}

/** 单槽显示：绑定料卷时用耗材库颜色/类型 */
export function amsSlotDisplay(
  deviceId: string,
  slot: DeviceAmsSlot,
  spools: SpoolRecord[]
): DeviceAmsSlot {
  return amsSlotsSyncedWithSpools(deviceId, [slot], spools)[0] || slot
}
