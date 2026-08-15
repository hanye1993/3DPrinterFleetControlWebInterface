/**
 * print_log — 打印记录：系统发送 / 队列 / 批量 / 现场操作
 * 存储：plugin-data/print_log/records.json + pending.json
 */
const crypto = require('crypto')

const SOURCE = {
  system: { id: 'system', label: '系统发送' },
  queue: { id: 'queue', label: '打印队列' },
  batch: { id: 'batch', label: '批量打印' },
  on_device: { id: 'on_device', label: '现场操作' }
}

function boolVar(api, key, def) {
  const v = api.getVar(key, def ? '1' : '0')
  return v === '1' || v === true || v === 'true'
}

function numVar(api, key, def) {
  const n = Number(api.getVar(key, String(def)))
  return Number.isFinite(n) ? n : def
}

function nowIso() {
  return new Date().toISOString()
}

function newId() {
  return crypto.randomBytes(10).toString('hex')
}

function authUser(ctx) {
  const a = ctx && ctx.auth
  if (a && a.kind === 'user' && a.user && a.user.id) return a.user
  return null
}

function userLabel(user) {
  if (!user) return { userId: '', userName: '未知' }
  return {
    userId: String(user.id || ''),
    userName: String(user.displayName || user.username || user.id || '未知')
  }
}

function parseDeviceIds(api) {
  try {
    const raw = api.getVar('device_ids', '[]')
    const j = typeof raw === 'string' ? JSON.parse(raw || '[]') : raw
    if (!Array.isArray(j)) return []
    return j.map((x) => String(x)).filter(Boolean)
  } catch {
    return []
  }
}

function deviceEnabled(api, deviceId) {
  if (!deviceId) return false
  if (boolVar(api, 'record_all', true)) return true
  const ids = parseDeviceIds(api)
  return ids.includes(String(deviceId))
}

function readRecords(api) {
  const raw = api.readJson('records.json', [])
  return Array.isArray(raw) ? raw : []
}

function writeRecords(api, rows) {
  const max = Math.max(100, Math.min(20000, numVar(api, 'max_rows', 2000)))
  const days = Math.max(0, numVar(api, 'retain_days', 180))
  let list = Array.isArray(rows) ? rows.slice() : []
  if (days > 0) {
    const cut = Date.now() - days * 86400000
    list = list.filter((r) => {
      const t = Date.parse(r.finishedAt || r.startedAt || r.createdAt || 0)
      return !Number.isFinite(t) || t >= cut
    })
  }
  if (list.length > max) list = list.slice(0, max)
  api.writeJson('records.json', list)
  return list
}

function readPending(api) {
  const raw = api.readJson('pending.json', {})
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
}

function writePending(api, map) {
  api.writeJson('pending.json', map && typeof map === 'object' ? map : {})
}

function deviceNameOf(api, deviceId) {
  const devices = (api.getDevices && api.getDevices()) || []
  const d = devices.find((x) => String(x.id) === String(deviceId))
  return d ? String(d.name || deviceId) : String(deviceId)
}

function findOpenRecord(records, deviceId, filename) {
  const fn = String(filename || '').trim()
  for (let i = 0; i < records.length; i++) {
    const r = records[i]
    if (!r || r.status !== 'printing') continue
    if (String(r.deviceId) !== String(deviceId)) continue
    if (fn && r.filename && String(r.filename) !== fn) continue
    return r
  }
  return null
}

function upsertStart(api, opts) {
  const deviceId = String(opts.deviceId || '')
  if (!deviceEnabled(api, deviceId)) return null
  const source = opts.source || SOURCE.on_device.id
  if (source === SOURCE.on_device.id && !boolVar(api, 'record_on_device', true)) return null
  if (source !== SOURCE.on_device.id && !boolVar(api, 'record_system', true)) return null

  const records = readRecords(api)
  const filename = String(opts.filename || '').trim() || '（未知文件）'
  let row = findOpenRecord(records, deviceId, filename)
  if (!row) {
    row = {
      id: newId(),
      deviceId,
      deviceName: opts.deviceName || deviceNameOf(api, deviceId),
      filename,
      userId: opts.userId || '',
      userName: opts.userName || (source === SOURCE.on_device.id ? '现场操作' : '未知'),
      source,
      sourceLabel: (SOURCE[source] && SOURCE[source].label) || source,
      status: 'printing',
      filamentUsedGrams: null,
      startedAt: opts.startedAt || nowIso(),
      finishedAt: null,
      durationSec: null,
      createdAt: nowIso()
    }
    records.unshift(row)
  } else {
    if (opts.userId && !row.userId) {
      row.userId = opts.userId
      row.userName = opts.userName || row.userName
    }
    if (opts.source && row.source === SOURCE.on_device.id && opts.source !== SOURCE.on_device.id) {
      row.source = opts.source
      row.sourceLabel = (SOURCE[opts.source] && SOURCE[opts.source].label) || opts.source
    }
    if (filename && filename !== '（未知文件）') row.filename = filename
  }
  writeRecords(api, records)
  return row
}

