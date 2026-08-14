/**
 * detail_console — 替换 device.detail：图一控制台 + AMS 耗材绑定
 * 风格：CSS 变量跟随主题（--app-* / --hud-*）
 */
;(function () {
  var P = window.HanyePlugin
  if (!P) return

  var TOKEN_KEY = 'hanye_client_jwt'
  var PLUGIN = 'detail_console'
  var enabled = true
  var pollMs = 2000
  var defaultTemp = 220
  var sessions = Object.create(null)

  function authHeaders(json) {
    var token = localStorage.getItem(TOKEN_KEY) || ''
    var h = { Accept: 'application/json' }
    if (json) h['Content-Type'] = 'application/json'
    if (token) h.Authorization = 'Bearer ' + token
    return h
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  function toast(msg, ok) {
    var el = document.createElement('div')
    el.className = 'dc-toast' + (ok === false ? ' is-err' : ' is-ok')
    el.textContent = String(msg || '')
    document.body.appendChild(el)
    setTimeout(function () {
      el.classList.add('is-out')
      setTimeout(function () {
        if (el.parentNode) el.parentNode.removeChild(el)
      }, 280)
    }, 1800)
  }

  function round(n) {
    if (n == null || n === '' || Number.isNaN(Number(n))) return null
    return Math.round(Number(n))
  }

  function fmtTemp(pair) {
    if (!pair) return { a: '—', t: '—' }
    return {
      a: round(pair.actual) == null ? '—' : String(round(pair.actual)),
      t: round(pair.target) == null ? '—' : String(round(pair.target))
    }
  }

  function spoolBindings(s) {
    if (!s) return []
    if (Array.isArray(s.amsBindings)) {
      return s.amsBindings.filter(function (b) {
        return b && b.deviceId && Number.isFinite(Number(b.slotId))
      })
    }
    if (s.amsBinding && s.amsBinding.deviceId) return [s.amsBinding]
    return []
  }

  function findBound(spools, deviceId, slotId) {
    for (var i = 0; i < spools.length; i++) {
      var s = spools[i]
      if (s.archived) continue
      var bs = spoolBindings(s)
      for (var j = 0; j < bs.length; j++) {
        if (bs[j].deviceId === deviceId && Number(bs[j].slotId) === Number(slotId)) return s
      }
    }
    return null
  }

  function rollsOf(s) {
    var n = Math.floor(Number(s && s.rolls))
    return !Number.isFinite(n) || n < 1 ? 1 : Math.min(99, n)
  }

  function bindLeft(s) {
    return Math.max(0, rollsOf(s) - spoolBindings(s).length)
  }

  function materialOf(s) {
    return (s && (s.material || s.materialName || s.tray_type)) || '料卷'
  }

  function colorOf(s) {
    // 料卷真正色值在 colorHex；color 常为中文/英文名
    var raw = String((s && (s.colorHex || s.color)) || '').trim()
    if (!raw) return '#888888'
    var h = raw.replace(/^#/, '')
    if (h.length === 8 && /^[0-9a-fA-F]{8}$/.test(h)) h = h.slice(0, 6) // RRGGBBAA
    if (/^[0-9a-fA-F]{6}$/.test(h)) return '#' + h.toLowerCase()
    if (/^[0-9a-fA-F]{3}$/.test(h)) {
      return (
        '#' +
        (h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2)).toLowerCase()
      )
    }
    // 常见中文色名兜底
    var named = {
      红: '#e53935',
      赤: '#e53935',
      橙: '#fb8c00',
      黄: '#fdd835',
      绿: '#43a047',
      青: '#00acc1',
      蓝: '#1e88e5',
      紫: '#8e24aa',
      粉: '#ec407a',
      黑: '#212121',
      白: '#f5f5f5',
      灰: '#9e9e9e',
      银: '#b0bec5',
      金: '#ffb300',
      red: '#e53935',
      orange: '#fb8c00',
      yellow: '#fdd835',
      green: '#43a047',
      blue: '#1e88e5',
      purple: '#8e24aa',
      pink: '#ec407a',
      black: '#212121',
      white: '#f5f5f5',
      gray: '#9e9e9e',
      grey: '#9e9e9e'
    }
    var key = raw.toLowerCase()
    if (named[raw]) return named[raw]
    if (named[key]) return named[key]
    return '#888888'
  }

  function textOnColor(hex) {
    var h = String(hex || '').replace(/^#/, '')
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return '#fff'
    var r = parseInt(h.slice(0, 2), 16) / 255
    var g = parseInt(h.slice(2, 4), 16) / 255
    var b = parseInt(h.slice(4, 6), 16) / 255
    var lin = function (c) {
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
    }
    var L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
    return L > 0.55 ? '#111' : '#fff'
  }

  function normalizeSlotColor(c) {
    return colorOf({ colorHex: c, color: c })
  }

  function fetchJson(url, opt) {
    return fetch(url, opt || { headers: authHeaders() }).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok || (j && j.ok === false)) {
          throw new Error((j && j.message) || '请求失败')
        }
        return j
      })
    })
  }

  function loadSnapshot(deviceId) {
    return fetchJson(
      '/api/v1/detail-console/snapshot?deviceId=' + encodeURIComponent(deviceId)
    ).then(function (j) {
      var d = (j && j.data) || j || {}
      if (d.vars) {
        enabled = String(d.vars.replace_detail) !== '0'
        pollMs = Math.max(800, Number(d.vars.poll_ms) || 2000)
        defaultTemp = Math.max(160, Number(d.vars.default_temp) || 220)
      }
      return d
    })
  }

  function loadDeviceStatus(deviceId) {
    return fetchJson('/api/v1/devices').then(function (j) {
      var list = (j && j.devices) || []
      for (var i = 0; i < list.length; i++) {
        if (String(list[i].id) === String(deviceId)) return list[i]
      }
      return null
    })
  }

  function loadSpools() {
    return fetchJson('/api/v1/filament').then(function (j) {
      return (j && (j.spools || j.data && j.data.spools)) || []
    })
  }

  function control(deviceId, payload) {
    return fetchJson('/api/v1/devices/' + encodeURIComponent(deviceId) + '/control', {
      method: 'POST',
      headers: authHeaders(true),
      body: JSON.stringify(payload)
    })
  }

  function bindSpool(spoolId, deviceId, slotId) {
    return fetchJson('/api/v1/filament/' + encodeURIComponent(spoolId) + '/bind', {
      method: 'POST',
      headers: authHeaders(true),
      body: JSON.stringify({ deviceId: deviceId, slotId: Number(slotId) })
    })
  }

  function unbindSpool(spoolId, deviceId, slotId) {
    return fetchJson('/api/v1/filament/' + encodeURIComponent(spoolId) + '/unbind', {
      method: 'POST',
      headers: authHeaders(true),
      body: JSON.stringify({ deviceId: deviceId, slotId: Number(slotId) })
    })
  }

  function confirmBox(title, okText) {
    return window.confirm(String(title || '确认？'))
  }

  function sessionOf(deviceId) {
    if (!sessions[deviceId]) {
      sessions[deviceId] = {
        tempInput: defaultTemp,
        fanPct: 0,
        speedPct: 100,
        ledOn: false,
        selectedSlot: 0,
        pendingSpoolId: '',
        autoRefill: false,
        busy: false,
        uiLock: false,
        uiLockUntil: 0,
        cameras: [],
        camIdx: 0,
        camPhase: 'boot'
      }
    }
    return sessions[deviceId]
  }

  function touchUiLock(sess, ms) {
    sess.uiLock = true
    sess.uiLockUntil = Date.now() + (ms || 20000)
  }

  function clearUiLock(sess) {
    sess.uiLock = false
    sess.uiLockUntil = 0
  }

  function isUiLocked(sess) {
    if (sess.uiLock && Date.now() < (sess.uiLockUntil || 0)) return true
    if (sess.uiLock && Date.now() >= (sess.uiLockUntil || 0)) {
      sess.uiLock = false
      return false
    }
    return false
  }

  function loadCameras(deviceId) {
    return fetchJson('/api/v1/devices/' + encodeURIComponent(deviceId) + '/cameras')
      .then(function (j) {
        return (j && j.cameras) || []
      })
      .catch(function () {
        return []
      })
  }

  function pullCameraFrame(deviceId, cam) {
    if (!cam || !cam.id) return Promise.resolve(null)
    var path =
      '/api/v1/devices/' +
      encodeURIComponent(deviceId) +
      '/cameras/' +
      encodeURIComponent(cam.id) +
      '/snapshot?format=json'
    return fetch(path, { headers: authHeaders() })
      .then(function (r) {
        return r.json()
      })
      .then(function (j) {
        if (j && j.ok && j.base64) {
          return {
            src: 'data:' + (j.contentType || 'image/jpeg') + ';base64,' + j.base64,
            name: cam.name || '摄像头'
          }
        }
        throw new Error((j && j.message) || '无画面')
      })
  }

  function camShellHtml() {
    return (
      '<div class="dc-cam">' +
      '<div class="dc-cam-head">' +
      '<strong class="dc-cam-title">摄像头</strong>' +
      '<span class="dc-cam-phase">连接中…</span>' +
      '<div class="dc-cam-switch"></div>' +
      '</div>' +
      '<div class="dc-cam-frame">' +
      '<button type="button" class="dc-cam-nav dc-cam-prev" data-act="cam-prev" aria-label="上一路">‹</button>' +
      '<img class="dc-cam-img" alt="camera" draggable="false" />' +
      '<button type="button" class="dc-cam-nav dc-cam-next" data-act="cam-next" aria-label="下一路">›</button>' +
      '<div class="dc-cam-empty">暂无摄像头</div>' +
      '<div class="dc-cam-dots"></div>' +
      '</div>' +
      '<div class="dc-cam-plugin-slots" data-slot="device.detail.camera.after"></div>' +
      '</div>'
    )
  }

  function fileToBase64(file) {
    return file.arrayBuffer().then(function (buf) {
      var bytes = new Uint8Array(buf)
      var binary = ''
      var chunk = 0x8000
      for (var i = 0; i < bytes.length; i += chunk) {
        var slice = bytes.subarray(i, i + chunk)
        binary += String.fromCharCode.apply(null, Array.from(slice))
      }
      return btoa(binary)
    })
  }

  function loadQueue(deviceId) {
    return fetchJson(
      '/api/v1/print-requests?deviceId=' + encodeURIComponent(deviceId)
    ).then(function (j) {
      return (j && j.requests) || []
    })
  }

  function submitGcode(deviceId, deviceName, file) {
    var name = String(file && file.name || '')
    if (!/\.gcode$/i.test(name)) {
      return Promise.reject(new Error('仅支持上传 .gcode 文件'))
    }
    return fileToBase64(file).then(function (contentBase64) {
      return fetchJson('/api/v1/print-requests', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({
          deviceId: deviceId,
          deviceName: deviceName || deviceId,
          filename: name,
          contentBase64: contentBase64,
          note: '详情控制台提交'
        })
      })
    })
  }

  function queueAction(id, action) {
    return fetchJson(
      '/api/v1/print-requests/' + encodeURIComponent(id) + '/' + action,
      {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({})
      }
    )
  }

  function statusLabel(s) {
    var map = {
      pending: '待审',
      queued: '排队',
      printing: '打印中',
      done: '完成',
      rejected: '已拒',
      cancelled: '已取消',
      failed: '失败',
      approved: '已通过'
    }
    return map[s] || s || '—'
  }

  function buildQueueHtml(deviceId, jobs) {
    var active = (jobs || []).filter(function (j) {
      return j && (j.status === 'queued' || j.status === 'pending' || j.status === 'printing')
    })
    active.sort(function (a, b) {
      var ta = a.queuedAt || a.createdAt || ''
      var tb = b.queuedAt || b.createdAt || ''
      return String(ta).localeCompare(String(tb))
    })

    var rows = ''
    if (!active.length) {
      rows = '<div class="dc-queue-empty">本机暂无排队/待审任务</div>'
    } else {
      for (var i = 0; i < active.length; i++) {
        var j = active[i]
        var pos =
          j.status === 'queued' && j.queuePosition
            ? ' #' + j.queuePosition
            : ''
        rows +=
          '<div class="dc-queue-row" data-job="' +
          escapeHtml(j.id) +
          '">' +
          '<span class="dc-queue-st dc-st-' +
          escapeHtml(j.status) +
          '">' +
          escapeHtml(statusLabel(j.status)) +
          pos +
          '</span>' +
          '<span class="dc-queue-name" title="' +
          escapeHtml(j.filename || '') +
          '">' +
          escapeHtml(j.filename || '—') +
          '</span>' +
          '<span class="dc-queue-who">' +
          escapeHtml(j.requesterName || '') +
          '</span>' +
          '<span class="dc-queue-ops">' +
          (j.status === 'queued'
            ? '<button type="button" data-act="queue-start" data-job="' +
              escapeHtml(j.id) +
              '">开始</button>'
            : '') +
          (j.status === 'queued' || j.status === 'pending' || j.status === 'printing'
            ? '<button type="button" data-act="queue-cancel" data-job="' +
              escapeHtml(j.id) +
              '">取消</button>'
            : '') +
          '</span></div>'
      }
    }

    return (
      '<div class="dc-queue">' +
      '<div class="dc-queue-head">' +
      '<strong>发送 G 文件打印</strong>' +
      '<button type="button" data-act="queue-refresh">刷新队列</button>' +
      '</div>' +
      '<p class="dc-hint">仅支持 .gcode；提交后进入该机队列（无直接打印权则先审核）。请确认切片机型匹配本机。</p>' +
      '<div class="dc-queue-actions">' +
      '<input type="file" accept=".gcode,.gco" class="dc-gcode-input" hidden />' +
      '<button type="button" class="dc-primary" data-act="gcode-pick">选择 .gcode 加入队列</button>' +
      '</div>' +
      '<div class="dc-queue-list">' +
      rows +
      '</div></div>'
    )
  }

  function spoolCardHtml(opts) {
    var sid = opts.slotId
    var label = opts.label
    var mat = opts.mat
    var col = opts.col
    var fg = opts.fg
    var k = opts.k
    var remain = opts.remain
    var remainUnit = opts.remainUnit || '%'
    var on = opts.on
    var solo = opts.solo
    var empty = opts.empty
    return (
      '<button type="button" class="dc-ams-slot' +
      (solo ? ' dc-ams-solo' : '') +
      (on ? ' is-on' : '') +
      (empty ? ' is-empty' : '') +
      '" data-slot="' +
      sid +
      '" style="--dc-slot:' +
      escapeHtml(col) +
      ';--dc-slot-fg:' +
      fg +
      '" title="' +
      escapeHtml(label + ' · ' + mat) +
      '">' +
      '<div class="dc-spool-ico">' +
      '<span class="dc-spool-flange dc-spool-flange-l" aria-hidden="true"></span>' +
      '<span class="dc-spool-hub" aria-hidden="true">' +
      '<span class="dc-spool-filament"></span>' +
      '</span>' +
      '<span class="dc-spool-flange dc-spool-flange-r" aria-hidden="true"></span>' +
      '<div class="dc-ams-meta">' +
      '<span class="dc-ams-label">' +
      escapeHtml(label) +
      '</span>' +
      '<strong>' +
      escapeHtml(String(mat).slice(0, 8)) +
      '</strong>' +
      '<em>K ' +
      (Number.isFinite(k) ? k.toFixed(3) : '0.040') +
      '</em>' +
      (remain != null ? '<small>' + remain + remainUnit + '</small>' : '') +
      '</div></div></button>'
    )
  }

  function buildHtml(deviceId, device, status, spools, jobs) {
    var st = status || (device && device.status) || {}
    var sess = sessionOf(deviceId)
    var ex = fmtTemp(st.extruder)
    var bed = fmtTemp(st.bed)
    var chamberA = round(st.chamberTemp)
    var chamberT = st.chamberTarget != null ? round(st.chamberTarget) : null
    var fan = st.fanSpeed != null ? round(st.fanSpeed) : sess.fanPct
    var spd = st.printSpeed != null ? round(st.printSpeed) : sess.speedPct
    sess.fanPct = fan == null ? sess.fanPct : fan
    sess.speedPct = spd == null ? sess.speedPct : spd

    var ams = Array.isArray(st.amsSlots) ? st.amsSlots : []

    var amsCards = ''
    if (ams.length) {
      for (var i = 0; i < ams.length; i++) {
        var slot = ams[i]
        var sid = Number(slot.id)
        var bound = findBound(spools, deviceId, sid)
        var mat = bound ? materialOf(bound) : slot.material || '空'
        var col = bound ? colorOf(bound) : normalizeSlotColor(slot.color)
        var emptySlot = !bound && (!slot.material || slot.material === '空')
        if (emptySlot) col = '#4a4a4a'
        var fg = textOnColor(col)
        var k =
          bound && bound.pa != null
            ? Number(bound.pa)
            : bound && bound.k != null
              ? Number(bound.k)
              : 0.04
        var remain =
          slot.remain != null ? round(slot.remain) : bound ? round(bound.remainGrams) : null
        amsCards += spoolCardHtml({
          slotId: sid,
          label: 'A' + sid,
          mat: mat,
          col: col,
          fg: fg,
          k: k,
          remain: remain,
          remainUnit: bound ? 'g' : '%',
          on: sess.selectedSlot === sid,
          empty: emptySlot
        })
      }
    }

    var extBound = findBound(spools, deviceId, 0)
    var extCol = extBound ? colorOf(extBound) : '#555555'
    var extEmpty = !extBound
    var extFg = textOnColor(extCol)
    var extMat = extBound ? materialOf(extBound) : '未绑定'
    var extRemain = extBound ? round(extBound.remainGrams) : null
    var extK =
      extBound && extBound.pa != null
        ? Number(extBound.pa)
        : extBound && extBound.k != null
          ? Number(extBound.k)
          : 0.04

    var isExtOnly = !ams.length
    if (isExtOnly) sess.selectedSlot = 0

    var extCardHtml = spoolCardHtml({
      slotId: 0,
      label: isExtOnly ? '外挂' : 'Ext',
      mat: extMat,
      col: extCol,
      fg: extFg,
      k: extK,
      remain: extRemain,
      remainUnit: 'g',
      on: sess.selectedSlot === 0 || isExtOnly,
      solo: isExtOnly,
      empty: extEmpty
    })

    var amsBoardHtml = isExtOnly
      ? '<div class="dc-ams-board is-ext-only">' +
        '<div class="dc-ams-shelf">' +
        '<div class="dc-ams-center">' +
        extCardHtml +
        '</div></div></div>'
      : '<div class="dc-ams-board">' +
        '<div class="dc-ams-shelf">' +
        '<div class="dc-ams-row">' +
        amsCards +
        extCardHtml +
        '</div></div></div>'

    var spoolOpts = '<option value="">绑定料卷…</option>'
    for (var s = 0; s < spools.length; s++) {
      var sp = spools[s]
      if (sp.archived || sp.tech === 'resin') continue
      var left = bindLeft(sp)
      var already = spoolBindings(sp).some(function (b) {
        return b.deviceId === deviceId && Number(b.slotId) === Number(sess.selectedSlot)
      })
      var dis = left <= 0 && !already
      var sel =
        sess.pendingSpoolId && String(sess.pendingSpoolId) === String(sp.id) ? ' selected' : ''
      spoolOpts +=
        '<option value="' +
        escapeHtml(sp.id) +
        '"' +
        (dis ? ' disabled' : '') +
        sel +
        '>' +
        escapeHtml(
          materialOf(sp) +
            ' ' +
            (sp.color || '') +
            ' · ' +
            Math.round(Number(sp.remainGrams) || 0) +
            'g'
        ) +
        '</option>'
    }

    return (
      '<div class="dc-body" data-device="' +
      escapeHtml(deviceId) +
      '">' +
      '<div class="dc-status">' +
      '<span>' +
      escapeHtml((device && device.name) || deviceId) +
      '</span>' +
      '<span class="dc-pill">' +
      escapeHtml(st.state || '—') +
      '</span>' +
      '<span class="dc-pill">' +
      escapeHtml(String(Math.min(100, Math.round(st.progress || 0)))) +
      '%</span>' +
      '</div>' +
      '<div class="dc-console">' +
      '<div class="dc-col dc-col-temps">' +
      tempRow('nozzle', '喷头', ex.a, ex.t) +
      tempRow('bed', '热床', bed.a, bed.t) +
      tempRow(
        'chamber',
        '腔温',
        chamberA == null ? '—' : String(chamberA),
        chamberT == null ? '—' : String(chamberT)
      ) +
      '<div class="dc-fan-row">' +
      '<span class="dc-ico" aria-hidden="true">❄</span>' +
      '<label>风扇</label>' +
      '<input type="range" min="0" max="100" step="1" class="dc-range" data-act="fan" value="' +
      sess.fanPct +
      '" />' +
      '<strong data-fan-val>' +
      sess.fanPct +
      '%</strong>' +
      '</div>' +
      '<div class="dc-quick">' +
      '<button type="button" class="dc-sq" data-act="speed-cycle" title="打印速度">' +
      '<span class="dc-ico">⏱</span><em data-spd-val>' +
      sess.speedPct +
      '%</em></button>' +
      '<button type="button" class="dc-sq' +
      (sess.ledOn ? ' is-on' : '') +
      '" data-act="led" title="LED / 仓内风扇">' +
      '<span class="dc-ico">💡</span><em>LED灯</em></button>' +
      '</div></div>' +
      '<div class="dc-col dc-col-pad">' +
      '<div class="dc-pad" role="group" aria-label="XY">' +
      '<button type="button" class="dc-pad-btn dc-y-pos" data-jog="Y" data-dist="10">Y+10</button>' +
      '<button type="button" class="dc-pad-btn dc-y-pos-1" data-jog="Y" data-dist="1">+1</button>' +
      '<button type="button" class="dc-pad-btn dc-x-neg" data-jog="X" data-dist="-10">X-10</button>' +
      '<button type="button" class="dc-pad-btn dc-x-neg-1" data-jog="X" data-dist="-1">-1</button>' +
      '<button type="button" class="dc-pad-home" data-act="home" title="归零">⌂</button>' +
      '<button type="button" class="dc-pad-btn dc-x-pos-1" data-jog="X" data-dist="1">+1</button>' +
      '<button type="button" class="dc-pad-btn dc-x-pos" data-jog="X" data-dist="10">X+10</button>' +
      '<button type="button" class="dc-pad-btn dc-y-neg-1" data-jog="Y" data-dist="-1">-1</button>' +
      '<button type="button" class="dc-pad-btn dc-y-neg" data-jog="Y" data-dist="-10">Y-10</button>' +
      '</div>' +
      '<div class="dc-zrow">' +
      '<button type="button" class="dc-zbtn" data-jog="Z" data-dist="10">▲10</button>' +
      '<button type="button" class="dc-zbtn" data-jog="Z" data-dist="1">▲1</button>' +
      '<span class="dc-zlabel">热床</span>' +
      '<button type="button" class="dc-zbtn" data-jog="Z" data-dist="-1">▼1</button>' +
      '<button type="button" class="dc-zbtn" data-jog="Z" data-dist="-10">▼10</button>' +
      '</div>' +
      '<div class="dc-zrow">' +
      '<button type="button" class="dc-zbtn" data-act="extrude" data-amount="5" title="挤出 5mm">E+5</button>' +
      '<button type="button" class="dc-zbtn" data-act="extrude" data-amount="1" title="挤出 1mm">E+1</button>' +
      '<span class="dc-zlabel">挤出</span>' +
      '<button type="button" class="dc-zbtn" data-act="retract" data-amount="1" title="回抽 1mm">E-1</button>' +
      '<button type="button" class="dc-zbtn" data-act="retract" data-amount="5" title="回抽 5mm">E-5</button>' +
      '</div></div>' +
      '<div class="dc-col dc-col-ext">' +
      '<button type="button" class="dc-ext-up" data-act="load" title="进料">▲</button>' +
      '<div class="dc-ext-body"><span class="dc-ext-gear">⚙</span><em>挤出机</em></div>' +
      '<button type="button" class="dc-ext-down" data-act="unload" title="退料">▼</button>' +
      '</div></div>' +
      '<div class="dc-actions">' +
      '<button type="button" data-act="pause">暂停</button>' +
      '<button type="button" data-act="resume">恢复</button>' +
      '<button type="button" class="dc-danger-outline" data-act="cancel">取消打印</button>' +
      '<button type="button" class="dc-danger" data-act="estop">紧急停止</button>' +
      '</div>' +
      '<div class="dc-ams">' +
      '<div class="dc-ams-tab" title="耗材绑定">🎞</div>' +
      amsBoardHtml +
      '<div class="dc-ams-bind">' +
      '<label>' +
      (isExtOnly ? '外挂料 · 绑定本地料卷' : '当前槽 · 绑定本地料卷') +
      '</label>' +
      '<select class="dc-spool-select">' +
      spoolOpts +
      '</select>' +
      '<button type="button" class="dc-bind-btn" data-act="bind">绑定</button>' +
      '<button type="button" class="dc-bind-btn" data-act="unbind">解绑</button>' +
      '</div>' +
      '<div class="dc-ams-bar">' +
      '<button type="button" class="dc-auto' +
      (sess.autoRefill ? ' is-on' : '') +
      '" data-act="auto-refill">自动续料</button>' +
      '<span class="dc-ams-icons" aria-hidden="true">◎ → ⚙</span>' +
      '<button type="button" data-act="unload">退料</button>' +
      '<button type="button" data-act="load">进料</button>' +
      '</div>' +
      '<p class="dc-hint">绑定本地料卷后打印完成自动扣减。多色 AMS 按剩余%；单色/外挂读取任务用量。XY/Z 点动走宿主 jog（Klipper/拓竹等支持 G-code 的机型）。</p>' +
      '</div>' +
      buildQueueHtml(deviceId, jobs || []) +
      '</div>'
    )
  }

  function tempRow(kind, label, a, t) {
    return (
      '<div class="dc-temp" data-temp="' +
      kind +
      '">' +
      '<span class="dc-ico">' +
      (kind === 'nozzle' ? '♨' : kind === 'bed' ? '▤' : '▦') +
      '</span>' +
      '<div class="dc-temp-txt"><label>' +
      label +
      '</label><strong>' +
      escapeHtml(a) +
      ' <span>/ ' +
      escapeHtml(t) +
      ' °C</span></strong></div>' +
      '<button type="button" class="dc-temp-edit" data-set-temp="' +
      kind +
      '" title="设定温度">✎</button></div>'
    )
  }

  var brandCache = Object.create(null)
  function brandIsBambu(deviceId) {
    return brandCache[deviceId] === 'bambu'
  }

  function runSafe(deviceId, fn) {
    var sess = sessionOf(deviceId)
    if (sess.busy) return
    sess.busy = true
    Promise.resolve()
      .then(fn)
      .catch(function (e) {
        toast(e && e.message ? e.message : '操作失败', false)
      })
      .then(function () {
        sess.busy = false
      })
  }

  var bodyRefreshers = Object.create(null)

  function onHostEvent(el, deviceId, ev) {
    var root = el.querySelector('.dc-body') || el.querySelector('.dc-root')
    if (!root) return
    var sess = sessionOf(deviceId)
    var t = ev.target

    if (ev.type === 'change' && t && t.classList && t.classList.contains('dc-gcode-input')) {
      var file = t.files && t.files[0]
      t.value = ''
      if (!file) return
      if (!confirmBox('确认上传打印文件？\n' + file.name + '\n请确保 G 文件匹配本机切片。')) return
      runSafe(deviceId, function () {
        var deviceName = brandCache[deviceId + ':name'] || deviceId
        return submitGcode(deviceId, deviceName, file).then(function (res) {
          var queued = res && res.queued
          var pos = res && (res.queuePosition || (res.request && res.request.queuePosition))
          if (queued) {
            toast(pos ? '已加入队列，第 ' + pos + ' 位' : '已加入打印队列')
          } else {
            toast('已提交，等待审核通过后入队')
          }
          if (typeof bodyRefreshers[deviceId] === 'function') bodyRefreshers[deviceId]()
        })
      })
      return
    }

    if (ev.type === 'input') {
      if (t && t.getAttribute('data-act') === 'fan') {
        sess.fanPct = Number(t.value) || 0
        var lab = root.querySelector('[data-fan-val]')
        if (lab) lab.textContent = sess.fanPct + '%'
      }
      return
    }

    if (ev.type === 'change') {
      if (t && t.classList && t.classList.contains('dc-spool-select')) {
        sess.pendingSpoolId = String(t.value || '')
        touchUiLock(sess, 30000)
        return
      }
      if (t && t.getAttribute('data-act') === 'fan') {
        runSafe(deviceId, function () {
          return control(deviceId, { action: 'set_fan', fan: 'part', percent: sess.fanPct }).then(
            function () {
              toast('风扇 ' + sess.fanPct + '%')
            }
          )
        })
      }
      return
    }

    if (ev.type === 'mousedown' || ev.type === 'focusin') {
      if (
        t &&
        (t.closest('.dc-ams-bind') ||
          t.closest('.dc-spool-select') ||
          t.classList.contains('dc-range'))
      ) {
        touchUiLock(sess, 30000)
      }
      return
    }

    if (ev.type !== 'click') return
    var btn = t && t.closest ? t.closest('[data-act],[data-jog],[data-slot],[data-set-temp]') : null
    if (!btn || !root.contains(btn)) return
    var act = btn.getAttribute('data-act')
    var jog = btn.getAttribute('data-jog')
    var slot = btn.getAttribute('data-slot')
    var setTemp = btn.getAttribute('data-set-temp')

    if (slot != null) {
      sess.selectedSlot = Number(slot)
      root.querySelectorAll('.dc-ams-slot').forEach(function (node) {
        node.classList.toggle('is-on', Number(node.getAttribute('data-slot')) === sess.selectedSlot)
      })
      return
    }

    if (setTemp) {
      var cur = window.prompt(
        setTemp === 'bed' ? '热床目标温度 °C' : setTemp === 'chamber' ? '仓内目标温度 °C' : '喷头目标温度 °C',
        String(sess.tempInput || defaultTemp)
      )
      if (cur == null) return
      var n = Number(cur)
      if (!Number.isFinite(n)) return
      sess.tempInput = n
      if (setTemp === 'chamber') {
        runSafe(deviceId, function () {
          return control(deviceId, {
            action: 'set_chamber_temp',
            temperature: n
          }).then(function () {
            toast('仓内 → ' + n + '°C')
          })
        })
        return
      }
      runSafe(deviceId, function () {
        return control(deviceId, {
          action: 'set_temp',
          heater: setTemp === 'bed' ? 'bed' : 'extruder',
          temperature: n
        }).then(function () {
          toast((setTemp === 'bed' ? '热床' : '喷头') + ' → ' + n + '°C')
        })
      })
      return
    }

    if (jog) {
      var dist = Number(btn.getAttribute('data-dist') || 0)
      if (!dist || !Number.isFinite(dist)) {
        toast('无效点动距离', false)
        return
      }
      runSafe(deviceId, function () {
        return control(deviceId, {
          action: 'jog',
          axis: jog,
          amount: dist
        }).then(function () {
          toast('点动 ' + jog + (dist > 0 ? '+' : '') + dist + 'mm 已发送')
        })
      })
      return
    }

    if (act === 'home') {
      if (!confirmBox('确认归零？')) return
      runSafe(deviceId, function () {
        return control(deviceId, { action: 'home' }).then(function () {
          toast('归零已发送')
        })
      })
      return
    }

    if (act === 'speed-cycle') {
      var steps = [50, 75, 100, 125, 150]
      var idx = steps.indexOf(sess.speedPct)
      sess.speedPct = steps[(idx + 1) % steps.length]
      var spdLab = root.querySelector('[data-spd-val]')
      if (spdLab) spdLab.textContent = sess.speedPct + '%'
      runSafe(deviceId, function () {
        return control(deviceId, { action: 'set_speed', percent: sess.speedPct }).then(function () {
          toast('速度 ' + sess.speedPct + '%')
        })
      })
      return
    }

    if (act === 'led') {
      sess.ledOn = !sess.ledOn
      btn.classList.toggle('is-on', sess.ledOn)
      runSafe(deviceId, function () {
        return control(deviceId, {
          action: 'set_fan',
          fan: 'chamber',
          percent: sess.ledOn ? 100 : 0
        })
          .then(function () {
            toast(sess.ledOn ? '仓内风扇/LED 开' : '仓内风扇/LED 关')
          })
          .catch(function () {
            toast('已切换本地 LED 状态（机型可能无仓内风扇）', false)
          })
      })
      return
    }

    if (act === 'pause' || act === 'resume' || act === 'cancel') {
      var map = { pause: '暂停', resume: '恢复', cancel: '取消打印' }
      if (!confirmBox('确认' + map[act] + '？')) return
      runSafe(deviceId, function () {
        return control(deviceId, { action: act }).then(function () {
          toast(map[act] + '已发送')
        })
      })
      return
    }

    if (act === 'estop') {
      if (!confirmBox('紧急停止？此操作会中断打印')) return
      runSafe(deviceId, function () {
        return control(deviceId, { action: 'emergency_stop' }).then(function () {
          toast('紧急停止已发送')
        })
      })
      return
    }

    if (act === 'load' || act === 'unload') {
      var tip = act === 'load' ? '确认进料？将加热喷嘴并执行进料' : '确认退料？将加热喷嘴并退出耗材'
      if (!confirmBox(tip)) return
      var payload = {
        action: act === 'load' ? 'load_filament' : 'unload_filament',
        temperature: sess.tempInput > 0 ? sess.tempInput : defaultTemp
      }
      if (act === 'load' && brandIsBambu(deviceId) && sess.selectedSlot > 0) {
        payload.slot = sess.selectedSlot
      }
      runSafe(deviceId, function () {
        return control(deviceId, payload).then(function () {
          toast(act === 'load' ? '进料已发送' : '退料已发送')
        })
      })
      return
    }

    if (act === 'extrude' || act === 'retract') {
      var amt = Number(btn.getAttribute('data-amount') || 5)
      if (!Number.isFinite(amt) || amt <= 0) amt = 5
      if (
        !confirmBox(
          (act === 'extrude' ? '确认挤出 ' : '确认回抽 ') + amt + 'mm？\n请确认喷嘴已加热'
        )
      )
        return
      runSafe(deviceId, function () {
        return control(deviceId, { action: act, amount: amt }).then(function () {
          toast((act === 'extrude' ? '挤出' : '回抽') + ' ' + amt + 'mm')
        })
      })
      return
    }

    if (act === 'auto-refill') {
      sess.autoRefill = !sess.autoRefill
      btn.classList.toggle('is-on', sess.autoRefill)
      toast(
        sess.autoRefill ? '已标记自动续料偏好（扣减仍依赖耗材绑定）' : '已关闭自动续料标记'
      )
      return
    }

    if (act === 'bind') {
      var sel = root.querySelector('.dc-spool-select')
      var spoolId = (sel && sel.value) || sess.pendingSpoolId
      if (!spoolId) {
        toast('请选择料卷', false)
        return
      }
      sess.pendingSpoolId = spoolId
      touchUiLock(sess, 5000)
      runSafe(deviceId, function () {
        return bindSpool(spoolId, deviceId, sess.selectedSlot).then(function () {
          toast('已绑定槽 ' + (sess.selectedSlot === 0 ? 'Ext' : 'A' + sess.selectedSlot))
          sess.pendingSpoolId = ''
          clearUiLock(sess)
          if (typeof bodyRefreshers[deviceId] === 'function') bodyRefreshers[deviceId](true)
        })
      })
      return
    }

    if (act === 'gcode-pick') {
      var gin = root.querySelector('.dc-gcode-input')
      if (gin) gin.click()
      return
    }

    if (act === 'queue-refresh') {
      if (typeof bodyRefreshers[deviceId] === 'function') bodyRefreshers[deviceId]()
      toast('队列已刷新')
      return
    }

    if (act === 'queue-start' || act === 'queue-cancel') {
      var jobId = btn.getAttribute('data-job')
      if (!jobId) return
      var tip =
        act === 'queue-start' ? '确认开始打印该任务？请确认热床已清空。' : '确认取消该任务？'
      if (!confirmBox(tip)) return
      runSafe(deviceId, function () {
        return queueAction(jobId, act === 'queue-start' ? 'start' : 'cancel').then(function () {
          toast(act === 'queue-start' ? '已下发开始' : '已取消')
          if (typeof bodyRefreshers[deviceId] === 'function') bodyRefreshers[deviceId]()
        })
      })
      return
    }

    if (act === 'unbind') {
      runSafe(deviceId, function () {
        return loadSpools().then(function (spools) {
          var bound = findBound(spools, deviceId, sess.selectedSlot)
          if (!bound) {
            toast('当前槽未绑定', false)
            return
          }
          return unbindSpool(bound.id, deviceId, sess.selectedSlot).then(function () {
            toast('已解绑')
            sess.pendingSpoolId = ''
            clearUiLock(sess)
            if (typeof bodyRefreshers[deviceId] === 'function') bodyRefreshers[deviceId](true)
          })
        })
      })
    }
  }

  function normalizeCameras(list) {
    var seen = Object.create(null)
    var out = []
    for (var i = 0; i < (list || []).length; i++) {
      var c = list[i]
      if (!c) continue
      var key = String(c.id || '') + '|' + String(c.streamUrl || c.snapshotUrl || '')
      if (!key || key === '|' || seen[key]) continue
      seen[key] = 1
      out.push(c)
    }
    // 宿主已折叠 URL 候选；此处再兜底：同名「摄像头」只留一路
    var byName = Object.create(null)
    var collapsed = []
    for (var j = 0; j < out.length; j++) {
      var cam = out[j]
      var id = String(cam.id || '')
      if (id.indexOf('extra:') === 0) {
        collapsed.push(cam)
        continue
      }
      var n = String(cam.name || '').trim() || '摄像头'
      var g = n === '摄像头' || n === '机舱摄像头' ? '__chamber__' : n
      if (byName[g]) continue
      byName[g] = 1
      if (g === '__chamber__') {
        collapsed.push({
          id: cam.id || 'chamber',
          name: '机舱摄像头',
          streamUrl: cam.streamUrl,
          snapshotUrl: cam.snapshotUrl
        })
      } else {
        collapsed.push(cam)
      }
    }
    return collapsed
  }

  /** 多路机位 / 第三方摄像头：显示切换；同源 URL 候选不当作多路 */
  function shouldShowCamSwitch(cams) {
    if (!cams || cams.length <= 1) return false
    for (var i = 0; i < cams.length; i++) {
      var id = String((cams[i] && cams[i].id) || '')
      if (id.indexOf('extra:') === 0) return true
    }
    var names = Object.create(null)
    var meaningful = 0
    for (var j = 0; j < cams.length; j++) {
      var n = String((cams[j] && cams[j].name) || '').trim() || '摄像头'
      names[n] = 1
      if (n !== '摄像头' && n !== '机舱摄像头') meaningful++
    }
    if (meaningful === 0) return false
    return Object.keys(names).length > 1
  }

  function updateCamUi(root, sess, frame) {
    if (!root) return
    var title = root.querySelector('.dc-cam-title')
    var phase = root.querySelector('.dc-cam-phase')
    var img = root.querySelector('.dc-cam-img')
    var empty = root.querySelector('.dc-cam-empty')
    var sw = root.querySelector('.dc-cam-switch')
    var dots = root.querySelector('.dc-cam-dots')
    var prevBtn = root.querySelector('.dc-cam-prev')
    var nextBtn = root.querySelector('.dc-cam-next')
    var cams = sess.cameras || []
    var showSwitch = shouldShowCamSwitch(cams)

    if (sw) {
      if (!showSwitch) {
        sw.innerHTML = ''
        sw.style.display = 'none'
      } else {
        sw.style.display = ''
        var html = ''
        for (var i = 0; i < cams.length; i++) {
          html +=
            '<button type="button" class="dc-cam-tab' +
            (i === sess.camIdx ? ' is-on' : '') +
            '" data-act="cam-pick" data-cam-idx="' +
            i +
            '">' +
            escapeHtml((cams[i] && cams[i].name) || 'CAM' + (i + 1)) +
            '</button>'
        }
        sw.innerHTML = html
      }
    }

    if (prevBtn) prevBtn.style.display = showSwitch ? '' : 'none'
    if (nextBtn) nextBtn.style.display = showSwitch ? '' : 'none'
    if (dots) {
      if (!showSwitch) {
        dots.innerHTML = ''
        dots.style.display = 'none'
      } else {
        dots.style.display = ''
        var dh = ''
        for (var d = 0; d < cams.length; d++) {
          dh +=
            '<button type="button" class="dc-cam-dot' +
            (d === sess.camIdx ? ' is-on' : '') +
            '" data-act="cam-pick" data-cam-idx="' +
            d +
            '"></button>'
        }
        dots.innerHTML = dh
      }
    }

    if (!cams.length) {
      if (title) title.textContent = '摄像头'
      if (phase) phase.textContent = '无信号'
      if (img) {
        img.removeAttribute('src')
        img.classList.remove('is-live')
      }
      if (empty) {
        empty.style.display = 'grid'
        empty.textContent = '暂无摄像头'
      }
      return
    }

    if (frame && frame.src && img) {
      img.src = frame.src
      img.classList.add('is-live')
      if (title)
        title.textContent =
          (frame.name || '摄像头') +
          (showSwitch ? ' · ' + (sess.camIdx + 1) + '/' + cams.length : '')
      if (phase) phase.textContent = 'LIVE'
      if (empty) empty.style.display = 'none'
      sess.camPhase = 'live'
    } else {
      if (title) title.textContent = '摄像头'
      if (phase) phase.textContent = sess.camPhase === 'live' ? 'LIVE' : '连接中…'
      if (empty && !(img && img.getAttribute('src'))) {
        empty.style.display = 'grid'
        empty.textContent = '连接中…'
      }
    }
  }

  function mount(el, deviceId) {
    var dead = false
    var timer = null
    var camTimer = null
    var sess = sessionOf(deviceId)
    var onEv = function (ev) {
      var t = ev.target
      var pick = t && t.closest ? t.closest('[data-act="cam-pick"]') : null
      if (pick && ev.type === 'click') {
        sess.camIdx = Number(pick.getAttribute('data-cam-idx') || 0)
        tickCamera()
        return
      }
      var prev = t && t.closest ? t.closest('[data-act="cam-prev"]') : null
      var next = t && t.closest ? t.closest('[data-act="cam-next"]') : null
      if ((prev || next) && ev.type === 'click') {
        var n = (sess.cameras || []).length
        if (n > 1) {
          sess.camIdx = prev
            ? (sess.camIdx - 1 + n) % n
            : (sess.camIdx + 1) % n
          tickCamera()
        }
        return
      }
      onHostEvent(el, deviceId, ev)
    }
    el.addEventListener('click', onEv)
    el.addEventListener('input', onEv)
    el.addEventListener('change', onEv)
    el.addEventListener('mousedown', onEv)
    el.addEventListener('focusin', onEv)

    var touchX = null
    el.addEventListener(
      'touchstart',
      function (ev) {
        var frame = ev.target && ev.target.closest ? ev.target.closest('.dc-cam-frame') : null
        if (!frame || !el.contains(frame)) return
        touchX = ev.changedTouches && ev.changedTouches[0] ? ev.changedTouches[0].clientX : null
      },
      { passive: true }
    )
    el.addEventListener(
      'touchend',
      function (ev) {
        if (touchX == null) return
        var start = touchX
        touchX = null
        var frame = ev.target && ev.target.closest ? ev.target.closest('.dc-cam-frame') : null
        if (!frame || !el.contains(frame)) return
        var n = (sess.cameras || []).length
        if (n <= 1) return
        var end = ev.changedTouches && ev.changedTouches[0] ? ev.changedTouches[0].clientX : null
        if (end == null) return
        var dx = end - start
        if (Math.abs(dx) < 48) return
        sess.camIdx = dx < 0 ? (sess.camIdx + 1) % n : (sess.camIdx - 1 + n) % n
        tickCamera()
      },
      { passive: true }
    )

    function ensureShell() {
      if (el.querySelector('.dc-root')) return
      el.innerHTML =
        '<div class="dc-root" data-device="' +
        escapeHtml(deviceId) +
        '">' +
        camShellHtml() +
        '<div class="dc-main"></div></div>'
    }

    function softUpdateStatus(device, status) {
      var body = el.querySelector('.dc-body')
      if (!body) return false
      var st = status || (device && device.status) || {}
      var pills = body.querySelectorAll('.dc-status .dc-pill')
      if (pills[0]) pills[0].textContent = st.state || '—'
      if (pills[1]) pills[1].textContent = String(Math.min(100, Math.round(st.progress || 0))) + '%'
      var ex = fmtTemp(st.extruder)
      var bed = fmtTemp(st.bed)
      var chamberA = round(st.chamberTemp)
      var chamberT = st.chamberTarget != null ? round(st.chamberTarget) : null
      var map = {
        nozzle: ex,
        bed: bed,
        chamber: {
          a: chamberA == null ? '—' : String(chamberA),
          t: chamberT == null ? '—' : String(chamberT)
        }
      }
      Object.keys(map).forEach(function (k) {
        var row = body.querySelector('.dc-temp[data-temp="' + k + '"] strong')
        if (!row) return
        row.innerHTML =
          escapeHtml(map[k].a) + ' <span>/ ' + escapeHtml(map[k].t) + ' °C</span>'
      })
      return true
    }

    function refresh(force) {
      if (dead) return Promise.resolve()
      ensureShell()
      var main = el.querySelector('.dc-main')
      // 选择耗材时禁止整页重绘，避免下拉被冲掉
      if (!force && isUiLocked(sess)) {
        return loadDeviceStatus(deviceId)
          .then(function (device) {
            if (dead) return
            if (device && device.brand) brandCache[deviceId] = device.brand
            if (device && device.name) brandCache[deviceId + ':name'] = device.name
            softUpdateStatus(device, device && device.status)
          })
          .catch(function () {})
      }
      // 焦点仍在下拉/输入里也跳过整页重绘
      var ae = document.activeElement
      if (
        !force &&
        ae &&
        main &&
        main.contains(ae) &&
        (ae.tagName === 'SELECT' || ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')
      ) {
        touchUiLock(sess, 15000)
        return loadDeviceStatus(deviceId)
          .then(function (device) {
            if (dead) return
            softUpdateStatus(device, device && device.status)
          })
          .catch(function () {})
      }

      return Promise.all([loadDeviceStatus(deviceId), loadSpools(), loadQueue(deviceId)])
        .then(function (pair) {
          if (dead || !main) return
          // 二次检查：请求回来时用户可能已点开下拉
          if (!force && isUiLocked(sess)) {
            softUpdateStatus(pair[0], pair[0] && pair[0].status)
            return
          }
          var device = pair[0]
          var spools = pair[1] || []
          var jobs = pair[2] || []
          if (device && device.brand) brandCache[deviceId] = device.brand
          if (device && device.name) brandCache[deviceId + ':name'] = device.name
          var status = (device && device.status) || null
          main.innerHTML = buildHtml(deviceId, device, status, spools, jobs)
        })
        .catch(function (e) {
          if (dead || !main) return
          if (isUiLocked(sess)) return
          main.innerHTML =
            '<div class="dc-error">详情控制台加载失败：' +
            escapeHtml(e && e.message ? e.message : 'error') +
            '</div>'
        })
    }

    bodyRefreshers[deviceId] = function (force) {
      return refresh(Boolean(force))
    }

    function tickCamera() {
      if (dead) return Promise.resolve()
      ensureShell()
      var root = el.querySelector('.dc-root')
      var cams = sess.cameras || []
      if (!cams.length) {
        updateCamUi(root, sess, null)
        return Promise.resolve()
      }
      if (sess.camIdx >= cams.length) sess.camIdx = 0
      var cam = cams[sess.camIdx]
      var showSwitch = shouldShowCamSwitch(cams)
      return pullCameraFrame(deviceId, cam)
        .then(function (frame) {
          if (dead) return
          updateCamUi(root, sess, frame)
        })
        .catch(function () {
          if (dead) return
          // 仅「同源候选」时自动试下一 URL；真多路机位不自动跳
          if (!showSwitch && cams.length > 1) {
            sess.camIdx = (sess.camIdx + 1) % cams.length
          }
          if (sess.camPhase !== 'live') sess.camPhase = 'boot'
          updateCamUi(root, sess, null)
          if (!showSwitch && cams.length > 1) {
            return pullCameraFrame(deviceId, cams[sess.camIdx]).then(
              function (frame) {
                if (!dead) updateCamUi(root, sess, frame)
              },
              function () {
                if (!dead) updateCamUi(root, sess, null)
              }
            )
          }
        })
    }

    function mountCameraPluginSlots() {
      ensureShell()
      var host = el.querySelector('.dc-cam-plugin-slots')
      if (!host || !P.getSlotEntries) return
      var entries = P.getSlotEntries('device.detail.camera.after') || []
      host.innerHTML = ''
      for (var i = 0; i < entries.length; i++) {
        var entry = entries[i]
        var box = document.createElement('div')
        box.className = 'dc-cam-plugin-slot'
        host.appendChild(box)
        try {
          if (typeof entry.render === 'function') {
            entry.render(box, {
              context: {
                deviceId: deviceId,
                deviceName: brandCache[deviceId + ':name'] || deviceId,
                brand: brandCache[deviceId] || ''
              }
            })
          }
        } catch (e) {
          console.error('[detail_console] slot', e)
        }
      }
    }

    function refreshCameras() {
      return loadCameras(deviceId).then(function (cams) {
        if (dead) return
        sess.cameras = normalizeCameras(cams || [])
        // 单路/候选列表：固定从 0 开始试，避免显示一堆切换按钮
        if (!shouldShowCamSwitch(sess.cameras)) sess.camIdx = 0
        else if (sess.camIdx >= sess.cameras.length) sess.camIdx = 0
        return tickCamera()
      })
    }

    var camListTimer = null
    loadSnapshot(deviceId)
      .catch(function () {
        return null
      })
      .then(function () {
        if (!enabled) {
          el.innerHTML = ''
          return
        }
        ensureShell()
        mountCameraPluginSlots()
        return refresh()
          .then(function () {
            return refreshCameras()
          })
          .then(function () {
            timer = setInterval(function () {
              refresh()
            }, pollMs)
            camTimer = setInterval(function () {
              tickCamera()
            }, 1200)
            camListTimer = setInterval(function () {
              if (!dead) refreshCameras()
            }, 15000)
          })
      })

    var offReload = null
    try {
      offReload = P.on('device:cameras-reload', function (payload) {
        var id =
          payload && typeof payload === 'object' && payload.deviceId
            ? String(payload.deviceId)
            : ''
        if (id && id === deviceId && !dead) {
          refreshCameras()
          mountCameraPluginSlots()
        }
      })
    } catch (_) {
      offReload = null
    }

    return function cleanup() {
      dead = true
      delete bodyRefreshers[deviceId]
      if (timer) clearInterval(timer)
      if (camTimer) clearInterval(camTimer)
      if (camListTimer) clearInterval(camListTimer)
      if (typeof offReload === 'function') offReload()
      el.removeEventListener('click', onEv)
      el.removeEventListener('input', onEv)
      el.removeEventListener('change', onEv)
      el.removeEventListener('mousedown', onEv)
      el.removeEventListener('focusin', onEv)
    }
  }

  P.registerSlot(
    'device.detail.replace',
    function (el, ctx) {
      var c = (ctx && ctx.context) || {}
      var deviceId = c.deviceId
      if (!deviceId) {
        el.innerHTML = ''
        return
      }
      return mount(el, String(deviceId))
    },
    { order: 0, plugin: PLUGIN }
  )
})()
