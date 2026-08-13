/** Admin module — plugin settings page */
module.exports = async function admin(api, ctx) {
  if (ctx.method === 'POST' && ctx.body && typeof ctx.body === 'object') {
    const body = ctx.body
    if (typeof body.greeting === 'string') api.setVar('greeting', body.greeting)
    if (body.prefix_devices != null) {
      api.setVar(
        'prefix_devices',
        body.prefix_devices === true || body.prefix_devices === '1' ? '1' : '0'
      )
    }
  }
  return {
    __html: `<!doctype html>
<html><head><meta charset="utf-8"/><title>问候插件设置</title>
<link rel="stylesheet" href="/api/v1/plugins/demo_hello/static/demo.css"/>
</head><body class="demo-hello">
<h2>问候插件设置</h2>
<p>当前问候语：<b>${escapeHtml(api.getVar('greeting'))}</b></p>
<p>设备名前缀：${api.getVar('prefix_devices') === '1' ? '开' : '关'}</p>
<form onsubmit="return save(event)">
  <label>问候语 <input id="g" value="${escapeHtml(api.getVar('greeting'))}"/></label>
  <label><input id="p" type="checkbox" ${api.getVar('prefix_devices') === '1' ? 'checked' : ''}/> 给设备名加前缀</label>
  <button type="submit">保存</button>
</form>
<script>
async function save(e){
  e.preventDefault();
  const token = localStorage.getItem('hanye_client_jwt') || '';
  const headers = {'Content-Type':'application/json'};
  if (token) headers['Authorization'] = 'Bearer '+token;
  await fetch('/api/v1/plugins/demo_hello/vars', {
    method:'PATCH', headers,
    body: JSON.stringify({ vars: {
      greeting: document.getElementById('g').value,
      prefix_devices: document.getElementById('p').checked ? '1' : '0'
    }})
  });
  location.reload();
  return false;
}
</script>
</body></html>`
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
