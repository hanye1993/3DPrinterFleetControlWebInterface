/**
 * device_model_card — 设备卡片显示机型
 *
 * 插件手册 §6.2：device.card.* 的 context 仅有 deviceId / deviceName / brand /
 * chamberTemp / boardTemp / health / state / tech，不含机型。
 * 机型取自宿主设备字段 model（详情/添加设备可设置），经插件路由或设备列表读取。
 */
;(function () {
  var P = window.HanyePlugin
  if (!P) return

  var TOKEN_KEY = 'hanye_client_jwt'
  var showOnCards = true
  var place = 'after_name'
  var modelById = Object.create(null)
  var timer = null
  var pollSec = 15

  function authHeaders() {
    var token = localStorage.getItem(TOKEN_KEY) || ''
    var h = { Accept: 'application/json' }
    if (token) h.Authorization = 'Bearer ' + token
    return h
  }

  function labelOf(model) {
    var s = model == null ? '' : String(model).trim()
    return s || '未知'
  }

  function badgeHtml(model) {
    var text = labelOf(model)
    var cls = 'device-model-badge'
    if (text === '未知') cls += ' is-unknown'
    return (
      '<span class="' +
      cls +
      '" title="机型">' +
      '机型 ' +
      escapeHtml(text) +
      '</span>'
    )
  }

  function extraHtml(model) {
    var text = labelOf(model)
    var cls = 'device-model-extra'
    if (text === '未知') cls += ' is-unknown'
    return (
      '<div class="' +
      cls +
      '" title="机型"><span class="device-model-extra-label">机型</span> <strong>' +
      escapeHtml(text) +
      '</strong></div>'
    )
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  function applyPayload(payload) {
    if (!payload || typeof payload !== 'object') return
    if (typeof payload.showOnCards === 'boolean') showOnCards = payload.showOnCards
    if (payload.place) place = String(payload.place)
    if (payload.pollSec != null) {
      pollSec = Math.max(5, Math.min(120, Number(payload.pollSec) || 15))
    }
    var next = Object.create(null)
    var rows = payload.rows || []
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i]
      if (!row || !row.id) continue
      next[String(row.id)] = row.model != null ? String(row.model) : ''
    }
    modelById = next
  }

  function loadModels() {
    return fetch('/api/v1/device-model-card/models', { headers: authHeaders() })
      .then(function (r) {
        return r.json()
      })
      .then(function (data) {
        if (!data || data.ok === false) return fallbackFromDevices()
        var payload = data.data && typeof data.data === 'object' ? data.data : data
        applyPayload(payload)
        return payload
      })
      .catch(function () {
        return fallbackFromDevices()
      })
  }

  /** 兜底：宿主标准设备列表（sanitize 后仍含 model） */
  function fallbackFromDevices() {
    return fetch('/api/v1/devices', { headers: authHeaders() })
      .then(function (r) {
        return r.json()
      })
      .then(function (data) {
        var list =
          (data && data.data && data.data.devices) ||
          (data && data.devices) ||
          (Array.isArray(data && data.data) ? data.data : null) ||
          (Array.isArray(data) ? data : null) ||
          []
        var next = Object.create(null)
        for (var i = 0; i < list.length; i++) {
          var d = list[i]
          if (!d || !d.id) continue
          next[String(d.id)] = d.model != null ? String(d.model).trim() : ''
        }
        modelById = next
        return { rows: list }
      })
      .catch(function () {
        return null
      })
  }

  function modelFor(ctx) {
    var c = (ctx && ctx.context) || {}
    var id = c.deviceId != null ? String(c.deviceId) : ''
    if (!id) return ''
    if (Object.prototype.hasOwnProperty.call(modelById, id)) return modelById[id]
    return ''
  }

  function wantAfterName() {
    return place === 'after_name' || place === 'both'
  }

  function wantExtra() {
    return place === 'extra' || place === 'both'
  }

  P.registerSlot(
    'device.card.after-name',
    function (el, ctx) {
      if (!showOnCards || !wantAfterName()) {
        el.innerHTML = ''
        return
      }
      el.innerHTML = badgeHtml(modelFor(ctx))
    },
    { order: 5, plugin: 'device_model_card' }
  )

  P.registerSlot(
    'device.card.extra',
    function (el, ctx) {
      if (!showOnCards || !wantExtra()) {
        el.innerHTML = ''
        return
      }
      el.innerHTML = extraHtml(modelFor(ctx))
    },
    { order: 5, plugin: 'device_model_card' }
  )

  function refreshSlots() {
    P.emit('slot:change', { name: 'device.card.after-name' })
    P.emit('slot:change', { name: 'device.card.extra' })
  }

  function startPoll() {
    if (timer) clearInterval(timer)
    timer = setInterval(function () {
      loadModels().then(refreshSlots)
    }, pollSec * 1000)
  }

  loadModels().then(function () {
    refreshSlots()
    startPoll()
  })

  P.emit('device_model_card:ready', { ok: true })
})()
