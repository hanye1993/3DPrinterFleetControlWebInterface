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
  var state = {
    me: null,
    board: null,
    devices: [],
    notices: [],
    waitingJobs: [],
    spools: [],
    tab: 'error',
    device: null,
    tabPicked: false
  }

  function deny(msg) {
    document.getElementById('app').innerHTML =
      '<div class="card"><h2>巡查看板</h2><p class="err">' +
      esc(msg) +
      '</p><p class="meta">请管理员把账号加入用户组「巡查」，或勾选权限 plugin.farm_dispatch.patrol</p></div>'
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
    if (!me.roles || !me.roles.patrol) return deny('当前账号不是巡查岗')
    state.me = me
    await loadBoard()
    setInterval(function () {
      if (state.me) loadBoard(true)
    }, 10000)
  }

  async function loadBoard(keepSheet) {
    var j = await api('GET', '/api/v1/farm-dispatch/patrol/board')
    if (!j || !j.ok) {
      document.getElementById('app').innerHTML =
        '<div class="err">' + esc((j && j.message) || '加载失败') + '</div>'
      return
    }
    state.board = j.board || {}
    state.devices = j.devices || []
    state.notices = j.notices || []
    state.waitingJobs = j.waitingJobs || []
    state.spools = j.spools || []
    if (!state.tabPicked) {
      if ((state.notices || []).length) state.tab = 'notices'
      else if (list('error').length) state.tab = 'error'
      else if (list('finished').length) state.tab = 'finished'
      state.tabPicked = true
    }
    render()
    if (keepSheet && state.device) openSheet(state.device.id)
  }

  function list(key) {
    return (state.board && state.board[key]) || []
  }

  function render() {
    var tabs = [
      { id: 'error', label: '报错', n: list('error').length },
      { id: 'finished', label: '完成', n: list('finished').length },
      { id: 'attention', label: '待处理', n: list('attention').length },
      { id: 'maintenance', label: '维修', n: list('maintenance').length },
      { id: 'printing', label: '打印中', n: list('printing').length },
      { id: 'notices', label: '通知', n: (state.notices || []).length },
      { id: 'idle', label: '空闲', n: list('idle').length }
    ]
    var u = state.me.user || {}
    var waitN = (state.waitingJobs || []).length
    document.getElementById('app').innerHTML =
      '<h2>巡查看板</h2><div class="sub">' +
      esc(u.displayName || u.username || '') +
      ' · 点设备可设空闲 / 维修 / 绑定耗材' +
      (waitN ? ' · <span style="color:var(--fd-warn)">待办任务 ' + waitN + '</span>' : '') +
      '</div>' +
      '<div class="tabs">' +
      tabs
        .map(function (t) {
          return (
            '<button class="tab' +
            (state.tab === t.id ? ' on' : '') +
            '" data-tab="' +
            t.id +
            '">' +
            t.label +
            (t.n ? ' ' + t.n : '') +
            '</button>'
          )
        })
        .join('') +
      '</div><div id="list"></div><div id="sheet" class="sheet-mask"></div>'
    Array.prototype.forEach.call(document.querySelectorAll('[data-tab]'), function (el) {
      el.onclick = function () {
        state.tab = el.getAttribute('data-tab')
        state.tabPicked = true
        render()
      }
    })
    renderList()
  }

  function card(d) {
    var badge =
      d.board === 'error'
        ? 'b-err'
        : d.board === 'finished'
          ? 'b-fin'
          : d.board === 'maintenance'
            ? 'b-mnt'
            : ''
    var label =
      d.board === 'error'
        ? '报错'
        : d.board === 'finished'
          ? '完成'
          : d.board === 'maintenance'
            ? '维修'
            : d.board === 'attention'
              ? '待处理'
              : d.board === 'printing'
                ? '打印中'
                : '空闲'
    var bound =
      (d.bound || [])
        .map(function (b) {
          return (
            '<span class="swatch" style="background:' +
            esc(b.colorHex || '#888') +
            '"></span> ' +
            esc((b.material || '') + ' ' + (b.color || ''))
          )
        })
        .join(' · ') || '未绑定耗材'
    return (
      '<div class="card" data-dev="' +
      esc(d.id) +
      '" style="cursor:pointer">' +
      '<div class="row"><strong>' +
      esc(d.name) +
      '</strong><span class="badge ' +
      badge +
      '">' +
      label +
      '</span></div>' +
      '<div class="meta">机型 ' +
      esc(d.model || '未知') +
      ' · ' +
      esc(d.state || d.health || '') +
      (d.filename ? '<br>文件 ' + esc(d.filename) : '') +
      (d.message ? '<br>' + esc(d.message) : '') +
      '<br>耗材：' +
      bound +
      '</div></div>'
    )
  }

  function renderList() {
    var box = document.getElementById('list')
    if (state.tab === 'notices') {
      var ns = state.notices || []
      if (!ns.length) {
        box.innerHTML = '<div class="empty">暂无待办通知</div>'
        return
      }
      box.innerHTML = ns
        .map(function (n) {
          return (
            '<div class="card" data-notice="' +
            esc(n.id) +
            '" data-job="' +
            esc(n.jobId || '') +
            '">' +
            '<strong>' +
            esc(n.title) +
            '</strong><div class="meta">' +
            esc(n.body) +
            '</div>' +
            '<button class="ok" style="margin-top:10px;width:100%" data-act="done">换好了 / 确认并重新派单</button></div>'
          )
        })
        .join('')
      Array.prototype.forEach.call(box.querySelectorAll('[data-act=done]'), function (btn) {
        btn.onclick = async function () {
          var cardEl = btn.closest('[data-notice]')
          btn.disabled = true
          var j = await api('POST', '/api/v1/farm-dispatch/patrol/notice-done', {
            noticeId: cardEl.getAttribute('data-notice'),
            jobId: cardEl.getAttribute('data-job') || undefined
          })
          if (!j || !j.ok) {
            alert((j && j.message) || '失败')
            btn.disabled = false
            return
          }
          var d = j.dispatch || {}
          if (d.busy) alert(d.message || '派单进行中')
          else if (d.waiting)
            alert(
              '仍无匹配机：' + ((d.job && d.job.waitReason) || d.diagnose || '请再检查绑料/空闲')
            )
          else if (d.ok === false) alert('重新派单失败：' + (d.message || '未知'))
          else if (d.ok)
            alert('已重新派单' + (d.device && d.device.name ? ' → ' + d.device.name : ''))
          else alert('已确认')
          await loadBoard()
        }
      })
      return
    }
    var rows = list(state.tab)
    if (!rows.length) {
      box.innerHTML = '<div class="empty">这一栏暂无设备</div>'
      return
    }
    box.innerHTML = rows.map(card).join('')
    Array.prototype.forEach.call(box.querySelectorAll('[data-dev]'), function (el) {
      el.onclick = function () {
        openSheet(el.getAttribute('data-dev'))
      }
    })
  }

  function findDev(id) {
    for (var i = 0; i < (state.devices || []).length; i++)
      if (String(state.devices[i].id) === String(id)) return state.devices[i]
    return null
  }

  function openSheet(id) {
    var d = findDev(id)
    if (!d) return
    state.device = d
    var sheet = document.getElementById('sheet')
    var opts = (state.spools || [])
      .filter(function (s) {
        return (s.slotsLeft != null ? s.slotsLeft : 1) > 0
      })
      .map(function (s) {
        var left = s.slotsLeft != null ? s.slotsLeft : '?'
        var rolls = s.rolls != null ? s.rolls : '?'
        var bound = s.boundCount != null ? s.boundCount : '?'
        return (
          '<option value="' +
          esc(s.id) +
          '">' +
          esc(
            (s.material || '') +
              ' / ' +
              (s.color || '') +
              ' · 余' +
              (s.remainGrams != null ? s.remainGrams + 'g' : '?') +
              ' · 可绑' +
              left +
              '（' +
              bound +
              '/' +
              rolls +
              '）'
          ) +
          '</option>'
        )
      })
      .join('')
    if (!opts) {
      opts = '<option value="" disabled>暂无可绑耗材（已绑满或未建档）</option>'
    }
    sheet.className = 'sheet-mask on'
    sheet.innerHTML =
      '<div class="sheet">' +
      '<div class="row"><strong>' +
      esc(d.name) +
      '</strong><button class="ghost" id="x">关闭</button></div>' +
      '<div class="meta" style="margin:8px 0 12px">机型 ' +
      esc(d.model || '未知') +
      '</div>' +
      '<div class="row" style="margin-bottom:12px">' +
      '<button class="ok" style="flex:1" id="idle">设为空闲</button>' +
      '<button class="warn" style="flex:1" id="mnt">设为维修</button></div>' +
      '<label class="meta">绑定耗材（耗材管理）</label>' +
      '<select id="spool" style="width:100%;margin:6px 0"><option value="">选择料卷…</option>' +
      opts +
      '</select>' +
      '<label class="meta">槽位（0=外挂，≥1=AMS）</label>' +
      '<input id="slot" type="number" value="0" min="0" style="width:100%;margin:6px 0 10px"/>' +
      '<button class="primary" style="width:100%" id="bind">绑定到本机</button>' +
      (d.bound && d.bound.length
        ? '<div class="meta" style="margin-top:12px">当前绑定</div>' +
          d.bound
            .map(function (b) {
              return (
                '<div class="row card" style="margin-top:6px"><div class="meta">' +
                esc(b.material + ' ' + b.color) +
                ' · 槽' +
                b.slotId +
                '</div><button class="ghost danger" data-u="' +
                esc(b.spoolId) +
                '" data-s="' +
                b.slotId +
                '">解绑</button></div>'
              )
            })
            .join('')
        : '') +
      '</div>'
    document.getElementById('x').onclick = function () {
      sheet.className = 'sheet-mask'
      sheet.innerHTML = ''
    }
    sheet.onclick = function (e) {
      if (e.target === sheet) document.getElementById('x').onclick()
    }
    document.getElementById('idle').onclick = function () {
      setDuty('idle')
    }
    document.getElementById('mnt').onclick = function () {
      setDuty('maintenance')
    }
    document.getElementById('bind').onclick = async function () {
      var spoolId = document.getElementById('spool').value
      if (!spoolId) return alert('请选择料卷')
      var j = await api('POST', '/api/v1/farm-dispatch/patrol/bind', {
        deviceId: d.id,
        spoolId: spoolId,
        slotId: Number(document.getElementById('slot').value) || 0
      })
      alert(j.ok ? '已绑定' : j.message || '失败')
      if (j.ok) await loadBoard(true)
    }
    Array.prototype.forEach.call(sheet.querySelectorAll('[data-u]'), function (btn) {
      btn.onclick = async function () {
        var j = await api('POST', '/api/v1/farm-dispatch/patrol/unbind', {
          deviceId: d.id,
          spoolId: btn.getAttribute('data-u'),
          slotId: Number(btn.getAttribute('data-s')) || 0
        })
        alert(j.ok ? '已解绑' : j.message || '失败')
        if (j.ok) await loadBoard(true)
      }
    })
  }

  async function setDuty(status) {
    var d = state.device
    if (!d) return
    var j = await api('POST', '/api/v1/farm-dispatch/patrol/duty', {
      deviceId: d.id,
      status: status
    })
    if (!j || !j.ok) {
      alert((j && j.message) || '失败')
      return
    }
    var msg = status === 'idle' ? '已设为空闲' : '已设为维修'
    if (status === 'idle' && j.completed) msg += '（收尾任务 ' + j.completed + ' 条）'
    alert(msg)
    await loadBoard(true)
  }

  boot().catch(function (e) {
    deny(String(e && e.message ? e.message : e))
  })
})()
