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
  var state = {
    me: null,
    models: [],
    materials: [],
    colors: [],
    jobs: [],
    file: null,
    b64: '',
    fileReady: false
  }

  function statusText(s) {
    return (
      {
        pending_audit: '待审核',
        approved: '已通过',
        waiting_material: '等巡查换料',
        printing: '打印中',
        print_done: '待清床',
        print_error: '打印报错',
        completed: '已完成',
        rejected: '已驳回',
        failed: '派单失败',
        cancelled: '已取消'
      }[s] || s
    )
  }

  function deny(msg) {
    document.getElementById('app').innerHTML =
      '<div class="card"><h2>提交打印</h2><p class="err">' +
      esc(msg) +
      '</p><p class="meta">请加入用户组「派单申请」，或勾选 plugin.farm_dispatch.submit</p></div>'
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
    if (!me.roles || !me.roles.submit) return deny('当前账号无提交权限')
    state.me = me
    var m = await api('GET', '/api/v1/farm-dispatch/models')
    state.models = (m && m.models) || []
    var c = await api('GET', '/api/v1/farm-dispatch/catalog')
    state.materials = (c && c.materials) || []
    state.colors = (c && c.colors) || []
    await loadJobs()
    render()
  }

  async function loadJobs() {
    var j = await api('GET', '/api/v1/farm-dispatch/jobs?mine=1&limit=50')
    state.jobs = (j && j.jobs) || []
  }

  function render() {
    var u = state.me.user || {}
    var modelOpts = ['<option value="">选择或下方手填</option>']
      .concat(
        state.models.map(function (m) {
          return '<option value="' + esc(m) + '">' + esc(m) + '</option>'
        })
      )
      .join('')
    var matList = state.materials
      .map(function (m) {
        return '<option value="' + esc(m) + '">'
      })
      .join('')
    var colorList = state.colors
      .map(function (c) {
        var label = (c.color || c.colorHex || '') + (c.material ? ' · ' + c.material : '')
        return (
          '<option value="' +
          esc(c.color || c.colorHex || '') +
          '" data-hex="' +
          esc(c.colorHex || '') +
          '">' +
          esc(label) +
          '</option>'
        )
      })
      .join('')
    document.getElementById('app').innerHTML =
      '<h2>提交打印</h2><div class="sub">' +
      esc(u.displayName || u.username || '') +
      ' · 上传机型 / 材料 / 颜色 / G-code，审核通过后智能派单</div>' +
      '<div class="card"><div class="grid2">' +
      '<div><div class="meta">机型（下拉）</div><select id="modelSel" style="width:100%;margin-top:6px">' +
      modelOpts +
      '</select></div>' +
      '<div><div class="meta">机型（手填优先）</div><input id="model" placeholder="如 X1C / P1S" style="width:100%;margin-top:6px"/></div>' +
      '</div><div class="grid2" style="margin-top:8px">' +
      '<div><div class="meta">材料</div><input id="material" list="matList" placeholder="PLA / PETG" style="width:100%;margin-top:6px"/><datalist id="matList">' +
      matList +
      '</datalist></div>' +
      '<div><div class="meta">颜色名称</div><input id="color" list="colorList" placeholder="黑色" style="width:100%;margin-top:6px"/><datalist id="colorList">' +
      colorList +
      '</datalist></div>' +
      '</div><div class="meta" style="margin-top:8px">颜色色值（可选）</div>' +
      '<div class="row" style="justify-content:flex-start;margin-top:6px">' +
      '<input id="colorHex" placeholder="#000000" style="flex:1"/><input id="colorPick" type="color" value="#000000" style="width:48px;height:38px;padding:2px"/>' +
      '<span class="swatch" id="sw" style="width:18px;height:18px"></span></div>' +
      '<div class="meta" style="margin-top:8px">备注</div><input id="note" style="width:100%;margin-top:6px" placeholder="选填"/>' +
      '<div class="meta" style="margin-top:8px">打印文件</div>' +
      '<div class="filebox" id="drop" style="margin-top:6px">点击选择 .gcode / .gco / .bgcode<div class="meta" id="fname" style="margin-top:8px">未选择文件</div></div>' +
      '<input id="file" type="file" accept=".gcode,.gco,.g,.bgcode" hidden/>' +
      '<button class="primary" id="submit" style="width:100%;margin-top:14px">提交审核</button></div>' +
      '<div class="card"><h2 style="font-size:15px;margin-bottom:8px">我的申请</h2><div id="mine"></div></div>'

    document.getElementById('colorPick').oninput = function () {
      document.getElementById('colorHex').value = document.getElementById('colorPick').value
      document.getElementById('sw').style.background = document.getElementById('colorPick').value
    }
    document.getElementById('colorHex').oninput = function () {
      document.getElementById('sw').style.background =
        document.getElementById('colorHex').value || '#888'
    }
    document.getElementById('modelSel').onchange = function () {
      if (!document.getElementById('model').value)
        document.getElementById('model').value = document.getElementById('modelSel').value
    }
    document.getElementById('color').onchange = function () {
      var v = document.getElementById('color').value
      for (var i = 0; i < (state.colors || []).length; i++) {
        var c = state.colors[i]
        if ((c.color || c.colorHex) === v && c.colorHex) {
          document.getElementById('colorHex').value = c.colorHex
          document.getElementById('colorPick').value = /^#[0-9a-fA-F]{6}$/.test(c.colorHex)
            ? c.colorHex
            : '#000000'
          document.getElementById('sw').style.background = c.colorHex
          break
        }
      }
    }
    var drop = document.getElementById('drop')
    drop.onclick = function () {
      document.getElementById('file').click()
    }
    drop.ondragover = function (e) {
      e.preventDefault()
    }
    drop.ondrop = function (e) {
      e.preventDefault()
      if (e.dataTransfer.files && e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0])
    }
    document.getElementById('file').onchange = function () {
      if (this.files && this.files[0]) readFile(this.files[0])
    }
    document.getElementById('submit').onclick = submitJob
    renderMine()
  }

  function readFile(f) {
    state.file = f
    state.b64 = ''
    state.fileReady = false
    document.getElementById('fname').textContent =
      f.name + ' · ' + Math.round(f.size / 1024) + ' KB · 读取中…'
    var reader = new FileReader()
    reader.onload = function () {
      var r = String(reader.result || '')
      var i = r.indexOf('base64,')
      state.b64 = i >= 0 ? r.slice(i + 7) : ''
      state.fileReady = !!state.b64
      document.getElementById('fname').textContent =
        f.name +
        ' · ' +
        Math.round(f.size / 1024) +
        ' KB' +
        (state.fileReady ? ' · 已就绪' : ' · 读取失败')
    }
    reader.onerror = function () {
      state.fileReady = false
      document.getElementById('fname').textContent = f.name + ' · 读取失败'
    }
    reader.readAsDataURL(f)
  }

  async function submitJob() {
    var model = (
      document.getElementById('model').value ||
      document.getElementById('modelSel').value ||
      ''
    ).trim()
    var material = (document.getElementById('material').value || '').trim()
    var color = (document.getElementById('color').value || '').trim()
    var colorHex = (document.getElementById('colorHex').value || '').trim()
    if (!model || !material || !(color || colorHex)) return alert('请填写机型、材料、颜色')
    if (!state.file) return alert('请上传打印文件')
    if (!state.fileReady || !state.b64) return alert('文件仍在读取，请稍候再提交')
    var btn = document.getElementById('submit')
    btn.disabled = true
    var j = await api(
      'POST',
      '/api/v1/farm-dispatch/jobs',
      {
        model: model,
        material: material,
        color: color,
        colorHex: colorHex,
        filename: state.file ? state.file.name : 'job.gcode',
        contentBase64: state.b64,
        note: (document.getElementById('note').value || '').trim()
      },
      { timeout: 120000 }
    )
    btn.disabled = false
    if (!j || !j.ok) return alert((j && j.message) || '提交失败')
    alert('已提交，等待审核')
    state.file = null
    state.b64 = ''
    state.fileReady = false
    await loadJobs()
    render()
  }

  function renderMine() {
    var el = document.getElementById('mine')
    if (!state.jobs.length) {
      el.innerHTML = '<div class="meta">暂无申请</div>'
      return
    }
    el.innerHTML = state.jobs
      .map(function (j) {
        return (
          '<div style="border-top:1px solid var(--fd-border);padding:10px 0">' +
          '<div><b>' +
          esc(j.filename) +
          '</b> <span class="badge">' +
          statusText(j.status) +
          '</span></div>' +
          '<div class="meta">' +
          esc(j.model) +
          ' · ' +
          esc(j.material) +
          ' · ' +
          esc(j.color || j.colorHex) +
          ' · ' +
          esc(fmtTime(j.createdAt)) +
          (j.rejectReason
            ? '<div style="color:var(--fd-err)">驳回原因：' + esc(j.rejectReason) + '</div>'
            : '') +
          (j.cancelReason ? '<div>取消：' + esc(j.cancelReason) + '</div>' : '') +
          (j.waitReason ? '<div>' + esc(j.waitReason) + '</div>' : '') +
          (j.deviceName ? '<div>设备：' + esc(j.deviceName) + '</div>' : '') +
          (j.status === 'pending_audit'
            ? '<button class="ghost danger" style="margin-top:6px" data-cancel="' +
              esc(j.id) +
              '">取消申请</button>'
            : '') +
          '</div></div>'
        )
      })
      .join('')
    Array.prototype.forEach.call(el.querySelectorAll('[data-cancel]'), function (btn) {
      btn.onclick = async function () {
        var r = await api('POST', '/api/v1/farm-dispatch/job/cancel', {
          id: btn.getAttribute('data-cancel'),
          reason: '申请人取消'
        })
        alert(r.ok ? '已取消' : r.message || '失败')
        await loadJobs()
        renderMine()
      }
    })
  }

  boot().catch(function (e) {
    deny(String(e && e.message ? e.message : e))
  })
})()
