/**
 * farm_dispatch — 巡查手机端 + 审核 PC + 提交申请 + 智能派单 + 开打拦截
 */
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const PERM = {
  patrol: 'plugin.farm_dispatch.patrol',
  audit: 'plugin.farm_dispatch.audit',
  submit: 'plugin.farm_dispatch.submit',
  logs: 'plugin.farm_dispatch.logs'
}

const GROUP_DEFS = [
  {
    id: 'farm_patrol',
    name: '巡查',
    description: '巡查看板：报错/完成确认、空闲/维修、绑定耗材；可看派单日志',
    permissions: [PERM.patrol, PERM.logs, 'device.view', 'filament.view', 'filament.bind', 'filament.unbind'],
    // 空 moduleAccess：仅靠 permissions 控制侧栏，避免白名单漏掉「派单日志」
    moduleAccess: []
  },
  {
    id: 'farm_audit',
    name: '审核',
    description: '派单审核；可看派单日志',
    permissions: [PERM.audit, PERM.logs, 'device.view'],
    moduleAccess: []
  },
  {
    id: 'farm_submit',
    name: '派单申请',
    description: '提交打印文件申请（机型/材料/颜色）',
    permissions: [PERM.submit],
    moduleAccess: []
  }
]

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

function httpHtml(status, html) {
  return {
    __pluginHttp: {
      status: status || 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: String(html)
    }
  }
}

function httpJson(status, json) {
  return { __pluginHttp: { status: status || 200, json } }
}

function authUser(ctx) {
  const a = ctx && ctx.auth
  if (a && a.kind === 'user' && a.user && a.user.id) return a.user
  return null
}

function authHeader(ctx) {
  const h = (ctx && ctx.headers) || {}
  return h.authorization || h.Authorization || ''
}

function userPerms(user) {
  const set = new Set()
  if (!user) return set
  if (String(user.level || '') === 'admin') {
    set.add('*')
    return set
  }
  for (const p of user.permissions || []) set.add(String(p))
  for (const p of user.effectivePermissions || []) set.add(String(p))
  return set
}

function hasPerm(user, code) {
  if (!user) return false
  const set = userPerms(user)
  return set.has('*') || set.has(code)
}

function isAdmin(user) {
  return user && String(user.level || '') === 'admin'
}

function requireRole(user, roleKey, api) {
  if (!user) return { ok: false, status: 401, message: '请先登录' }
  const roles = roleFlags(user, api)
  if (roles.admin || roles[roleKey]) return { ok: true }
  return { ok: false, status: 403, message: '无权限：需要「' + roleKey + '」岗' }
}

function norm(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
}

function normColor(s) {
  let t = String(s || '').trim()
  if (!t) return ''
  if (t.charAt(0) === '#') {
    t = t.toLowerCase()
    // #RGB → #RRGGBB
    if (/^#[0-9a-f]{3}$/i.test(t)) {
      t = '#' + t[1] + t[1] + t[2] + t[2] + t[3] + t[3]
    }
    return t
  }
  return norm(t)
}

function colorMatch(a, b) {
  const x = normColor(a)
  const y = normColor(b)
  if (!x || !y) return false
  if (x === y) return true
  // 非色值名称：允许「黑」≈「黑色」
  if (x.charAt(0) !== '#' && y.charAt(0) !== '#') {
    return x.includes(y) || y.includes(x)
  }
  return false
}

function materialMatch(a, b) {
  const x = norm(a)
  const y = norm(b)
  if (!x || !y) return false
  if (x === y) return true
  return x.includes(y) || y.includes(x)
}

function modelMatch(a, b) {
  const x = norm(a)
  const y = norm(b)
  if (!x || !y) return false
  if (x === y) return true
  // 容忍机型写法差异：X1C / bambu x1c / X1-Carbon
  return x.includes(y) || y.includes(x)
}

function readArr(api, file, fallback) {
  const raw = api.readJson(file, fallback)
  return Array.isArray(raw) ? raw : fallback
}

function readObj(api, file) {
  const raw = api.readJson(file, {})
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
}

function appendLog(api, entry) {
  const max = Math.max(200, Math.min(20000, numVar(api, 'log_max', 5000)))
  const list = readArr(api, 'audit_log.json', [])
  list.unshift({
    id: newId(),
    at: nowIso(),
    ...entry
  })
  api.writeJson('audit_log.json', list.slice(0, max))
}

function actorOf(user) {
  if (!user) return { actorId: '', actorName: '系统' }
  return {
    actorId: String(user.id || ''),
    actorName: String(user.displayName || user.username || user.id || '')
  }
}

function pageFile(api, name) {
  const p = path.join(api.pluginDir, 'pages', name)
  return fs.readFileSync(p, 'utf8')
}

function roleFlags(user, api) {
  const gids = Array.isArray(user && user.groupIds) ? user.groupIds.map(String) : []
  const admin = isAdmin(user)
  const groups = listGroups(api)
  const extra = []
  for (const gid of gids) {
    const g = groups.find((x) => String(x.id) === gid)
    if (g && Array.isArray(g.permissions)) extra.push(...g.permissions)
  }
  const boxed = user
    ? { ...user, permissions: [...(user.permissions || []), ...extra] }
    : user
  return {
    patrol: admin || hasPerm(boxed, PERM.patrol) || gids.includes('farm_patrol'),
    audit: admin || hasPerm(boxed, PERM.audit) || gids.includes('farm_audit'),
    submit: admin || hasPerm(boxed, PERM.submit) || gids.includes('farm_submit'),
    logs:
      admin ||
      hasPerm(boxed, PERM.logs) ||
      gids.includes('farm_patrol') ||
      gids.includes('farm_audit'),
    admin
  }
}

function spoolBindings(s) {
  return spoolBindingsOf(s)
}

function deviceSpools(spools, deviceId) {
  const out = []
  for (const s of spools || []) {
    if (!s || s.archived) continue
    for (const b of spoolBindings(s)) {
      if (String(b.deviceId) === String(deviceId)) {
        out.push({ spool: s, slotId: Number(b.slotId) })
      }
    }
  }
  return out
}

function hasAnyFilament(spools, deviceId) {
  return deviceSpools(spools, deviceId).length > 0
}

function spoolMatchesJob(spool, job) {
  if (!spool || !job) return false
  if (!materialMatch(spool.material, job.material)) return false
  const cOk =
    colorMatch(spool.color, job.color) ||
    colorMatch(spool.colorHex, job.color) ||
    colorMatch(spool.color, job.colorHex) ||
    colorMatch(spool.colorHex, job.colorHex)
  return cOk
}

function normState(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
}

function isErrorSt(st) {
  if (!st) return false
  if (String(st.health || '') === 'error') return true
  const s = normState(st.state)
  if (!s) return false
  return (
    s === 'failed' ||
    s === 'error' ||
    s === 'fatal' ||
    s === 'klippy_shutdown' ||
    s === 'klippy_disconnect' ||
    s === 'klippy_disconnected' ||
    s.endsWith('_failed') ||
    s.endsWith('_error')
  )
}

function isFinishedSt(st) {
  const s = normState(st && st.state)
  return (
    s === 'finish' ||
    s === 'finished' ||
    s === 'complete' ||
    s === 'completed' ||
    s === 'done'
  )
}

function isPrintingSt(st) {
  const s = normState(st && st.state)
  return /print|run|busy|pause/.test(s) && !isFinishedSt(st) && !isErrorSt(st)
}

function isOfflineSt(st) {
  if (!st) return true
  const h = String(st.health || '').toLowerCase()
  if (h === 'offline' || h === 'disconnected') return true
  if (h === 'online' || h === 'ok' || h === 'healthy' || h === 'degraded') return false
  const s = normState(st.state)
  if (s === 'offline' || s === 'disconnected') return true
  // 已有明确运行态时，不因 health 为空误判离线
  if (s && s !== 'unknown' && s !== 'idle' && s !== 'ready') return false
  if (s === 'idle' || s === 'ready' || s === 'standby') return false
  return h === ''
}

