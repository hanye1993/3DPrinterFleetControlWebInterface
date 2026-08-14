/**
 * extra_cameras — device detail settings for third-party cams.
 * Swipe switching is provided by host CameraPanel / detail_console.
 */
;(function () {
  var P = window.HanyePlugin
  if (!P) return

  var TOKEN_KEY = 'hanye_client_jwt'
  var PLUGIN = 'extra_cameras'
  var showSettings = true
  var defaultAi = true

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
    el.className = 'ec-toast' + (ok === false ? ' is-err' : ' is-ok')
    el.textContent = String(msg || '')
    document.body.appendChild(el)
    setTimeout(function () {
      el.classList.add('is-out')
      setTimeout(function () {
        if (el.parentNode) el.parentNode.removeChild(el)
      }, 280)
    }, 1800)
  }

  function fetchJson(url, opts) {
    return fetch(url, opts || {}).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok && (!j || j.ok === false)) {
          throw new Error((j && j.message) || '请求失败 ' + r.status)
        }
        return j
      })
    })
  }

  function loadList(deviceId) {
    return fetchJson(
      '/api/v1/extra-cameras/list?deviceId=' + encodeURIComponent(deviceId),
      { headers: authHeaders() }
    ).then(function (j) {
      if (j && typeof j.showSettings === 'boolean') showSettings = j.showSettings
      if (typeof j.defaultAi === 'boolean') defaultAi = j.defaultAi
      return (j && j.cameras) || []
    })
  }

  function saveList(deviceId, cameras) {
    return fetchJson('/api/v1/extra-cameras/save', {
      method: 'PUT',
      headers: authHeaders(true),
      body: JSON.stringify({ deviceId: deviceId, cameras: cameras })
    })
  }

  function rowHtml(cam, i) {
    return (
      '<div class="ec-row" data-idx="' +
      i +
      '">' +
      '<input class="ec-name" type="text" placeholder="名称" value="' +
      escapeHtml(cam.name || '') +
      '" />' +
      '<input class="ec-url" type="text" placeholder="画面 URL（HTTP / MJPEG）" value="' +
      escapeHtml(cam.streamUrl || '') +
      '" />' +
      '<input class="ec-snap" type="text" placeholder="可选：快照 URL" value="' +
      escapeHtml(cam.snapshotUrl || '') +
      '" />' +
      '<label class="ec-ai"><input type="checkbox" class="ec-ai-ck"' +
      (cam.aiEnabled === false ? '' : ' checked') +
      ' /> AI 巡检</label>' +
      '<button type="button" class="ec-del" data-act="del">删除</button>' +
      '</div>'
    )
  }

  function collect(root) {
    var rows = root.querySelectorAll('.ec-row')
    var out = []
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i]
      var name = (row.querySelector('.ec-name') || {}).value || ''
      var url = (row.querySelector('.ec-url') || {}).value || ''
      var snap = (row.querySelector('.ec-snap') || {}).value || ''
      var ai = row.querySelector('.ec-ai-ck')
      if (!String(url).trim()) continue
      out.push({
        id: '',
        name: String(name).trim(),
        streamUrl: String(url).trim(),
        snapshotUrl: String(snap).trim() || undefined,
        aiEnabled: ai ? !!ai.checked : true
      })
    }
    return out
  }

  function render(el, deviceId, cameras) {
    if (!showSettings) {
      el.innerHTML = ''
      return
    }
    var html =
      '<div class="ec-panel" data-device-id="' +
      escapeHtml(deviceId) +
      '">' +
      '<div class="ec-head">' +
      '<strong>第三方摄像头</strong>' +
      '<span class="ec-hint">左右滑动画面可切换；保存后进入内部监控与 AI 巡检</span>' +
      '</div>' +
      '<div class="ec-list">' +
      (cameras.length
        ? cameras.map(rowHtml).join('')
        : '<div class="ec-empty">尚未添加第三方摄像头</div>') +
      '</div>' +
      '<div class="ec-actions">' +
      '<button type="button" class="ec-btn" data-act="add">添加摄像头</button>' +
      '<button type="button" class="ec-btn ec-primary" data-act="save">保存</button>' +
      '</div></div>'
    el.innerHTML = html
  }

  P.registerSlot(
    'device.detail.camera.after',
    function (el, ctx) {
      var c = (ctx && ctx.context) || {}
      var deviceId = String(c.deviceId || '')
      if (!deviceId) {
        el.innerHTML = ''
        return
      }
      el.innerHTML = '<div class="ec-panel"><div class="ec-hint">加载摄像头设置…</div></div>'
      loadList(deviceId)
        .then(function (cams) {
          render(el, deviceId, cams)
        })
        .catch(function () {
          render(el, deviceId, [])
        })

      if (el._ecBound) return
      el._ecBound = true
      el.addEventListener('click', function (ev) {
        var t = ev.target
        var act = t && t.getAttribute ? t.getAttribute('data-act') : ''
        var panel = el.querySelector('.ec-panel')
        if (!panel) return
        var id = panel.getAttribute('data-device-id') || deviceId

        if (act === 'add') {
          var list = el.querySelector('.ec-list')
          if (!list) return
          var empty = list.querySelector('.ec-empty')
          if (empty) empty.parentNode.removeChild(empty)
          var wrap = document.createElement('div')
          wrap.innerHTML = rowHtml(
            { name: '', streamUrl: '', snapshotUrl: '', aiEnabled: defaultAi },
            list.children.length
          )
          list.appendChild(wrap.firstChild)
          return
        }

        if (act === 'del') {
          var row = t.closest ? t.closest('.ec-row') : null
          if (row && row.parentNode) row.parentNode.removeChild(row)
          var list2 = el.querySelector('.ec-list')
          if (list2 && !list2.querySelector('.ec-row')) {
            list2.innerHTML = '<div class="ec-empty">尚未添加第三方摄像头</div>'
          }
          return
        }

        if (act === 'save') {
          var cams = collect(panel)
          t.disabled = true
          saveList(id, cams)
            .then(function (j) {
              toast('已保存 ' + ((j && j.cameras && j.cameras.length) || 0) + ' 路摄像头', true)
              render(el, id, (j && j.cameras) || cams)
              try {
                P.emit('device:cameras-reload', { deviceId: id })
                P.emit('monitor:change', null)
              } catch (_) {
                /* ignore */
              }
            })
            .catch(function (e) {
              toast(e && e.message ? e.message : '保存失败', false)
            })
            .then(function () {
              t.disabled = false
            })
        }
      })
    },
    { order: 20, plugin: PLUGIN }
  )
})()
