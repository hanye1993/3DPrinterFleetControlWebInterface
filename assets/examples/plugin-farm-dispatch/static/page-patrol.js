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
    groups: [],
    groupFilter: '',
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
    state.groups = j.groups || []
    state.notices = j.notices || []
    state.waitingJobs = j.waitingJobs || []
    state.spools = j.spools || []
    if (
      state.groupFilter &&
      state.groups.indexOf(state.groupFilter) < 0
    ) {
      state.groupFilter = ''
    }
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
    var rows = (state.board && state.board[key]) || []
    if (!state.groupFilter) return rows
    return rows.filter(function (d) {
      return String(d.group || '其他') === state.groupFilter
    })
  }

  function groupChipsHtml() {
    var groups = state.groups || []
    if (groups.length <= 1) return ''
    var chips = [
      { id: '', label: '全部分组' }
    ].concat(
      groups.map(function (g) {
        return { id: g, label: g }
      })
    )
    return (
      '<div class="group-chips">' +
      chips
        .map(function (c) {
          return (
            '<button type="button" class="group-chip' +
            (state.groupFilter === c.id ? ' on' : '') +
            '" data-group="' +
            esc(c.id) +
            '">' +
            esc(c.label) +
            '</button>'
          )
        })
        .join('') +
      '</div>'
    )
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
      ' · 按设备分组筛选 · 点设备可设空闲 / 维修 / 绑定耗材' +
      (waitN ? ' · <span style="color:var(--fd-warn)">待办任务 ' + waitN + '</span>' : '') +
      '</div>' +
      groupChipsHtml() +
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
    Array.prototype.forEach.call(document.querySelectorAll('[data-group]'), function (el) {
      el.onclick = function () {
        state.groupFilter = el.getAttribute('data-group') || ''
        render()
      }
    })
    renderList()
  }

  function cardTone(board) {
    if (board === 'error') return 'is-err'
    if (board === 'finished') return 'is-fin'
    if (board === 'maintenance') return 'is-mnt'
    if (board === 'printing') return 'is-print'
    return ''
  }

  function cardBadge(board) {
    if (board === 'error') return { cls: 'b-err', label: '报错' }
    if (board === 'finished') return { cls: 'b-fin', label: '完成' }
    if (board === 'maintenance') return { cls: 'b-mnt', label: '维修' }
    if (board === 'attention') return { cls: 'b-wait', label: '待处理' }
    if (board === 'printing') return { cls: 'b-print', label: '打印中' }
    return { cls: '', label: '空闲' }
  }

  function card(d) {
    var b = cardBadge(d.board)
    var fil =
      (d.bound || []).length > 0
        ? (d.bound || [])
            .map(function (x) {
              return (
                '<span class="swatch" title="' +
                esc((x.material || '') + ' ' + (x.color || '')) +
                '" style="background:' +
                esc(x.colorHex || '#888') +
                '"></span>'
              )
            })
            .join('')
        : '<span>未绑耗材</span>'
    var statusLine = esc(d.state || d.health || '—')
    if (d.message) statusLine += ' · ' + esc(d.message)
    return (
      '<div class="card dev-card ' +
      cardTone(d.board) +
      '" data-dev="' +
      esc(d.id) +
      '">' +
      '<div class="row">' +
      '<div class="dev-card-name">' +
      esc(d.name) +
      '</div>' +
      '<span class="badge ' +
      b.cls +
      '">' +
      b.label +
      '</span></div>' +
      '<div class="dev-card-body meta">' +
      '<div>' +
      esc(d.model || '未知机型') +
      '</div>' +
      '<div style="margin-top:4px">' +
      statusLine +
      '</div>' +
      (d.filename
        ? '<div style="margin-top:4px;word-break:break-all">文件 ' + esc(d.filename) + '</div>'
        : '') +
      '<div class="dev-card-fil">' +
      fil +
      '</div></div>' +
      '<div class="dev-card-foot"><span>' +
      esc(d.group || '其他') +
      '</span><span>点按操作</span></div></div>'
    )
  }

  function wrapGrid(html) {
    return '<div class="card-grid">' + html + '</div>'
  }

  function renderGroupedCards(rows) {
    if (state.groupFilter) {
      return wrapGrid(rows.map(card).join(''))
    }
    var order = state.groups && state.groups.length ? state.groups.slice() : []
    var by = {}
    rows.forEach(function (d) {
      var g = String(d.group || '其他')
      if (!by[g]) by[g] = []
      by[g].push(d)
      if (order.indexOf(g) < 0) order.push(g)
    })
    if (!order.length) {
      Object.keys(by).forEach(function (g) {
        order.push(g)
      })
    }
    return order
      .filter(function (g) {
        return by[g] && by[g].length
      })
      .map(function (g) {
        return (
          '<div class="group-h">' +
          esc(g) +
          ' · ' +
          by[g].length +
          '</div>' +
          wrapGrid(by[g].map(card).join(''))
        )
      })
      .join('')
  }

  function renderList() {
    var box = document.getElementById('list')
    if (state.tab === 'notices') {
      var ns = state.notices || []
      if (!ns.length) {
        box.innerHTML = '<div class="empty">暂无待办通知</div>'
        return
      }
      box.innerHTML =
        '<div class="card-grid">' +
        ns
          .map(function (n) {
            return (
              '<div class="card dev-card" data-notice="' +
              esc(n.id) +
              '" data-job="' +
              esc(n.jobId || '') +
              '">' +
              '<div class="dev-card-name">' +
              esc(n.title) +
              '</div><div class="dev-card-body meta">' +
              esc(n.body) +
              '</div>' +
              '<button class="ok" style="margin-top:4px;width:100%" data-act="done">换好了 / 确认并重新派单</button></div>'
            )
          })
          .join('') +
        '</div>'
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
      box.innerHTML =
        '<div class="empty">' +
        (state.groupFilter ? '该分组下这一栏暂无设备' : '这一栏暂无设备') +
        '</div>'
      return
    }
    box.innerHTML = renderGroupedCards(rows)
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
      '<div class="meta" style="margin:8px 0 12px">分组 ' +
      esc(d.group || '其他') +
      ' · 机型 ' +
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