function getDuty(api, deviceId) {
  const all = readObj(api, 'duty.json')
  const row = all[String(deviceId)]
  return row && typeof row === 'object'
    ? row
    : { status: 'idle', clearedAt: null, note: '', updatedAt: null, updatedBy: '' }
}

function setDuty(api, deviceId, patch, user) {
  const all = readObj(api, 'duty.json')
  const prev = getDuty(api, deviceId)
  const next = {
    ...prev,
    ...patch,
    updatedAt: nowIso(),
    updatedBy: user ? String(user.displayName || user.username || user.id) : prev.updatedBy || ''
  }
  all[String(deviceId)] = next
  api.writeJson('duty.json', all)
  return next
}

function attentionKind(st) {
  if (isErrorSt(st)) return 'error'
  if (isFinishedSt(st)) return 'finished'
  return null
}

function episodeFp(st) {
  const kind = attentionKind(st)
  if (!kind) return ''
  return kind + ':' + String(st.state || '') + ':' + String(st.filename || st.gcodeFile || '')
}

/** 设备是否允许接收打印文件 */
function canAcceptPrint(api, deviceId, spools) {
  if (!boolVar(api, 'block_unavailable', true)) return { ok: true }
  const duty = getDuty(api, deviceId)
  if (duty.status === 'maintenance') {
    return { ok: false, message: '设备维修中，禁止发送打印文件' }
  }
  if (duty.status === 'attention') {
    return { ok: false, message: '设备待巡查处理，禁止发送打印文件' }
  }
  const st = (api.getStatuses() || {})[String(deviceId)] || {}
  if (isOfflineSt(st)) return { ok: false, message: '设备离线，禁止发送打印文件' }
  if (isPrintingSt(st)) return { ok: false, message: '设备正在打印，禁止发送打印文件' }
  const fp = episodeFp(st)
  if (isErrorSt(st) || isFinishedSt(st)) {
    if (!(duty.status === 'idle' && duty.clearedFp && duty.clearedFp === fp)) {
      return {
        ok: false,
        message: isErrorSt(st)
          ? '设备报错，需巡查确认空闲后才能开打'
          : '打印已完成，需巡查确认空闲（清床）后才能开打'
      }
    }
  }
  if (boolVar(api, 'require_filament', true) && !hasAnyFilament(spools || [], deviceId)) {
    return { ok: false, message: '设备未绑定耗材，禁止发送打印文件 / 无法智能派单' }
  }
  return { ok: true }
}

function takeAllowOnce(api, deviceId) {
  const map = readObj(api, 'allow_once.json')
  const key = String(deviceId)
  const row = map[key]
  if (!row) return false
  const t = Date.parse(row.until || 0)
  if (!Number.isFinite(t) || Date.now() > t) {
    delete map[key]
    api.writeJson('allow_once.json', map)
    return false
  }
  delete map[key]
  api.writeJson('allow_once.json', map)
  return true
}

function grantAllowOnce(api, deviceId, jobId) {
  const map = readObj(api, 'allow_once.json')
  map[String(deviceId)] = {
    jobId: String(jobId || ''),
    until: new Date(Date.now() + 120000).toISOString()
  }
  api.writeJson('allow_once.json', map)
}

function dataRoot(api) {
  if (api && typeof api.dataRoot === 'string' && api.dataRoot) return api.dataRoot
  if (api && typeof api.dataDir === 'string' && api.dataDir) {
    // .../data/plugin-data/farm_dispatch → .../data
    const base = path.resolve(api.dataDir, '..', '..')
    if (path.basename(path.dirname(api.dataDir)) === 'plugin-data') return base
  }
  return process.env.DATA_ROOT || path.join(process.cwd(), 'data')
}

function listGroups(api) {
  try {
    if (api && typeof api.listUserGroups === 'function') {
      const g = api.listUserGroups()
      if (Array.isArray(g)) return g
    }
  } catch (e) {
    if (api && api.log) api.log('[farm_dispatch] listUserGroups ' + (e && e.message))
  }
  const p = path.join(dataRoot(api), 'user-groups.json')
  if (!fs.existsSync(p)) return []
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'))
    return Array.isArray(raw.groups) ? raw.groups : []
  } catch {
    return []
  }
}

function cacheSpools(api, spools) {
  api.writeJson('filament_cache.json', {
    at: nowIso(),
    spools: Array.isArray(spools) ? spools : []
  })
}

/** 内存短缓存，避免每次开打拦截/派单都同步读大 JSON */
let _spoolMem = { at: 0, spools: null }

function readFilamentSpools(api) {
  const now = Date.now()
  if (_spoolMem.spools && now - _spoolMem.at < 4000) return _spoolMem.spools
  // 1) 宿主 dataRoot 下的 filament-spools.json（无数据库安装的主路径）
  try {
    const root = dataRoot(api)
    const candidates = [
      path.join(root, 'filament-spools.json'),
      path.join(root, 'data', 'filament-spools.json')
    ]
    for (const p of candidates) {
      if (!fs.existsSync(p)) continue
      const raw = JSON.parse(fs.readFileSync(p, 'utf8'))
      if (Array.isArray(raw)) {
        _spoolMem = { at: now, spools: raw }
        try {
          setImmediate(function () {
            try {
              cacheSpools(api, raw)
            } catch (_) {}
          })
        } catch (_) {}
        return raw
      }
    }
  } catch (e) {
    try {
      api.log('[farm_dispatch] readFilamentSpools ' + (e && e.message))
    } catch (_) {}
  }
  // 2) 插件内缓存（MySQL 插件数据 / 文件均走 api.readJson）
  const cache = readObj(api, 'filament_cache.json')
  const list = Array.isArray(cache.spools) ? cache.spools : []
  _spoolMem = { at: now, spools: list }
  return list
}

function writeFilamentSpools(api, spools) {
  const list = Array.isArray(spools) ? spools : []
  _spoolMem = { at: Date.now(), spools: list }
  cacheSpools(api, list)
  // 无数据库：写宿主 filament 文件；有库时宿主也可能从同路径同步
  try {
    const p = path.join(dataRoot(api), 'filament-spools.json')
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, JSON.stringify(list, null, 2), 'utf8')
  } catch (e) {
    try {
      api.log('[farm_dispatch] writeFilamentSpools ' + (e && e.message))
    } catch (_) {}
  }
}

function spoolBindingsOf(s) {
  if (!s) return []
  if (Array.isArray(s.amsBindings)) {
    return s.amsBindings.filter((b) => b && b.deviceId && Number.isFinite(Number(b.slotId)))
  }
  if (s.amsBinding && s.amsBinding.deviceId) {
    return [{ deviceId: s.amsBinding.deviceId, slotId: Number(s.amsBinding.slotId) }]
  }
  return []
}

/** 可同时绑定的卷数：1000g = 1 卷（与宿主一致）；不足 1000g 也按 1 卷 */
function spoolRollsOf(s) {
  if (!s) return 1
  const total = Number(s.totalGrams)
  if (Number.isFinite(total) && total > 0) {
    return Math.max(1, Math.min(99, Math.ceil(total / 1000)))
  }
  const explicit = Math.floor(Number(s.rolls))
  if (Number.isFinite(explicit) && explicit >= 1) return Math.min(99, explicit)
  const remain = Number(s.remainGrams)
  if (Number.isFinite(remain) && remain > 0) {
    return Math.max(1, Math.min(99, Math.ceil(remain / 1000)))
  }
  return 1
}

function spoolSlotsLeft(s) {
  return Math.max(0, spoolRollsOf(s) - spoolBindingsOf(s).length)
}

