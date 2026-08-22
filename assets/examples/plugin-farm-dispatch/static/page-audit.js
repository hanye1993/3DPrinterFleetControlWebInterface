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
  var state = { me: null, jobs: [], tab: 'pending_audit', selected: null, candidates: null }

  function statusBadge(s) {
    var map = {
      pending_audit: ['待审核', 'b-wait'],
      approved: ['已通过', ''],
      waiting_material: ['等换料', 'b-wait'],
      printing: ['打印中', 'b-print'],
      print_done: ['待清床', 'b-fin'],
      print_error: ['打印报错', 'b-err'],
      completed: ['已完成', 'b-fin'],
      rejected: ['已驳回', 'b-rej'],
      failed: ['派单失败', 'b-rej'],
      cancelled: ['已取消', '']
    }
    var m = map[s] || [s, '']
    return '<span class="badge ' + m[1] + '">' + m[0] + '</span>'
  }

  function dispatchAlert(d) {
    if (!d) return '已处理'
    if (d.busy) return d.message || '派单进行中，请稍候'
    if (d.waiting)
      return '暂无匹配机，已通知巡查换料' + (d.diagnose ? '\n' + d.diagnose : '')
    if (d.ok === false) {
      var tried =
        d.tried && d.tried.length
          ? '\n已尝试：' +
            d.tried
              .map(function (t) {
                return t.name
              })
              .join('、')
          : ''
      return '派单失败：' + (d.message || '未知') + tried
    }
    return '已派单' + (d.device && d.device.name ? ' → ' + d.device.name : '')
  }

  function deny(msg) {
    document.getElementById('app').innerHTML =
      '<div class="card"><h2>派单审核</h2><p class="err">' +
      esc(msg) +
      '</p><p class="meta">请加入用户组「审核」，或勾选 plugin.farm_dispatch.audit</p></div>'
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
    if (!me.roles || !me.roles.audit) return deny('当前账号不是审核岗')
    state.me = me
    await refresh()
    setInterval(function () {
      if (state.me) refresh(true)
    }, 20000)
  }

  async function refresh(silent) {
    var j = await api('GET', '/api/v1/farm-dispatch/jobs?limit=200')
    if (!j || !j.ok) {
      if (!silent)
        document.getElementById('app').innerHTML =
          '<div class="err">' + esc((j && j.message) || '加载失败') + '</div>'
      return
    }
    state.jobs = j.jobs || []
    if (state.selected)
      state.selected = state.jobs.find(function (x) {
        return x.id === state.selected.id
      }) || null
    render()
  }

  function filtered() {
    if (!state.tab) return state.jobs
    return state.jobs.filter(function (j) {
      return j.status === state.tab
    })
  }

  function tabCount(st) {
    if (!st) return state.jobs.length
    return state.jobs.filter(function (j) {
      return j.status === st
    }).length
  }

  function render() {
    var u = state.me.user || {}
    var tabs = [
      ['pending_audit', '待审核'],
      ['waiting_material', '等换料'],
      ['printing', '打印中'],
      ['print_done', '待清床'],
      ['print_error', '报错'],
      ['failed', '失败'],
      ['completed', '完成'],
      ['rejected', '驳回'],
      ['cancelled', '取消'],
      ['', '全部']
    ]
    document.getElementById('app').innerHTML =
      '<div class="row"><div><h2>派单审核</h2><div class="sub">' +
      esc(u.displayName || u.username || '') +
      ' · 通过后按机型 / 材料 / 颜色智能派单</div></div>' +
      '<button class="ghost" id="reload">刷新</button></div>' +
      '<div class="tabs">' +
      tabs
        .map(function (t) {
          var n = tabCount(t[0])
          return (
            '<button class="tab' +
            (state.tab === t[0] ? ' on' : '') +
            '" data-tab="' +
            t[0] +
            '">' +
            t[1] +
            (n ? ' ' + n : '') +
            '</button>'
          )
        })
        .join('') +
      '</div><div class="grid"><div id="list"></div><div id="detail"></div></div>'
    document.getElementById('reload').onclick = function () {
      refresh()
    }
    Array.prototype.forEach.call(document.querySelectorAll('[data-tab]'), function (el) {
      el.onclick = function () {
        state.tab = el.getAttribute('data-tab')
        state.candidates = null
        renderList()
        renderDetail()
      }
    })
    renderList()
    renderDetail()
  }

  function renderList() {
    var el = document.getElementById('list')
    var list = filtered()
    if (!list.length) {
      el.innerHTML = '<div class="card empty">暂无任务</div>'
      return
    }
    el.innerHTML = list
      .map(function (j) {
        var on = state.selected && state.selected.id === j.id
        return (
          '<div class="card" data-id="' +
          esc(j.id) +
          '" style="cursor:pointer' +
          (on ? ';outline:1px solid var(--fd-primary)' : '') +
          '">' +
          '<div class="row"><strong>' +
          esc(j.filename) +
          '</strong>' +
          statusBadge(j.status) +
          '</div>' +
          '<div class="meta">申请人 ' +
          esc(j.applicantName) +
          ' · ' +
          esc(fmtTime(j.createdAt)) +
          '<br>机型 ' +
          esc(j.model) +
          ' · ' +
          esc(j.material) +
          ' · ' +
          esc(j.color || j.colorHex) +
          (j.rejectReason
            ? '<br><span style="color:var(--fd-err)">驳回：' + esc(j.rejectReason) + '</span>'
            : '') +
          (j.waitReason
            ? '<br><span style="color:var(--fd-warn)">' + esc(j.waitReason) + '</span>'
            : '') +
          '</div></div>'
        )
      })
      .join('')
    Array.prototype.forEach.call(el.querySelectorAll('[data-id]'), function (c) {
      c.onclick = function () {
        state.selected = state.jobs.find(function (x) {
          return x.id === c.getAttribute('data-id')
        })
        state.candidates = null
        renderList()
        renderDetail()
        loadCandidates()
      }
    })
  }

  async function loadCandidates() {
    var j = state.selected
    if (
      !j ||
      ['pending_audit', 'waiting_material', 'approved', 'failed', 'print_error'].indexOf(j.status) <
        0
    )
      return
    var r = await api(
      'GET',
      '/api/v1/farm-dispatch/job/candidates?id=' + encodeURIComponent(j.id)
    )
    if (state.selected && state.selected.id === j.id) {
      state.candidates =
        r && r.ok ? r : { candidates: [], diagnose: (r && r.message) || '预览失败' }
      renderDetail()
    }
  }

  function renderDetail() {
    var el = document.getElementById('detail')
    var j = state.selected
    if (!j) {
      el.innerHTML = '<div class="card empty">选择左侧任务</div>'
      return
    }
    var candHtml = ''
    if (state.candidates) {
      var cs = state.candidates.candidates || []
      candHtml =
        '<div class="meta" style="margin-top:10px"><b>可派候选</b> ' +
        cs.length +
        (state.candidates.diagnose
          ? '<br><span style="color:var(--fd-warn)">' +
            esc(state.candidates.diagnose) +
            '</span>'
          : '') +
        (cs.length
          ? '<br>' +
            cs
              .map(function (c) {
                return (
                  esc(c.name) +
                  '（余料约 ' +
                  (c.remain != null ? c.remain + 'g' : '?') +
                  '）'
                )
              })
              .join('<br>')
          : '') +
        '</div>'
    }
    el.innerHTML =
      '<div class="card"><h2 style="font-size:15px">任务详情</h2>' +
      '<div class="meta">ID ' +
      esc(j.id) +
      '<br>状态 ' +
      statusBadge(j.status) +
      '<br>文件 ' +
      esc(j.filename) +
      '<br>机型 ' +
      esc(j.model) +
      ' / 材料 ' +
      esc(j.material) +
      ' / 颜色 ' +
      esc(j.color || j.colorHex) +
      '<br>申请人 ' +
      esc(j.applicantName) +
      ' · ' +
      esc(fmtTime(j.createdAt)) +
      (j.deviceName ? '<br>已派设备 ' + esc(j.deviceName) : '') +
      (j.note ? '<br>备注 ' + esc(j.note) : '') +
      (j.rejectReason
        ? '<br><b style="color:var(--fd-err)">驳回原因：' + esc(j.rejectReason) + '</b>'
        : '') +
      (j.cancelReason ? '<br><b>取消：' + esc(j.cancelReason) + '</b>' : '') +
      (j.failReason
        ? '<br><b style="color:var(--fd-err)">失败：' + esc(j.failReason) + '</b>'
        : '') +
      (j.waitReason
        ? '<br><b style="color:var(--fd-warn)">' + esc(j.waitReason) + '</b>'
        : '') +
      '</div>' +
      candHtml +
      (j.status === 'pending_audit'
        ? '<div style="margin-top:12px"><button class="ok" id="approve">通过并智能派单</button></div>' +
          '<div class="meta" style="margin-top:12px">驳回原因（必填）</div>' +
          '<textarea id="reason" placeholder="说明为什么驳回，申请人可见"></textarea>' +
          '<button class="danger" id="reject">驳回</button>'
        : '') +
      (['waiting_material', 'failed', 'approved', 'print_error'].indexOf(j.status) >= 0
        ? '<div style="margin-top:12px"><button class="primary" id="redispatch">重新智能派单</button></div>'
        : '') +
      (['pending_audit', 'approved', 'waiting_material', 'failed', 'print_error'].indexOf(
        j.status
      ) >= 0
        ? '<div style="margin-top:8px"><button class="ghost danger" id="cancel">取消任务</button></div>'
        : '') +
      '</div>'
    var a = document.getElementById('approve')
    if (a)
      a.onclick = async function () {
        a.disabled = true
        var r = await api('POST', '/api/v1/farm-dispatch/job/approve', { id: j.id })
        if (!r || !r.ok) {
          alert((r && r.message) || '失败')
          a.disabled = false
          await refresh()
          return
        }
        alert(dispatchAlert(r.dispatch))
        await refresh()
      }
    var rj = document.getElementById('reject')
    if (rj)
      rj.onclick = async function () {
        var reason = (document.getElementById('reason').value || '').trim()
        if (!reason) return alert('请填写驳回原因')
        var r = await api('POST', '/api/v1/farm-dispatch/job/reject', {
          id: j.id,
          reason: reason
        })
        alert(r.ok ? '已驳回' : r.message || '失败')
        await refresh()
      }
    var rd = document.getElementById('redispatch')
    if (rd)
      rd.onclick = async function () {
        rd.disabled = true
        var r = await api('POST', '/api/v1/farm-dispatch/job/redispatch', { id: j.id })
        if (!r || !r.ok) alert((r && r.message) || '失败')
        else alert(dispatchAlert(r.dispatch))
        await refresh()
      }
    var c = document.getElementById('cancel')
    if (c)
      c.onclick = async function () {
        var reason = prompt('取消原因（可选）', '') || ''
        var r = await api('POST', '/api/v1/farm-dispatch/job/cancel', {
          id: j.id,
          reason: reason
        })
        alert(r.ok ? '已取消' : r.message || '失败')
        await refresh()
      }
  }

  boot().catch(function (e) {
    deny(String(e && e.message ? e.message : e))
  })
})()
