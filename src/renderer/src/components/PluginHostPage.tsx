import { useMemo, useState } from 'react'
import { Alert, Spin } from 'antd'
import { PluginSlot } from '../plugins/PluginSlot'
import { useAuthStore } from '../stores/authStore'

/**
 * 插件页宿主：用 iframe src 加载真实 URL（非 srcDoc），否则文件选择器在 sandbox 内无法工作。
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

  const frameSrc = useMemo(() => {
    const base = String(serverUrl || '').replace(/\/$/, '')
    const jwt = String(token || '').trim()
    if (!base || !jwt || !/^https?:\/\//i.test(base)) return ''
    const path = `/api/v1/plugins/${encodeURIComponent(identifier)}/page/${encodeURIComponent(moduleName)}`
    return `${base}${path}?access_token=${encodeURIComponent(jwt)}`
  }, [identifier, moduleName, serverUrl, token])

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
