/**
 * extra_cameras — button opens modal to add; list + delete in compact bar.
 * Host CameraPanel / detail_console handle swipe switching.
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

  function unwrap(j) {
    if (j && j.data && typeof j.data === 'object') return j.data
    return j
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
        var payload = unwrap(j)
        if (!r.ok || (payload && payload.ok === false) || (j && j.ok === false && !payload)) {
          throw new Error(
            (payload && payload.message) || (j && j.message) || '请求失败 ' + r.status
          )
        }
        return payload
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

  function closeModal() {
    var m = document.getElementById('ec-modal-root')
    if (m && m.parentNode) m.parentNode.removeChild(m)
  }

  function openAddModal(deviceId, existing, onDone) {
    closeModal()
    var root = document.createElement('div')
    root.id = 'ec-modal-root'
    root.className = 'ec-modal-root'
    root.innerHTML =
      '<div class="ec-modal-mask" data-act="cancel"></div>' +
      '<div class="ec-modal" role="dialog" aria-modal="true">' +
      '<div class="ec-modal-title">添加第三方摄像头</div>' +
      '<label class="ec-field"><span>名称</span>' +
      '<input class="ec-modal-name" type="text" placeholder="例如：机后 / 门口" /></label>' +
      '<label class="ec-field"><span>画面 URL</span>' +
      '<input class="ec-modal-url" type="text" placeholder="http://192.168.x.x/stream 或 IP:端口/路径" /></label>' +
      '<label class="ec-field"><span>快照 URL（可选）</span>' +
      '<input class="ec-modal-snap" type="text" placeholder="留空则用画面地址" /></label>' +
      '<label class="ec-ai ec-modal-ai"><input type="checkbox" class="ec-modal-ai-ck"' +
      (defaultAi ? ' checked' : '') +
      ' /> 参与 AI 巡检</label>' +
      '<div class="ec-modal-actions">' +
      '<button type="button" class="ec-btn" data-act="cancel">取消</button>' +
      '<button type="button" class="ec-btn ec-primary" data-act="confirm">确定</button>' +
      '</div></div>'

    function onClick(ev) {
      var t = ev.target
      var act = t && t.getAttribute ? t.getAttribute('data-act') : ''
      if (act === 'cancel' || t === root.querySelector('.ec-modal-mask')) {
        closeModal()
        return
      }
      if (act !== 'confirm') return
      var name = (root.querySelector('.ec-modal-name') || {}).value || ''
      var url = (root.querySelector('.ec-modal-url') || {}).value || ''
      var snap = (root.querySelector('.ec-modal-snap') || {}).value || ''
      var ai = root.querySelector('.ec-modal-ai-ck')
      if (!String(url).trim()) {
        toast('请填写画面 URL', false)
        return
      }
      var next = (existing || []).slice()
      next.push({
        id: '',
        name: String(name).trim(),
        streamUrl: String(url).trim(),
        snapshotUrl: String(snap).trim() || undefined,
        aiEnabled: ai ? !!ai.checked : true
      })
      var btn = t
      btn.disabled = true
      saveList(deviceId, next)
        .then(function (j) {
          var cams = (j && j.cameras) || next
          toast('已添加，共 ' + cams.length + ' 路', true)
          closeModal()
          try {
            P.emit('device:cameras-reload', { deviceId: deviceId })
            P.emit('monitor:change', null)
          } catch (_) {
            /* ignore */
          }
          if (typeof onDone === 'function') onDone(cams)
        })
        .catch(function (e) {
          toast(e && e.message ? e.message : '保存失败', false)
          btn.disabled = false
        })
    }

    root.addEventListener('click', onClick)
    document.body.appendChild(root)
    var first = root.querySelector('.ec-modal-name')
    if (first && first.focus) setTimeout(function () {
      first.focus()
    }, 30)
  }

  function chipHtml(cam, i) {
    return (
      '<div class="ec-chip" data-idx="' +
      i +
      '" data-id="' +
      escapeHtml(cam.id || '') +
      '" title="' +
      escapeHtml(cam.streamUrl || '') +
      '">' +
      '<span class="ec-chip-name">' +
      escapeHtml(cam.name || '摄像头') +
      '</span>' +
      (cam.aiEnabled === false ? '<span class="ec-chip-tag">无AI</span>' : '') +
      '<button type="button" class="ec-chip-del" data-act="del" data-idx="' +
      i +
      '" aria-label="删除">×</button>' +
      '</div>'
    )
  }

  function render(el, deviceId, cameras) {
    if (!showSettings) {
      el.innerHTML = ''
      return
    }
    el._ecCams = cameras || []
    var html =
      '<div class="ec-panel" data-device-id="' +
      escapeHtml(deviceId) +
      '">' +
      '<div class="ec-bar">' +
      '<div class="ec-bar-left">' +
      '<strong>第三方摄像头</strong>' +
      '<span class="ec-hint">' +
      (cameras.length ? '已添加 ' + cameras.length + ' 路 · 画面左右滑切换' : '未添加') +
      '</span>' +
      '</div>' +
      '<button type="button" class="ec-btn ec-primary" data-act="add">添加摄像头</button>' +
      '</div>' +
      (cameras.length
        ? '<div class="ec-chips">' + cameras.map(chipHtml).join('') + '</div>'
        : '') +
      '</div>'
    el.innerHTML = html
  }

  function refresh(el, deviceId) {
    return loadList(deviceId)
      .then(function (cams) {
        render(el, deviceId, cams)
        return cams
      })
      .catch(function () {
        render(el, deviceId, el._ecCams || [])
      })
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
      el.innerHTML = '<div class="ec-panel"><div class="ec-hint">加载中…</div></div>'
      void refresh(el, deviceId)

      if (el._ecBound) return
      el._ecBound = true
      el.addEventListener('click', function (ev) {
        var t = ev.target
        if (!t || !t.getAttribute) return
        var act = t.getAttribute('data-act')
        var panel = el.querySelector('.ec-panel')
        if (!panel) return
        var id = panel.getAttribute('data-device-id') || deviceId
        var cams = el._ecCams || []

        if (act === 'add') {
          openAddModal(id, cams, function (next) {
            render(el, id, next)
          })
          return
        }

        if (act === 'del') {
          var idx = Number(t.getAttribute('data-idx'))
          if (!Number.isFinite(idx) || idx < 0 || idx >= cams.length) return
          var next = cams.slice()
          next.splice(idx, 1)
          t.disabled = true
          saveList(id, next)
            .then(function (j) {
              var list = (j && j.cameras) || next
              toast(list.length ? '已删除' : '已清空第三方摄像头', true)
              render(el, id, list)
              try {
                P.emit('device:cameras-reload', { deviceId: id })
                P.emit('monitor:change', null)
              } catch (_) {
                /* ignore */
              }
            })
            .catch(function (e) {
              toast(e && e.message ? e.message : '删除失败', false)
              t.disabled = false
            })
        }
      })
    },
    { order: 20, plugin: PLUGIN }
  )
})()
