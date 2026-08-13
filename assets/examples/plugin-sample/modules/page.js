/** Front page module */
module.exports = async function page(api) {
  const devices = api.getDevices()
  return {
    __html: `<!doctype html>
<html><head><meta charset="utf-8"/><title>问候插件</title>
<link rel="stylesheet" href="/api/v1/plugins/demo_hello/static/demo.css"/>
</head><body class="demo-hello">
<h2>${escapeHtml(api.getVar('greeting'))} · 插件页</h2>
<p>当前设备数：${devices.length}</p>
<p>自定义 API：<code>GET /api/v1/plugin-demo/hello</code></p>
<p>模块调用：<code>GET /api/v1/plugins/demo_hello/modules/page</code></p>
</body></html>`
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
