/**
 * print_log page module — 记录列表（iframe srcDoc，同源可读 JWT）
 */
module.exports = async function page(api) {
  const showNav = api.getVar('show_nav', '1') === '1'
  return {
    __html: `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>打印记录</title>
<style>
  :root { color-scheme: dark light; }
  body { margin: 0; font: 13px/1.45 system-ui, sans-serif; background: #0f141c; color: #e8eaed; }
  .wrap { padding: 16px; max-width: 1100px; margin: 0 auto; }
  h2 { margin: 0 0 4px; font-size: 18px; }
  .sub { opacity: .65; margin-bottom: 14px; font-size: 12px; }
  .bar { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; align-items: center; }
  input, select, button {
    border-radius: 8px; border: 1px solid rgba(255,255,255,.14);
    background: rgba(255,255,255,.06); color: inherit; padding: 7px 10px; font-size: 13px;
  }
  button { cursor: pointer; }
  button.primary { background: rgba(64,150,255,.3); border-color: rgba(64,150,255,.5); }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid rgba(255,255,255,.08); vertical-align: top; }
  th { opacity: .7; font-weight: 600; }
  .tag { display: inline-block; padding: 1px 7px; border-radius: 999px; font-size: 11px; background: rgba(255,255,255,.08); }
  .tag.system { background: rgba(64,150,255,.25); }
  .tag.queue { background: rgba(82,196,26,.2); }
  .tag.batch { background: rgba(250,173,20,.22); }
  .tag.on_device { background: rgba(255,120,117,.22); }
  .tag.printing { color: #69b1ff; }
  .tag.finished { color: #95de64; }
  .tag.failed { color: #ff7875; }
  .empty { padding: 28px; text-align: center; opacity: .55; }
  .err { color: #ff7875; margin: 8px 0; }
  .hint { font-size: 11px; opacity: .55; margin-top: 10px; }
</style>
</head>
<body>
<div class="wrap">
  <h2>打印记录</h2>
  <div class="sub">系统发送 / 打印队列 / 批量 / 现场操作 · 材料用量在打印结束后尽量回填</div>
  ${showNav ? '' : '<div class="err">导航已在设置中关闭；你仍可通过权限直达本页。</div>'}
  <div class="bar">
    <input id="q" placeholder="搜索文件/人员/设备" style="min-width:180px"/>
    <select id="source">
      <option value="">全部来源</option>
      <option value="system">系统发送</option>
      <option value="queue">打印队列</option>
      <option value="batch">批量打印</option>
      <option value="on_device">现场操作</option>
    </select>
    <select id="status">
      <option value="">全部状态</option>
      <option value="printing">打印中</option>
      <option value="finished">已完成</option>
      <option value="failed">失败/取消</option>
    </select>
    <button class="primary" id="reload">刷新</button>
  </div>
  <div id="err" class="err" style="display:none"></div>
  <div id="box"><div class="empty">加载中…</div></div>
  <div class="hint">配置：软件设置 → 打印记录。导航开关与用户权限「打印记录」可分别控制入口。</div>
</div>
<script>
(function () {
  var TOKEN_KEY = 'hanye_client_jwt';
  function token() { return localStorage.getItem(TOKEN_KEY) || ''; }
  function authHeaders() {
    var h = { Accept: 'application/json' };
    var t = token();
    if (t) h.Authorization = 'Bearer ' + t;
    return h;
  }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function fmtTime(s) {
    if (!s) return '—';
    try {
      var d = new Date(s);
      if (isNaN(d.getTime())) return esc(s);
      var p = function (n) { return n < 10 ? '0' + n : '' + n; };
      return d.getFullYear() + '-' + p(d.getMonth()+1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    } catch (e) { return esc(s); }
  }
  function fmtGrams(g) {
    if (g == null || g === '' || isNaN(Number(g))) return '—';
    return Math.round(Number(g) * 10) / 10 + ' g';
  }
  function fmtDur(sec) {
    if (sec == null || !isFinite(Number(sec))) return '—';
    var s = Math.max(0, Math.round(Number(sec)));
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    if (h) return h + '时' + m + '分';
    if (m) return m + '分' + r + '秒';
    return r + '秒';
  }
  function statusLabel(st) {
    if (st === 'printing') return '打印中';
    if (st === 'finished') return '已完成';
    if (st === 'failed') return '失败/取消';
    return st || '—';
  }
  function load() {
    var q = document.getElementById('q').value.trim();
    var source = document.getElementById('source').value;
    var status = document.getElementById('status').value;
    var url = '/api/v1/print-log/records?limit=200';
    if (q) url += '&q=' + encodeURIComponent(q);
    if (source) url += '&source=' + encodeURIComponent(source);
    if (status) url += '&status=' + encodeURIComponent(status);
    var box = document.getElementById('box');
    var err = document.getElementById('err');
    err.style.display = 'none';
    box.innerHTML = '<div class="empty">加载中…</div>';
    fetch(url, { headers: authHeaders() })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var payload = j && j.data && typeof j.data === 'object' ? j.data : j;
        if (!payload || payload.ok === false) throw new Error((payload && payload.message) || (j && j.message) || '加载失败');
        var rows = payload.records || [];
        if (!rows.length) {
          box.innerHTML = '<div class="empty">暂无记录</div>';
          return;
        }
        var html = '<table><thead><tr>' +
          '<th>时间</th><th>设备</th><th>文件</th><th>人员</th><th>来源</th><th>状态</th><th>材料</th><th>时长</th>' +
          '</tr></thead><tbody>';
        for (var i = 0; i < rows.length; i++) {
          var r = rows[i];
          html += '<tr>' +
            '<td>' + fmtTime(r.startedAt || r.createdAt) + (r.finishedAt ? '<div style="opacity:.55;font-size:11px">至 ' + fmtTime(r.finishedAt) + '</div>' : '') + '</td>' +
            '<td>' + esc(r.deviceName || r.deviceId) + '</td>' +
            '<td>' + esc(r.filename || '—') + '</td>' +
            '<td>' + esc(r.userName || '—') + '</td>' +
            '<td><span class="tag ' + esc(r.source || '') + '">' + esc(r.sourceLabel || r.source || '—') + '</span></td>' +
            '<td><span class="tag ' + esc(r.status || '') + '">' + esc(statusLabel(r.status)) + '</span></td>' +
            '<td>' + fmtGrams(r.filamentUsedGrams) + '</td>' +
            '<td>' + fmtDur(r.durationSec) + '</td>' +
            '</tr>';
        }
        html += '</tbody></table>';
        box.innerHTML = html;
      })
      .catch(function (e) {
        err.style.display = '';
        err.textContent = e && e.message ? e.message : String(e);
        box.innerHTML = '<div class="empty">无法加载</div>';
      });
  }
  document.getElementById('reload').onclick = load;
  document.getElementById('q').onkeydown = function (e) { if (e.key === 'Enter') load(); };
  document.getElementById('source').onchange = load;
  document.getElementById('status').onchange = load;
  load();
  setInterval(load, 15000);
})();
</script>
</body></html>`
  }
}
