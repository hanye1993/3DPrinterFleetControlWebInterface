/** 仓内温度一览页 */
module.exports = async function page(api) {
  const devices = api.getDevices() || []
  const statuses = api.getStatuses() || {}
  const warn = Number(api.getVar('warn_celsius', '45')) || 45

  const rows = devices
    .map((d) => {
      const id = String(d.id || '')
      const st = statuses[id] || {}
      const temp =
        st.chamberTemp == null || Number.isNaN(Number(st.chamberTemp))
          ? null
          : Number(st.chamberTemp)
      return {
        id,
        name: String(d.name || id),
        brand: String(d.brand || ''),
        health: String(st.health || 'offline'),
        temp,
        warn: temp != null && temp >= warn
      }
    })
    .sort((a, b) => {
      if (a.temp == null && b.temp == null) return a.name.localeCompare(b.name)
      if (a.temp == null) return 1
      if (b.temp == null) return -1
      return b.temp - a.temp
    })

  const body = rows
    .map((r) => {
      const t = r.temp == null ? '—' : `${Math.round(r.temp)} °C`
      const cls = r.warn ? 'warn' : r.temp == null ? 'na' : 'ok'
      return `<tr class="${cls}">
  <td>${esc(r.name)}</td>
  <td>${esc(r.brand || '—')}</td>
  <td>${esc(r.health)}</td>
  <td class="temp">${t}</td>
</tr>`
    })
    .join('')

  return {
    __html: `<!doctype html>
<html><head><meta charset="utf-8"/><title>仓内温度</title>
<link rel="stylesheet" href="/api/v1/plugins/chamber_temp/static/page.css"/>
</head><body class="chamber-temp-page">
<h2>仓内温度</h2>
<p class="meta">预警阈值 <strong>${warn}°C</strong> · 共 ${rows.length} 台 · <button type="button" id="ct-refresh">刷新</button></p>
<table>
  <thead><tr><th>设备</th><th>品牌</th><th>状态</th><th>仓温</th></tr></thead>
  <tbody>${body || '<tr><td colspan="4">暂无设备</td></tr>'}</tbody>
</table>
<script>
document.getElementById('ct-refresh').onclick = function () { location.reload() }
</script>
</body></html>`
  }
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
