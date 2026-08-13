import type * as XLSXType from 'xlsx'

export type QuoteOptionCosts = {
  mat: number
  elec: number
  wear: number
  labor: number
  fixed: number
  base: number
  costWithFail: number
  kwh: number
  perUnit: number
  profit: number
  profitRate: number
  grand: number
  appliedFloor: boolean
}

export type QuoteOptionExport = {
  index: number
  name: string
  brandLabel: string
  materialLabel: string
  color: string
  colorHex?: string
  specLabel: string
  pricePerKg: number
  spoolLabel?: string
  note?: string
  costs: QuoteOptionCosts
}

export type QuoteExportInput = {
  time: string
  customer: string
  jobName: string
  tech: string
  weightG: number
  wastePct: number
  printHours: number
  watts: number
  electricity: number
  wearPerHour: number
  laborMinutes: number
  laborRate: number
  packaging: number
  shipping: number
  failPct: number
  pricingMode: string
  markupPct: number
  marginPct: number
  minPrice: number
  qty: number
  options: QuoteOptionExport[]
}

function round2(n: number) {
  return Math.round(n * 100) / 100
}

/** 生成多方案代打报价 xlsx（含厂商/颜色，供顾客选型） */
export async function buildQuoteWorkbook(input: QuoteExportInput): Promise<Uint8Array> {
  const XLSX = (await import('xlsx')) as typeof XLSXType
  const wb = XLSX.utils.book_new()

  const customerSheet: (string | number)[][] = [
    ['3D 代打报价 · 请选择耗材方案'],
    ['导出时间', input.time],
    ['客户', input.customer || '—'],
    ['项目', input.jobName || '—'],
    ['工艺', input.tech],
    ['模型重量 (g)', input.weightG],
    ['损耗/支撑 (%)', input.wastePct],
    ['打印时长 (h)', round2(input.printHours)],
    ['数量', input.qty],
    [],
    ['说明', '不同厂商、不同颜色价格不同，请按下方规格勾选或回复选用方案。'],
    [],
    [
      '方案',
      '厂商',
      '材料',
      '颜色',
      '完整规格',
      '材料单价(元/kg)',
      '建议单价(元)',
      `合计×${input.qty}(元)`,
      '备注',
      '客户选择(✓)'
    ]
  ]

  for (const opt of input.options) {
    customerSheet.push([
      opt.name,
      opt.brandLabel,
      opt.materialLabel,
      opt.color || '—',
      opt.specLabel,
      round2(opt.pricePerKg),
      round2(opt.costs.perUnit),
      round2(opt.costs.grand),
      opt.note || '',
      ''
    ])
  }

  customerSheet.push([], ['客户签名', ''], ['选定方案', ''], ['日期', ''])

  const wsCustomer = XLSX.utils.aoa_to_sheet(customerSheet)
  wsCustomer['!cols'] = [
    { wch: 14 },
    { wch: 12 },
    { wch: 12 },
    { wch: 10 },
    { wch: 28 },
    { wch: 16 },
    { wch: 14 },
    { wch: 14 },
    { wch: 20 },
    { wch: 12 }
  ]
  XLSX.utils.book_append_sheet(wb, wsCustomer, '顾客选型')

  const compareHeader = [
    '方案',
    '厂商',
    '材料',
    '颜色',
    '完整规格',
    '料卷',
    '单价元/kg',
    '材料费',
    '电费',
    '折旧',
    '人工',
    '包材运费',
    '含缓冲成本',
    '建议单价',
    '单件利润',
    '利润率%',
    '合计',
    '备注'
  ]
  const compareRows: (string | number)[][] = [compareHeader]
  for (const opt of input.options) {
    const c = opt.costs
    compareRows.push([
      opt.name,
      opt.brandLabel,
      opt.materialLabel,
      opt.color || '',
      opt.specLabel,
      opt.spoolLabel || '',
      round2(opt.pricePerKg),
      round2(c.mat),
      round2(c.elec),
      round2(c.wear),
      round2(c.labor),
      round2(c.fixed),
      round2(c.costWithFail),
      round2(c.perUnit),
      round2(c.profit),
      round2(c.profitRate),
      round2(c.grand),
      opt.note || ''
    ])
  }
  const wsCompare = XLSX.utils.aoa_to_sheet(compareRows)
  wsCompare['!cols'] = compareHeader.map(() => ({ wch: 12 }))
  XLSX.utils.book_append_sheet(wb, wsCompare, '方案对比')

  const shared: (string | number)[][] = [
    ['共用打印参数'],
    ['导出时间', input.time],
    ['客户', input.customer || '—'],
    ['项目', input.jobName || '—'],
    ['工艺', input.tech],
    ['模型重量 (g)', input.weightG],
    ['损耗/支撑 (%)', input.wastePct],
    ['打印时长 (h)', round2(input.printHours)],
    ['功率 (W)', input.watts],
    ['电费 (元/kWh)', input.electricity],
    ['折旧 (元/h)', input.wearPerHour],
    ['人工 (分钟)', input.laborMinutes],
    ['人工单价 (元/h)', input.laborRate],
    ['包材 (元)', input.packaging],
    ['运费 (元)', input.shipping],
    ['失败缓冲 (%)', input.failPct],
    ['定价方式', input.pricingMode],
    ['加成 (%)', input.markupPct],
    ['目标利润率 (%)', input.marginPct],
    ['最低单价 (元)', input.minPrice],
    ['数量', input.qty],
    ['方案数', input.options.length]
  ]
  const wsShared = XLSX.utils.aoa_to_sheet(shared)
  wsShared['!cols'] = [{ wch: 22 }, { wch: 28 }]
  XLSX.utils.book_append_sheet(wb, wsShared, '共用参数')

  return XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as Uint8Array
}
