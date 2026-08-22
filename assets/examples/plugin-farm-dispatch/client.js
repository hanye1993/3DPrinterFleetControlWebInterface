/**
 * farm_dispatch — 宿主内：设置页 + 首页 FDM 卡片巡查状态
 */
;(function () {
  var P = window.HanyePlugin
  if (!P) return

  var TOKEN_KEY = 'hanye_client_jwt'
  var PLUGIN = 'farm_dispatch'
  var boardCache = {}

  function authHeaders(json) {
    var token = ''
    try {
      token = localStorage.getItem(TOKEN_KEY) || ''
    } catch (e) {}
    var h = { Accept: 'application/json' }
    if (json) h['Content-Type'] = 'application/json'
    if (token) h.Authorization = 'Bearer ' + token
    return h
  }

  function unwrap(j) {
    if (j && j.data && typeof j.data === 'object') return j.data
    return j
  }

  function api(method, path, body) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
    var timer = ctrl ? setTimeout(function () { try { ctrl.abort() } catch (e) {} }, 8000) : null
    return fetch(path, {
      method: method,
      headers: authHeaders(body != null),
      body: body != null ? JSON.stringify(body) : undefined,
      signal: ctrl ? ctrl.signal : undefined
    })
      .then(function (r) {
        return r.json().then(function (j) {
          return unwrap(j)
        })
      })
      .catch(function () {
        return { ok: false, message: '网络错误' }
      })
      .finally(function () {
        if (timer) clearTimeout(timer)
      })
  }

  function boardBadge(board) {
    if (board === 'maintenance') return { cls: 'fd-mnt', text: '维修' }
    if (board === 'error') return { cls: 'fd-err', text: '报错' }
    if (board === 'finished') return { cls: 'fd-fin', text: '待清床' }
    if (board === 'attention') return { cls: 'fd-att', text: '待巡查' }
    if (board === 'idle') return { cls: 'fd-idle', text: '空闲' }
    return null
  }

  function tagDeviceCard(el, board) {
    var card = el && el.closest && el.closest('.device-card')
    if (!card) return
    if (board) card.setAttribute('data-fd-board', board)
    else card.removeAttribute('data-fd-board')
  }

  function refreshBoards() {
    return api('GET', '/api/v1/farm-dispatch/device-boards').then(function (j) {
      if (j && j.ok && j.boards) boardCache = j.boards
      if (P.emit) {
        P.emit('slot:change', { name: 'device.card.after-name' })
        P.emit('slot:change', { name: 'device.card.extra' })
      }
    })
  }

  P.registerSlot &&
    P.registerSlot(
      'device.card.after-name',
      function (el, ctx) {
        var c = (ctx && ctx.context) || {}
        var row = boardCache[c.deviceId]
        var board = row && row.board
        tagDeviceCard(el, board)
        var b = board ? boardBadge(board) : null
        el.innerHTML = b
          ? '<span class="fd-duty-badge ' +
            b.cls +
            '" title="巡查派单 · ' +
            (row.label || b.text) +
            '">' +
            b.text +
            '</span>'
          : ''
      },
      { order: 18, plugin: PLUGIN }
    )

  P.registerSlot &&
    P.registerSlot(
      'device.card.extra',
      function (el, ctx) {
        var c = (ctx && ctx.context) || {}
        var row = boardCache[c.deviceId]
        tagDeviceCard(el, row && row.board)
        el.innerHTML = ''
      },
      { order: 0, plugin: PLUGIN }
    )

  window.addEventListener('message', function (ev) {
    if (ev && ev.data && ev.data.type === 'farm_dispatch:duty') refreshBoards()
  })

  if (P.on) {
    P.on('farm_dispatch:duty', function () {
      refreshBoards()
    })
  }

  function renderStats(el, stats) {
    var box = el.querySelector('[data-stats]')
    if (!box) return
    if (!stats) {
      box.textContent = '统计暂不可用（可点刷新）'
      return
    }
    box.innerHTML =
      '待审核 <b>' +
      (stats.pending_audit || 0) +
      '</b> · 等换料 <b>' +
      (stats.waiting_material || 0) +
      '</b> · 打印中 <b>' +
      (stats.printing || 0) +
      '</b> · 待清床 <b>' +
      (stats.print_done || 0) +
      '</b> · 报错 <b>' +
      (stats.print_error || 0) +
      '</b> · 失败 <b>' +
      (stats.failed || 0) +
      '</b>'
  }

  P.registerSettingsTab &&
    P.registerSettingsTab({
      key: 'farm_dispatch',
      label: '巡查派单',
      after: 'plugins',
      order: 28,
      adminOnly: true,
      plugin: PLUGIN,
      render: function (el) {
        el.innerHTML =
          '<div class="settings-tab-panel">' +
          '<h3>巡查派单</h3>' +
          '<p>四个入口在<strong>侧栏</strong>：巡查看板、派单审核、提交打印、派单日志。勿开独立窗口。</p>' +
          '<p data-stats style="opacity:.85">统计按需加载…</p>' +
          '<p>安装后请点一次「初始化用户组」，再到「用户」把账号加入：巡查 / 审核 / 派单申请。</p>' +
          '<button type="button" class="ant-btn ant-btn-primary" data-act="groups">初始化用户组</button> ' +
          '<button type="button" class="ant-btn" data-act="refresh">刷新统计</button>' +
          '<div data-msg style="margin-top:10px;opacity:.75"></div></div>'
        setTimeout(function () {
          api('GET', '/api/v1/farm-dispatch/stats').then(function (j) {
            renderStats(el, j && j.ok ? j.stats : null)
          })
        }, 0)
        if (el._fdBound) return
        el._fdBound = true
        el.addEventListener('click', function (ev) {
          var t = ev.target
          if (!t) return
          var act = t.getAttribute('data-act')
          if (act === 'refresh') {
            api('GET', '/api/v1/farm-dispatch/stats').then(function (j) {
              renderStats(el, j && j.ok ? j.stats : null)
            })
            return
          }
          if (act !== 'groups') return
          var msg = el.querySelector('[data-msg]')
          t.disabled = true
          if (msg) msg.textContent = '处理中…'
          api('POST', '/api/v1/farm-dispatch/ensure-groups', {}).then(function (j) {
            t.disabled = false
            if (msg) {
              msg.textContent =
                j && j.ok
                  ? '用户组已就绪（新增 ' +
                    (j.added || 0) +
                    '，更新 ' +
                    (j.updated || 0) +
                    '）。请到「用户」把账号加入对应组后刷新页面。'
                  : (j && j.message) || '失败（需管理员）'
            }
          })
        })
      }
    })

  refreshBoards()
  setInterval(refreshBoards, 12000)
})()
