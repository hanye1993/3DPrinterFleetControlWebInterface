import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Checkbox, Dropdown, Empty, Pagination, Select, Space, Spin, Typography, message } from 'antd'
import type { MenuProps } from 'antd'
import type { DeviceConfig, PrinterLiveStatus, PrinterTech } from '../types/printer'
import { deviceTech, useDeviceStore, type DevicePageSize } from '../stores/deviceStore'
import {
  DEVICE_STATUS_FILTERS,
  deviceRuntimeStatusLabel,
  deviceStatusKind,
  deviceStatusLabel
} from '../utils/statusLabel'
import { formatEtaFinish, formatRemain } from '../utils/timeFormat'
import { colorSwatchBorder, normalizeColor, relativeLuminance } from '../utils/color'
import { useFilamentStore } from '../stores/filamentStore'
import { spoolBindings } from '../utils/spoolBinding'
import type { SpoolRecord } from '../types/filament'
import { useAuthGrants } from '../stores/authStore'
import { useThemePackStore } from '../theme/themePackStore'
import { PluginSlot } from '../plugins/PluginSlot'
import { getHanyePlugin } from '../plugins/runtime'

type CardColor = { hex: string; label: string }

function cardFilamentColors(
  deviceId: string,
  st: PrinterLiveStatus | undefined,
  spools: SpoolRecord[]
): CardColor[] {
  // AMS / multi-color from printer
  const slots = st?.amsSlots
  if (slots && slots.length > 0) {
    return slots
      .filter((s) => s.material && s.material !== '空')
      .map((s) => ({
        hex: normalizeColor(s.color),
        label: `${s.material}${s.remain != null ? ` · ${s.remain}%` : ''}`
      }))
  }
  // No on-printer colors → bound filament-manager colors (slot order)
  const bound: { slotId: number; color: string; colorHex: string }[] = []
  for (const s of spools) {
    if (s.archived) continue
    for (const b of spoolBindings(s)) {
      if (b.deviceId === deviceId && Number.isFinite(Number(b.slotId))) {
        bound.push({ slotId: Number(b.slotId), color: s.color, colorHex: s.colorHex })
      }
    }
  }
  bound.sort((a, b) => a.slotId - b.slotId)
  return bound.map((s) => ({
    hex: normalizeColor(s.colorHex || s.color),
    label: s.color || s.colorHex
  }))
}

function CardColorDots({ colors }: { colors: CardColor[] }) {
  if (!colors.length) return null
  return (
    <span className="card-color-dots" title={colors.map((c) => c.label).join(' · ')}>
      {colors.map((c, i) => {
        const bg = c.hex
        const light = relativeLuminance(bg) > 0.72
        return (
          <span
            key={`${c.hex}-${i}`}
            className="card-color-dot"
            title={c.label}
            style={{
              background: bg,
              borderColor: colorSwatchBorder(bg),
              boxShadow: light ? 'inset 0 0 0 1px rgba(0,0,0,0.2)' : 'inset 0 0 0 1px rgba(255,255,255,0.12)'
            }}
          />
        )
      })}
    </span>
  )
}

const CARD_MIN = 300
const CARD_GAP = 14
const ROW_HEIGHT = 248
const OVERSCAN = 2

const SPEED_PRESETS_GENERIC = [50, 75, 100, 125, 150]
const SPEED_PRESETS_BAMBU: { percent: number; label: string }[] = [
  { percent: 25, label: '静音 25%' },
  { percent: 50, label: '标准 50%' },
  { percent: 75, label: '运动 75%' },
  { percent: 100, label: '狂暴 100%' }
]
const FAN_PRESETS = [0, 25, 50, 75, 100]

const PAGE_SIZE_OPTIONS: { value: DevicePageSize; label: string }[] = [
  { value: 10, label: '10' },
  { value: 20, label: '20' },
  { value: 50, label: '50' },
  { value: 100, label: '100' },
  { value: 0, label: '全部' }
]

function brandLabel(brand: DeviceConfig['brand']): string {
  switch (brand) {
    case 'klipper':
      return 'Klipper'
    case 'creality':
      return '创想'
    case 'elegoo':
      return '爱乐库'
    case 'anycubic':
      return '纵维'
    case 'snapmaker':
      return 'Snapmaker'
    case 'flashforge':
      return '闪铸'
    case 'qidi':
      return '启迪'
    case 'bambu':
      return 'Bambu'
    default: {
      const p = getHanyePlugin().getAddDeviceBrand(String(brand))
      if (p?.label) return p.label
      return String(brand || '未知')
    }
  }
}