function bindFilamentSpool(api, spoolId, deviceId, slotId, bind) {
  let spools = readFilamentSpools(api)
  const idx = spools.findIndex((s) => String(s.id) === String(spoolId))
  if (idx < 0) return { ok: false, message: '耗材不存在' }
  const rolls = spoolRollsOf(spools[idx])
  for (const s of spools) {
    let list = spoolBindingsOf(s).map((b) => ({
      deviceId: String(b.deviceId),
      slotId: Number(b.slotId)
    }))
    // 同一机位槽只允许一卷：先从所有料卷上摘掉该槽
    list = list.filter(
      (b) => !(String(b.deviceId) === String(deviceId) && Number(b.slotId) === Number(slotId))
    )
    if (String(s.id) === String(spoolId) && bind) {
      if (!list.some((b) => String(b.deviceId) === String(deviceId) && Number(b.slotId) === Number(slotId))) {
        if (list.length >= rolls) {
          return {
            ok: false,
            message:
              '该耗材仅 ' +
              rolls +
              ' 卷（约按 1000g/卷），已绑满 ' +
              list.length +
              '/' +
              rolls +
              '，请先解绑后再绑到其它机'
          }
        }
        list.push({ deviceId: String(deviceId), slotId: Number(slotId) })
      }
    }
    s.amsBindings = list
    s.amsBinding = list[0] || null
    if (String(s.id) === String(spoolId)) s.rolls = rolls
    s.updatedAt = nowIso()
  }
  writeFilamentSpools(api, spools)
  const next = spools.find((s) => String(s.id) === String(spoolId))
  return { ok: true, spool: next }
}

function pushPatrolNotice(api, n, opts) {
  opts = opts || {}
  const list = readArr(api, 'notifications.json', [])
  const jobId = n && n.jobId ? String(n.jobId) : ''
  // 同一任务的开放通知去重：更新旧条，避免刷屏
  if (jobId) {
    for (const row of list) {
      if (row && row.status === 'open' && String(row.jobId || '') === jobId) {
        Object.assign(row, n, {
          id: row.id,
          status: 'open',
          createdAt: row.createdAt || nowIso(),
          updatedAt: nowIso()
        })
        api.writeJson('notifications.json', list.slice(0, 500))
        return row
      }
    }
  }
  const row = {
    id: newId(),
    status: 'open',
    createdAt: nowIso(),
    ...n
  }
  list.unshift(row)
  api.writeJson('notifications.json', list.slice(0, 500))
  // 默认不走宿主 notify（状态广播热路径会卡死）；仅 opts.notify === true 时触发
  if (opts.notify === true) {
    try {
      if (typeof api.notify === 'function') {
        void Promise.resolve(
          api.notify({
            kind: 'farm_dispatch',
            title: row.title || '巡查通知',
            content: row.body || '',
            deviceId: row.deviceId,
            deviceName: row.deviceName
          })
        ).catch(function () {})
      }
    } catch (_) {
      /* ignore */
    }
  }
  return row
}

function closeNoticesForJob(api, jobId, by) {
  const id = String(jobId || '')
  if (!id) return 0
  const list = readArr(api, 'notifications.json', [])
  let n = 0
  for (const row of list) {
    if (row && row.status === 'open' && String(row.jobId || '') === id) {
      row.status = 'done'
      row.doneAt = nowIso()
      row.doneBy = by || '系统'
      n++
    }
  }
  if (n) api.writeJson('notifications.json', list)
  return n
}

function clearAllowOnce(api, deviceId) {
  const map = readObj(api, 'allow_once.json')
  const key = String(deviceId)
  if (!map[key]) return
  delete map[key]
  api.writeJson('allow_once.json', map)
}

function lastDispatchMap(api) {
  const raw = readObj(api, 'dispatch_stats.json')
  return raw && typeof raw === 'object' ? raw : {}
}

function markDispatched(api, deviceId) {
  const map = lastDispatchMap(api)
  map[String(deviceId)] = nowIso()
  api.writeJson('dispatch_stats.json', map)
}

function diagnoseNoMatch(api, job, spools) {
  const devices = api.getDevices() || []
  const statuses = api.getStatuses() || {}
  let total = 0
  let noModel = 0
  let noBind = 0
  let noMatColor = 0
  let gateBlock = 0
  let busy = 0
  for (const d of devices) {
    const id = String(d.id || '')
    if (!id) continue
    total++
    if (!modelMatch(d.model, job.model)) {
      noModel++
      continue
    }
    const bound = deviceSpools(spools, id)
    if (!bound.length) {
      noBind++
      continue
    }
    if (!bound.some((x) => spoolMatchesJob(x.spool, job))) {
      noMatColor++
      continue
    }
    const gate = canAcceptPrint(api, id, spools)
    if (!gate.ok) {
      gateBlock++
      continue
    }
    const st = statuses[id] || {}
    const duty = getDuty(api, id)
    if (
      isPrintingSt(st) ||
      isErrorSt(st) ||
      isFinishedSt(st) ||
      isOfflineSt(st) ||
      duty.status === 'maintenance' ||
      duty.status === 'attention'
    ) {
      busy++
    }
  }
  return (
    '共 ' +
    total +
    ' 台：机型不符 ' +
    noModel +
    '；未绑料 ' +
    noBind +
    '；材料/颜色不符 ' +
    noMatColor +
    '；开打受限 ' +
    gateBlock +
    '；忙/离线/待巡查 ' +
    busy
  )
}

function findCandidates(api, job, spools) {
  const devices = api.getDevices() || []
  const statuses = api.getStatuses() || {}
  const stats = lastDispatchMap(api)
  const hits = []
  for (const d of devices) {
    const id = String(d.id || '')
    if (!id) continue
    if (!modelMatch(d.model, job.model)) continue
    const bound = deviceSpools(spools, id)
    if (!bound.length) continue
    const matched = bound.filter((x) => spoolMatchesJob(x.spool, job))
    if (!matched.length) continue
    const gate = canAcceptPrint(api, id, spools)
    if (!gate.ok) continue
    const st = statuses[id] || {}
    if (isPrintingSt(st) || isErrorSt(st) || isFinishedSt(st) || isOfflineSt(st)) continue
    const duty = getDuty(api, id)
    if (duty.status === 'maintenance' || duty.status === 'attention') continue
    const remain = matched.reduce((s, x) => {
      const g = Number(x.spool && x.spool.remainGrams)
      return s + (Number.isFinite(g) ? Math.max(0, g) : 0)
    }, 0)
    const lastAt = Date.parse(stats[id] || 0) || 0
    hits.push({
      id,
      name: String(d.name || id),
      model: String(d.model || ''),
      brand: d.brand,
      remain,
      lastAt,
      // 余料多优先，其次久未派过
      score: remain * 1000 - lastAt / 1e10
    })
  }
  hits.sort((a, b) => b.score - a.score)
  return hits
}

/** 防止审核通过与巡查「换料完成」并发双开打 */
const dispatchInFlight = new Set()

async function withDispatchLock(jobId, fn) {
  const id = String(jobId || '')
  if (!id) return fn()
  if (dispatchInFlight.has(id)) {
    return { ok: false, message: '该任务正在派单中，请稍候', busy: true }
  }
  dispatchInFlight.add(id)
  try {
    return await fn()
  } finally {
    dispatchInFlight.delete(id)
  }
}

