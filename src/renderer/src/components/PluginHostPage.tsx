import { useEffect, useState } from 'react'
import { Alert, Spin } from 'antd'
import { serverGet, serverSend } from '../api/serverClient'
import { PluginSlot } from '../plugins/PluginSlot'

/** Load plugin module HTML with JWT (srcDoc; link tags use public static paths). */
export function PluginHostPage({
  identifier,
  moduleName
}: {
  identifier: string
  moduleName: string
}) {
  const [html, setHtml] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const slotCtx = { identifier, moduleName }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setHtml(null)
    const path = `/api/v1/plugins/${encodeURIComponent(identifier)}/modules/${encodeURIComponent(moduleName)}`
    void (async () => {
      try {
        const data = await serverGet<{ data?: unknown }>(path)
        if (cancelled) return
        const raw = data.data
        if (raw && typeof raw === 'object' && '__html' in (raw as object)) {
          setHtml(String((raw as { __html: string }).__html))
        } else {
          setHtml(
            `<pre style="padding:16px;font-family:ui-monospace,monospace">${escapeHtml(
              JSON.stringify(raw, null, 2)
            )}</pre>`
          )
        }
      } catch (e) {
        // POST-only modules: try GET failed — show message
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [identifier, moduleName])

  if (loading) {
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
  if (error) {
    return (
      <>
        <PluginSlot name="plugin.host.before" context={slotCtx} />
        <PluginSlot name="plugin.host" replace context={slotCtx}>
          <Alert
            type="error"
            showIcon
            message="插件加载失败"
            description={error}
            style={{ margin: 16 }}
          />
        </PluginSlot>
        <PluginSlot name="plugin.host.after" context={slotCtx} />
      </>
    )
  }
  return (
    <>
      <PluginSlot name="plugin.host.before" context={slotCtx} />
      <PluginSlot name="plugin.host" replace context={slotCtx}>
        <iframe
          title={`plugin-${identifier}-${moduleName}`}
          className="plugin-frame"
          srcDoc={html || ''}
          sandbox="allow-scripts allow-same-origin allow-forms"
          style={{
            width: '100%',
            minHeight: '70vh',
            border: 'none',
            borderRadius: 8,
            background: '#fff'
          }}
        />
      </PluginSlot>
      <PluginSlot name="plugin.host.after" context={slotCtx} />
    </>
  )
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** Optional: call plugin module with body */
export async function invokePluginModule(
  identifier: string,
  moduleName: string,
  body?: unknown
): Promise<unknown> {
  const path = `/api/v1/plugins/${encodeURIComponent(identifier)}/modules/${encodeURIComponent(moduleName)}`
  if (body === undefined) {
    const data = await serverGet<{ data?: unknown }>(path)
    return data.data
  }
  const data = await serverSend<{ data?: unknown }>(path, 'POST', body)
  return data.data
}
