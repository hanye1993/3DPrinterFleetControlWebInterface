import { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Spin } from 'antd'
import { PluginSlot } from '../plugins/PluginSlot'
import { useAuthStore } from '../stores/authStore'
import { serverGet } from '../api/serverClient'

/**
 * 需要整页打开的插件（系统文件选择器在 iframe 内常被拦）。
 * 其它插件默认侧栏内 iframe 镶嵌，避免跳转导致整站「其它插件不可用」。
 */
const STANDALONE_PLUGIN_IDS = new Set(['orca_web'])

type PluginListRow = {
  identifier?: string
  modules?: Array<{ name?: string; openMode?: string }>
}

/**
 * 插件页宿主：默认镶嵌 iframe；仅切片类或 module.openMode=standalone 时整页跳转。
 * 强制：?embed=1 镶嵌；?standalone=1 整页。
 */
export function PluginHostPage({
  identifier,
  moduleName
}: {
  identifier: string
  moduleName: string
}) {
  const [frameError, setFrameError] = useState(false)
  const [loading, setLoading] = useState(true)
  const [moduleStandalone, setModuleStandalone] = useState<boolean | null>(null)
  const slotCtx = { identifier, moduleName }
  const token = useAuthStore((s) => s.token)
  const serverUrl = useAuthStore((s) => s.serverUrl)

  const queryMode = useMemo(() => {
    if (typeof window === 'undefined') return null as null | 'embed' | 'standalone'
    const q = new URLSearchParams(window.location.search)
    if (q.get('embed') === '1') return 'embed'
    if (q.get('standalone') === '1' || q.get('fullscreen') === '1') return 'standalone'
    return null
  }, [])

  useEffect(() => {
    let cancelled = false
    setModuleStandalone(null)
    ;(async () => {
      try {
        const data = await serverGet<{
          ok?: boolean
          plugins?: PluginListRow[]
          data?: { plugins?: PluginListRow[] }
        }>('/api/v1/plugins')
        const list = Array.isArray(data.plugins)
          ? data.plugins
          : Array.isArray(data.data?.plugins)
            ? data.data!.plugins!
            : []
        const plug = list.find(
          (p) => String(p.identifier || (p as { id?: string }).id || '') === identifier
        )
        const mod = (plug?.modules || []).find((m) => String(m.name || '') === moduleName)
        const mode = String(mod?.openMode || '').toLowerCase()
        if (!cancelled) {
          setModuleStandalone(mode === 'standalone' || mode === 'fullscreen' || mode === 'new')
        }
      } catch {
        if (!cancelled) setModuleStandalone(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [identifier, moduleName])

  const standalone = useMemo(() => {
    if (queryMode === 'embed') return false
    if (queryMode === 'standalone') return true
    if (STANDALONE_PLUGIN_IDS.has(identifier)) return true
    if (moduleStandalone === true) return true
    return false
  }, [queryMode, identifier, moduleStandalone])

  /** 尚未拉到模块元数据且非白名单时，先按镶嵌处理，避免误跳转 */
  const ready = queryMode != null || STANDALONE_PLUGIN_IDS.has(identifier) || moduleStandalone !== null
  const embed = !standalone

  const frameSrc = useMemo(() => {
    const base = String(serverUrl || '').replace(/\/$/, '')
    const jwt = String(token || '').trim()
    if (!base || !jwt || !/^https?:\/\//i.test(base)) return ''
    const path = `/api/v1/plugins/${encodeURIComponent(identifier)}/page/${encodeURIComponent(moduleName)}`
    const q = new URLSearchParams({ access_token: jwt })
    if (embed) q.set('embed', '1')
    return `${base}${path}?${q.toString()}`
  }, [identifier, moduleName, serverUrl, token, embed])

  useEffect(() => {
    if (!ready || !frameSrc || embed) return
    window.location.assign(frameSrc)
  }, [frameSrc, embed, ready])

  if (!frameSrc) {
    return (
      <>
        <PluginSlot name="plugin.host.before" context={slotCtx} />
        <PluginSlot name="plugin.host" replace context={slotCtx}>
          <Alert
            type="warning"
            showIcon
            message="无法加载插件"
            description="请确认已登录且服务地址有效"
            style={{ margin: 16 }}
          />
        </PluginSlot>
        <PluginSlot name="plugin.host.after" context={slotCtx} />
      </>
    )
  }

  if (!ready) {
    return (
      <>
        <PluginSlot name="plugin.host.before" context={slotCtx} />
        <PluginSlot name="plugin.host" replace context={slotCtx}>
          <div style={{ padding: 48, textAlign: 'center' }}>
            <Spin tip="加载插件…" />
          </div>
        </PluginSlot>
        <PluginSlot name="plugin.host.after" context={slotCtx} />
      </>
    )
  }

  if (!embed) {
    return (
      <>
        <PluginSlot name="plugin.host.before" context={slotCtx} />
        <PluginSlot name="plugin.host" replace context={slotCtx}>
          <div style={{ padding: 48, textAlign: 'center' }}>
            <Spin size="large" tip="正在打开插件页（全屏，可正常导入文件）…" />
            <p style={{ marginTop: 20, color: 'var(--text-secondary, #8b9cb3)' }}>
              此模块需要全屏打开（如切片导入 stl / 3mf），正在跳转…
            </p>
            <Button type="link" href={frameSrc}>
              若未自动跳转，请点击此处
            </Button>
          </div>
        </PluginSlot>
        <PluginSlot name="plugin.host.after" context={slotCtx} />
      </>
    )
  }

  if (frameError) {
    return (
      <>
        <PluginSlot name="plugin.host.before" context={slotCtx} />
        <PluginSlot name="plugin.host" replace context={slotCtx}>
          <Alert type="error" showIcon message="插件页加载失败" description="请刷新后重试" style={{ margin: 16 }} />
        </PluginSlot>
        <PluginSlot name="plugin.host.after" context={slotCtx} />
      </>
    )
  }

  return (
    <>
      <PluginSlot name="plugin.host.before" context={slotCtx} />
      <PluginSlot name="plugin.host" replace context={slotCtx}>
        <div style={{ position: 'relative', minHeight: '70vh', height: 'calc(100vh - 56px)' }}>
          {loading && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 1
              }}
            >
              <Spin tip="加载插件…" />
            </div>
          )}
          <iframe
            title={`plugin-${identifier}-${moduleName}`}
            className="plugin-frame"
            src={frameSrc}
            onLoad={() => setLoading(false)}
            onError={() => {
              setFrameError(true)
              setLoading(false)
            }}
            style={{
              width: '100%',
              height: '100%',
              minHeight: '70vh',
              border: 'none',
              borderRadius: 8,
              background: 'transparent'
            }}
          />
        </div>
      </PluginSlot>
      <PluginSlot name="plugin.host.after" context={slotCtx} />
    </>
  )
}

/** Optional: call plugin module with body */
export async function invokePluginModule(
  identifier: string,
  moduleName: string,
  body?: unknown
): Promise<unknown> {
  const { serverGet: get, serverSend } = await import('../api/serverClient')
  const path = `/api/v1/plugins/${encodeURIComponent(identifier)}/modules/${encodeURIComponent(moduleName)}`
  if (body === undefined) {
    const data = await get<{ data?: unknown }>(path)
    return data.data
  }
  const data = await serverSend<{ data?: unknown }>(path, 'POST', body)
  return data.data
}