async function dispatchJob(api, ctx, job, user, opts) {
  opts = opts || {}
  if (job && job.status === 'printing') {
    return { ok: true, job, already: true }
  }
  const spools = readFilamentSpools(api)
  let candidates = findCandidates(api, job, spools)
  const preferred = String(opts.preferredDeviceId || opts.deviceId || '').trim()
  if (preferred) {
    const hit = candidates.find((c) => String(c.id) === preferred)
    if (hit) {
      candidates = [hit, ...candidates.filter((c) => String(c.id) !== preferred)]
    } else if (opts.requirePreferred) {
      return {
        ok: false,
        message: '指定设备当前不可派（机型/耗材/状态不匹配）',
        job
      }
    }
  }
  if (!candidates.length) {
    const diag = diagnoseNoMatch(api, job, spools)
    job.status = 'waiting_material'
    job.deviceId = ''
    job.deviceName = ''
    job.waitReason =
      '没有匹配机型「' +
      job.model +
      '」且材料「' +
      job.material +
      '」颜色「' +
      (job.color || job.colorHex) +
      '」且可开打的设备。' +
      diag
    job.updatedAt = nowIso()
    pushPatrolNotice(api, {
      type: 'need_filament',
      title: '需要换料 / 换机',
      body:
        '任务 #' +
        job.id.slice(0, 8) +
        ' 需要机型 ' +
        job.model +
        '、材料 ' +
        job.material +
        '、颜色 ' +
        (job.color || job.colorHex) +
        '。' +
        diag +
        ' 请绑料或确认空闲后点「换料完成」。',
      jobId: job.id,
      need: {
        model: job.model,
        material: job.material,
        color: job.color,
        colorHex: job.colorHex
      }
    })
    appendLog(api, {
      ...actorOf(user),
      action: 'dispatch_waiting',
      detail: { jobId: job.id, reason: job.waitReason, diagnose: diag }
    })
    return { ok: false, waiting: true, job, diagnose: diag }
  }

  let contentBase64 = job.contentBase64
  if (!contentBase64 && job.mediaRel) {
    try {
      const full = path.join(api.dataDir, 'media', job.mediaRel)
      contentBase64 = fs.readFileSync(full).toString('base64')
    } catch (e) {
      return { ok: false, message: '读取打印文件失败：' + (e.message || e), job }
    }
  }
  if (!contentBase64) return { ok: false, message: '任务缺少打印文件内容', job }

  const tried = []
  let lastErr = ''
  for (const target of candidates) {
    grantAllowOnce(api, target.id, job.id)
    let claimed = null
    try {
      claimed = await api.claimDevice(target.id, {
        ttlSec: 300,
        ownerLabel: 'farm_dispatch:' + job.id
      })
    } catch (e) {
      claimed = { ok: false, message: String(e && e.message ? e.message : e) }
    }
    if (claimed && claimed.ok === false) {
      const msg = String(claimed.message || '')
      // 无锁子系统时继续；其它锁定失败则换下一台
      if (!/lock\s*不可用/i.test(msg)) {
        clearAllowOnce(api, target.id)
        lastErr = (claimed.message || '设备锁定失败') + '（' + target.name + '）'
        tried.push({ id: target.id, name: target.name, error: lastErr })
        continue
      }
    }

    let r = null
    try {
      r = await api.startPrint(target.id, {
        filename: job.filename,
        contentBase64
      })
    } catch (e) {
      r = { ok: false, message: String(e && e.message ? e.message : e) }
    }
    try {
      await api.releaseDevice(target.id, {})
    } catch (_) {
      /* ignore */
    }

    if (r && r.ok) {
      job.status = 'printing'
      job.deviceId = target.id
      job.deviceName = target.name
      job.dispatchedAt = nowIso()
      job.updatedAt = nowIso()
      job.waitReason = ''
      job.failReason = ''
      markDispatched(api, target.id)
      closeNoticesForJob(api, job.id, actorOf(user).actorName)
      appendLog(api, {
        ...actorOf(user),
        action: 'dispatch_ok',
        detail: {
          jobId: job.id,
          deviceId: target.id,
          deviceName: target.name,
          tried: tried.length
        }
      })
      return { ok: true, job, device: target, tried }
    }

    clearAllowOnce(api, target.id)
    lastErr = ((r && r.message) || '开打失败') + '（' + target.name + '）'
    tried.push({ id: target.id, name: target.name, error: lastErr })
  }

  job.status = 'failed'
  job.failReason = lastErr || '所有候选设备开打失败'
  job.updatedAt = nowIso()
  appendLog(api, {
    ...actorOf(user),
    action: 'dispatch_failed',
    detail: { jobId: job.id, message: job.failReason, tried }
  })
  return { ok: false, message: job.failReason, job, tried }
}

function saveJobs(api, jobs) {
  api.writeJson('jobs.json', jobs)
}

function getJobs(api) {
  return readArr(api, 'jobs.json', [])
}

function updateJob(api, id, patch) {
  const jobs = getJobs(api)
  const i = jobs.findIndex((j) => String(j.id) === String(id))
  if (i < 0) return null
  jobs[i] = { ...jobs[i], ...patch, updatedAt: nowIso() }
  saveJobs(api, jobs)
  return jobs[i]
}

function jobStats(api) {
  const jobs = getJobs(api)
  const c = {
    pending_audit: 0,
    waiting_material: 0,
    printing: 0,
    print_done: 0,
    print_error: 0,
    failed: 0,
    approved: 0,
    rejected: 0,
    cancelled: 0,
    completed: 0,
    total: jobs.length
  }
  for (const j of jobs) {
    const s = String(j.status || '')
    if (c[s] != null) c[s]++
  }
  return c
}

/** 设备打印完成/报错时回写派单任务，并通知巡查（仅写插件内通知，不走宿主告警） */
function syncJobsFromStatuses(api, statusMap) {
  const map = statusMap && typeof statusMap === 'object' ? statusMap : {}
  const jobs = getJobs(api)
  let changed = false
  for (const job of jobs) {
    if (!job || job.status !== 'printing' || !job.deviceId) continue
    const st = map[String(job.deviceId)]
    if (!st) continue
    if (isFinishedSt(st)) {
      job.status = 'print_done'
      job.finishedAt = nowIso()
      job.updatedAt = nowIso()
      changed = true
      pushPatrolNotice(api, {
        type: 'print_done',
        title: '打印完成待清床',
        body:
          '任务 #' +
          job.id.slice(0, 8) +
          ' 在「' +
          (job.deviceName || job.deviceId) +
          '」已完成，请确认清床后点空闲。',
        jobId: job.id,
        deviceId: job.deviceId,
        deviceName: job.deviceName
      })
      appendLog(api, {
        actorId: '',
        actorName: '系统',
        action: 'job_print_done',
        detail: { jobId: job.id, deviceId: job.deviceId }
      })
    } else if (isErrorSt(st)) {
      job.status = 'print_error'
      job.failReason = String(st.message || st.state || '打印报错')
      job.updatedAt = nowIso()
      changed = true
      pushPatrolNotice(api, {
        type: 'print_error',
        title: '打印报错待处理',
        body:
          '任务 #' +
          job.id.slice(0, 8) +
          ' 在「' +
          (job.deviceName || job.deviceId) +
          '」报错：' +
          job.failReason,
        jobId: job.id,
        deviceId: job.deviceId,
        deviceName: job.deviceName
      })
      appendLog(api, {
        actorId: '',
        actorName: '系统',
        action: 'job_print_error',
        detail: { jobId: job.id, deviceId: job.deviceId, message: job.failReason }
      })
    }
  }
  if (changed) saveJobs(api, jobs)
  return changed
}

function syncDutiesFromStatuses(api, map) {
  const duties = readObj(api, 'duty.json')
  let changed = false
  for (const id of Object.keys(map)) {
    const st = map[id]
    const kind = attentionKind(st)
    const prev = duties[id] && typeof duties[id] === 'object' ? duties[id] : {}
    if (prev.status === 'maintenance') continue
    if (!kind) continue
    const fp = kind + ':' + String(st.state || '') + ':' + String(st.filename || st.gcodeFile || '')
    if (prev.status === 'idle' && prev.clearedFp && prev.clearedFp === fp) continue
    if (prev.status === 'attention' && prev.attentionFp === fp) continue
    duties[id] = {
      ...prev,
      status: 'attention',
      attentionFp: fp,
      attentionKind: kind,
      clearedAt: null,
      note: kind === 'error' ? '报错待巡查' : '打印完成待确认',
      updatedAt: nowIso(),
      updatedBy: 'system'
    }
    changed = true
  }
  if (changed) api.writeJson('duty.json', duties)
  return changed
}

