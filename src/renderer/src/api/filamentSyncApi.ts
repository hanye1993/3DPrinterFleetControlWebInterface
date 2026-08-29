import { serverGet, serverSend, serverSendAllowFail } from './serverClient'

export type FilamentSyncSourceType = 'none' | 'spoolman'
export type FilamentSyncDirection = 'pull' | 'push' | 'mutual'

export type FilamentSyncSource = {
  id: string
  type: FilamentSyncSourceType
  enabled: boolean
  name: string
  baseUrl: string
  direction: FilamentSyncDirection
}

export type FilamentSyncSourcesState = {
  ok?: boolean
  sources: FilamentSyncSource[]
  message?: string
}

export type FilamentSyncResult = {
  ok: boolean
  message: string
  results?: Array<{
    ok: boolean
    sourceId: string
    name: string
    message: string
    pushed: number
    pulled: number
    updated: number
    skipped: number
  }>
}

export async function fetchFilamentSyncSources() {
  return serverGet<FilamentSyncSourcesState>('/api/v1/filament/sync-sources')
}

export async function saveFilamentSyncSources(sources: Partial<FilamentSyncSource>[]) {
  return serverSend<FilamentSyncSourcesState>('/api/v1/filament/sync-sources', 'POST', { sources })
}

export async function testFilamentSyncSource(id: string) {
  return serverSendAllowFail<{ ok: boolean; message: string }>(
    '/api/v1/filament/sync-sources/test',
    'POST',
    { id }
  )
}

export async function runFilamentSyncSources(opts?: { id?: string; all?: boolean }) {
  return serverSendAllowFail<FilamentSyncResult>('/api/v1/filament/sync-sources/sync', 'POST', {
    ...(opts?.id ? { id: opts.id } : {}),
    ...(opts?.all ? { all: true } : !opts?.id ? { all: true } : {})
  })
}