const BRAND_CLASS: Record<string, string> = {
  klipper: 'brand-klipper',
  creality: 'brand-creality',
  elegoo: 'brand-elegoo',
  anycubic: 'brand-anycubic',
  snapmaker: 'brand-snapmaker',
  flashforge: 'brand-flashforge',
  qidi: 'brand-qidi',
  bambu: 'brand-bambu'
}

function getScrollParent(el: HTMLElement | null): HTMLElement | null {
  let p = el?.parentElement ?? null
  while (p) {
    const oy = getComputedStyle(p).overflowY
    if (oy === 'auto' || oy === 'scroll' || oy === 'overlay') return p
    p = p.parentElement
  }
  return null
}

const DeviceCard = memo(function DeviceCard({
  device,
  selected,
  checked,
  canOpen,
  onSelect,
  onToggle,
  compact = false
}: {
  device: DeviceConfig
  selected: boolean
  checked: boolean
  canOpen: boolean
  onSelect: (id: string) => void
  onToggle: (id: string) => void
  compact?: boolean
}) {
  const st = useDeviceStore((s) => s.statuses[device.id]) as PrinterLiveStatus | undefined
  const control = useDeviceStore((s) => s.control)
  const spools = useFilamentStore((s) => s.spools)
  const filamentColors = useMemo(
    () => cardFilamentColors(device.id, st, spools),
    [device.id, st, spools]
  )
  const [ctrlBusy, setCtrlBusy] = useState<'chamber' | 'fan' | 'speed' | null>(null)
  const health = st?.health || 'offline'
  const resin = deviceTech(device) === 'resin'
  const filamentBoundCount = useMemo(() => {
    if (resin) return 0
    let n = 0
    for (const s of spools) {
      if (s.archived || s.tech !== 'fdm') continue
      n += spoolBindings(s).filter((b) => b.deviceId === device.id).length
    }
    return n
  }, [spools, device.id, resin])
  const statusKind = deviceStatusKind(st)
  const statusText = deviceRuntimeStatusLabel(st)
  const hasChamberFan = st?.chamberFanSpeed != null
  const pct = Math.min(100, Math.round(st?.progress ?? 0))
  const cls = [
    'device-card',
    compact ? 'device-card-compact' : '',
    resin ? 'tech-resin' : 'tech-fdm',
    selected ? 'selected' : '',
    checked ? 'checked' : '',
    health === 'error' ? 'error' : '',
    health === 'warning' ? 'warning' : '',
    canOpen ? '' : 'view-only'
  ]
    .filter(Boolean)
    .join(' ')

  // Card quick controls require open/control permission, not view-only
  const ctrlOnline = canOpen && (health === 'online' || health === 'warning')
  const speedMenu: MenuProps['items'] = useMemo(() => {
    if (device.brand === 'bambu') {
      return SPEED_PRESETS_BAMBU.map((p) => ({
        key: String(p.percent),
        label: p.label
      }))
    }
    return SPEED_PRESETS_GENERIC.map((p) => ({
      key: String(p),
      label: `${p}%`
    }))
  }, [device.brand])

  const fanMenu: MenuProps['items'] = useMemo(
    () =>
      FAN_PRESETS.map((p) => ({
        key: String(p),
        label: p === 0 ? '关闭 0%' : `${p}%`
      })),
    []
  )

  const setChamberFan = async (percent: number) => {
    if (ctrlBusy || !ctrlOnline) return
    setCtrlBusy('chamber')
    try {
      await control(device.id, {
        action: 'set_fan',
        fan: 'chamber',
        percent,
        fanName: st?.chamberFanName
      })
      message.success(`${device.name} 仓内风扇已设为 ${percent}%`)
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err))
    } finally {
      setCtrlBusy(null)
    }
  }

  const setFan = async (percent: number) => {
    if (ctrlBusy || !ctrlOnline) return
    setCtrlBusy('fan')
    try {
      await control(device.id, { action: 'set_fan', fan: 'part', percent })
      message.success(`${device.name} 风扇已设为 ${percent}%`)
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err))
    } finally {
      setCtrlBusy(null)
    }
  }

  const setSpeed = async (percent: number) => {
    if (ctrlBusy || !ctrlOnline) return
    setCtrlBusy('speed')
    try {
      await control(device.id, { action: 'set_speed', percent })
      message.success(`${device.name} 速度已设为 ${percent}%`)
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err))
    } finally {
      setCtrlBusy(null)
    }
  }

  return (
    <PluginSlot
      name="device.card"
      replace
      context={{
        deviceId: device.id,
        deviceName: device.name,
        brand: device.brand,
        chamberTemp: st?.chamberTemp ?? null,
        health
      }}
    >
    <div
      className={cls}
      data-device-id={device.id}
      title={canOpen ? undefined : '仅查看权限，无法打开控制面板'}
      style={canOpen ? undefined : { cursor: 'default' }}
      onClick={() => {
        if (!canOpen) {
          message.info('当前仅有查看权限，无法进入控制面板')
          return
        }
        onSelect(device.id)
      }}
    >
      <PluginSlot name="device.card.before" context={{ deviceId: device.id, deviceName: device.name }} />
      <div className="device-card-head">
        <PluginSlot name="device.card.head.before" context={{ deviceId: device.id }} />
        <div className="device-card-title">
          <span onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
            <Checkbox checked={checked} onChange={() => onToggle(device.id)} />
          </span>
          <span className={`health-dot health-${health}`} />
          <strong className="device-card-name">{device.name}</strong>
          <PluginSlot
            name="device.card.after-name"
            context={{
              deviceId: device.id,
              deviceName: device.name,
              brand: device.brand,
              chamberTemp: st?.chamberTemp ?? null,
              health
            }}
          />
          <span className={`tech-chip ${resin ? 'resin' : 'fdm'}`}>{resin ? '光固化' : 'FDM'}</span>
        </div>
        <div className="device-card-head-end">
          {!resin ? <CardColorDots colors={filamentColors} /> : null}
          <span className={`brand-chip ${BRAND_CLASS[device.brand] || 'brand-bambu'}`}>
            {brandLabel(device.brand)}
          </span>
        </div>
        <PluginSlot name="device.card.head.after" context={{ deviceId: device.id }} />
      </div>

      <div className="device-card-msg">{deviceStatusLabel(st)}</div>

      <div className={`card-progress${health === 'error' ? ' err' : ''}${resin ? ' resin' : ''}`}>
        <div className="card-progress-bar" style={{ width: `${pct}%` }} />
      </div>
      <PluginSlot
        name="device.card.progress.after"
        context={{ deviceId: device.id, progress: pct, health }}
      />

      <div className="device-card-eta">
        <span>
          剩余 <strong>{formatRemain(st?.remainingSeconds)}</strong>
        </span>
        <span>
          预计完成{' '}
          <strong>
            {st?.remainingSeconds != null && st.remainingSeconds > 0
              ? formatEtaFinish(st.remainingSeconds)
              : '--'}
          </strong>
        </span>
      </div>

      {resin ? (
        <div className="temp-row">
          <div className="temp-pill">
            当前层 <strong>{st?.layer ?? '--'}</strong>
          </div>
          <div className="temp-pill">
            总层数 <strong>{st?.layerTotal ?? '--'}</strong>
          </div>
          <PluginSlot
            name="device.card.temps"
            context={{
              deviceId: device.id,
              deviceName: device.name,
              tech: 'resin',
              chamberTemp: st?.chamberTemp ?? null,
              boardTemp: st?.boardTemp ?? null,
              health
            }}
          />
        </div>
      ) : (
        <div className="temp-row">
          <div className="temp-pill">
            挤出机{' '}
            <strong>
              {st?.extruder ? `${st.extruder.actual.toFixed(0)}°` : '--'}
              <span className="temp-target"> / {st?.extruder?.target?.toFixed(0) ?? '--'}°</span>
            </strong>
          </div>
          <div className="temp-pill">
            热床{' '}
            <strong>
              {st?.bed ? `${st.bed.actual.toFixed(0)}°` : '--'}
              <span className="temp-target"> / {st?.bed?.target?.toFixed(0) ?? '--'}°</span>
            </strong>
          </div>
          <PluginSlot
            name="device.card.temps"
            context={{
              deviceId: device.id,
              deviceName: device.name,
              tech: 'fdm',
              chamberTemp: st?.chamberTemp ?? null,
              boardTemp: st?.boardTemp ?? null,
              extruderActual: st?.extruder?.actual ?? null,
              bedActual: st?.bed?.actual ?? null,
              health
            }}
          />
        </div>
      )}

      <PluginSlot
        name="device.card.extra"
        context={{
          deviceId: device.id,
          deviceName: device.name,
          brand: device.brand,
          chamberTemp: st?.chamberTemp ?? null,
          health,
          state: st?.state ?? null
        }}
      />
      <PluginSlot name="device.card.meta.before" context={{ deviceId: device.id }} />
      <div className="device-card-meta">
        <span>
          层 {st?.layer ?? '--'}/{st?.layerTotal ?? '--'}
        </span>
        {resin ? (
          <span>光固化任务</span>
        ) : (
          <span
            className="device-card-speed"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <PluginSlot name="device.card.meta.actions" context={{ deviceId: device.id }} />
            {hasChamberFan ? (
              <Dropdown
                menu={{
                  items: fanMenu,
                  onClick: ({ key }) => {
                    void setChamberFan(Number(key))
                  }
                }}
                trigger={['click']}
                disabled={!ctrlOnline || !!ctrlBusy}
              >
                <Button
                  size="small"
                  type="default"
                  loading={ctrlBusy === 'chamber'}
                  disabled={!ctrlOnline || (ctrlBusy != null && ctrlBusy !== 'chamber')}
                >
                  仓扇 {st?.chamberFanSpeed != null ? `${st.chamberFanSpeed}%` : '--'}
                </Button>
              </Dropdown>
            ) : null}
            <Dropdown
              menu={{
                items: fanMenu,
                onClick: ({ key }) => {
                  void setFan(Number(key))
                }
              }}
              trigger={['click']}
              disabled={!ctrlOnline || !!ctrlBusy}
            >
              <Button
                size="small"
                type="default"
                loading={ctrlBusy === 'fan'}
                disabled={!ctrlOnline || (ctrlBusy != null && ctrlBusy !== 'fan')}
              >
                模扇 {st?.fanSpeed != null ? `${st.fanSpeed}%` : '--'}
              </Button>
            </Dropdown>
            <Dropdown
              menu={{
                items: speedMenu,
                onClick: ({ key }) => {
                  void setSpeed(Number(key))
                }
              }}
              trigger={['click']}
              disabled={!ctrlOnline || !!ctrlBusy}
            >
              <Button
                size="small"
                type="default"
                loading={ctrlBusy === 'speed'}
                disabled={!ctrlOnline || (ctrlBusy != null && ctrlBusy !== 'speed')}
              >
                速度 {st?.printSpeed != null ? `${st.printSpeed}%` : '--'}
              </Button>
            </Dropdown>
          </span>
        )}
      </div>
      <PluginSlot name="device.card.footer.before" context={{ deviceId: device.id }} />
      <div
        className={`device-card-footer state-${statusKind}${filamentBoundCount > 0 ? ' has-filament' : ''}`}
        title={
          resin
            ? statusText
            : `${statusText} · ${filamentBoundCount > 0 ? `已绑耗材库 ${filamentBoundCount} 处` : '未绑耗材库'}`
        }
      >
        <span className="device-card-footer-status">
          <i className="device-card-footer-dot" aria-hidden />
          {statusText}
        </span>
        {!resin ? (
          <span className={`device-card-footer-filament${filamentBoundCount > 0 ? ' on' : ''}`}>
            {filamentBoundCount > 0 ? `耗材已绑 ${filamentBoundCount}` : '耗材未绑'}
          </span>
        ) : null}
      </div>
      <PluginSlot
        name="device.card.footer"
        context={{
          deviceId: device.id,
          deviceName: device.name,
          chamberTemp: st?.chamberTemp ?? null,
          health,
          state: st?.state ?? null
        }}
      />
      <PluginSlot name="device.card.after" context={{ deviceId: device.id, deviceName: device.name }} />
    </div>
    </PluginSlot>
  )
})