/** 合并多次状态广播，避免安装启用后状态风暴把事件循环堵死 */
let _statusSideApi = null
let _statusSideLatest = null
let _statusSideQueued = false

function queueStatusSideEffects(api, statuses) {
  _statusSideApi = api
  _statusSideLatest = statuses
  if (_statusSideQueued) return
  _statusSideQueued = true
  const run = function () {
    _statusSideQueued = false
    const a = _statusSideApi
    const snap = _statusSideLatest
    _statusSideLatest = null
    if (!a || !snap) return
    try {
      syncJobsFromStatuses(a, snap)
      syncDutiesFromStatuses(a, snap)
    } catch (e) {
      try {
        a.log('[farm_dispatch] statusSideEffects ' + (e && e.message))
      } catch (_) {}
    }
  }
  try {
    if (typeof setImmediate === 'function') setImmediate(run)
    else setTimeout(run, 0)
  } catch (_) {
    run()
  }
}

function completeJobsOnIdle(api, deviceId, user) {
  const id = String(deviceId || '')
  if (!id) return 0
  const jobs = getJobs(api)
  let n = 0
  for (const job of jobs) {
    if (!job) continue
    if (String(job.deviceId) !== id) continue
    if (job.status !== 'print_done' && job.status !== 'print_error') continue
    job.status = job.status === 'print_error' ? 'failed' : 'completed'
    job.clearedAt = nowIso()
    job.updatedAt = nowIso()
    n++
    closeNoticesForJob(api, job.id, actorOf(user).actorName)
    appendLog(api, {
      ...actorOf(user),
      action: job.status === 'completed' ? 'job_completed' : 'job_failed_cleared',
      detail: { jobId: job.id, deviceId: id }
    })
  }
  if (n) saveJobs(api, jobs)
  return n
}

function enrichDevices(api, spools) {
  const devices = api.getDevices() || []
  const statuses = api.getStatuses() || {}
  return devices.map((d) => {
    const id = String(d.id || '')
    const st = statuses[id] || {}
    const duty = getDuty(api, id)
    const bound = deviceSpools(spools, id).map((x) => ({
      spoolId: x.spool.id,
      material: x.spool.material,
      color: x.spool.color,
      colorHex: x.spool.colorHex,
      slotId: x.slotId,
      remainGrams: x.spool.remainGrams
    }))
    const kind = attentionKind(st)
    const fp = episodeFp(st)
    const cleared =
      duty.status === 'idle' && duty.clearedFp && fp && duty.clearedFp === fp
    let board = 'other'
    if (duty.status === 'maintenance') board = 'maintenance'
    else if (kind === 'error' && !cleared) board = 'error'
    else if (kind === 'finished' && !cleared) board = 'finished'
    else if (duty.status === 'attention') board = 'attention'
    else if (isPrintingSt(st)) board = 'printing'
    else board = 'idle'
    return {
      id,
      name: String(d.name || id),
      model: String(d.model || ''),
      brand: d.brand,
      health: st.health,
      state: st.state,
      message: st.message,
      filename: st.filename || st.gcodeFile || '',
      duty,
      board,
      bound,
      gate: canAcceptPrint(api, id, spools)
    }
  })
}

