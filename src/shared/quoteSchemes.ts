export type QuoteSchemeTech = 'fdm' | 'resin'
export type QuoteSchemePricingMode = 'markup' | 'margin'

/** One material option inside a saved quote scheme */
export type QuoteSchemeMaterialOption = {
  id: string
  name: string
  brandId: string
  materialId: string
  color: string
  colorHex: string
  pricePerKg: number
  spoolId: string | null
  note: string
}

/** Full calculation scheme persisted on the server data root */
export type QuoteSchemeRecord = {
  id: string
  name: string
  customer: string
  jobName: string
  tech: QuoteSchemeTech
  weightG: number
  hours: number
  minutesExtra: number
  wastePct: number
  printerId: string
  watts: number
  electricity: number
  wearPerHour: number
  laborMinutes: number
  laborRate: number
  packaging: number
  shipping: number
  failPct: number
  pricingMode: QuoteSchemePricingMode
  markupPct: number
  marginPct: number
  minPrice: number
  qty: number
  options: QuoteSchemeMaterialOption[]
  /** Original uploaded G-code file name */
  gcodeFileName?: string
  /** Relative path under data root, e.g. quote-schemes/{id}.gcode */
  gcodeRelativePath?: string
  gcodeNote?: string
  createdAt: string
  updatedAt: string
}

/** List row without loading G-code body */
export type QuoteSchemeSummary = Omit<QuoteSchemeRecord, 'options'> & {
  optionCount: number
  hasGcode: boolean
}