export function DeviceGrid({
  devices,
  loading,
  tech
}: {
  devices: DeviceConfig[]
  loading: boolean
  tech: PrinterTech
}) {
  const selectedId = useDeviceStore((s) => s.selectedId)
  const checkedIds = useDeviceStore((s) => s.checkedIds)
  const storePageSize = useDeviceStore((s) => s.pageSize)
  const page = useDeviceStore((s) => s.page)
  const statusFilters = useDeviceStore((s) => s.statusFilters)
  /** Only subscribe to statuses when filters are active (avoids full-grid re-render every tick). */
  const statuses = useDeviceStore((s) => (statusFilters.length ? s.statuses : null))
  const setPageSize = useDeviceStore((s) => s.setPageSize)
  const setPage = useDeviceStore((s) => s.setPage)
  const toggleStatusFilter = useDeviceStore((s) => s.toggleStatusFilter)
  const selectDevice = useDeviceStore((s) => s.selectDevice)
  const toggleChecked = useDeviceStore((s) => s.toggleChecked)
  const { canOpenDevice } = useAuthGrants()
  const deviceView = useThemePackStore((s) => s.active?.deviceView || 'grid')
  const themeRev = useThemePackStore((s) => s.revision)
  const checkedSet = useMemo(() => new Set(checkedIds), [checkedIds])
  const statusFilterSet = useMemo(() => new Set(statusFilters), [statusFilters])

  const onSelect = useCallback((id: string) => selectDevice(id), [selectDevice])
  const onToggle = useCallback((id: string) => toggleChecked(id), [toggleChecked])

  const filteredDevices = useMemo(() => {
    if (!statusFilters.length || !statuses) return devices
    return devices.filter((d) => statusFilterSet.has(deviceStatusKind(statuses[d.id])))
  }, [devices, statusFilters, statusFilterSet, statuses])

  // 仅 FDM 使用每页数量；光固化始终全部显示
  const paginate = tech === 'fdm'
  const pageSize: DevicePageSize = paginate ? storePageSize : 0

  const total = filteredDevices.length
  const totalPages = pageSize === 0 ? 1 : Math.max(1, Math.ceil(total / pageSize))
  const safePage = Math.min(page, totalPages)

  const pageDevices = useMemo(() => {
    if (pageSize === 0) return filteredDevices
    const start = (safePage - 1) * pageSize
    return filteredDevices.slice(start, start + pageSize)
  }, [filteredDevices, pageSize, safePage])

  useEffect(() => {
    if (paginate && page !== safePage) setPage(safePage)
  }, [paginate, page, safePage, setPage])

  const wrapRef = useRef<HTMLDivElement>(null)
  const [cols, setCols] = useState(3)
  const [range, setRange] = useState({ start: 0, end: 24 })
  const rowHeight = deviceView === 'grid' ? ROW_HEIGHT : deviceView === 'table' ? 56 : 112

  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const scrollParent = getScrollParent(wrap) || wrap

    const measure = () => {
      const w = wrap.clientWidth || scrollParent.clientWidth
      const nextCols =
        deviceView === 'grid'
          ? Math.max(1, Math.floor((w + CARD_GAP) / (CARD_MIN + CARD_GAP)))
          : 1
      setCols(nextCols)

      const scrollTop = scrollParent === wrap ? wrap.scrollTop : scrollParent.scrollTop
      const viewH = scrollParent.clientHeight
      const gridTop =
        scrollParent === wrap
          ? 0
          : wrap.getBoundingClientRect().top - scrollParent.getBoundingClientRect().top + scrollParent.scrollTop

      const relTop = Math.max(0, scrollTop - gridTop)
      const rowCount = Math.ceil(pageDevices.length / nextCols) || 1
      const startRow = Math.max(0, Math.floor(relTop / rowHeight) - OVERSCAN)
      const endRow = Math.min(rowCount, Math.ceil((relTop + viewH) / rowHeight) + OVERSCAN)
      setRange({ start: startRow * nextCols, end: endRow * nextCols })
    }

    measure()
    let raf = 0
    const onScroll = () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        measure()
      })
    }
    scrollParent.addEventListener('scroll', onScroll, { passive: true })
    const ro = new ResizeObserver(onScroll)
    ro.observe(wrap)
    ro.observe(scrollParent)
    return () => {
      scrollParent.removeEventListener('scroll', onScroll)
      ro.disconnect()
      if (raf) cancelAnimationFrame(raf)
    }
  }, [pageDevices.length, safePage, pageSize, deviceView, rowHeight, themeRev])

  if (loading) {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <Spin tip="加载设备…" />
      </div>
    )
  }

  if (!devices.length) {
    return (
      <PluginSlot name="device.grid.empty" replace>
        <Empty description="暂无设备，点击右上角添加打印机" />
      </PluginSlot>
    )
  }

  const rowCount = Math.ceil(pageDevices.length / cols) || 1
  const start = Math.min(range.start, pageDevices.length)
  const end = Math.min(range.end, pageDevices.length)
  const startRow = Math.floor(start / cols)
  const endRow = Math.ceil(end / cols)
  const padTop = startRow * rowHeight
  const padBottom = Math.max(0, (rowCount - endRow) * rowHeight)
  const slice = pageDevices.slice(start, end)

  const from = pageSize === 0 ? (total === 0 ? 0 : 1) : total === 0 ? 0 : (safePage - 1) * pageSize + 1
  const to = pageSize === 0 ? total : Math.min(total, safePage * pageSize)

  const statusFilterBar = (
    <Space size={4} wrap align="center" className="device-status-filters">
      <Typography.Text type="secondary" style={{ marginRight: 4 }}>
        状态
      </Typography.Text>
      {DEVICE_STATUS_FILTERS.map((opt) => (
        <Checkbox
          key={opt.value}
          checked={statusFilterSet.has(opt.value)}
          onChange={() => toggleStatusFilter(opt.value)}
        >
          {opt.label}
        </Checkbox>
      ))}
    </Space>
  )

  return (
    <div className={`device-grid-wrap device-view-${deviceView}`}>
      <PluginSlot name="device.grid.toolbar.before" />
      <div className="device-page-bar">
        <Space size={12} wrap align="center">
          {paginate ? (
            <>
              <Typography.Text type="secondary">每页显示</Typography.Text>
              <Select
                size="small"
                value={storePageSize}
                style={{ width: 88 }}
                options={PAGE_SIZE_OPTIONS}
                onChange={(v) => setPageSize(v as DevicePageSize)}
              />
            </>
          ) : null}
          {statusFilterBar}
          <PluginSlot name="device.grid.statusFilters.after" />
          <Typography.Text type="secondary">
            {total === 0
              ? statusFilters.length
                ? '无匹配设备'
                : '0 台'
              : paginate
                ? `第 ${from}–${to} 台 / 共 ${total} 台`
                : `共 ${total} 台`}
          </Typography.Text>
        </Space>
        {paginate && pageSize !== 0 ? (
          <Pagination
            size="small"
            current={safePage}
            pageSize={pageSize}
            total={total}
            showSizeChanger={false}
            onChange={(p) => setPage(p)}
          />
        ) : null}
      </div>
      <PluginSlot name="device.grid.toolbar.after" />
      <PluginSlot name="device.grid.pagination.after" />

      {!filteredDevices.length ? (
        <PluginSlot name="device.grid.empty" replace>
          <Empty description={statusFilters.length ? '没有符合所选状态的设备' : '暂无设备'} />
        </PluginSlot>
      ) : (
        <div ref={wrapRef} className="device-grid-window">
          <div style={{ height: padTop }} aria-hidden />
          <div
            className={`device-grid device-grid-${deviceView}`}
            style={{
              gridTemplateColumns:
                deviceView === 'grid' ? `repeat(${cols}, minmax(0, 1fr))` : '1fr'
            }}
          >
            {slice.map((device) => (
              <DeviceCard
                key={device.id}
                device={device}
                selected={selectedId === device.id}
                checked={checkedSet.has(device.id)}
                canOpen={canOpenDevice(device.id)}
                onSelect={onSelect}
                onToggle={onToggle}
                compact={deviceView !== 'grid'}
              />
            ))}
          </div>
          <div style={{ height: padBottom }} aria-hidden />
        </div>
      )}

      {paginate && pageSize !== 0 && totalPages > 1 ? (
        <div className="device-page-bar device-page-bar-bottom">
          <Typography.Text type="secondary">
            第 {safePage} / {totalPages} 页
          </Typography.Text>
          <Pagination
            size="small"
            current={safePage}
            pageSize={pageSize}
            total={total}
            showSizeChanger={false}
            onChange={(p) => {
              setPage(p)
              const main = document.querySelector('.app-main')
              if (main) main.scrollTop = 0
            }}
          />
        </div>
      ) : null}
    </div>
  )
}