module.exports = {
  async register(api) {
    const servePage = (name) => async () => {
      try {
        return httpHtml(200, pageFile(api, name))
      } catch (e) {
        return httpHtml(500, '<pre>页面缺失：' + String(e.message || e) + '</pre>')
      }
    }

    // 旧独立 URL：提示改走侧栏，避免 Electron 新窗口套壳卡死
    const tipPage = (title, section) =>
      httpHtml(
        200,
        '<!doctype html><meta charset="utf-8"/><title>' +
          title +
          '</title><body style="font-family:system-ui;padding:24px;background:#0f141c;color:#e8eaed">' +
          '<h1 style="font-size:18px">' +
          title +
          '</h1><p>请在监控台侧栏打开「' +
          section +
          '」，勿用独立窗口（易卡死）。</p>' +
          '<p style="opacity:.65;font-size:13px">入口：巡查看板 / 派单审核 / 提交打印 / 派单日志</p></body>'
      )
    api.registerRoute('GET', '/farm/patrol', async () => tipPage('巡查看板', '巡查看板'), {
      public: true
    })
    api.registerRoute('GET', '/farm/audit', async () => tipPage('派单审核', '派单审核'), {
      public: true
    })
    api.registerRoute('GET', '/farm/submit', async () => tipPage('提交打印', '提交打印'), {
      public: true
    })

    api.registerRoute(
      'GET',
      '/api/v1/farm-dispatch/meta',
      async () => {
        return {
          ok: true,
          pages: {
            patrol: 'plugin:farm_dispatch:patrol',
            audit: 'plugin:farm_dispatch:audit',
            submit: 'plugin:farm_dispatch:submit',
            logs: 'plugin:farm_dispatch:logs'
          },
          perms: PERM,
          groups: GROUP_DEFS.map((g) => ({ id: g.id, name: g.name, description: g.description }))
        }
      },
      { public: true }
    )

    api.registerRoute('GET', '/api/v1/farm-dispatch/me', async (req) => {
      const user = authUser(req)
      if (!user) return httpJson(401, { ok: false, message: '请先登录' })
      // 禁止回调本机 /auth/me（同进程自请求会卡死）
      let roles
      try {
        roles = roleFlags(user, api)
      } catch (e) {
        roles = {
          patrol: false,
          audit: false,
          submit: false,
          logs: false,
          admin: isAdmin(user)
        }
        api.log('[farm_dispatch] roleFlags ' + (e && e.message))
      }
      const storage =
        api.db && api.db.available ? 'mysql' : 'file'
      return {
        ok: true,
        user: {
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          level: user.level,
          groupIds: user.groupIds || []
        },
        roles,
        storage
      }
    })

    api.registerRoute('POST', '/api/v1/farm-dispatch/ensure-groups', async (req) => {
      const user = authUser(req)
      if (!isAdmin(user)) return httpJson(403, { ok: false, message: '需要管理员' })
      const list = listGroups(api).map((g) => ({
        id: String(g.id),
        name: String(g.name || g.id),
        description: g.description,
        permissions: Array.isArray(g.permissions) ? g.permissions.map(String) : [],
        moduleAccess: Array.isArray(g.moduleAccess) ? g.moduleAccess : []
      }))
      let added = 0
      let updated = 0
      for (const g of GROUP_DEFS) {
        const i = list.findIndex((x) => String(x.id) === g.id)
        if (i < 0) {
          list.push({ ...g, moduleAccess: [] })
          added++
          continue
        }
        // 已存在：合并权限（补 logs 等），清空过严的 moduleAccess 白名单
        const prev = list[i]
        const set = new Set([...(prev.permissions || []), ...g.permissions])
        const nextPerms = Array.from(set)
        const samePerms =
          nextPerms.length === (prev.permissions || []).length &&
          nextPerms.every((p) => (prev.permissions || []).includes(p))
        const needClearAccess =
          Array.isArray(prev.moduleAccess) &&
          prev.moduleAccess.length > 0 &&
          prev.moduleAccess.every((m) => String(m.pluginId || '').toLowerCase() === 'farm_dispatch')
        if (!samePerms || needClearAccess) {
          list[i] = {
            ...prev,
            name: prev.name || g.name,
            description: prev.description || g.description,
            permissions: nextPerms,
            moduleAccess: needClearAccess ? [] : prev.moduleAccess || []
          }
          updated++
        }
      }
      let groups = list
      if (typeof api.saveUserGroups === 'function') {
        groups = api.saveUserGroups(list)
      } else {
        const p = path.join(dataRoot(api), 'user-groups.json')
        fs.mkdirSync(path.dirname(p), { recursive: true })
        fs.writeFileSync(p, JSON.stringify({ groups: list }, null, 2), 'utf8')
      }
      appendLog(api, {
        ...actorOf(user),
        action: 'ensure_groups',
        detail: { added, updated }
      })
      return { ok: true, added, updated, groups }
    })

    // —— 巡查 ——
    api.registerRoute('GET', '/api/v1/farm-dispatch/patrol/board', async (req) => {
      const user = authUser(req)
      const gate = requireRole(user, 'patrol', api)
      if (!gate.ok) return httpJson(gate.status, gate)
      const spools = readFilamentSpools(api)
      const devices = enrichDevices(api, spools)
      const board = {
        error: devices.filter((d) => d.board === 'error'),
        finished: devices.filter((d) => d.board === 'finished'),
        maintenance: devices.filter((d) => d.board === 'maintenance'),
        attention: devices.filter((d) => d.board === 'attention'),
        printing: devices.filter((d) => d.board === 'printing'),
        idle: devices.filter((d) => d.board === 'idle')
      }
      const notices = readArr(api, 'notifications.json', []).filter((n) => n.status === 'open')
      const waitingJobs = getJobs(api)
        .filter((j) => j && (j.status === 'waiting_material' || j.status === 'print_done' || j.status === 'print_error'))
        .map(({ contentBase64, ...rest }) => rest)
        .slice(0, 50)
      return {
        ok: true,
        board,
        notices,
        waitingJobs,
        devices,
        spools: spools
          .filter((s) => !s.archived)
          .map((s) => {
            const rolls = spoolRollsOf(s)
            const bound = spoolBindingsOf(s).length
            return {
              ...s,
              rolls,
              boundCount: bound,
              slotsLeft: Math.max(0, rolls - bound)
            }
          }),
        stats: jobStats(api)
      }
    })

    api.registerRoute('POST', '/api/v1/farm-dispatch/patrol/duty', async (req) => {
      const user = authUser(req)
      const gate = requireRole(user, 'patrol', api)
      if (!gate.ok) return httpJson(gate.status, gate)
      const body = (req && req.body) || {}
      const deviceId = String(body.deviceId || '').trim()
      const status = String(body.status || '').trim()
      const note = String(body.note || '').trim()
      if (!deviceId) return { ok: false, message: '缺少 deviceId' }
      if (status !== 'idle' && status !== 'maintenance') {
        return { ok: false, message: 'status 仅支持 idle / maintenance' }
      }
      const st = (api.getStatuses() || {})[deviceId] || {}
      const kind = attentionKind(st)
      const fp = kind
        ? kind + ':' + String(st.state || '') + ':' + String(st.filename || st.gcodeFile || '')
        : ''
      const patch = { status, note }
      if (status === 'idle') {
        patch.clearedAt = nowIso()
        patch.clearedFp = fp || getDuty(api, deviceId).attentionFp || ''
      }
      if (status === 'maintenance') {
        patch.clearedAt = null
        patch.clearedFp = ''
      }
      const duty = setDuty(api, deviceId, patch, user)
      let completed = 0
      if (status === 'idle') completed = completeJobsOnIdle(api, deviceId, user)
      appendLog(api, {
        ...actorOf(user),
        action: 'patrol_duty',
        detail: { deviceId, status, note, completed }
      })
      return { ok: true, duty, completed }
    })

    api.registerRoute('POST', '/api/v1/farm-dispatch/patrol/bind', async (req) => {
      const user = authUser(req)
      const gate = requireRole(user, 'patrol', api)
      if (!gate.ok) return httpJson(gate.status, gate)
      const body = (req && req.body) || {}
      const deviceId = String(body.deviceId || '').trim()
      const spoolId = String(body.spoolId || '').trim()
      const slotId = Math.floor(Number(body.slotId != null ? body.slotId : 0))
      if (!deviceId || !spoolId) return { ok: false, message: '需要 deviceId 与 spoolId' }
      const r = bindFilamentSpool(api, spoolId, deviceId, slotId, true)
      appendLog(api, {
        ...actorOf(user),
        action: 'patrol_bind',
        detail: { deviceId, spoolId, slotId, ok: r.ok, message: r.message }
      })
      if (!r.ok) return r
      return { ok: true, spool: r.spool }
    })

    api.registerRoute('POST', '/api/v1/farm-dispatch/patrol/unbind', async (req) => {
      const user = authUser(req)
      const gate = requireRole(user, 'patrol', api)
      if (!gate.ok) return httpJson(gate.status, gate)
      const body = (req && req.body) || {}
      const deviceId = String(body.deviceId || '').trim()
      const spoolId = String(body.spoolId || '').trim()
      const slotId = Math.floor(Number(body.slotId != null ? body.slotId : 0))
      if (!deviceId || !spoolId) return { ok: false, message: '需要 deviceId 与 spoolId' }
      const r = bindFilamentSpool(api, spoolId, deviceId, slotId, false)
      appendLog(api, {
        ...actorOf(user),
        action: 'patrol_unbind',
        detail: { deviceId, spoolId, slotId }
      })
      return { ok: r.ok !== false, spool: r.spool, message: r.message }
    })

    api.registerRoute('POST', '/api/v1/farm-dispatch/patrol/notice-done', async (req) => {
      const user = authUser(req)
      const gate = requireRole(user, 'patrol', api)
      if (!gate.ok) return httpJson(gate.status, gate)
      const body = (req && req.body) || {}
      const noticeId = String(body.noticeId || '').trim()
      const jobId = String(body.jobId || '').trim()
      const list = readArr(api, 'notifications.json', [])
      let notice = null
      for (const n of list) {
        if (noticeId && String(n.id) === noticeId) {
          n.status = 'done'
          n.doneAt = nowIso()
          n.doneBy = actorOf(user).actorName
          notice = n
        }
      }
      api.writeJson('notifications.json', list)
      appendLog(api, {
        ...actorOf(user),
        action: 'patrol_notice_done',
        detail: { noticeId, jobId: jobId || (notice && notice.jobId) }
      })

      const jid = jobId || (notice && notice.jobId)
      if (jid) {
        const job = getJobs(api).find((j) => String(j.id) === String(jid))
        if (job && (job.status === 'waiting_material' || job.status === 'approved' || job.status === 'failed' || job.status === 'print_error')) {
          const r = await withDispatchLock(job.id, () => dispatchJob(api, req, job, user))
          if (r && r.busy) return { ok: true, notice, dispatch: r }
          const jobs = getJobs(api)
          const i = jobs.findIndex((x) => String(x.id) === String(job.id))
          if (i >= 0) {
            jobs[i] = r.job || job
            saveJobs(api, jobs)
          }
          return { ok: true, notice, dispatch: r }
        }
      }
      return { ok: true, notice }
    })

    // —— 提交申请 ——
    api.registerRoute('POST', '/api/v1/farm-dispatch/jobs', async (req) => {
      const user = authUser(req)
      const gate = requireRole(user, 'submit', api)
      if (!gate.ok) return httpJson(gate.status, gate)
      const body = (req && req.body) || {}
      const model = String(body.model || '').trim()
      const material = String(body.material || '').trim()
      const color = String(body.color || '').trim()
      const colorHex = String(body.colorHex || '').trim()
      const filename = String(body.filename || '').trim() || 'job.gcode'
      const contentBase64 = typeof body.contentBase64 === 'string' ? body.contentBase64 : ''
      const note = String(body.note || '').trim()
      if (!model || !material || !(color || colorHex)) {
        return { ok: false, message: '请填写机型、材料、颜色' }
      }
      if (!contentBase64) return { ok: false, message: '请上传打印文件' }
      const maxMb = Math.max(1, numVar(api, 'max_file_mb', 80))
      const bytes = Buffer.from(contentBase64, 'base64')
      if (bytes.length > maxMb * 1024 * 1024) {
        return { ok: false, message: '文件过大，上限 ' + maxMb + 'MB' }
      }
      const mediaRel = 'jobs/' + newId() + '_' + filename.replace(/[^\w.\-]+/g, '_')
      const up = api.writeMedia(mediaRel, contentBase64, { encoding: 'base64' })
      if (!up || !up.ok) {
        return { ok: false, message: (up && up.message) || '保存文件失败' }
      }
      const job = {
        id: newId(),
        status: 'pending_audit',
        model,
        material,
        color,
        colorHex,
        filename,
        mediaRel,
        note,
        applicantId: String(user.id),
        applicantName: String(user.displayName || user.username || user.id),
        reviewerId: '',
        reviewerName: '',
        rejectReason: '',
        deviceId: '',
        deviceName: '',
        waitReason: '',
        failReason: '',
        createdAt: nowIso(),
        updatedAt: nowIso()
      }
      const jobs = getJobs(api)
      jobs.unshift(job)
      saveJobs(api, jobs)
      appendLog(api, {
        ...actorOf(user),
        action: 'job_submit',
        detail: { jobId: job.id, model, material, color, filename }
      })
      return { ok: true, job: { ...job, contentBase64: undefined } }
    })

    api.registerRoute('GET', '/api/v1/farm-dispatch/jobs', async (req) => {
      const user = authUser(req)
      if (!user) return httpJson(401, { ok: false, message: '请先登录' })
      const q = (req && req.query) || {}
      let rows = getJobs(api).map((j) => {
        const { contentBase64, ...rest } = j
        return rest
      })
      const status = String(q.status || '').trim()
      const mine = q.mine === '1' || q.mine === 'true'
      if (status) rows = rows.filter((j) => String(j.status) === status)
      const roles = roleFlags(user, api)
      if (mine || !roles.audit) {
        rows = rows.filter((j) => String(j.applicantId) === String(user.id))
      }
      const limit = Math.max(1, Math.min(500, Number(q.limit) || 100))
      return { ok: true, total: rows.length, jobs: rows.slice(0, limit) }
    })

    api.registerRoute('GET', '/api/v1/farm-dispatch/job', async (req) => {
      const user = authUser(req)
      if (!user) return httpJson(401, { ok: false, message: '请先登录' })
      const jobId = String((req.query && req.query.id) || '').trim()
      const job = getJobs(api).find((j) => String(j.id) === jobId)
      if (!job) return httpJson(404, { ok: false, message: '任务不存在' })
      const roles = roleFlags(user, api)
      if (String(job.applicantId) !== String(user.id) && !roles.audit) {
        return httpJson(403, { ok: false, message: '无权查看' })
      }
      const { contentBase64, ...rest } = job
      return { ok: true, job: rest }
    })

    api.registerRoute('POST', '/api/v1/farm-dispatch/job/approve', async (req) => {
      const user = authUser(req)
      const gate = requireRole(user, 'audit', api)
      if (!gate.ok) return httpJson(gate.status, gate)
      const body = (req && req.body) || {}
      const jobId = String(body.id || body.jobId || '').trim()
      const jobs0 = getJobs(api)
      const job = jobs0.find((j) => String(j.id) === jobId)
      if (!job) return httpJson(404, { ok: false, message: '任务不存在' })
      if (job.status !== 'pending_audit') {
        return { ok: false, message: '当前状态不可审核：' + job.status }
      }
      job.status = 'approved'
      job.reviewerId = String(user.id)
      job.reviewerName = String(user.displayName || user.username || user.id)
      job.reviewedAt = nowIso()
      job.rejectReason = ''
      job.updatedAt = nowIso()
      // 先落盘 approved，避免派单中途崩溃仍停在 pending，或并发重复审核
      saveJobs(api, jobs0)
      appendLog(api, {
        ...actorOf(user),
        action: 'job_approve',
        detail: { jobId: job.id }
      })
      const r = await withDispatchLock(job.id, () =>
        dispatchJob(api, req, job, user, {
          preferredDeviceId: String(body.deviceId || body.preferredDeviceId || '').trim()
        })
      )
      if (r && r.busy) {
        return { ok: true, dispatch: r, job: { ...job, contentBase64: undefined }, message: r.message }
      }
      const jobs = getJobs(api)
      const i = jobs.findIndex((x) => String(x.id) === String(job.id))
      if (i >= 0) {
        jobs[i] = r.job || job
        saveJobs(api, jobs)
      }
      return { ok: true, dispatch: r, job: { ...(r.job || job), contentBase64: undefined } }
    })

    api.registerRoute('POST', '/api/v1/farm-dispatch/job/reject', async (req) => {
      const user = authUser(req)
      const gate = requireRole(user, 'audit', api)
      if (!gate.ok) return httpJson(gate.status, gate)
      const body = (req && req.body) || {}
      const reason = String(body.reason || '').trim()
      if (!reason) return { ok: false, message: '驳回必须填写原因' }
      const jobId = String(body.id || body.jobId || '').trim()
      const cur = getJobs(api).find((j) => String(j.id) === jobId)
      if (!cur) return httpJson(404, { ok: false, message: '任务不存在' })
      if (cur.status !== 'pending_audit') {
        return { ok: false, message: '仅待审核任务可驳回，当前：' + cur.status }
      }
      const job = updateJob(api, jobId, {
        status: 'rejected',
        rejectReason: reason,
        reviewerId: String(user.id),
        reviewerName: String(user.displayName || user.username || user.id),
        reviewedAt: nowIso()
      })
      if (!job) return httpJson(404, { ok: false, message: '任务不存在' })
      appendLog(api, {
        ...actorOf(user),
        action: 'job_reject',
        detail: { jobId, reason }
      })
      return { ok: true, job }
    })

    api.registerRoute('POST', '/api/v1/farm-dispatch/job/redispatch', async (req) => {
      const user = authUser(req)
      const roles = roleFlags(user, api)
      if (!roles.audit && !roles.patrol) {
        return httpJson(403, { ok: false, message: '无权限' })
      }
      const body = (req && req.body) || {}
      const jobId = String(body.id || body.jobId || '').trim()
      const job = getJobs(api).find((j) => String(j.id) === jobId)
      if (!job) return httpJson(404, { ok: false, message: '任务不存在' })
      if (!['waiting_material', 'approved', 'failed', 'print_error'].includes(job.status)) {
        return { ok: false, message: '当前状态不可重新派单：' + job.status }
      }
      const r = await withDispatchLock(job.id, () =>
        dispatchJob(api, req, job, user, {
          preferredDeviceId: String(body.deviceId || body.preferredDeviceId || '').trim(),
          requirePreferred: !!(body.deviceId || body.preferredDeviceId) && !!body.requirePreferred
        })
      )
      if (r && r.busy) {
        return { ok: false, message: r.message, dispatch: r }
      }
      const jobs = getJobs(api)
      const i = jobs.findIndex((x) => String(x.id) === String(job.id))
      if (i >= 0) {
        jobs[i] = r.job || job
        saveJobs(api, jobs)
      }
      return { ok: true, dispatch: r, job: { ...(r.job || job), contentBase64: undefined } }
    })

    api.registerRoute('POST', '/api/v1/farm-dispatch/job/cancel', async (req) => {
      const user = authUser(req)
      if (!user) return httpJson(401, { ok: false, message: '请先登录' })
      const body = (req && req.body) || {}
      const jobId = String(body.id || body.jobId || '').trim()
      const reason = String(body.reason || '').trim()
      const job = getJobs(api).find((j) => String(j.id) === jobId)
      if (!job) return httpJson(404, { ok: false, message: '任务不存在' })
      const roles = roleFlags(user, api)
      const mine = String(job.applicantId) === String(user.id)
      if (!roles.audit && !(mine && job.status === 'pending_audit')) {
        return httpJson(403, { ok: false, message: '无权限取消' })
      }
      const cancellable = [
        'pending_audit',
        'approved',
        'waiting_material',
        'failed',
        'print_error'
      ]
      if (!cancellable.includes(job.status)) {
        return { ok: false, message: '当前状态不可取消：' + job.status }
      }
      const next = updateJob(api, jobId, {
        status: 'cancelled',
        cancelReason: reason || '已取消',
        cancelledBy: actorOf(user).actorName,
        cancelledAt: nowIso()
      })
      closeNoticesForJob(api, jobId, actorOf(user).actorName)
      appendLog(api, {
        ...actorOf(user),
        action: 'job_cancel',
        detail: { jobId, reason: reason || '' }
      })
      return { ok: true, job: next }
    })

    api.registerRoute('GET', '/api/v1/farm-dispatch/job/candidates', async (req) => {
      const user = authUser(req)
      const gate = requireRole(user, 'audit', api)
      if (!gate.ok) return httpJson(gate.status, gate)
      const jobId = String((req.query && (req.query.id || req.query.jobId)) || '').trim()
      const job = getJobs(api).find((j) => String(j.id) === jobId)
      if (!job) return httpJson(404, { ok: false, message: '任务不存在' })
      const spools = readFilamentSpools(api)
      const candidates = findCandidates(api, job, spools).map((c) => ({
        id: c.id,
        name: c.name,
        model: c.model,
        remain: c.remain
      }))
      const diagnose = candidates.length ? '' : diagnoseNoMatch(api, job, spools)
      return { ok: true, candidates, diagnose, count: candidates.length }
    })

    api.registerRoute('GET', '/api/v1/farm-dispatch/stats', async (req) => {
      const user = authUser(req)
      if (!user) return httpJson(401, { ok: false, message: '请先登录' })
      const roles = roleFlags(user, api)
      if (!roles.audit && !roles.patrol && !roles.admin) {
        return httpJson(403, { ok: false, message: '无权限' })
      }
      return { ok: true, stats: jobStats(api) }
    })

    api.registerRoute('GET', '/api/v1/farm-dispatch/logs', async (req) => {
      const user = authUser(req)
      const gate = requireRole(user, 'logs', api)
      if (!gate.ok) return httpJson(gate.status || 403, gate)
      const q = (req && req.query) || {}
      let rows = readArr(api, 'audit_log.json', [])
      const action = String(q.action || '').trim()
      if (action) rows = rows.filter((r) => String(r.action) === action)
      const limit = Math.max(1, Math.min(1000, Number(q.limit) || 200))
      return { ok: true, total: rows.length, logs: rows.slice(0, limit) }
    })

    api.registerRoute('GET', '/api/v1/farm-dispatch/models', async (req) => {
      const user = authUser(req)
      if (!user) return httpJson(401, { ok: false, message: '请先登录' })
      const set = new Set()
      for (const d of api.getDevices() || []) {
        const m = String(d.model || '').trim()
        if (m) set.add(m)
      }
      return { ok: true, models: Array.from(set).sort() }
    })

    api.registerRoute('GET', '/api/v1/farm-dispatch/catalog', async (req) => {
      const user = authUser(req)
      if (!user) return httpJson(401, { ok: false, message: '请先登录' })
      const spools = readFilamentSpools(api).filter((s) => s && !s.archived)
      const materials = new Set()
      const colors = []
      const seenColor = new Set()
      for (const s of spools) {
        const mat = String(s.material || '').trim()
        if (mat) materials.add(mat)
        const name = String(s.color || '').trim()
        const hex = String(s.colorHex || '').trim()
        const key = norm(name) + '|' + normColor(hex)
        if (!name && !hex) continue
        if (seenColor.has(key)) continue
        seenColor.add(key)
        colors.push({ color: name, colorHex: hex, material: mat })
      }
      return {
        ok: true,
        materials: Array.from(materials).sort(),
        colors
      }
    })

    api.log('[farm_dispatch] routes ready — /farm/patrol /farm/audit /farm/submit')
  },

  async ui_assets(api, assets) {
    return assets && typeof assets === 'object' ? assets : {}
  },

  async permissions_catalog(api, list) {
    const rows = Array.isArray(list) ? list.slice() : []
    const add = (code, label, description) => {
      if (!rows.some((r) => r && r.code === code)) {
        rows.push({ code, label, plugin: 'farm_dispatch', description })
      }
    }
    add(PERM.patrol, '巡查岗', '手机巡查页：空闲/维修/绑耗材')
    add(PERM.audit, '审核岗', 'PC 审核派单申请')
    add(PERM.submit, '派单申请', '提交打印文件申请')
    add(PERM.logs, '派单日志', '查看操作审计日志')
    return rows
  },

  async control_before(api, payload) {
    try {
      if (!payload || payload.proceed === false) return payload
      if (!boolVar(api, 'block_unavailable', true)) return payload
      const action = String((payload.payload && payload.payload.action) || '')
      if (action !== 'print_file') return payload
      const deviceId = String(payload.deviceId || '')
      if (takeAllowOnce(api, deviceId)) {
        return payload
      }
      const spools = readFilamentSpools(api)
      const gate = canAcceptPrint(api, deviceId, spools)
      if (!gate.ok) {
        appendLog(api, {
          actorId: '',
          actorName: '拦截器',
          action: 'block_print',
          detail: { deviceId, message: gate.message }
        })
        return {
          proceed: false,
          status: 403,
          message: gate.message,
          body: { ok: false, message: gate.message }
        }
      }
    } catch (e) {
      api.log('[farm_dispatch] control_before ' + (e && e.message))
    }
    return payload
  },

  async print_batch_before(api, payload) {
    if (!payload || payload.proceed === false) return payload
    if (!boolVar(api, 'block_unavailable', true)) return payload
    const ids = Array.isArray(payload.deviceIds) ? payload.deviceIds : []
    const spools = readFilamentSpools(api)
    for (const id of ids) {
      const deviceId = String(id)
      if (takeAllowOnce(api, deviceId)) continue
      const gate = canAcceptPrint(api, deviceId, spools)
      if (!gate.ok) {
        return {
          proceed: false,
          status: 403,
          body: { ok: false, message: gate.message + '（设备 ' + id + '）' }
        }
      }
    }
    return payload
  },

  async print_start(api, payload) {
    return payload
  },

  async print_request_create(api, payload) {
    if (!payload || payload.proceed === false) return payload
    if (!boolVar(api, 'require_filament', true) && !boolVar(api, 'block_unavailable', true)) {
      return payload
    }
    if (!boolVar(api, 'block_unavailable', true)) return payload
    const body = payload.body && typeof payload.body === 'object' ? payload.body : {}
    const deviceId = String(body.deviceId || '')
    if (!deviceId) return payload
    const spools = readFilamentSpools(api)
    const gate = canAcceptPrint(api, deviceId, spools)
    if (!gate.ok) {
      return {
        proceed: false,
        status: 403,
        message: gate.message,
        body: { ok: false, message: gate.message }
      }
    }
    return payload
  },

  async statuses_publish(api, statuses) {
    try {
      const map = statuses && typeof statuses === 'object' ? statuses : {}
      // 立刻返回，副作用合并延后执行，避免启用后状态风暴卡死宿主
      queueStatusSideEffects(api, map)
    } catch (e) {
      try {
        api.log('[farm_dispatch] statuses_publish ' + (e && e.message))
      } catch (_) {}
    }
    return statuses
  }
}

/** 巡查板拉取时刷新耗材缓存，供开打拦截使用 */
module.exports._cacheSpools = cacheSpools
