/**
 * company_chat — 侧栏聊天 UI（可开闭）
 */
;(function () {
  var P = window.HanyePlugin
  if (!P) return

  var TOKEN_KEY = 'hanye_client_jwt'
  var OPEN_KEY = 'hanye_company_chat_open'
  var state = {
    open: false,
    tab: 'room', // room | dm
    peerId: null,
    peer: null,
    me: null,
    config: null,
    online: [],
    recent: [],
    roomMessages: [],
    dmMessages: [],
    threads: [],
    roomAfter: '',
    dmAfter: '',
    pollTimer: null,
    hbTimer: null
  }

  function authHeaders() {
    var token = localStorage.getItem(TOKEN_KEY) || ''
    var h = { Accept: 'application/json', 'Content-Type': 'application/json' }
    if (token) h.Authorization = 'Bearer ' + token
    return h
  }

  function unwrap(data) {
    if (data && data.data && typeof data.data === 'object') return data.data
    return data
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  function fmtTime(iso) {
    if (!iso) return ''
    var d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ''
    var hh = String(d.getHours()).padStart(2, '0')
    var mm = String(d.getMinutes()).padStart(2, '0')
    return hh + ':' + mm
  }

  function api(path, method, body) {
    var opts = { method: method || 'GET', headers: authHeaders() }
    if (body != null) opts.body = JSON.stringify(body)
    return fetch(path, opts).then(function (r) {
      return r.json().then(function (data) {
        var payload = unwrap(data)
        if (!r.ok || (payload && payload.ok === false)) {
          throw new Error((payload && payload.message) || (data && data.message) || '请求失败')
        }
        return payload
      })
    })
  }

  function setOpen(open) {
    state.open = Boolean(open)
    try {
      localStorage.setItem(OPEN_KEY, state.open ? '1' : '0')
    } catch (_) {}
    document.body.classList.toggle('cc-chat-open', state.open)
    var panel = document.getElementById('cc-chat-panel')
    if (panel) panel.classList.toggle('is-open', state.open)
    var btn = document.querySelector('[data-cc-toggle]')
    if (btn) btn.setAttribute('aria-pressed', state.open ? 'true' : 'false')
  }

  function toggle() {
    setOpen(!state.open)
    if (state.open) refreshAll()
  }

  function nameOf(u) {
    if (!u) return '用户'
    return u.displayName || u.username || u.userId || '用户'
  }

  function renderOnlineList(root) {
    var el = root.querySelector('[data-cc-online]')
    if (!el) return
    var html = ''
    var list = state.online || []
    if (!list.length) {
      html = '<div class="cc-empty">暂无其他在线成员</div>'
    } else {
      for (var i = 0; i < list.length; i++) {
        var u = list[i]
        if (state.me && String(u.userId) === String(state.me.userId)) continue
        html +=
          '<button type="button" class="cc-user" data-peer="' +
          escapeHtml(u.userId) +
          '">' +
          '<span class="cc-dot online"></span>' +
          '<span class="cc-user-name">' +
          escapeHtml(nameOf(u)) +
          '</span>' +
          '<span class="cc-user-meta">在线</span>' +
          '</button>'
      }
      if (!html) html = '<div class="cc-empty">只有你在线</div>'
    }
    var recent = state.recent || []
    if (recent.length) {
      html += '<div class="cc-sub">最近活跃</div>'
      for (var j = 0; j < recent.length; j++) {
        var r = recent[j]
        if (state.me && String(r.userId) === String(state.me.userId)) continue
        html +=
          '<button type="button" class="cc-user" data-peer="' +
          escapeHtml(r.userId) +
          '">' +
          '<span class="cc-dot"></span>' +
          '<span class="cc-user-name">' +
          escapeHtml(nameOf(r)) +
          '</span>' +
          '<span class="cc-user-meta">离线</span>' +
          '</button>'
      }
    }
    el.innerHTML = html
    el.querySelectorAll('[data-peer]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openDm(btn.getAttribute('data-peer'))
      })
    })
  }

  function fmtSize(n) {
    var x = Number(n) || 0
    if (x < 1024) return x + ' B'
    if (x < 1024 * 1024) return (x / 1024).toFixed(1) + ' KB'
    return (x / 1024 / 1024).toFixed(1) + ' MB'
  }

  function fileBodyHtml(m) {
    var f = m.file
    if (!f) return escapeHtml(m.content || '')
    var caption = m.text || ''
    var isImg = String(f.mime || '').indexOf('image/') === 0
    var html =
      '<div class="cc-file">' +
      (isImg
        ? '<div class="cc-file-preview" data-preview="' +
          escapeHtml(f.url) +
          '" data-name="' +
          escapeHtml(f.name) +
          '">图片加载中…</div>'
        : '') +
      '<button type="button" class="cc-file-link" data-dl="' +
      escapeHtml(f.url) +
      '" data-name="' +
      escapeHtml(f.name) +
      '">📎 ' +
      escapeHtml(f.name) +
      ' <span class="cc-file-size">(' +
      escapeHtml(fmtSize(f.size)) +
      ')</span></button>' +
      (caption ? '<div class="cc-file-caption">' + escapeHtml(caption) + '</div>' : '') +
      '</div>'
    return html
  }

  function bindFileActions(el) {
    el.querySelectorAll('[data-dl]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        downloadAuthed(btn.getAttribute('data-dl'), btn.getAttribute('data-name') || 'file')
      })
    })
    el.querySelectorAll('[data-preview]').forEach(function (box) {
      var url = box.getAttribute('data-preview')
      fetch(url, { headers: authHeaders() })
        .then(function (r) {
          if (!r.ok) throw new Error('预览失败')
          return r.blob()
        })
        .then(function (blob) {
          var src = URL.createObjectURL(blob)
          box.innerHTML =
            '<img class="cc-file-img" src="' + src + '" alt="' + escapeHtml(box.getAttribute('data-name') || '') + '" />'
        })
        .catch(function () {
          box.textContent = '无法预览'
        })
    })
  }

  function downloadAuthed(url, name) {
    fetch(url, { headers: authHeaders() })
      .then(function (r) {
        if (!r.ok) throw new Error('下载失败')
        return r.blob()
      })
      .then(function (blob) {
        var a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = name || 'file'
        document.body.appendChild(a)
        a.click()
        a.remove()
      })
      .catch(function (e) {
        window.alert(e && e.message ? e.message : String(e))
      })
  }

  function renderMessages(root) {
    var el = root.querySelector('[data-cc-messages]')
    if (!el) return
    var rows = state.tab === 'room' ? state.roomMessages : state.dmMessages
    var html = ''
    if (!rows.length) {
      html = '<div class="cc-empty">还没有消息，打个招呼吧</div>'
    } else {
      for (var i = 0; i < rows.length; i++) {
        var m = rows[i]
        var mine =
          state.me &&
          ((state.tab === 'room' && String(m.userId) === String(state.me.userId)) ||
            (state.tab === 'dm' && String(m.fromId) === String(state.me.userId)))
        var who =
          state.tab === 'room'
            ? nameOf({ displayName: m.displayName, username: m.username, userId: m.userId })
            : mine
              ? '我'
              : nameOf(state.peer)
        var body =
          m.msgType === 'file' && m.file ? fileBodyHtml(m) : escapeHtml(m.content || m.text || '')
        html +=
          '<div class="cc-msg' +
          (mine ? ' mine' : '') +
          '">' +
          '<div class="cc-msg-meta"><span>' +
          escapeHtml(who) +
          '</span><span>' +
          escapeHtml(fmtTime(m.createdAt)) +
          '</span></div>' +
          '<div class="cc-msg-body">' +
          body +
          '</div></div>'
      }
    }
    var stick = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    el.innerHTML = html
    bindFileActions(el)
    if (stick || !rows.length) el.scrollTop = el.scrollHeight
  }

  function renderHeader(root) {
    var title = root.querySelector('[data-cc-title]')
    if (!title) return
    if (state.tab === 'room') title.textContent = '全员聊天室'
    else title.textContent = '私聊 · ' + nameOf(state.peer)
  }

  function renderTabs(root) {
    root.querySelectorAll('[data-cc-tab]').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-cc-tab') === state.tab)
    })
  }

  function paint() {
    var root = document.getElementById('cc-chat-panel')
    if (!root) return
    renderHeader(root)
    renderTabs(root)
    renderOnlineList(root)
    renderMessages(root)
    var policy = root.querySelector('[data-cc-policy]')
    if (policy && state.config) {
      policy.textContent =
        state.config.dmPolicy === 'admin_only' ? '私聊：仅管理员可发起' : '私聊：全员可聊'
    }
  }

  function openDm(peerId) {
    var policy = (state.config && state.config.dmPolicy) || 'all'
    var meAdmin = state.me && state.me.level === 'admin'
    if (policy === 'admin_only' && !meAdmin) {
      // 仍可打开已有会话；无会话时提示
      var has = (state.threads || []).some(function (t) {
        return String(t.peerId) === String(peerId)
      })
      if (!has) {
        window.alert('当前仅管理员可发起私聊')
        return
      }
    }
    state.tab = 'dm'
    state.peerId = String(peerId)
    state.peer = null
    state.dmMessages = []
    state.dmAfter = ''
    setOpen(true)
    paint()
    loadDm(true)
  }

  function loadOnline() {
    return api('/api/v1/company-chat/online')
      .then(function (data) {
        state.online = data.online || []
        state.recent = data.recent || []
        state.me = data.me || state.me
        state.config = data.config || state.config
        paint()
      })
      .catch(function () {})
  }

  function loadRoom(initial) {
    var q = initial ? '?limit=80' : state.roomAfter ? '?after=' + encodeURIComponent(state.roomAfter) + '&limit=80' : '?limit=80'
    return api('/api/v1/company-chat/room' + q)
      .then(function (data) {
        var msgs = data.messages || []
        if (initial || !state.roomAfter) {
          state.roomMessages = msgs
        } else if (msgs.length) {
          state.roomMessages = state.roomMessages.concat(msgs)
        }
        if (state.roomMessages.length) {
          state.roomAfter = state.roomMessages[state.roomMessages.length - 1].createdAt
        }
        if (state.tab === 'room') paint()
      })
      .catch(function () {})
  }

  function loadDm(initial) {
    if (!state.peerId) return Promise.resolve()
    var q =
      '?peerId=' +
      encodeURIComponent(state.peerId) +
      (initial || !state.dmAfter
        ? '&limit=80'
        : '&after=' + encodeURIComponent(state.dmAfter) + '&limit=80')
    return api('/api/v1/company-chat/dm' + q)
      .then(function (data) {
        state.peer = data.peer || state.peer
        var msgs = data.messages || []
        if (initial || !state.dmAfter) state.dmMessages = msgs
        else if (msgs.length) state.dmMessages = state.dmMessages.concat(msgs)
        if (state.dmMessages.length) {
          state.dmAfter = state.dmMessages[state.dmMessages.length - 1].createdAt
        }
        if (state.tab === 'dm') paint()
      })
      .catch(function () {})
  }

  function loadThreads() {
    return api('/api/v1/company-chat/dm/threads')
      .then(function (data) {
        state.threads = data.threads || []
      })
      .catch(function () {})
  }

  function refreshAll() {
    return Promise.all([loadOnline(), loadThreads(), state.tab === 'dm' ? loadDm(false) : loadRoom(false)])
  }

  function sendMessage() {
    var root = document.getElementById('cc-chat-panel')
    if (!root) return
    var input = root.querySelector('[data-cc-input]')
    if (!input) return
    var text = String(input.value || '').trim()
    if (!text) return
    input.value = ''
    var p =
      state.tab === 'room'
        ? api('/api/v1/company-chat/room', 'POST', { content: text })
        : api('/api/v1/company-chat/dm', 'POST', { toId: state.peerId, content: text })
    p.then(function () {
      if (state.tab === 'room') return loadRoom(false)
      return loadDm(false).then(loadThreads)
    }).catch(function (e) {
      window.alert(e && e.message ? e.message : String(e))
    })
  }

  function fileToBase64(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader()
      reader.onload = function () {
        resolve(String(reader.result || ''))
      }
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  function sendFile(file) {
    if (!file) return
    if (state.config && state.config.allowFile === false) {
      window.alert('未开启文件发送')
      return
    }
    if (state.tab === 'dm' && !state.peerId) {
      window.alert('请先选择私聊对象')
      return
    }
    var maxMb = (state.config && state.config.maxFileMb) || 10
    if (file.size > maxMb * 1024 * 1024) {
      window.alert('文件过大（最大 ' + maxMb + ' MB）')
      return
    }
    var root = document.getElementById('cc-chat-panel')
    var tip = root && root.querySelector('[data-cc-file-tip]')
    if (tip) tip.textContent = '上传中…'
    fileToBase64(file)
      .then(function (dataUrl) {
        return api('/api/v1/company-chat/upload', 'POST', {
          name: file.name,
          mime: file.type || 'application/octet-stream',
          size: file.size,
          dataBase64: dataUrl
        })
      })
      .then(function (data) {
        var f = data.file
        if (!f || !f.id) throw new Error('上传失败')
        var caption = ''
        var input = root && root.querySelector('[data-cc-input]')
        if (input) {
          caption = String(input.value || '').trim()
          input.value = ''
        }
        var body =
          state.tab === 'room'
            ? { fileId: f.id, caption: caption }
            : { toId: state.peerId, fileId: f.id, caption: caption }
        var url = state.tab === 'room' ? '/api/v1/company-chat/room' : '/api/v1/company-chat/dm'
        return api(url, 'POST', body)
      })
      .then(function () {
        if (tip) tip.textContent = ''
        if (state.tab === 'room') return loadRoom(false)
        return loadDm(false).then(loadThreads)
      })
      .catch(function (e) {
        if (tip) tip.textContent = ''
        window.alert(e && e.message ? e.message : String(e))
      })
  }

  function ensurePanel() {
    if (document.getElementById('cc-chat-panel')) return
    var panel = document.createElement('aside')
    panel.id = 'cc-chat-panel'
    panel.className = 'cc-chat-panel'
    panel.innerHTML =
      '<div class="cc-chat-head">' +
      '<div><strong data-cc-title>公司聊天</strong><div class="cc-policy" data-cc-policy></div></div>' +
      '<button type="button" class="cc-icon-btn" data-cc-close title="关闭">×</button>' +
      '</div>' +
      '<div class="cc-chat-tabs">' +
      '<button type="button" data-cc-tab="room" class="active">聊天室</button>' +
      '<button type="button" data-cc-tab="dm">私聊</button>' +
      '</div>' +
      '<div class="cc-chat-body">' +
      '<div class="cc-side">' +
      '<div class="cc-side-title">在线成员</div>' +
      '<div class="cc-online" data-cc-online></div>' +
      '</div>' +
      '<div class="cc-main">' +
      '<div class="cc-messages" data-cc-messages></div>' +
      '<div class="cc-composer">' +
      '<textarea data-cc-input rows="2" placeholder="输入消息，Enter 发送 / Shift+Enter 换行"></textarea>' +
      '<div class="cc-composer-actions">' +
      '<label class="cc-file-btn" title="发送文件">文件<input type="file" data-cc-file hidden /></label>' +
      '<button type="button" class="cc-send" data-cc-send>发送</button>' +
      '</div></div>' +
      '<div class="cc-file-tip" data-cc-file-tip></div>' +
      '</div></div>'
    document.body.appendChild(panel)

    panel.querySelector('[data-cc-close]').addEventListener('click', function () {
      setOpen(false)
    })
    panel.querySelectorAll('[data-cc-tab]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.tab = btn.getAttribute('data-cc-tab')
        if (state.tab === 'room') {
          state.peerId = null
          loadRoom(true)
        } else {
          loadThreads().then(function () {
            if (!state.peerId && state.threads[0]) openDm(state.threads[0].peerId)
            else paint()
          })
        }
        paint()
      })
    })
    panel.querySelector('[data-cc-send]').addEventListener('click', sendMessage)
    panel.querySelector('[data-cc-input]').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        sendMessage()
      }
    })
    var fileInput = panel.querySelector('[data-cc-file]')
    if (fileInput) {
      fileInput.addEventListener('change', function () {
        var f = fileInput.files && fileInput.files[0]
        fileInput.value = ''
        if (f) sendFile(f)
      })
    }
  }

  function startTimers() {
    if (state.hbTimer) clearInterval(state.hbTimer)
    if (state.pollTimer) clearInterval(state.pollTimer)
    state.hbTimer = setInterval(function () {
      api('/api/v1/company-chat/heartbeat', 'POST', {}).catch(function () {})
    }, 25000)
    api('/api/v1/company-chat/heartbeat', 'POST', {}).catch(function () {})
    var sec = (state.config && state.config.pollSec) || 3
    state.pollTimer = setInterval(function () {
      if (!state.open) {
        loadOnline()
        return
      }
      refreshAll()
    }, sec * 1000)
  }

  // header toggle
  P.registerSlot(
    'app.header.actions',
    function (el) {
      el.innerHTML =
        '<button type="button" class="cc-toggle-btn" data-cc-toggle title="公司聊天">聊天</button>'
      var btn = el.querySelector('[data-cc-toggle]')
      if (btn) btn.addEventListener('click', toggle)
      return function () {
        el.innerHTML = ''
      }
    },
    { order: 20, plugin: 'company_chat' }
  )

  // settings form
  function loadPluginVars() {
    return fetch('/api/v1/plugins', { headers: authHeaders() })
      .then(function (r) {
        return r.json()
      })
      .then(function (data) {
        var list = (data && data.plugins) || []
        for (var i = 0; i < list.length; i++) {
          if (list[i] && list[i].identifier === 'company_chat') return Object.assign({}, list[i].vars || {})
        }
        return {}
      })
      .catch(function () {
        return {}
      })
  }

  function savePluginVars(vars) {
    return fetch('/api/v1/plugins/company_chat/vars', {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({ vars: vars })
    }).then(function (r) {
      return r.json()
    })
  }

  P.registerSettingsTab({
    key: 'company_chat',
    label: '公司聊天',
    after: 'plugins',
    order: 8,
    adminOnly: true,
    render: function (el) {
      el.innerHTML = '<div class="settings-tab-panel"><p>加载中…</p></div>'
      Promise.all([loadPluginVars(), api('/api/v1/company-chat/admin/cleanup-status').catch(function () { return null })])
        .then(function (pair) {
          var v = pair[0] || {}
          var st = pair[1]
          var last = st && st.last ? st.last : null
          el.innerHTML =
            '<div class="settings-tab-panel cc-settings">' +
            '<h3>公司聊天设置</h3>' +
            '<div class="cc-field"><label>私聊权限</label>' +
            '<select name="dm_policy" class="cc-input">' +
            '<option value="all"' +
            ((v.dm_policy || 'all') === 'all' ? ' selected' : '') +
            '>全部人员可私聊</option>' +
            '<option value="admin_only"' +
            (v.dm_policy === 'admin_only' ? ' selected' : '') +
            '>仅管理员可发起私聊</option>' +
            '</select></div>' +
            '<div class="cc-field"><label>记录保留天数</label>' +
            '<input class="cc-input" name="retain_days" type="number" min="1" max="3650" value="' +
            escapeHtml(v.retain_days || '30') +
            '" /></div>' +
            '<div class="cc-field"><label>自动清理</label>' +
            '<select name="cleanup_enabled" class="cc-input">' +
            '<option value="1"' +
            (v.cleanup_enabled !== '0' ? ' selected' : '') +
            '>开启</option>' +
            '<option value="0"' +
            (v.cleanup_enabled === '0' ? ' selected' : '') +
            '>关闭</option>' +
            '</select></div>' +
            '<div class="cc-field"><label>默认展开侧栏</label>' +
            '<select name="panel_default_open" class="cc-input">' +
            '<option value="0"' +
            (v.panel_default_open !== '1' ? ' selected' : '') +
            '>否</option>' +
            '<option value="1"' +
            (v.panel_default_open === '1' ? ' selected' : '') +
            '>是</option>' +
            '</select></div>' +
            '<div class="cc-field"><label>轮询间隔（秒）</label>' +
            '<input class="cc-input" name="poll_sec" type="number" min="2" max="30" value="' +
            escapeHtml(v.poll_sec || '3') +
            '" /></div>' +
            '<div class="cc-field"><label>单条字数上限</label>' +
            '<input class="cc-input" name="max_len" type="number" min="50" max="8000" value="' +
            escapeHtml(v.max_len || '2000') +
            '" /></div>' +
            '<div class="cc-field"><label>允许发送文件</label>' +
            '<select name="allow_file" class="cc-input">' +
            '<option value="1"' +
            (v.allow_file !== '0' ? ' selected' : '') +
            '>开启</option>' +
            '<option value="0"' +
            (v.allow_file === '0' ? ' selected' : '') +
            '>关闭</option>' +
            '</select></div>' +
            '<div class="cc-field"><label>单个文件最大 MB</label>' +
            '<input class="cc-input" name="max_file_mb" type="number" min="1" max="50" value="' +
            escapeHtml(v.max_file_mb || '10') +
            '" /></div>' +
            '<div class="cc-actions">' +
            '<button type="button" class="cc-save" data-save>保存设置</button> ' +
            '<button type="button" class="cc-clean" data-cleanup>立即清理过期消息</button>' +
            '<span data-msg class="cc-msg-tip"></span></div>' +
            '<div class="cc-search-box">' +
            '<h4>消息查询</h4>' +
            '<div class="cc-search-row">' +
            '<input class="cc-input" data-q placeholder="关键词" />' +
            '<select class="cc-input" data-type style="max-width:120px">' +
            '<option value="all">全部</option><option value="room">聊天室</option><option value="dm">私聊</option>' +
            '</select>' +
            '<button type="button" class="cc-save" data-search>查询</button></div>' +
            '<div data-search-out class="cc-search-out"></div>' +
            (last
              ? '<p class="cc-hint">上次清理：删聊天室 ' +
                (last.roomDeleted || 0) +
                ' / 私聊 ' +
                (last.dmDeleted || 0) +
                ' · ' +
                escapeHtml(last.at || '') +
                '</p>'
              : '') +
            '</div></div>'

          el.querySelector('[data-save]').addEventListener('click', function () {
            var vars = {}
            el.querySelectorAll('[name]').forEach(function (n) {
              vars[n.getAttribute('name')] = String(n.value || '')
            })
            var tip = el.querySelector('[data-msg]')
            savePluginVars(vars)
              .then(function (data) {
                if (data && data.ok === false) throw new Error(data.message || '保存失败')
                tip.textContent = '已保存'
                tip.className = 'cc-msg-tip ok'
                return api('/api/v1/company-chat/config')
              })
              .then(function (cfg) {
                state.config = cfg
                startTimers()
              })
              .catch(function (e) {
                tip.textContent = e.message || String(e)
                tip.className = 'cc-msg-tip err'
              })
          })

          el.querySelector('[data-cleanup]').addEventListener('click', function () {
            if (!window.confirm('按当前保留天数清理过期消息？')) return
            var tip = el.querySelector('[data-msg]')
            api('/api/v1/company-chat/admin/cleanup', 'POST', {})
              .then(function (r) {
                tip.textContent =
                  '清理完成：聊天室 -' + (r.roomDeleted || 0) + '，私聊 -' + (r.dmDeleted || 0)
                tip.className = 'cc-msg-tip ok'
              })
              .catch(function (e) {
                tip.textContent = e.message || String(e)
                tip.className = 'cc-msg-tip err'
              })
          })

          el.querySelector('[data-search]').addEventListener('click', function () {
            var q = el.querySelector('[data-q]').value
            var type = el.querySelector('[data-type]').value
            var out = el.querySelector('[data-search-out]')
            out.textContent = '查询中…'
            api(
              '/api/v1/company-chat/admin/search?q=' +
                encodeURIComponent(q) +
                '&type=' +
                encodeURIComponent(type) +
                '&limit=50'
            )
              .then(function (data) {
                var rows = data.rows || []
                if (!rows.length) {
                  out.innerHTML = '<div class="cc-empty">无结果</div>'
                  return
                }
                var html = '<table class="cc-table"><thead><tr><th>类型</th><th>时间</th><th>内容</th></tr></thead><tbody>'
                for (var i = 0; i < rows.length; i++) {
                  var row = rows[i]
                  html +=
                    '<tr><td>' +
                    escapeHtml(row.kind) +
                    '</td><td>' +
                    escapeHtml(row.createdAt || '') +
                    '</td><td>' +
                    escapeHtml(row.content || '') +
                    '</td></tr>'
                }
                html += '</tbody></table>'
                out.innerHTML = html
              })
              .catch(function (e) {
                out.textContent = e.message || String(e)
              })
          })
        })
    }
  })

  // boot
  ensurePanel()
  api('/api/v1/company-chat/config')
    .then(function (cfg) {
      state.config = cfg
      var prefer
      try {
        prefer = localStorage.getItem(OPEN_KEY)
      } catch (_) {
        prefer = null
      }
      if (prefer === '1' || prefer === '0') setOpen(prefer === '1')
      else setOpen(Boolean(cfg.panelDefaultOpen))
      startTimers()
      loadOnline()
      loadRoom(true)
      loadThreads()
    })
    .catch(function () {
      ensurePanel()
      startTimers()
    })
})()
