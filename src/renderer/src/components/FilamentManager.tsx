import { useEffect, useMemo, useReducer, useState } from 'react'
import {
  Button,
  ColorPicker,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Progress,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
  message
} from 'antd'
import type { Color } from 'antd/es/color-picker'
import {
  DeleteOutlined,
  EditOutlined,
  InboxOutlined,
  PlusOutlined,
  RollbackOutlined
} from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { brandsForTech, findBrand } from '../data/filamentBrands'
import { materialLabel, materialsForTech } from '../data/filamentMaterials'
import {
  isLowStock,
  selectVisibleSpools,
  spoolCapacityGrams,
  spoolRemainPct,
  useFilamentStore
} from '../stores/filamentStore'
import type { SpoolRecord } from '../types/filament'
import { useDeviceStore } from '../stores/deviceStore'
import { formatAmsBinding } from '../utils/amsDeduct'
import { spoolBindings, spoolRolls, migrateSpoolRecord } from '../utils/spoolBinding'
import { PluginSlot } from '../plugins/PluginSlot'
import { getHanyePlugin } from '../plugins/runtime'
import {
  FilamentPluginFields,
  applyFilamentFieldCollect,
  filamentPluginFormSeed,
  filamentPreserveExtras
} from './FilamentPluginHosts'

const PRESET_COLORS: { label: string; hex: string }[] = [
  { label: '黑', hex: '#1a1a1a' },
  { label: '白', hex: '#f5f5f5' },
  { label: '灰', hex: '#8c8c8c' },
  { label: '红', hex: '#cf1322' },
  { label: '橙', hex: '#d46b08' },
  { label: '黄', hex: '#d4b106' },
  { label: '绿', hex: '#389e0d' },
  { label: '蓝', hex: '#0958d9' },
  { label: '青', hex: '#08979c' },
  { label: '紫', hex: '#531dab' },
  { label: '粉', hex: '#c41d7f' },
  { label: '棕', hex: '#874d00' },
  { label: '透明', hex: '#d9d9d9' },
  { label: '金', hex: '#d4a017' },
  { label: '银', hex: '#bfbfbf' }
]

type SpoolFormValues = {
  brandId: string
  material: string
  color: string
  colorHex: string
  totalGrams: number
  remainGrams: number
  rolls: number
  location?: string
  price?: number
  notes?: string
  openedAt?: string
  amsDeviceId?: string
  amsSlotId?: number
}

function brandDisplay(id: string): string {
  const b = findBrand(id)
  if (b) return b.nameEn && b.nameEn !== b.name ? `${b.name} (${b.nameEn})` : b.name
  const pb = getHanyePlugin()
    .getFilamentBrands()
    .find((x) => x.id === id)
  if (pb) {
    return pb.nameEn && pb.nameEn !== pb.name ? `${pb.name} (${pb.nameEn})` : pb.name
  }
  return id
}

function materialDisplay(id: string): string {
  const builtIn = materialLabel(id)
  if (builtIn !== id) return builtIn
  const pm = getHanyePlugin()
    .getFilamentMaterials()
    .find((m) => m.id === id)
  return pm?.label || id
}

