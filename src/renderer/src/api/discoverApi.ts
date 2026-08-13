import { serverGet, serverSend } from './serverClient'

export type LanDiscoverHit = {
  host: string
  brand: string
  port: number
  label: string
  name?: string
  baseUrl?: string
  needsCredentials?: boolean
  detail?: string
}

export type LanDiscoverState = {
  ok?: boolean
  phase: string
  scanned: number
  total: number
  found: number
  message?: string
  hits: LanDiscoverHit[]
}

export async function startLanDiscover(brands: string[]): Promise<LanDiscoverState> {
  return serverSend<LanDiscoverState>('/api/v1/discover/lan', 'POST', { brands })
}

export async function getLanDiscover(): Promise<LanDiscoverState> {
  return serverGet<LanDiscoverState>('/api/v1/discover/lan')
}

export async function cancelLanDiscover(): Promise<void> {
  await serverSend('/api/v1/discover/lan', 'DELETE')
}

/** Poll until scan completes or timeoutMs elapsed. */
export async function pollLanDiscover(
  onProgress: (state: LanDiscoverState) => void,
  timeoutMs = 120_000
): Promise<LanDiscoverState> {
  const start = Date.now()
  for (;;) {
    const state = await getLanDiscover()
    onProgress(state)
    if (state.phase === 'done' || state.phase === 'error' || state.phase === 'idle') {
      return state
    }
    if (Date.now() - start > timeoutMs) {
      await cancelLanDiscover().catch(() => undefined)
      return { ...state, phase: 'error', message: '扫描超时' }
    }
    await new Promise((r) => setTimeout(r, 500))
  }
}