function finishRecord(api, opts) {
  const deviceId = String(opts.deviceId || '')
  if (!deviceEnabled(api, deviceId)) return null
  const records = readRecords(api)
  const filename = String(opts.filename || '').trim()
  let row = findOpenRecord(records, deviceId, filename) || findOpenRecord(records, deviceId, '')
  const status = opts.failed ? 'failed' : 'finished'
  const at = opts.at || nowIso()
  if (!row) {
    if (opts.failed) return null
    // 现场打印可能漏掉 started：补一条完成记录
    if (!boolVar(api, 'record_on_device', true) && !boolVar(api, 'record_system', true)) return null
    row = {
      id: newId(),
      deviceId,
      deviceName: opts.deviceName || deviceNameOf(api, deviceId),
      filename: filename || '（未知文件）',
      userId: '',
      userName: '现场操作',
      source: SOURCE.on_device.id,
      sourceLabel: SOURCE.on_device.label,
      status,
      filamentUsedGrams:
        typeof opts.filamentUsedGrams === 'number' ? opts.filamentUsedGrams : null,
      startedAt: opts.startedAt || at,
      finishedAt: at,
      durationSec: opts.durationSec != null ? opts.durationSec : null,
      createdAt: nowIso()
    }
    if (!deviceEnabled(api, deviceId)) return null
    if (!boolVar(api, 'record_on_device', true)) return null
    records.unshift(row)
  } else {
    row.status = status
    row.finishedAt = at
    if (typeof opts.filamentUsedGrams === 'number') row.filamentUsedGrams = opts.filamentUsedGrams
    if (opts.durationSec != null) row.durationSec = opts.durationSec
    else if (row.startedAt) {
      const ms = Date.parse(at) - Date.parse(row.startedAt)
      if (Number.isFinite(ms) && ms >= 0) row.durationSec = Math.round(ms / 1000)
    }
    if (filename && (!row.filename || row.filename === '（未知文件）')) row.filename = filename
    if (opts.deviceName) row.deviceName = opts.deviceName
  }
  writeRecords(api, records)
  const pending = readPending(api)
  delete pending[deviceId]
  writePending(api, pending)
  return row
}

function rememberAttribution(api, deviceId, attr) {
  const pending = readPending(api)
  pending[String(deviceId)] = {
    ...attr,
    at: nowIso()
  }
  writePending(api, pending)
}

function takeAttribution(api, deviceId) {
  const pending = readPending(api)
  const row = pending[String(deviceId)]
  if (!row) return null
  // 队列可能排队较久：默认 7 天内有效
  const t = Date.parse(row.at || 0)
  if (Number.isFinite(t) && Date.now() - t > 7 * 24 * 60 * 60 * 1000) {
    delete pending[String(deviceId)]
    writePending(api, pending)
    return null
  }
  delete pending[String(deviceId)]
  writePending(api, pending)
  return row
}

function isPrintingState(state) {
  return /print|run|busy|pause/.test(String(state || '').toLowerCase())
}

function isDoneState(state) {
  return /complete|finish|success|done/.test(String(state || '').toLowerCase())
}

function isFailedState(state) {
  return /fail|error|cancel|abort/.test(String(state || '').toLowerCase())
}

function jobName(st) {
  const f = String((st && (st.filename || st.gcodeFile)) || '').trim()
  return f || ''
}

