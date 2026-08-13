import type { DeviceConfig, PrinterBrand } from '../types/printer'

/** Normalize model for same-fleet batch print matching. */
export function normalizeDeviceModel(model?: string | null): string {
  return String(model || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

/** Brand + model key; empty model → "" (legacy devices of same brand can still match each other). */
export function deviceBatchPrintKey(device: DeviceConfig): string {
  return `${device.brand}::${normalizeDeviceModel(device.model)}`
}

export function deviceModelLabel(device: DeviceConfig): string {
  const m = String(device.model || '').trim()
  return m || '未设置机型'
}

export type BatchPrintGroupCheck =
  | { ok: true; brand: PrinterBrand; modelLabel: string }
  | { ok: false; message: string }

/** Batch import print requires identical brand and model. */
export function assertSameBrandAndModel(devices: DeviceConfig[]): BatchPrintGroupCheck {
  if (!devices.length) return { ok: false, message: '没有可批量打印的设备' }
  const brands = new Set(devices.map((d) => d.brand))
  if (brands.size !== 1) {
    return {
      ok: false,
      message: `批量导入打印仅允许相同品牌：当前选中 ${brands.size} 种品牌，请只勾选同品牌设备`
    }
  }
  const models = new Set(devices.map((d) => normalizeDeviceModel(d.model)))
  if (models.size !== 1) {
    const sample = devices
      .slice(0, 6)
      .map((d) => `${d.name}（${deviceModelLabel(d)}）`)
      .join('、')
    return {
      ok: false,
      message: `批量导入打印仅允许相同机型：当前机型不一致。示例：${sample}`
    }
  }
  const brand = devices[0]!.brand
  return { ok: true, brand, modelLabel: deviceModelLabel(devices[0]!) }
}
