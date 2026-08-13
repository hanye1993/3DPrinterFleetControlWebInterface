/** 管理页：说明 + 当前阈值 */
module.exports = async function admin(api) {
  const warn = api.getVar('warn_celsius', '45')
  const showCards = api.getVar('show_on_cards', '1')
  const showPanel = api.getVar('show_panel', '1')
  const poll = api.getVar('poll_sec', '3')

  return {
    __html: `<!doctype html>
<html><head><meta charset="utf-8"/><title>仓温插件设置</title>
<link rel="stylesheet" href="/api/v1/plugins/chamber_temp/static/page.css"/>
</head><body class="chamber-temp-page">
<h2>仓内温度 · 插件设置</h2>
<p>在「软件设置 → 插件 → 变量」中修改下列项，或在此查看当前值。</p>
<ul>
  <li>设备卡片显示：<code>${esc(showCards === '1' ? '开' : '关')}</code></li>
  <li>列表上方仓温条：<code>${esc(showPanel === '1' ? '开' : '关')}</code></li>
  <li>高温阈值：<code>${esc(warn)}°C</code></li>
  <li>刷新间隔：<code>${esc(poll)}s</code></li>
</ul>
<p>自定义 API：<code>GET /api/v1/chamber-temp/temps</code></p>
</body></html>`
  }
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