export function FilamentManager() {
  const init = useFilamentStore((s) => s.init)
  const loading = useFilamentStore((s) => s.loading)
  const spools = useFilamentStore((s) => s.spools)
  const tech = useFilamentStore((s) => s.tech)
  const search = useFilamentStore((s) => s.search)
  const brandFilter = useFilamentStore((s) => s.brandFilter)
  const materialFilter = useFilamentStore((s) => s.materialFilter)
  const lowStockOnly = useFilamentStore((s) => s.lowStockOnly)
  const showArchived = useFilamentStore((s) => s.showArchived)
  const lowStockThreshold = useFilamentStore((s) => s.lowStockThreshold)
  const setTech = useFilamentStore((s) => s.setTech)
  const setBrandFilter = useFilamentStore((s) => s.setBrandFilter)
  const setMaterialFilter = useFilamentStore((s) => s.setMaterialFilter)
  const setLowStockOnly = useFilamentStore((s) => s.setLowStockOnly)
  const setShowArchived = useFilamentStore((s) => s.setShowArchived)
  const addModalOpen = useFilamentStore((s) => s.addModalOpen)
  const closeAddModal = useFilamentStore((s) => s.closeAddModal)
  const addSpool = useFilamentStore((s) => s.addSpool)
  const updateSpool = useFilamentStore((s) => s.updateSpool)
  const removeSpool = useFilamentStore((s) => s.removeSpool)
  const archiveSpool = useFilamentStore((s) => s.archiveSpool)

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<SpoolRecord | null>(null)
  const [form] = Form.useForm<SpoolFormValues>()
  const [pluginTick, bumpPlugin] = useReducer((n: number) => n + 1, 0)
  const colorHexWatch = Form.useWatch('colorHex', form)
  const amsDeviceWatch = Form.useWatch('amsDeviceId', form)
  const totalGramsWatch = Form.useWatch('totalGrams', form)
  const rollsWatch = Form.useWatch('rolls', form)
  const devices = useDeviceStore((s) => s.devices)
  const statuses = useDeviceStore((s) => s.statuses)
  const fdmDevices = useMemo(
    () => devices.filter((d) => (d.tech || 'fdm') === 'fdm'),
    [devices]
  )

  useEffect(() => {
    return getHanyePlugin().on('filament:change', () => bumpPlugin())
  }, [])

  const brands = useMemo(() => {
    const built = brandsForTech(tech)
    const extra = getHanyePlugin().getFilamentBrands(tech)
    const seen = new Set(built.map((b) => b.id))
    const merged = [...built]
    for (const b of extra) {
      if (seen.has(b.id)) continue
      seen.add(b.id)
      merged.push({
        id: b.id,
        name: b.name,
        nameEn: b.nameEn,
        kind: b.kind || 'both',
        popular: b.popular
      })
    }
    return merged
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tech, pluginTick])

  const materials = useMemo(() => {
    const built = materialsForTech(tech)
    const extra = getHanyePlugin().getFilamentMaterials(tech)
    const seen = new Set(built.map((m) => m.id))
    const merged = [...built]
    for (const m of extra) {
      if (seen.has(m.id)) continue
      seen.add(m.id)
      merged.push({ id: m.id, label: m.label, category: m.category })
    }
    return merged
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tech, pluginTick])

  const formMode = editing ? 'edit' : 'create'
  const slotCtx = useMemo(
    () => ({ tech, mode: formMode, spoolId: editing?.id || null }),
    [tech, formMode, editing?.id]
  )
  const toolbarActions = useMemo(
    () => getHanyePlugin().getFilamentToolbarActions(tech),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tech, pluginTick]
  )
  const rowActions = useMemo(
    () => getHanyePlugin().getFilamentRowActions(tech),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tech, pluginTick]
  )
  const pluginColumns = useMemo(
    () => getHanyePlugin().getFilamentColumns(tech),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tech, pluginTick]
  )

  const openCreate = () => {
    setEditing(null)
    form.resetFields()
    form.setFieldsValue({
      brandId: brands.find((b) => b.popular)?.id || brands[0]?.id,
      material: materials[0]?.id,
      color: '黑',
      colorHex: '#1a1a1a',
      totalGrams: 1000,
      remainGrams: 1000,
      rolls: 1,
      location: '',
      price: undefined,
      notes: '',
      openedAt: undefined,
      amsDeviceId: undefined,
      amsSlotId: undefined
    })
    setFormOpen(true)
  }

  useEffect(() => {
    void init()
  }, [init])

  useEffect(() => {
    if (!addModalOpen) return
    openCreate()
    closeAddModal()
    // Intentionally only react to addModalOpen from header
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addModalOpen])

  const syncFdmRemain = (override?: { totalGrams?: number; rolls?: number }) => {
    if (tech !== 'fdm') return
    const per = Math.max(
      0,
      Number(override?.totalGrams ?? form.getFieldValue('totalGrams')) || 0
    )
    const rolls = Math.max(
      1,
      Math.min(99, Math.floor(Number(override?.rolls ?? form.getFieldValue('rolls')) || 1))
    )
    if (per <= 0) return
    form.setFieldsValue({ remainGrams: Math.round(per * rolls) })
  }

  const visible = useMemo(
    () =>
      selectVisibleSpools({
        spools,
        tech,
        search,
        brandFilter,
        materialFilter,
        lowStockOnly,
        showArchived,
        lowStockThreshold
      }),
    [
      spools,
      tech,
      search,
      brandFilter,
      materialFilter,
      lowStockOnly,
      showArchived,
      lowStockThreshold
    ]
  )

  const techSpools = useMemo(() => spools.filter((s) => s.tech === tech), [spools, tech])

  const brandCounts = useMemo(() => {
    const map = new Map<string, number>()
    for (const s of techSpools) {
      if (!showArchived && s.archived) continue
      map.set(s.brandId, (map.get(s.brandId) || 0) + 1)
    }
    return map
  }, [techSpools, showArchived])

  const lowCount = useMemo(
    () => techSpools.filter((s) => isLowStock(s, lowStockThreshold)).length,
    [techSpools, lowStockThreshold]
  )

  const openEdit = (row: SpoolRecord) => {
    setEditing(row)
    form.setFieldsValue({
      brandId: row.brandId,
      material: row.material,
      color: row.color,
      colorHex: row.colorHex,
      totalGrams: row.totalGrams,
      remainGrams: row.remainGrams,
      rolls: spoolRolls(row),
      location: row.location,
      price: row.price,
      notes: row.notes,
      openedAt: row.openedAt?.slice(0, 10),
      amsDeviceId: undefined,
      amsSlotId: undefined,
      ...filamentPluginFormSeed(row)
    })
    setFormOpen(true)
  }

  const submitForm = async () => {
    const values = await form.validateFields()
    const rolls =
      tech === 'fdm'
        ? Math.max(1, Math.min(99, Math.floor(Number(values.rolls) || 1)))
        : 1
    const perRoll = Math.max(1, Number(values.totalGrams) || 0)
    const capacity = Math.round(perRoll * rolls)
    const remain = Math.min(
      Math.max(0, Number(values.remainGrams) || 0),
      capacity
    )
    const slotId =
      values.amsSlotId === 0 || (values.amsSlotId != null && values.amsSlotId > 0)
        ? Number(values.amsSlotId)
        : undefined
    const addBind =
      tech === 'fdm' && values.amsDeviceId && slotId != null
        ? { deviceId: values.amsDeviceId, slotId }
        : null

    const prevBindings = editing ? spoolBindings(editing) : []
    let payload: Record<string, unknown> = {
      ...filamentPreserveExtras(editing),
      brandId: values.brandId,
      material: values.material,
      color: values.color.trim() || '未命名',
      colorHex: values.colorHex || '#888888',
      totalGrams: perRoll,
      remainGrams: remain,
      rolls,
      location: values.location?.trim() || undefined,
      price: values.price,
      notes: values.notes?.trim() || undefined,
      openedAt: values.openedAt || undefined,
      tech,
      archived: editing?.archived,
      amsBindings: prevBindings.slice(0, rolls),
      amsBinding: prevBindings[0] || null
    }
    payload = applyFilamentFieldCollect(form, tech, formMode, editing, payload)
    if (editing) {
      await updateSpool({ ...editing, ...payload } as SpoolRecord)
      if (addBind) {
        const ok = await useFilamentStore.getState().bindSpoolAms(editing.id, addBind)
        if (!ok) {
          message.warning(`卷数仅 ${rolls}，已满，无法再绑定设备`)
        } else {
          message.success('已更新料卷并添加绑定')
        }
      } else {
        message.success('已更新料卷')
      }
    } else {
      const created = await addSpool(payload as Omit<SpoolRecord, 'id' | 'createdAt' | 'updatedAt'>)
      if (addBind) {
        const ok = await useFilamentStore.getState().bindSpoolAms(created.id, addBind)
        if (!ok) message.warning('绑定失败')
      }
      message.success('已添加料卷')
    }
    setFormOpen(false)
  }

  const baseColumns: ColumnsType<SpoolRecord> = [
    {
      title: '颜色',
      key: 'color',
      width: 120,
      render: (_, row) => (
        <Space size={8}>
          <span className="spool-swatch" style={{ background: row.colorHex }} title={row.colorHex} />
          <span>{row.color}</span>
        </Space>
      )
    },
    {
      title: '品牌',
      dataIndex: 'brandId',
      width: 140,
      render: (id: string) => brandDisplay(id)
    },
    {
      title: '材质',
      dataIndex: 'material',
      width: 120,
      render: (id: string) => materialDisplay(id)
    },
    {
      title: '余量',
      key: 'remain',
      width: 200,
      render: (_, row) => {
        const pct = spoolRemainPct(row)
        const low = isLowStock(row, lowStockThreshold)
        return (
          <div className="spool-remain">
            <div className="spool-remain-text">
              {Math.round(row.remainGrams)} / {Math.round(spoolCapacityGrams(row))} g
              {low ? <Tag color="warning">低库存</Tag> : null}
            </div>
            <Progress
              percent={Math.round(pct)}
              size="small"
              status={low ? 'exception' : 'active'}
              showInfo={false}
            />
          </div>
        )
      }
    },
    {
      title: '卷数',
      key: 'rolls',
      width: 72,
      render: (_, row) => {
        const n = spoolRolls(row)
        const used = spoolBindings(row).length
        return (
          <span title={`已绑定 ${used}/${n}`}>
            {used}/{n}
          </span>
        )
      }
    },
    {
      title: '位置',
      dataIndex: 'location',
      width: 100,
      render: (v?: string) => v || '—'
    },
    {
      title: '打印机绑定',
      key: 'ams',
      width: 200,
      render: (_, row) => {
        if (row.tech !== 'fdm') return '—'
        const list = spoolBindings(row)
        if (!list.length) return '—'
        return (
          <Space size={4} wrap>
            {list.map((b) => {
              const name = devices.find((d) => d.id === b.deviceId)?.name
              return (
                <Tag key={`${b.deviceId}-${b.slotId}`} style={{ margin: 0 }}>
                  {formatAmsBinding({ ...row, amsBinding: b, amsBindings: [b] }, name)}
                </Tag>
              )
            })}
          </Space>
        )
      }
    },
    {
      title: '单价',
      dataIndex: 'price',
      width: 80,
      render: (v?: number) => (v != null ? `¥${v}` : '—')
    },
    {
      title: '状态',
      key: 'status',
      width: 90,
      render: (_, row) =>
        row.archived ? (
          <Tag>已归档</Tag>
        ) : row.openedAt ? (
          <Tag color="blue">已开封</Tag>
        ) : (
          <Tag color="green">未开封</Tag>
        )
    },
    {
      title: '操作',
      key: 'actions',
      width: 220 + Math.min(160, rowActions.length * 72),
      fixed: 'right',
      render: (_, row) => (
        <Space size={4} wrap>
          <PluginSlot
            name="filament.row.actions"
            context={{ ...slotCtx, spoolId: row.id, archived: row.archived }}
          />
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(row)}>
            编辑
          </Button>
          {!row.archived ? (
            <Button
              type="link"
              size="small"
              icon={<RollbackOutlined />}
              onClick={() => {
                Modal.confirm({
                  title: '开封 / 重置余量？',
                  content: '将标记为今日开封，并把余量重置为总重（满卷）。',
                  okText: '确认',
                  cancelText: '取消',
                  onOk: async () => {
                    await updateSpool({
                      ...row,
                      openedAt: new Date().toISOString().slice(0, 10),
                      remainGrams: spoolCapacityGrams(row)
                    })
                    message.success('已开封并重置余量')
                  }
                })
              }}
            >
              开封重置
            </Button>
          ) : null}
          <Button
            type="link"
            size="small"
            onClick={async () => {
              await archiveSpool(row.id, !row.archived)
              message.success(row.archived ? '已取消归档' : '已归档')
            }}
          >
            {row.archived ? '取消归档' : '归档'}
          </Button>
          {rowActions.map((a) => (
            <Button
              key={a.id}
              type="link"
              size="small"
              danger={a.danger}
              onClick={() => {
                void Promise.resolve(
                  a.run({ tech, spool: row as unknown as Record<string, unknown> })
                ).catch((err) =>
                  message.error(err instanceof Error ? err.message : '插件动作失败')
                )
              }}
            >
              {a.label}
            </Button>
          ))}
          <Button
            type="link"
            size="small"
            danger
            icon={<DeleteOutlined />}
            onClick={() => {
              Modal.confirm({
                title: '删除料卷？',
                content: '删除后不可恢复。',
                okText: '删除',
                okButtonProps: { danger: true },
                cancelText: '取消',
                onOk: async () => {
                  await removeSpool(row.id)
                  message.success('已删除')
                }
              })
            }}
          >
            删除
          </Button>
        </Space>
      )
    }
  ]

  const columns: ColumnsType<SpoolRecord> = [
    ...baseColumns.slice(0, -1),
    ...pluginColumns.map(
      (c): ColumnsType<SpoolRecord>[number] => ({
        title: c.title,
        key: `plugin_${c.id}`,
        width: c.width || 120,
        render: (_, row) => {
          try {
            return c.render(row as unknown as Record<string, unknown>, { tech })
          } catch (e) {
            console.error('[filament column]', c.id, e)
            return '—'
          }
        }
      })
    ),
    baseColumns[baseColumns.length - 1]
  ]

  return (
    <div className="filament-manager">
      <PluginSlot name="filament.header.before" context={slotCtx} />
      <PluginSlot name="filament.header" replace context={slotCtx} />
      <PluginSlot name="filament.header.after" context={slotCtx} />
      <PluginSlot name="filament.toolbar.before" context={slotCtx} />
      <div className="filament-toolbar">
        <Tabs
          activeKey={tech}
          onChange={(k) => setTech(k as 'fdm' | 'resin')}
          items={[
            { key: 'fdm', label: `FDM 线材 (${spools.filter((s) => s.tech === 'fdm' && !s.archived).length})` },
            {
              key: 'resin',
              label: `光固化树脂 (${spools.filter((s) => s.tech === 'resin' && !s.archived).length})`
            }
          ]}
          className="filament-tabs"
        />
        {toolbarActions.length > 0 ? (
          <Space wrap size={8} style={{ marginLeft: 12 }}>
            {toolbarActions.map((a) => (
              <Button
                key={a.id}
                size="small"
                onClick={() => {
                  void Promise.resolve(a.run({ tech })).catch((err) =>
                    message.error(err instanceof Error ? err.message : '插件动作失败')
                  )
                }}
              >
                {a.label}
              </Button>
            ))}
          </Space>
        ) : null}
      </div>
      <PluginSlot name="filament.toolbar.after" context={slotCtx} />

      <PluginSlot name="filament.filters.before" context={slotCtx} />
      <div className="filament-filters">
        <Typography.Text type="secondary" className="filament-filter-label">
          品牌
        </Typography.Text>
        <Space size={[8, 8]} wrap className="filament-brand-tags">
          <Tag
            className={brandFilter === 'all' ? 'brand-filter-tag active' : 'brand-filter-tag'}
            onClick={() => setBrandFilter('all')}
          >
            全部
            <span className="brand-filter-count">
              {techSpools.filter((s) => showArchived || !s.archived).length}
            </span>
          </Tag>
          {brands.map((b) => (
              <Tag
                key={b.id}
                className={brandFilter === b.id ? 'brand-filter-tag active' : 'brand-filter-tag'}
                onClick={() => setBrandFilter(b.id)}
              >
                {b.name}
                <span className="brand-filter-count">{brandCounts.get(b.id) || 0}</span>
              </Tag>
            ))}
        </Space>
        <Space wrap size={12} className="filament-filter-controls">
          <Select
            allowClear
            placeholder="材质"
            style={{ width: 160 }}
            value={materialFilter === 'all' ? undefined : materialFilter}
            onChange={(v) => setMaterialFilter(v || 'all')}
            options={materials.map((m) => ({ value: m.id, label: m.label }))}
          />
          <Space size={6}>
            <Switch checked={lowStockOnly} onChange={setLowStockOnly} size="small" />
            <Typography.Text type="secondary">
              仅低库存{lowCount > 0 ? ` (${lowCount})` : ''}
            </Typography.Text>
          </Space>
          <Space size={6}>
            <Switch checked={showArchived} onChange={setShowArchived} size="small" />
            <Typography.Text type="secondary">显示已归档</Typography.Text>
          </Space>
        </Space>
      </div>
      <PluginSlot name="filament.filters.after" context={slotCtx} />

      <PluginSlot name="filament.list.before" context={slotCtx} />
      {visible.length === 0 && !loading ? (
        <PluginSlot name="filament.list.empty" replace context={slotCtx}>
          <div className="filament-empty">
            <Empty
              image={<InboxOutlined style={{ fontSize: 48, opacity: 0.45 }} />}
              description={
                <span>
                  {techSpools.length === 0
                    ? `还没有${tech === 'resin' ? '树脂' : '线材'}料卷。当前分区品牌库 ${brands.length} 个，添加第一卷开始管理。`
                    : '没有符合筛选条件的料卷'}
                </span>
              }
            >
              {techSpools.length === 0 ? (
                <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
                  添加第一卷
                </Button>
              ) : null}
            </Empty>
          </div>
        </PluginSlot>
      ) : (
        <Table
          rowKey="id"
          size="middle"
          loading={loading}
          columns={columns}
          dataSource={visible}
          pagination={{ pageSize: 12, showSizeChanger: false }}
          scroll={{ x: 1120 + pluginColumns.length * 120 }}
          className="filament-table"
          rowClassName={(row) => (row.archived ? 'spool-row-archived' : '')}
        />
      )}
      <PluginSlot name="filament.list.after" context={slotCtx} />

      <Modal
        title={editing ? '编辑料卷' : `添加${tech === 'resin' ? '树脂' : '线材'}料卷`}
        open={formOpen}
        onCancel={() => setFormOpen(false)}
        onOk={() => void submitForm()}
        okText={editing ? '保存' : '添加'}
        cancelText="取消"
        destroyOnClose
        width={520}
      >
        <PluginSlot name="filament.form" replace context={slotCtx}>
          <PluginSlot name="filament.form.before" context={slotCtx} />
          <Form form={form} layout="vertical" requiredMark="optional">
            <Form.Item name="brandId" label="品牌" rules={[{ required: true, message: '请选择品牌' }]}>
              <Select
                showSearch
                optionFilterProp="label"
                options={brands.map((b) => ({
                  value: b.id,
                  label: b.nameEn && b.nameEn !== b.name ? `${b.name} / ${b.nameEn}` : b.name
                }))}
              />
            </Form.Item>
            <Form.Item name="material" label="材质" rules={[{ required: true, message: '请选择材质' }]}>
              <Select options={materials.map((m) => ({ value: m.id, label: m.label }))} />
            </Form.Item>
            <Form.Item label="颜色" required>
              <Space wrap size={[8, 8]} style={{ marginBottom: 8 }}>
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c.hex + c.label}
                    type="button"
                    className={`spool-color-preset${colorHexWatch === c.hex ? ' active' : ''}`}
                    style={{ background: c.hex }}
                    title={c.label}
                    onClick={() => form.setFieldsValue({ color: c.label, colorHex: c.hex })}
                  />
                ))}
              </Space>
              <Space.Compact style={{ width: '100%' }}>
                <Form.Item name="color" noStyle rules={[{ required: true, message: '请输入颜色名' }]}>
                  <Input placeholder="颜色名称" style={{ width: '55%' }} />
                </Form.Item>
                <Form.Item
                  name="colorHex"
                  noStyle
                  rules={[{ required: true, message: '请选择色值' }]}
                  getValueFromEvent={(c: Color) => c.toHexString()}
                >
                  <ColorPicker showText format="hex" />
                </Form.Item>
              </Space.Compact>
            </Form.Item>
            <Space align="start" style={{ width: '100%' }} size={12}>
              <Form.Item
                name="totalGrams"
                label={tech === 'resin' ? '总重 (g)' : '单卷总重 (g)'}
                rules={[{ required: true, message: '请输入总重' }]}
                style={{ flex: 1, minWidth: 0, marginBottom: tech === 'fdm' ? 4 : undefined }}
              >
                <InputNumber
                  min={1}
                  max={50000}
                  style={{ width: '100%' }}
                  onChange={(v) => syncFdmRemain({ totalGrams: Number(v) || 0 })}
                />
              </Form.Item>
              {tech === 'fdm' ? (
                <Form.Item
                  name="rolls"
                  label="卷数"
                  rules={[{ required: true, message: '请输入卷数' }]}
                  style={{ flex: 1, minWidth: 0, marginBottom: 4 }}
                >
                  <InputNumber
                    min={1}
                    max={99}
                    style={{ width: '100%' }}
                    onChange={(v) => syncFdmRemain({ rolls: Number(v) || 1 })}
                  />
                </Form.Item>
              ) : null}
              <Form.Item
                name="remainGrams"
                label="余量 (g)"
                rules={[{ required: true, message: '请输入余量' }]}
                style={{ flex: 1, minWidth: 0, marginBottom: tech === 'fdm' ? 4 : undefined }}
              >
                <InputNumber min={0} max={50000} style={{ width: '100%' }} />
              </Form.Item>
            </Space>
            {tech === 'fdm' ? (
              <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 0, marginBottom: 16 }}>
                可绑设备数 = 卷数；余量满卷 = 单卷总重 × 卷数（
                {Math.round(
                  (Number(totalGramsWatch) || 0) * Math.max(1, Math.floor(Number(rollsWatch) || 1))
                )}{' '}
                g）
              </Typography.Paragraph>
            ) : null}
            <Space style={{ width: '100%' }} size={12}>
              <Form.Item name="location" label="位置" style={{ flex: 1 }}>
                <Input placeholder="如货架 A1 / AMS 旁" />
              </Form.Item>
              <Form.Item name="price" label="单价 (元)" style={{ flex: 1 }}>
                <InputNumber min={0} precision={2} style={{ width: '100%' }} />
              </Form.Item>
            </Space>
            <Form.Item name="openedAt" label="开封日期">
              <Input type="date" />
            </Form.Item>
            {tech === 'fdm' ? (
              <>
                {editing && spoolBindings(editing).length > 0 ? (
                  <div style={{ marginBottom: 12 }}>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      已绑定（{spoolBindings(editing).length}/{spoolRolls(editing)}）
                    </Typography.Text>
                    <div style={{ marginTop: 6 }}>
                      <Space size={4} wrap>
                        {spoolBindings(editing).map((b) => {
                          const name = devices.find((d) => d.id === b.deviceId)?.name || b.deviceId
                          return (
                            <Tag
                              key={`${b.deviceId}-${b.slotId}`}
                              closable
                              onClose={(e) => {
                                e.preventDefault()
                                void useFilamentStore
                                  .getState()
                                  .unbindSpoolAms(editing.id, b.deviceId, b.slotId)
                                  .then(() => {
                                    const latest = useFilamentStore
                                      .getState()
                                      .spools.find((x) => x.id === editing.id)
                                    if (latest) setEditing(migrateSpoolRecord(latest))
                                    message.success('已解除绑定')
                                  })
                                  .catch((err) =>
                                    message.error(err instanceof Error ? err.message : '解绑失败')
                                  )
                              }}
                            >
                              {name} · {b.slotId === 0 ? '外挂' : `AMS ${b.slotId}`}
                            </Tag>
                          )
                        })}
                      </Space>
                    </div>
                  </div>
                ) : null}
                <Typography.Paragraph type="secondary" style={{ marginBottom: 8, fontSize: 12 }}>
                  卷数决定最多绑几台设备/几个料位。下方可再添加一条绑定（也可在设备详情里绑定）。
                </Typography.Paragraph>
                <Space style={{ width: '100%' }} size={12}>
                  <Form.Item name="amsDeviceId" label="添加绑定 · 打印机" style={{ flex: 1 }}>
                    <Select
                      allowClear
                      placeholder="可选"
                      options={fdmDevices.map((d) => ({
                        value: d.id,
                        label: `${d.name}${d.brand === 'bambu' ? '' : ` · ${d.brand}`}`
                      }))}
                      onChange={() => form.setFieldsValue({ amsSlotId: 0 })}
                    />
                  </Form.Item>
                  <Form.Item name="amsSlotId" label="料位" style={{ flex: 1 }}>
                    <Select
                      allowClear
                      disabled={!amsDeviceWatch}
                      placeholder="选择料位"
                      options={(() => {
                        const slots = statuses[amsDeviceWatch || '']?.amsSlots
                        const base = [{ value: 0, label: '外挂 / 单色料架' }]
                        if (slots?.length) {
                          return [
                            ...base,
                            ...slots.map((s) => ({
                              value: s.id,
                              label: `AMS ${s.id} · ${s.material} ${s.remain}%`
                            }))
                          ]
                        }
                        return base
                      })()}
                    />
                  </Form.Item>
                </Space>
              </>
            ) : null}
            <Form.Item name="notes" label="备注">
              <Input.TextArea rows={2} placeholder="批次、干燥状态等" />
            </Form.Item>
            <PluginSlot name="filament.form.fields" context={slotCtx} />
            <FilamentPluginFields form={form} tech={tech} mode={formMode} spool={editing} />
          </Form>
          <PluginSlot name="filament.form.footer" context={slotCtx} />
          <PluginSlot name="filament.form.after" context={slotCtx} />
        </PluginSlot>
      </Modal>
    </div>
  )
}
