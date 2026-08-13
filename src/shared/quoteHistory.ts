export type QuoteHistoryAction = 'copy' | 'export'

export type QuoteHistoryOption = {
  name: string
  brandLabel: string
  materialLabel: string
  color: string
  pricePerKg: number
  perUnit: number
  grand: number
  profit?: number
  note?: string
}

/** One copy/export event from tools quote calculator */
export type QuoteHistoryRecord = {
  id: string
  action: QuoteHistoryAction
  createdAt: string
  userId: string
  username: string
  displayName: string
  customer: string
  jobName: string
  tech: 'fdm' | 'resin'
  weightG: number
  printHours: number
  qty: number
  options: QuoteHistoryOption[]
  /** Min/max option grand totals for quick filter */
  minGrand: number
  maxGrand: number
  textPreview?: string
  gcodeFileName?: string
}
