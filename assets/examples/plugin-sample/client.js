/* Authed SPA script — demo plugin keeps nav/permission hooks; no visible demo banners. */
;(function () {
  var P = window.HanyePlugin
  if (!P) return

  P.patchNav(function (items) {
    return items.map(function (it) {
      if (it.key === 'settings') return Object.assign({}, it, { label: '软件设置★' })
      return it
    })
  })

  P.patchPermissions(function (perms) {
    if (perms.indexOf('nav.tools') < 0) perms = perms.concat(['nav.tools'])
    return perms
  })

  // Demo: custom brand + connection + extra field in 添加设备
  P.registerAddDeviceBrand({
    id: 'demo_vendor',
    label: '演示品牌',
    tech: 'both',
    order: 90,
    plugin: 'demo_hello',
    connections: [
      { id: 'lan', label: '局域网', default: true },
      { id: 'cloud', label: '云端' }
    ],
    renderForm: function (el, ctx) {
      el.innerHTML =
        '<div style="margin-bottom:8px">' +
        '<label>演示地址</label>' +
        '<input class="ant-input" data-demo-url placeholder="http://192.168.1.10" style="width:100%;margin-top:4px" />' +
        '</div>' +
        '<div style="opacity:.7;font-size:12px">连接方式：' +
        (ctx.connectionMode || 'lan') +
        '（示例）</div>'
      var input = el.querySelector('[data-demo-url]')
      if (input) {
        input.value = String(ctx.getFieldValue('demoUrl') || '')
        input.addEventListener('change', function () {
          ctx.setFieldsValue({ demoUrl: input.value })
        })
      }
    },
    submit: async function (ctx) {
      var v = await ctx.validateFields(['name'])
      var url = String(ctx.getFieldValue('demoUrl') || '').trim()
      return {
        device: {
          id: ctx.newId(),
          name: String(v.name || ''),
          brand: 'demo_vendor',
          tech: ctx.tech,
          connectionMode: ctx.connectionMode || 'lan',
          baseUrl: url || undefined,
          pluginData: { source: 'demo_hello', demoUrl: url },
          x_demo_note: 'from plugin',
          createdAt: new Date().toISOString()
        }
      }
    }
  })

  P.registerAddDeviceField({
    id: 'demo_note',
    brands: '*',
    tech: 'both',
    order: 50,
    plugin: 'demo_hello',
    render: function (el, ctx) {
      el.innerHTML =
        '<label style="display:block;margin-bottom:4px">插件备注（全品牌）</label>' +
        '<input class="ant-input" data-demo-note placeholder="可选" style="width:100%" />'
      var input = el.querySelector('[data-demo-note]')
      if (input) {
        input.value = String(ctx.getFieldValue('demoNote') || '')
        input.addEventListener('change', function () {
          ctx.setFieldsValue({ demoNote: input.value })
        })
      }
    },
    collect: function (ctx, device) {
      var note = String(ctx.getFieldValue('demoNote') || '').trim()
      if (!note) return device
      device.pluginData = Object.assign({}, device.pluginData || {}, { demoNote: note })
      return device
    }
  })

  P.registerBatchAction({
    id: 'demo_batch_ping',
    label: '插件批量动作',
    tech: 'both',
    order: 40,
    plugin: 'demo_hello',
    run: function (ctx) {
      window.alert(
        'demo_hello：当前工作区 ' +
          ctx.tech +
          '，已选 ' +
          ctx.checkedIds.length +
          ' 台\n' +
          ctx.devices
            .filter(function (d) {
              return ctx.checkedIds.indexOf(d.id) >= 0
            })
            .map(function (d) {
              return d.name
            })
            .join(', ')
      )
    }
  })

  P.registerBatchStatus({
    id: 'demo_batch_status',
    tech: 'both',
    order: 10,
    plugin: 'demo_hello',
    render: function (el, ctx) {
      var online = 0
      for (var i = 0; i < ctx.checkedIds.length; i++) {
        var st = ctx.statuses[ctx.checkedIds[i]]
        if (st && st.health === 'online') online++
      }
      el.textContent =
        '插件状态：在线 ' + online + ' / 已选 ' + ctx.checkedIds.length
      el.style.fontSize = '12px'
      el.style.opacity = '0.8'
    }
  })

  // Demo: 耗材管理扩展
  P.registerFilamentBrand({
    id: 'demo_filament_brand',
    name: '演示线材',
    nameEn: 'Demo Filament',
    kind: 'fdm',
    popular: false,
    plugin: 'demo_hello'
  })

  P.registerFilamentMaterial({
    id: 'demo_cf',
    label: '演示 CF',
    category: 'fdm',
    plugin: 'demo_hello'
  })

  P.registerFilamentField({
    id: 'demo_batch_no',
    tech: 'both',
    mode: 'both',
    order: 40,
    plugin: 'demo_hello',
    render: function (el, ctx) {
      el.innerHTML =
        '<label style="display:block;margin-bottom:4px">插件批次号</label>' +
        '<input class="ant-input" data-demo-batch placeholder="可选" style="width:100%" />'
      var input = el.querySelector('[data-demo-batch]')
      if (input) {
        input.value = String(ctx.getFieldValue('batchNo') || '')
        input.addEventListener('change', function () {
          ctx.setFieldsValue({ batchNo: input.value })
        })
      }
    },
    collect: function (ctx, spool) {
      var batchNo = String(ctx.getFieldValue('batchNo') || '').trim()
      spool.pluginData = Object.assign({}, spool.pluginData || {}, { batchNo: batchNo })
      if (batchNo) spool.x_batch_no = batchNo
      else delete spool.x_batch_no
      return spool
    }
  })

  P.registerFilamentColumn({
    id: 'demo_batch',
    title: '批次',
    width: 100,
    tech: 'both',
    order: 50,
    plugin: 'demo_hello',
    render: function (spool) {
      var pd = spool.pluginData || {}
      return String(pd.batchNo || spool.x_batch_no || '—')
    }
  })

  P.registerFilamentRowAction({
    id: 'demo_spool_info',
    label: '插件信息',
    tech: 'both',
    order: 40,
    plugin: 'demo_hello',
    run: function (ctx) {
      var s = ctx.spool || {}
      var pd = s.pluginData || {}
      window.alert(
        'demo_hello 料卷\nID: ' +
          s.id +
          '\n批次: ' +
          (pd.batchNo || s.x_batch_no || '(无)')
      )
    }
  })

  P.registerFilamentToolbarAction({
    id: 'demo_filament_toolbar',
    label: '插件耗材',
    tech: 'both',
    order: 40,
    plugin: 'demo_hello',
    run: function (ctx) {
      window.alert('demo_hello：当前耗材分区 ' + ctx.tech)
    }
  })

  // Demo: 常用工具 / 报价扩展
  P.registerQuoteMaterialPreset({
    id: 'demo_silk',
    label: '演示丝绸 PLA',
    tech: 'fdm',
    pricePerKg: 88,
    plugin: 'demo_hello'
  })

  P.registerQuotePrinterPreset({
    id: 'demo_printer',
    label: '演示机',
    watts: 160,
    plugin: 'demo_hello'
  })

  P.registerQuoteField({
    id: 'demo_rush',
    tech: 'both',
    order: 30,
    plugin: 'demo_hello',
    render: function (el, ctx) {
      el.innerHTML =
        '<label style="display:block;margin-bottom:4px">插件加急费（元）</label>' +
        '<input class="ant-input" data-demo-rush type="number" min="0" style="width:100%" />'
      var input = el.querySelector('[data-demo-rush]')
      if (input) {
        input.value = String(ctx.getParam('rushFee') || 0)
        input.addEventListener('change', function () {
          ctx.setParam('rushFee', Number(input.value) || 0)
        })
      }
    }
  })

  P.registerQuoteCostAdjust({
    id: 'demo_rush_adjust',
    tech: 'both',
    order: 10,
    plugin: 'demo_hello',
    adjust: function (costs, ctx) {
      var rush = Number(ctx.getParam('rushFee') || 0)
      if (!rush) return costs
      var next = Object.assign({}, costs)
      next.fixed = (Number(next.fixed) || 0) + rush
      next.perUnit = (Number(next.perUnit) || 0) + rush
      next.grand =
        (Number(next.grand) || 0) + rush * (Number(ctx.getParam('qty')) || 1)
      return next
    }
  })

  P.registerQuoteColumn({
    id: 'demo_rush_col',
    title: '加急',
    width: 64,
    tech: 'both',
    order: 40,
    plugin: 'demo_hello',
    render: function (_row, ctx) {
      var rush = Number(ctx.getParam('rushFee') || 0)
      return rush ? '¥' + rush.toFixed(0) : '—'
    }
  })

  P.registerQuoteToolbarAction({
    id: 'demo_quote_toolbar',
    label: '插件报价',
    tech: 'both',
    order: 40,
    plugin: 'demo_hello',
    run: function (ctx) {
      window.alert(
        'demo_hello：报价分区 ' + ctx.tech + '，方案 ' + ctx.options.length + ' 个'
      )
    }
  })

  P.registerQuoteAction({
    id: 'demo_quote_action',
    label: '插件汇总报价',
    tech: 'both',
    order: 40,
    plugin: 'demo_hello',
    run: function (ctx) {
      var lines = ctx.results.map(function (r, i) {
        var c = r.costs || {}
        return i + 1 + '. ' + (r.name || '') + ' → ¥' + Number(c.perUnit || 0).toFixed(2)
      })
      window.alert(lines.join('\n') || '无方案')
    }
  })

  // Demo: 报价记录扩展
  P.registerQuoteHistoryColumn({
    id: 'demo_hist_opts',
    title: '方案标记',
    width: 90,
    order: 40,
    plugin: 'demo_hello',
    render: function (r) {
      var n = (r.options && r.options.length) || 0
      return n >= 3 ? '多方案' : String(n)
    }
  })

  P.registerQuoteHistoryFilter({
    id: 'demo_hist_tech',
    order: 20,
    plugin: 'demo_hello',
    render: function (el, ctx) {
      el.innerHTML =
        '<select data-demo-tech style="height:32px;padding:0 8px;border:1px solid #d9d9d9;border-radius:6px">' +
        '<option value="">工艺(插件)</option>' +
        '<option value="fdm">仅 FDM</option>' +
        '<option value="resin">仅树脂</option>' +
        '</select>'
      var sel = el.querySelector('[data-demo-tech]')
      if (sel) {
        sel.value = String(ctx.pluginFilters.tech || '')
        sel.addEventListener('change', function () {
          ctx.setPluginFilter('tech', sel.value || undefined)
        })
      }
    },
    match: function (r, ctx) {
      var t = ctx.pluginFilters.tech
      if (!t) return true
      return r.tech === t
    }
  })

  P.registerQuoteHistoryRowAction({
    id: 'demo_hist_info',
    label: '插件信息',
    order: 40,
    plugin: 'demo_hello',
    run: function (ctx) {
      var r = ctx.record || {}
      window.alert(
        'demo_hello 报价记录\nID: ' +
          r.id +
          '\n用户: ' +
          (r.displayName || r.username || '') +
          '\n方案数: ' +
          ((r.options && r.options.length) || 0)
      )
    }
  })

  P.registerQuoteHistoryToolbarAction({
    id: 'demo_hist_toolbar',
    label: '插件记录',
    order: 40,
    plugin: 'demo_hello',
    run: function (ctx) {
      window.alert('当前可见 ' + ctx.visibleRecords.length + ' / 原始 ' + ctx.records.length + ' 条')
    }
  })

  P.registerQuoteHistoryDetailField({
    id: 'demo_hist_detail',
    order: 20,
    plugin: 'demo_hello',
    render: function (el, ctx) {
      var r = ctx.record || {}
      el.innerHTML =
        '<div style="font-size:12px;opacity:.85;margin-bottom:8px">插件备注：记录 ID ' +
        String(r.id || '') +
        '</div>'
    }
  })

  // Demo: 内部监控 / 区域监控
  P.registerMonitorToolbarAction({
    id: 'demo_monitor_toolbar',
    label: '插件监控',
    scope: 'both',
    order: 40,
    plugin: 'demo_hello',
    run: function (ctx) {
      window.alert(
        'demo_hello：' + ctx.scope + ' · 画面/摄像头数 ' + ctx.slotCount
      )
    }
  })

  P.registerMonitorTileAction({
    id: 'demo_monitor_tile',
    label: '插件信息',
    scope: 'both',
    order: 40,
    plugin: 'demo_hello',
    run: function (ctx) {
      window.alert(
        'demo_hello\n' +
          (ctx.deviceName || ctx.cameraName || '') +
          '\n' +
          (ctx.deviceId || ctx.cameraId || '')
      )
    }
  })

  P.registerMonitorTileExtra({
    id: 'demo_monitor_footer',
    place: 'footer',
    scope: 'wall',
    order: 20,
    plugin: 'demo_hello',
    render: function (el, ctx) {
      el.textContent = '插件：' + (ctx.brand || ctx.deviceId || '')
      el.style.opacity = '0.75'
    }
  })

  P.registerMonitorCameraField({
    id: 'demo_cam_note',
    order: 30,
    plugin: 'demo_hello',
    render: function (el, ctx) {
      el.innerHTML =
        '<label style="display:block;margin-bottom:4px">插件备注</label>' +
        '<input class="ant-input" data-demo-cam-note placeholder="可选" style="width:100%" />'
      var input = el.querySelector('[data-demo-cam-note]')
      if (input) {
        input.value = String(ctx.getFieldValue('demoNote') || '')
        input.addEventListener('change', function () {
          ctx.setFieldsValue({ demoNote: input.value })
        })
      }
    },
    collect: function (ctx, camera) {
      var note = String(ctx.getFieldValue('demoNote') || '').trim()
      if (note) camera.name = String(camera.name || '') + ' · ' + note
      return camera
    }
  })

  // Demo: 厂家 / 自定义监控对接（不只是填 HTTP URL）
  P.registerMonitorCameraSource({
    id: 'demo_vendor',
    label: '演示厂家对接',
    order: 20,
    plugin: 'demo_hello',
    hideUrlFields: true,
    renderForm: function (el, ctx) {
      el.innerHTML =
        '<div style="margin-bottom:12px">' +
        '<label style="display:block;margin-bottom:4px">厂家通道号</label>' +
        '<input class="ant-input" data-demo-ch placeholder="例如 CH-01" style="width:100%" />' +
        '</div>' +
        '<div style="margin-bottom:8px">' +
        '<label style="display:block;margin-bottom:4px">可选：直接快照 URL（演示用）</label>' +
        '<input class="ant-input" data-demo-snap placeholder="http://... 有则服务端直拉" style="width:100%" />' +
        '</div>' +
        '<div style="opacity:0.7;font-size:12px">无 URL 时由 main.js 的 monitor_camera_snapshot 返回占位图</div>'
      var ch = el.querySelector('[data-demo-ch]')
      var snap = el.querySelector('[data-demo-snap]')
      if (ch) {
        ch.value = String(ctx.getFieldValue('demoChannel') || '')
        ch.addEventListener('change', function () {
          ctx.setFieldsValue({ demoChannel: ch.value })
        })
      }
      if (snap) {
        snap.value = String(ctx.getFieldValue('demoSnapUrl') || '')
        snap.addEventListener('change', function () {
          ctx.setFieldsValue({ demoSnapUrl: snap.value })
        })
      }
    },
    submit: function (ctx) {
      var channel = String(ctx.getFieldValue('demoChannel') || '').trim()
      var snapUrl = String(ctx.getFieldValue('demoSnapUrl') || '').trim()
      var name = String(ctx.getFieldValue('name') || '').trim() || (channel ? '厂家 ' + channel : '厂家演示')
      if (!channel && !snapUrl) {
        throw new Error('请填写通道号，或提供演示快照 URL')
      }
      return {
        camera: {
          name: name,
          sourceType: 'demo_vendor',
          pluginData: { channel: channel, snapUrl: snapUrl },
          url: snapUrl || undefined
        }
      }
    }
  })

  // Demo: 用户与权限页扩展
  P.registerUserToolbarAction({
    id: 'demo_users_toolbar',
    label: '插件用户工具',
    order: 40,
    plugin: 'demo_hello',
    run: function (ctx) {
      window.alert('demo_hello：当前用户数 ' + (ctx.users && ctx.users.length))
    }
  })

  P.registerUserColumn({
    id: 'demo_dept',
    title: '部门(插件)',
    order: 50,
    plugin: 'demo_hello',
    render: function (user) {
      var pd = user.pluginData && typeof user.pluginData === 'object' ? user.pluginData : {}
      return String(pd.dept || user.x_dept || '—')
    }
  })

  P.registerUserRowAction({
    id: 'demo_users_row',
    label: '插件详情',
    order: 40,
    plugin: 'demo_hello',
    run: function (ctx) {
      var u = ctx.user || {}
      window.alert(
        'demo_hello\n' +
          String(u.username || '') +
          '\n' +
          JSON.stringify(u.pluginData || {}, null, 0)
      )
    }
  })

  P.registerUserFormField({
    id: 'demo_dept_field',
    order: 20,
    plugin: 'demo_hello',
    render: function (el, ctx) {
      el.innerHTML =
        '<label style="display:block;margin-bottom:4px">部门（插件）</label>' +
        '<input class="ant-input" data-demo-dept placeholder="例如 生产部" style="width:100%" />'
      var input = el.querySelector('[data-demo-dept]')
      if (input) {
        var seed =
          ctx.getFieldValue('dept') ||
          (ctx.user &&
            ctx.user.pluginData &&
            ctx.user.pluginData.dept) ||
          ''
        input.value = String(seed || '')
        input.addEventListener('change', function () {
          ctx.setFieldsValue({ dept: input.value })
        })
      }
    },
    collect: function (ctx, user) {
      var dept = String(ctx.getFieldValue('dept') || '').trim()
      var pd =
        user.pluginData && typeof user.pluginData === 'object'
          ? Object.assign({}, user.pluginData)
          : {}
      if (dept) pd.dept = dept
      else delete pd.dept
      user.pluginData = pd
      return user
    }
  })

  P.registerUserPermGroup({
    id: 'demo_extra_group',
    title: '演示扩展权限组',
    order: 30,
    plugin: 'demo_hello',
    description: 'registerUserPermGroup 示例；勾选后写入用户 permissions[]',
    options: [
      { code: 'plugin.demo_hello.extra', label: '演示扩展能力' },
      { code: 'plugin.demo_hello.audit', label: '演示审计查看' }
    ]
  })

  // Demo: 软件设置导航任意位置插入（在「设置」与「企业软件对接」之间）
  P.registerSettingsTab({
    key: 'demo_hello_settings',
    label: '插件演示设置',
    after: 'general',
    order: 10,
    adminOnly: true,
    plugin: 'demo_hello',
    render: function (el) {
      el.innerHTML =
        '<div class="settings-tab-panel">' +
        '<h3>插件演示设置</h3>' +
        '<p style="opacity:.8">由 registerSettingsTab({ after: "general" }) 插入到「设置」后面。</p>' +
        '</div>'
    }
  })

  // Demo: 打印审核 / 队列
  P.registerPrintToolbarAction({
    id: 'demo_print_toolbar',
    label: '插件队列',
    order: 40,
    plugin: 'demo_hello',
    run: function (ctx) {
      window.alert(
        'demo_hello：待审 ' +
          ctx.pendingCount +
          ' / 排队 ' +
          ctx.queuedCount +
          ' / Tab ' +
          ctx.tab
      )
    }
  })

  P.registerPrintColumn({
    id: 'demo_print_tag',
    title: '插件标记',
    order: 40,
    plugin: 'demo_hello',
    tabs: ['pending', 'queued', 'history', 'mine'],
    render: function (job) {
      var pd = job.pluginData && typeof job.pluginData === 'object' ? job.pluginData : {}
      return String(pd.tag || pd.priority || '—')
    }
  })

  P.registerPrintRowAction({
    id: 'demo_print_row',
    label: '插件详情',
    order: 40,
    plugin: 'demo_hello',
    tabs: ['all'],
    run: function (ctx) {
      var j = ctx.job || {}
      window.alert(
        'demo_hello\n' +
          String(j.filename || '') +
          '\n' +
          JSON.stringify(j.pluginData || {}, null, 0)
      )
    }
  })

  P.emit('demo_hello:ready', { ok: true })
})()
