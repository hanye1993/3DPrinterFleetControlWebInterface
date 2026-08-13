import { useMemo } from 'react'
import { Typography } from 'antd'
import type { BrandFilter } from '../stores/deviceStore'
import { deviceTech, useDeviceStore } from '../stores/deviceStore'
import type { PrinterTech } from '../types/printer'
import { PluginSlot } from '../plugins/PluginSlot'

const FDM_BRANDS: { key: BrandFilter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'klipper', label: 'Klipper' },
  { key: 'creality', label: '创想三维' },
  { key: 'elegoo', label: '爱乐库' },
  { key: 'anycubic', label: '纵维立方' },
  { key: 'snapmaker', label: 'Snapmaker' },
  { key: 'flashforge', label: '闪铸' },
  { key: 'qidi', label: '启迪' },
  { key: 'bambu', label: 'Bambu Lab' }
]

const RESIN_BRANDS: { key: BrandFilter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'elegoo', label: '爱乐库' },
  { key: 'anycubic', label: '纵维立方' },
  { key: 'creality', label: '创想三维' }
]

export function BrandFilterBar({ tech }: { tech: PrinterTech }) {
  const allDevices = useDeviceStore((s) => s.devices)
  const filter = useDeviceStore((s) => s.filter)
  const setFilter = useDeviceStore((s) => s.setFilter)
  const brands = tech === 'resin' ? RESIN_BRANDS : FDM_BRANDS
  const slotCtx = { tech }

  const counts = useMemo(() => {
    const map: Record<string, number> = { all: 0 }
    for (const d of allDevices) {
      if (deviceTech(d) !== tech) continue
      map.all += 1
      map[d.brand] = (map[d.brand] || 0) + 1
    }
    return map
  }, [allDevices, tech])

  return (
    <>
      <PluginSlot name="device.filter.before" context={slotCtx} />
      <PluginSlot name="device.filter" replace context={slotCtx}>
        <div className={`brand-filter-bar tech-${tech}`}>
          <Typography.Text type="secondary" className="brand-filter-label">
            {tech === 'resin' ? '光固化品牌' : 'FDM 品牌'}
          </Typography.Text>
          <div className="brand-filter-tags">
            {brands.map((b) => {
              const n = counts[b.key] || 0
              const active = filter === b.key
              return (
                <button
                  key={b.key}
                  type="button"
                  className={active ? 'brand-filter-tag active' : 'brand-filter-tag'}
                  onClick={() => setFilter(b.key)}
                >
                  {b.label}
                  <span className="brand-filter-count">{n}</span>
                </button>
              )
            })}
          </div>
          <PluginSlot name="device.filter.tags.after" context={slotCtx} />
        </div>
      </PluginSlot>
      <PluginSlot name="device.filter.after" context={slotCtx} />
    </>
  )
}
