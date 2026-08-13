/**
 * chamber_temp — card-only UI (no side-nav pages).
 * Slots: device.card.temps / device.card.after-name / device.grid.before
 */
;(function () {
  var P = window.HanyePlugin
  if (!P) return

  var TOKEN_KEY = 'hanye_client_jwt'
  var warnC = 45
  var showOnCards = true
  var showBadge = true
  var showPanel = false
  var pollSec = 5
  var panelHost = null
  var timer = null

  function authHeaders() {
    var token = localStorage.getItem(TOKEN_KEY) || ''
    var h = { Accept: 'application/json' }
    if (token) h.Authorization = 'Bearer ' + token
    return h
  }

  function loadConfig() {
    return fetch('/api/v1/chamber-temp/temps', { headers: authHeaders() })
      .then(function (r) {
        return r.json()
      })
      .then(function (data) {
        if (!data || data.ok === false) return null
        var payload = data.data && typeof data.data === 'object' ? data.data : data
        if (payload.warnCelsius != null) warnC = Number(payload.warnCelsius) || 45
        if (typeof payload.showOnCards === 'boolean') showOnCards = payload.showOnCards
        if (typeof payload.showPanel === 'boolean') showPanel = payload.showPanel
        if (payload.pollSec != null) {
          pollSec = Math.max(2, Math.min(60, Number(payload.pollSec) || 5))
        }
        if (payload.vars && payload.vars.show_badge != null) {
          showBadge = payload.vars.show_badge === '1' || payload.vars.show_badge === true
        }
        return payload
      })
      .catch(function () {
        return null
      })
  }

  function fmt(t) {
    if (t == null || t === '' || Number.isNaN(Number(t))) return null
    return Math.round(Number(t))
  }

  function pillHtml(temp) {
    var n = fmt(temp)
    var cls = 'temp-pill chamber-temp-pill'
    if (n == null) cls += ' is-na'
    else if (n >= warnC) cls += ' is-warn'
    var val = n == null ? '--' : n + '°'
    return (
      '<div class="' +
      cls +
      '" title="仓内温度"><span class="chamber-temp-label">仓内</span> <strong>' +
      val +
      '</strong></div>'
    )
  }

  function badgeHtml(temp) {
    var n = fmt(temp)
    var cls = 'chamber-temp-badge'
    if (n == null) cls += ' is-na'
    else if (n >= warnC) cls += ' is-warn'
    var val = n == null ? '仓 --' : '仓 ' + n + '°'
    return '<span class="' + cls + '" title="仓内温度">' + val + '</span>'
  }

  P.registerSlot(
    'device.card.temps',
    function (el, ctx) {
      if (!showOnCards) {
        el.innerHTML = ''
        return
      }
      var c = (ctx && ctx.context) || {}
      el.innerHTML = pillHtml(c.chamberTemp)
    },
    { order: 0, plugin: 'chamber_temp' }
  )

  P.registerSlot(
    'device.card.after-name',
    function (el, ctx) {
      if (!showOnCards || !showBadge) {
        el.innerHTML = ''
        return
      }
      var c = (ctx && ctx.context) || {}
      el.innerHTML = badgeHtml(c.chamberTemp)
    },
    { order: 0, plugin: 'chamber_temp' }
  )

  function renderPanel(host, rows) {
    if (!host || !showPanel) {
      if (host) host.innerHTML = ''
      return
    }
    var list = rows || []
    var html =
      '<div class="chamber-temp-panel"><div class="chamber-temp-panel-title">仓内温度总览 · 阈值 ' +
      warnC +
      '°C</div>'
    if (!list.length) {
      html += '<span class="chamber-temp-chip is-na">暂无设备</span>'
    } else {
      for (var i = 0; i < list.length; i++) {
        var row = list[i]
        var cls = 'chamber-temp-chip'
        if (row.chamberTemp == null) cls += ' is-na'
        else if (row.warn) cls += ' is-warn'
        var t =
          row.chamberTemp == null ? '--' : Math.round(Number(row.chamberTemp)) + '°C'
        html +=
          '<span class="' +
          cls +
          '"><span>' +
          String(row.name || row.id) +
          '</span><strong>' +
          t +
          '</strong></span>'
      }
    }
    html += '</div>'
    host.innerHTML = html
  }

  P.registerSlot(
    'device.grid.before',
    function (el) {
      panelHost = el
      function tick() {
        loadConfig().then(function (payload) {
          if (payload) renderPanel(panelHost, payload.rows)
          P.emit('slot:change', { name: 'device.card.temps' })
          P.emit('slot:change', { name: 'device.card.after-name' })
        })
      }
      tick()
      if (timer) clearInterval(timer)
      timer = setInterval(tick, Math.max(2000, pollSec * 1000))
      return function () {
        if (timer) clearInterval(timer)
        timer = null
        panelHost = null
      }
    },
    { order: 10, plugin: 'chamber_temp' }
  )

  loadConfig().then(function () {
    P.emit('slot:change', { name: 'device.card.temps' })
    P.emit('slot:change', { name: 'device.card.after-name' })
  })
})()
