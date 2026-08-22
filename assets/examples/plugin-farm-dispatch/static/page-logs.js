;(function () {
  var FD = window.FarmDispatch
  if (!FD) {
    document.getElementById('app').innerHTML =
      '<div class="card"><p class="err">shell.js 未加载（CSP/路径）</p></div>'
    return
  }
  var api = FD.api
  var esc = FD.esc
  var token = FD.token
  var apiBase = FD.apiBase
  var fmtTime = FD.fmtTime
  var ACTION = {
    ensure_groups: '初始化用户组',
    job_submit: '提交申请',
    job_approve: '审核通过',
    job_reject: '审核驳回',
    job_cancel: '取消任务',
    job_print_done: '打印完成',
    job_print_error: '打印报错',
    job_completed: '清床收尾',
    job_failed_cleared: '报错收尾',
    dispatch_ok: '派单成功',
    dispatch_waiting: '等换料',
    dispatch_failed: '派单失败',
    patrol_duty: '巡查值班',
    patrol_bind: '绑定耗材',
    patrol_unbind: '解绑耗材',
    patrol_notice_done: '通知完成',
    block_print: '拦截开打'
  }

  function deny(msg) {
    document.getElementById('app').innerHTML =
      '<div class="card"><h2>派单日志</h2><p class="err">' +
      esc(msg) +
      '</p><p class="meta">需要巡查/审核岗，或权限 plugin.farm_dispatch.logs</p></div>'
  }

  function label(a) {
    return ACTION[a] || a
  }

  async function boot() {
    if (!token()) return deny('未登录：请先在监控台登录')
    document.getElementById('app').innerHTML =
      '<div class="empty">连接服务中…<div class="meta" style="margin-top:8px">' +
      esc(apiBase()) +
      '</div></div>'
    var me = await api('GET', '/api/v1/farm-dispatch/me')
    if (!me || !me.ok)
      return deny((me && me.message) || '无法获取身份（请确认服务地址 ' + apiBase() + '）')
    if (!me.roles || !me.roles.logs) return deny('当前账号无日志权限')
    renderShell()
    await load()
  }

  function renderShell() {
    document.getElementById('app').innerHTML =
      '<h2>派单操作日志</h2><div class="sub">巡查 / 审核 / 派单 / 拦截等全部操作记录</div>' +
      '<div class="bar">' +
      '<select id="act"><option value="">全部动作</option>' +
      Object.keys(ACTION)
        .map(function (k) {
          return '<option value="' + k + '">' + esc(ACTION[k]) + '</option>'
        })
        .join('') +
      '</select><button class="primary" id="r">刷新</button></div><div id="box" class="card">加载中…</div>'
    document.getElementById('r').onclick = load
    document.getElementById('act').onchange = load
  }

  async function load() {
    var box = document.getElementById('box')
    var act = (document.getElementById('act') && document.getElementById('act').value) || ''
    var q =
      '/api/v1/farm-dispatch/logs?limit=300' +
      (act ? '&action=' + encodeURIComponent(act) : '')
    var j = await api('GET', q)
    if (!j || !j.ok) {
      box.innerHTML = '<div class="err">' + esc((j && j.message) || '加载失败') + '</div>'
      return
    }
    var rows = j.logs || []
    if (!rows.length) {
      box.textContent = '暂无日志'
      return
    }
    box.innerHTML =
      '<table><thead><tr><th>时间</th><th>操作人</th><th>动作</th><th>详情</th></tr></thead><tbody>' +
      rows
        .map(function (r) {
          return (
            '<tr><td>' +
            esc(fmtTime(r.at)) +
            '</td><td>' +
            esc(r.actorName) +
            '</td><td>' +
            esc(label(r.action)) +
            '</td><td><code>' +
            esc(JSON.stringify(r.detail || {})) +
            '</code></td></tr>'
          )
        })
        .join('') +
      '</tbody></table>'
  }

  boot().catch(function (e) {
    deny(String(e && e.message ? e.message : e))
  })
})()
