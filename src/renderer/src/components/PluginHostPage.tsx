import { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Spin } from 'antd'
import { PluginSlot } from '../plugins/PluginSlot'
import { useAuthStore } from '../stores/authStore'

/**
 * 插件页宿主：默认整页跳转打开（非 iframe），否则 Orca 等页面的文件选择器会被浏览器拦截。
 * 需要内嵌预览时可加 ?embed=1（文件导入可能不可用）。
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
  const slotCtx = { identifier, moduleName }
  const token = useAuthStore((s) => s.token)
  const serverUrl = useAuthStore((s) => s.serverUrl)

  const embed = useMemo(() => {
    if (typeof window === 'undefined') return false
    return new URLSearchParams(window.location.search).get('embed') === '1'
  }, [])

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
    if (!frameSrc || embed) return
    window.location.assign(frameSrc)
  }, [frameSrc, embed])

  if (!frameSrc) {
    return (
      <>
        <PluginSlot name="plugin.host.before" context={slotCtx} />
        <PluginSlot name="plugin.host" replace context={slotCtx}>
          <Alert type="warning" showIcon message="无法加载插件" description="请确认已登录且服务地址有效" style={{ margin: 16 }} />
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
              插件将在新页面打开，导入 stl / 3mf 不受 iframe 限制。
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
        <Alert
          type="info"
          showIcon
          message="内嵌模式"
          description="此模式下部分浏览器无法弹出文件选择器。请关闭 ?embed=1 或从侧栏正常进入插件。"
          style={{ margin: '8px 12px 0' }}
        />
        <div style={{ position: 'relative', minHeight: '70vh' }}>
          {loading && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1 }}>
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
  const { serverGet, serverSend } = await import('../api/serverClient')
  const path = `/api/v1/plugins/${encodeURIComponent(identifier)}/modules/${encodeURIComponent(moduleName)}`
  if (body === undefined) {
    const data = await serverGet<{ data?: unknown }>(path)
    return data.data
  }
  const data = await serverSend<{ data?: unknown }>(path, 'POST', body)
  return data.data
}