module.exports = {
  async register(api) {
    api.registerRoute('GET', '/api/v1/print-log/config', async (req) => {
      const user = authUser(req)
      if (!user) return { ok: false, message: '请先登录' }
      const devices = ((api.getDevices && api.getDevices()) || []).map((d) => ({
        id: String(d.id),
        name: String(d.name || d.id),
        brand: d.brand
      }))
      return {
        ok: true,
        showNav: boolVar(api, 'show_nav', true),
        recordAll: boolVar(api, 'record_all', true),
        deviceIds: parseDeviceIds(api),
        recordSystem: boolVar(api, 'record_system', true),
        recordOnDevice: boolVar(api, 'record_on_device', true),
        retainDays: numVar(api, 'retain_days', 180),
        maxRows: numVar(api, 'max_rows', 2000),
        devices
      }
    })

    api.registerRoute('PUT', '/api/v1/print-log/config', async (req) => {
      const user = authUser(req)
      if (!user || String(user.level || '') !== 'admin') {
        return { ok: false, message: '需要管理员' }
      }
      const body = (req && req.body) || {}
      const vars = {}
      if (body.showNav != null) vars.show_nav = body.showNav ? '1' : '0'
      if (body.recordAll != null) vars.record_all = body.recordAll ? '1' : '0'
      if (Array.isArray(body.deviceIds)) vars.device_ids = JSON.stringify(body.deviceIds.map(String))
      if (body.recordSystem != null) vars.record_system = body.recordSystem ? '1' : '0'
      if (body.recordOnDevice != null) vars.record_on_device = body.recordOnDevice ? '1' : '0'
      if (body.retainDays != null) vars.retain_days = String(Math.max(0, Number(body.retainDays) || 0))
      if (body.maxRows != null) {
        vars.max_rows = String(Math.max(100, Math.min(20000, Number(body.maxRows) || 2000)))
      }
      if (Object.keys(vars).length) {
        for (const [k, v] of Object.entries(vars)) {
          api.setVar(k, v)
        }
      }
      writeRecords(api, readRecords(api))
      const devices = ((api.getDevices && api.getDevices()) || []).map((d) => ({
        id: String(d.id),
        name: String(d.name || d.id),
        brand: d.brand
      }))
      return {
        ok: true,
        showNav: boolVar(api, 'show_nav', true),
        recordAll: boolVar(api, 'record_all', true),
        deviceIds: parseDeviceIds(api),
        recordSystem: boolVar(api, 'record_system', true),
        recordOnDevice: boolVar(api, 'record_on_device', true),
        retainDays: numVar(api, 'retain_days', 180),
        maxRows: numVar(api, 'max_rows', 2000),
        devices
      }
    })

    api.registerRoute('GET', '/api/v1/print-log/records', async (req) => {
      const user = authUser(req)
      if (!user) return { ok: false, message: '请先登录' }
      const q = (req && req.query) || {}
      let rows = readRecords(api)
      const deviceId = String(q.deviceId || '').trim()
      const source = String(q.source || '').trim()
      const status = String(q.status || '').trim()
      const kw = String(q.q || '').trim().toLowerCase()
      if (deviceId) rows = rows.filter((r) => String(r.deviceId) === deviceId)
      if (source) rows = rows.filter((r) => String(r.source) === source)
      if (status) rows = rows.filter((r) => String(r.status) === status)
      if (kw) {
        rows = rows.filter((r) => {
          const bag = [r.filename, r.userName, r.deviceName, r.sourceLabel].join(' ').toLowerCase()
          return bag.includes(kw)
        })
      }
      const limit = Math.max(1, Math.min(500, Number(q.limit) || 100))
      return { ok: true, total: rows.length, records: rows.slice(0, limit) }
    })

    api.registerRoute('DELETE', '/api/v1/print-log/records', async (req) => {
      const user = authUser(req)
      if (!user || String(user.level || '') !== 'admin') {
        return { ok: false, message: '需要管理员' }
      }
      const body = (req && req.body) || {}
      if (body.all) {
        writeRecords(api, [])
        return { ok: true, deleted: 'all' }
      }
      const id = String(body.id || '').trim()
      if (!id) return { ok: false, message: '缺少 id' }
      const next = readRecords(api).filter((r) => String(r.id) !== id)
      writeRecords(api, next)
      return { ok: true, deleted: id }
    })

    api.log('[print_log] routes ready')
  },

  async ui_assets(api, assets) {
    const next = assets && typeof assets === 'object' ? { ...assets } : {}
    if (!boolVar(api, 'show_nav', true)) {
      next.hideNavKeys = Array.from(
        new Set([...(next.hideNavKeys || []), 'plugin:print_log:page'])
      )
    }
    return next
  },

  async permissions_catalog(api, list) {
    const rows = Array.isArray(list) ? list.slice() : []
    if (!rows.some((r) => r && r.code === 'plugin.print_log.page')) {
      rows.push({
        code: 'plugin.print_log.page',
        label: '打印记录',
        plugin: 'print_log',
        description: '查看侧栏「打印记录」页面'
      })
    }
    return rows
  },

  /** 系统详情/控制台直接下发 print_file */
  async control_before(api, payload, ctx) {
    try {
      if (!payload || payload.proceed === false) return payload
      const action = String((payload.payload && payload.payload.action) || '')
      if (action !== 'print_file') return payload
      const deviceId = String(payload.deviceId || '')
      const filename = String(
        (payload.payload && (payload.payload.filename || payload.payload.file || payload.payload.path)) ||
          ''
      ).trim()
      const u = userLabel(authUser(ctx))
      rememberAttribution(api, deviceId, {
        ...u,
        source: SOURCE.system.id,
        filename
      })
      upsertStart(api, {
        deviceId,
        filename,
        ...u,
        source: SOURCE.system.id
      })
    } catch (e) {
      api.log('[print_log] control_before', e)
    }
    return payload
  },

  async print_request_create(api, payload, ctx) {
    try {
      if (!payload || payload.proceed === false) return payload
      const body = payload.body && typeof payload.body === 'object' ? payload.body : {}
      const deviceId = String(body.deviceId || '')
      const filename = String(body.filename || '').trim()
      const u = userLabel(authUser(ctx))
      rememberAttribution(api, deviceId, {
        ...u,
        source: SOURCE.queue.id,
        filename
      })
    } catch (e) {
      api.log('[print_log] print_request_create', e)
    }
    return payload
  },

  async print_approve(api, payload, ctx) {
    // 申请创建时已按设备记下申请人；审批本身不改归因
    return payload
  },

  async print_start(api, payload, ctx) {
    try {
      if (!payload || payload.proceed === false) return payload
      // 真正开打后由 statuses_publish 消费 pending 归因；此处仅刷新时间戳防过期
      const pending = readPending(api)
      const u = userLabel(authUser(ctx))
      for (const [deviceId, row] of Object.entries(pending)) {
        if (!row || typeof row !== 'object' || String(deviceId).startsWith('__')) continue
        if (row.source === SOURCE.queue.id) {
          pending[deviceId] = { ...row, ...u, source: SOURCE.queue.id, at: nowIso() }
        }
      }
      writePending(api, pending)
    } catch (e) {
      api.log('[print_log] print_start', e)
    }
    return payload
  },

  async print_batch_before(api, payload, ctx) {
    try {
      if (!payload || payload.proceed === false) return payload
      const u = userLabel(authUser(ctx))
      const filename = String(payload.filename || '').trim()
      const ids = Array.isArray(payload.deviceIds) ? payload.deviceIds : []
      for (const id of ids) {
        const deviceId = String(id)
        rememberAttribution(api, deviceId, {
          ...u,
          source: SOURCE.batch.id,
          filename
        })
        upsertStart(api, {
          deviceId,
          filename,
          ...u,
          source: SOURCE.batch.id
        })
      }
    } catch (e) {
      api.log('[print_log] print_batch_before', e)
    }
    return payload
  },

  /** 状态机：现场打印 / 补全材料与结束 */
  async statuses_publish(api, statuses) {
    try {
      if (!statuses || typeof statuses !== 'object') return statuses
      const prev = api.readJson('status_prev.json', {})
      const nextPrev = { ...(prev && typeof prev === 'object' ? prev : {}) }

      for (const [deviceId, raw] of Object.entries(statuses)) {
        if (!raw || typeof raw !== 'object') continue
        if (!deviceEnabled(api, deviceId)) {
          nextPrev[deviceId] = {
            state: String(raw.state || ''),
            filename: jobName(raw)
          }
          continue
        }
        const st = raw
        const state = String(st.state || '').toLowerCase()
        const filename = jobName(st)
        const before = nextPrev[deviceId] || prev[deviceId] || {}
        const wasPrinting = isPrintingState(before.state)
        const nowPrinting = isPrintingState(state)
        const grams =
          typeof st.filamentUsedGrams === 'number' && Number.isFinite(st.filamentUsedGrams)
            ? st.filamentUsedGrams
            : undefined

        if (!wasPrinting && nowPrinting) {
          // 仅用按设备归因，避免把「现场操作」误记成上次队列操作人
          const attr = takeAttribution(api, deviceId)
          const source = (attr && attr.source) || SOURCE.on_device.id
          upsertStart(api, {
            deviceId,
            deviceName: st.deviceName || st.name,
            filename: filename || (attr && attr.filename) || '',
            userId: attr && attr.userId,
            userName: attr && attr.userName,
            source
          })
        } else if (wasPrinting && isDoneState(state)) {
          finishRecord(api, {
            deviceId,
            deviceName: st.deviceName || st.name,
            filename: filename || before.filename || '',
            filamentUsedGrams: grams,
            failed: false,
            at: nowIso()
          })
        } else if (wasPrinting && isFailedState(state) && before.state !== state) {
          finishRecord(api, {
            deviceId,
            deviceName: st.deviceName || st.name,
            filename: filename || before.filename || '',
            filamentUsedGrams: grams,
            failed: true,
            at: nowIso()
          })
        } else if (nowPrinting && grams != null) {
          const records = readRecords(api)
          const row = findOpenRecord(records, deviceId, filename) || findOpenRecord(records, deviceId, '')
          if (row) {
            row.filamentUsedGrams = grams
            if (filename && (!row.filename || row.filename === '（未知文件）')) row.filename = filename
            writeRecords(api, records)
          }
        }

        nextPrev[deviceId] = { state, filename }
      }
      api.writeJson('status_prev.json', nextPrev)
    } catch (e) {
      try {
        api.log('[print_log] statuses_publish', e)
      } catch (_) {
        /* ignore */
      }
    }
    return statuses
  }
}
