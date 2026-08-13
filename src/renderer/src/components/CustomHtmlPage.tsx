import { useMemo } from 'react'
import { findPageItem, pageIdFromSection } from '@shared/navConfig'
import { useNavConfigStore } from '../stores/navConfigStore'
import { useDeviceStore } from '../stores/deviceStore'
import { PluginSlot } from '../plugins/PluginSlot'

/**
 * Custom HTML page host. Renders in a sandboxed iframe.
 */
export function CustomHtmlPage() {
  const section = useDeviceStore((s) => s.section)
  const items = useNavConfigStore((s) => s.config.items)
  const pageId = typeof section === 'string' && section.startsWith('page:')
    ? pageIdFromSection(section)
    : ''
  const item = useMemo(
    () => (pageId ? findPageItem(items, pageId) : null),
    [items, pageId]
  )

  if (!item || item.type !== 'page') {
    return (
      <PluginSlot name="custom.page.empty" replace>
        <div className="custom-html-page custom-html-page-empty">
          <p>单页不存在或已删除。</p>
        </div>
      </PluginSlot>
    )
  }

  const html = item.html || '<p style="padding:24px;color:#888">空白页</p>'
  const doc = `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><base target="_blank"/><style>html,body{margin:0;padding:0;background:transparent;color:inherit;font-family:system-ui,sans-serif}a{color:#3b82f6}</style></head><body>${html}</body></html>`

  return (
    <>
      <PluginSlot name="custom.page.before" />
      <PluginSlot name="custom.page" replace>
        <div className="custom-html-page">
          <iframe
            title={item.label || '单页'}
            className="custom-html-page-frame"
            sandbox="allow-scripts allow-popups allow-forms allow-popups-to-escape-sandbox"
            srcDoc={doc}
          />
        </div>
      </PluginSlot>
      <PluginSlot name="custom.page.after" />
    </>
  )
}
