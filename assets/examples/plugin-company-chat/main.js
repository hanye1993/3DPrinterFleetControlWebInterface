/**
 * company_chat — 公司聊天（聊天室 + 私聊 + 文件 + 在线名单 + 可清理历史）
 * 宿主无 listUsers / presence API → 插件自建心跳在线；消息优先 MySQL，否则 JSON。
 * 文件：JSON+Base64 上传到 api.dataDir/files（插件路由只解析 JSON body）。
 */
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const ONLINE_TTL_MS = 90_000
const presence = new Map() // userId -> { userId, username, displayName, level, lastSeenAt }

function boolVar(api, key, def) {
  const v = api.getVar(key, def ? '1' : '0')
  return v === '1' || v === true || v === 'true'
}

function numVar(api, key, def) {
  const n = Number(api.getVar(key, String(def)))
  return Number.isFinite(n) ? n : def
}

function dmPolicy(api) {
  const p = String(api.getVar('dm_policy', 'all') || 'all')
    .trim()
    .toLowerCase()
  return p === 'admin_only' || p === 'admin' ? 'admin_only' : 'all'
}

function httpJson(status, json) {
  return { __pluginHttp: { status: status || 200, json } }
}

function authUser(ctx) {
  const a = ctx && ctx.auth
  if (a && a.kind === 'user' && a.user && a.user.id) return a.user
  return null
}

function isAdmin(user) {
  return user && String(user.level || '') === 'admin'
}

function nowIso() {
  return new Date().toISOString()
}

function newId() {
  return crypto.randomBytes(12).toString('hex')
}

function threadId(a, b) {
  const x = String(a)
  const y = String(b)
  return x < y ? x + ':' + y : y + ':' + x
}

function prunePresence() {
  const cut = Date.now() - ONLINE_TTL_MS
  for (const [id, row] of presence.entries()) {
    const t = Date.parse(row.lastSeenAt || '')
    if (!Number.isFinite(t) || t < cut) presence.delete(id)
  }
}

function touchPresence(user) {
  if (!user || !user.id) return
  presence.set(String(user.id), {
    userId: String(user.id),
    username: String(user.username || ''),
    displayName: String(user.displayName || user.username || ''),
    level: String(user.level || 'viewer'),
    lastSeenAt: nowIso()
  })
}

function listOnline() {
  prunePresence()
  return Array.from(presence.values()).sort((a, b) =>
    String(a.displayName || a.username).localeCompare(String(b.displayName || b.username), 'zh-CN')
  )
}

function loadRoster(api) {
  const raw = api.readJson('roster.json', null)
  return raw && typeof raw === 'object' ? raw : {}
}

function saveRoster(api, roster) {
  api.writeJson('roster.json', roster)
}

function upsertRoster(api, user) {
  if (!user || !user.id) return
  const roster = loadRoster(api)
  roster[String(user.id)] = {
    userId: String(user.id),
    username: String(user.username || ''),
    displayName: String(user.displayName || user.username || ''),
    level: String(user.level || 'viewer'),
    lastSeenAt: nowIso()
  }
  saveRoster(api, roster)
}

function publicConfig(api) {
  return {
    dmPolicy: dmPolicy(api),
    retainDays: Math.max(1, Math.min(3650, numVar(api, 'retain_days', 30))),
    cleanupEnabled: boolVar(api, 'cleanup_enabled', true),
    panelDefaultOpen: boolVar(api, 'panel_default_open', false),
    pollSec: Math.max(2, Math.min(30, numVar(api, 'poll_sec', 3))),
    maxLen: Math.max(50, Math.min(8000, numVar(api, 'max_len', 2000))),
    allowFile: boolVar(api, 'allow_file', true),
    maxFileMb: Math.max(1, Math.min(50, numVar(api, 'max_file_mb', 10))),
    db: Boolean(api.db && api.db.available)
  }
}

function filesDir(api) {
  const dir = path.join(api.dataDir, 'files')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function loadFilesMeta(api) {
  const raw = api.readJson('files_meta.json', null)
  return raw && typeof raw === 'object' ? raw : {}
}

function saveFilesMeta(api, meta) {
  api.writeJson('files_meta.json', meta)
}

function getFileMeta(api, fileId) {
  const meta = loadFilesMeta(api)
  return meta[String(fileId)] || null
}

function safeFileName(name) {
  return String(name || 'file')
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
    .slice(0, 180)
}

function encodeFileContent(meta, caption) {
  return JSON.stringify({
    v: 1,
    kind: 'file',
    fileId: meta.id,
    name: meta.name,
    mime: meta.mime,
    size: meta.size,
    caption: String(caption || '').trim()
  })
}

function enrichMessage(msg) {
  const content = String(msg.content || '')
  let parsed = null
  try {
    const o = JSON.parse(content)
    if (o && o.v === 1 && o.kind === 'file' && o.fileId) parsed = o
  } catch (_) {}
  if (!parsed) {
    return Object.assign({}, msg, { msgType: 'text', text: content, file: null })
  }
  return Object.assign({}, msg, {
    msgType: 'file',
    text: parsed.caption || '',
    content: parsed.caption || ('[文件] ' + (parsed.name || '')),
    file: {
      id: String(parsed.fileId),
      name: String(parsed.name || 'file'),
      mime: String(parsed.mime || 'application/octet-stream'),
      size: Number(parsed.size) || 0,
      url: '/api/v1/company-chat/file/' + encodeURIComponent(String(parsed.fileId))
    }
  })
}

function saveUploadedFile(api, user, payload) {
  if (!boolVar(api, 'allow_file', true)) throw new Error('未开启文件发送')
  const name = safeFileName(payload.name || 'file')
  const mime = String(payload.mime || 'application/octet-stream').slice(0, 120)
  let b64 = String(payload.dataBase64 || payload.data || '')
  const comma = b64.indexOf(',')
  if (b64.startsWith('data:') && comma >= 0) b64 = b64.slice(comma + 1)
  b64 = b64.replace(/\s/g, '')
  if (!b64) throw new Error('缺少文件数据')
  let buf
  try {
    buf = Buffer.from(b64, 'base64')
  } catch (_) {
    throw new Error('文件数据无效')
  }
  const maxBytes = publicConfig(api).maxFileMb * 1024 * 1024
  if (!buf.length) throw new Error('文件为空')
  if (buf.length > maxBytes) {
    throw new Error('文件过大（最大 ' + publicConfig(api).maxFileMb + ' MB）')
  }
  const id = newId()
  const dir = filesDir(api)
  const disk = path.join(dir, id + '.bin')
  fs.writeFileSync(disk, buf)
  const meta = {
    id,
    name,
    mime,
    size: buf.length,
    userId: String(user.id),
    createdAt: nowIso()
  }
  const all = loadFilesMeta(api)
  all[id] = meta
  saveFilesMeta(api, all)
  return meta
}

function deleteFileById(api, fileId) {
  const all = loadFilesMeta(api)
  const id = String(fileId || '')
  if (!all[id]) return false
  try {
    fs.unlinkSync(path.join(filesDir(api), id + '.bin'))
  } catch (_) {}
  delete all[id]
  saveFilesMeta(api, all)
  return true
}

function extractFileIdFromContent(content) {
  try {
    const o = JSON.parse(String(content || ''))
    if (o && o.v === 1 && o.kind === 'file' && o.fileId) return String(o.fileId)
  } catch (_) {}
  return null
}

async function ensureTables(api) {
  if (!api.db || !api.db.available) return false
  await api.db.ensureTable(
    'room_msg',
    'id VARCHAR(32) PRIMARY KEY, user_id CHAR(36) NOT NULL, username VARCHAR(128) NOT NULL, display_name VARCHAR(128) NOT NULL, content TEXT NOT NULL, created_at DATETIME(3) NOT NULL, INDEX idx_room_created (created_at)'
  )
  await api.db.ensureTable(
    'dm_msg',
    'id VARCHAR(32) PRIMARY KEY, thread_id VARCHAR(80) NOT NULL, from_id CHAR(36) NOT NULL, to_id CHAR(36) NOT NULL, content TEXT NOT NULL, created_at DATETIME(3) NOT NULL, INDEX idx_dm_thread (thread_id, created_at), INDEX idx_dm_created (created_at)'
  )
  return true
}

function loadJsonMessages(api, file) {
  const raw = api.readJson(file, null)
  return Array.isArray(raw) ? raw : []
}

function saveJsonMessages(api, file, rows) {
  api.writeJson(file, rows)
}

function normalizeRoom(row) {
  return enrichMessage({
    id: String(row.id),
    userId: String(row.user_id || row.userId),
    username: String(row.username || ''),
    displayName: String(row.display_name || row.displayName || row.username || ''),
    content: String(row.content || ''),
    createdAt: row.created_at
      ? new Date(row.created_at).toISOString()
      : String(row.createdAt || '')
  })
}

function normalizeDm(row) {
  return enrichMessage({
    id: String(row.id),
    threadId: String(row.thread_id || row.threadId || ''),
    fromId: String(row.from_id || row.fromId),
    toId: String(row.to_id || row.toId),
    content: String(row.content || ''),
    createdAt: row.created_at
      ? new Date(row.created_at).toISOString()
      : String(row.createdAt || '')
  })
}

async function addRoomMessage(api, user, content) {
  const id = newId()
  const createdAt = nowIso()
  const row = {
    id,
    userId: String(user.id),
    username: String(user.username || ''),
    displayName: String(user.displayName || user.username || ''),
    content,
    createdAt
  }
  if (api.db && api.db.available) {
    await ensureTables(api)
    await api.db.insert('room_msg', {
      id,
      user_id: row.userId,
      username: row.username,
      display_name: row.displayName,
      content,
      created_at: new Date(createdAt)
    })
  } else {
    const list = loadJsonMessages(api, 'room_messages.json')
    list.push(row)
    if (list.length > 20000) list.splice(0, list.length - 20000)
    saveJsonMessages(api, 'room_messages.json', list)
  }
  return enrichMessage(row)
}

async function listRoomMessages(api, opts) {
  const after = opts.after || ''
  const limit = Math.max(1, Math.min(200, Number(opts.limit) || 50))
  if (api.db && api.db.available) {
    await ensureTables(api)
    let rows
    if (after) {
      rows = await api.db.query(
        'SELECT * FROM `' +
          api.db.table('room_msg') +
          '` WHERE created_at > ? ORDER BY created_at ASC LIMIT ?',
        [new Date(after), limit]
      )
    } else {
      rows = await api.db.query(
        'SELECT * FROM `' +
          api.db.table('room_msg') +
          '` ORDER BY created_at DESC LIMIT ?',
        [limit]
      )
      rows = (rows || []).slice().reverse()
    }
    return (rows || []).map(normalizeRoom)
  }
  let list = loadJsonMessages(api, 'room_messages.json')
  if (after) {
    const t = Date.parse(after)
    list = list.filter((m) => Date.parse(m.createdAt) > t)
    return list.slice(-limit).map(enrichMessage)
  }
  return list.slice(-limit).map(enrichMessage)
}

async function addDmMessage(api, fromUser, toId, content) {
  const id = newId()
  const createdAt = nowIso()
  const tid = threadId(fromUser.id, toId)
  const row = {
    id,
    threadId: tid,
    fromId: String(fromUser.id),
    toId: String(toId),
    content,
    createdAt
  }
  if (api.db && api.db.available) {
    await ensureTables(api)
    await api.db.insert('dm_msg', {
      id,
      thread_id: tid,
      from_id: row.fromId,
      to_id: row.toId,
      content,
      created_at: new Date(createdAt)
    })
  } else {
    const list = loadJsonMessages(api, 'dm_messages.json')
    list.push(row)
    if (list.length > 50000) list.splice(0, list.length - 50000)
    saveJsonMessages(api, 'dm_messages.json', list)
  }
  return enrichMessage(row)
}

async function listDmMessages(api, userId, peerId, opts) {
  const tid = threadId(userId, peerId)
  const after = opts.after || ''
  const limit = Math.max(1, Math.min(200, Number(opts.limit) || 50))
  if (api.db && api.db.available) {
    await ensureTables(api)
    let rows
    if (after) {
      rows = await api.db.query(
        'SELECT * FROM `' +
          api.db.table('dm_msg') +
          '` WHERE thread_id = ? AND created_at > ? ORDER BY created_at ASC LIMIT ?',
        [tid, new Date(after), limit]
      )
    } else {
      rows = await api.db.query(
        'SELECT * FROM `' +
          api.db.table('dm_msg') +
          '` WHERE thread_id = ? ORDER BY created_at DESC LIMIT ?',
        [tid, limit]
      )
      rows = (rows || []).slice().reverse()
    }
    return (rows || []).map(normalizeDm)
  }
  let list = loadJsonMessages(api, 'dm_messages.json').filter((m) => m.threadId === tid)
  if (after) {
    const t = Date.parse(after)
    list = list.filter((m) => Date.parse(m.createdAt) > t)
    return list.slice(-limit).map(enrichMessage)
  }
  return list.slice(-limit).map(enrichMessage)
}

async function listDmThreads(api, userId) {
  const uid = String(userId)
  if (api.db && api.db.available) {
    await ensureTables(api)
    const rows = await api.db.query(
      'SELECT * FROM `' +
        api.db.table('dm_msg') +
        '` WHERE from_id = ? OR to_id = ? ORDER BY created_at DESC LIMIT 500',
      [uid, uid]
    )
    const map = {}
    for (const r of rows || []) {
      const m = normalizeDm(r)
      const peer = m.fromId === uid ? m.toId : m.fromId
      if (!map[peer]) {
        map[peer] = { peerId: peer, lastMessage: m, unreadHint: 0 }
      }
    }
    return Object.values(map)
  }
  const list = loadJsonMessages(api, 'dm_messages.json').filter(
    (m) => m.fromId === uid || m.toId === uid
  )
  const map = {}
  for (let i = list.length - 1; i >= 0; i--) {
    const m = enrichMessage(list[i])
    const peer = m.fromId === uid ? m.toId : m.fromId
    if (!map[peer]) map[peer] = { peerId: peer, lastMessage: m, unreadHint: 0 }
  }
  return Object.values(map)
}

async function searchMessages(api, opts) {
  const q = String(opts.q || '')
    .trim()
    .toLowerCase()
  const type = String(opts.type || 'all')
  const limit = Math.max(1, Math.min(200, Number(opts.limit) || 50))
  const out = []
  if (type === 'all' || type === 'room') {
    let room
    if (api.db && api.db.available) {
      await ensureTables(api)
      if (q) {
        room = await api.db.query(
          'SELECT * FROM `' +
            api.db.table('room_msg') +
            '` WHERE LOWER(content) LIKE ? ORDER BY created_at DESC LIMIT ?',
          ['%' + q + '%', limit]
        )
      } else {
        room = await api.db.query(
          'SELECT * FROM `' +
            api.db.table('room_msg') +
            '` ORDER BY created_at DESC LIMIT ?',
          [limit]
        )
      }
      out.push(...(room || []).map((r) => ({ kind: 'room', ...normalizeRoom(r) })))
    } else {
      room = loadJsonMessages(api, 'room_messages.json')
        .filter((m) => {
          if (!q) return true
          const e = enrichMessage(m)
          return (
            String(e.content || '').toLowerCase().includes(q) ||
            String((e.file && e.file.name) || '').toLowerCase().includes(q)
          )
        })
        .slice(-limit)
        .reverse()
      out.push(...room.map((r) => ({ kind: 'room', ...enrichMessage(r) })))
    }
  }
  if (type === 'all' || type === 'dm') {
    let dm
    if (api.db && api.db.available) {
      await ensureTables(api)
      if (q) {
        dm = await api.db.query(
          'SELECT * FROM `' +
            api.db.table('dm_msg') +
            '` WHERE LOWER(content) LIKE ? ORDER BY created_at DESC LIMIT ?',
          ['%' + q + '%', limit]
        )
      } else {
        dm = await api.db.query(
          'SELECT * FROM `' +
            api.db.table('dm_msg') +
            '` ORDER BY created_at DESC LIMIT ?',
          [limit]
        )
      }
      out.push(...(dm || []).map((r) => ({ kind: 'dm', ...normalizeDm(r) })))
    } else {
      dm = loadJsonMessages(api, 'dm_messages.json')
        .filter((m) => {
          if (!q) return true
          const e = enrichMessage(m)
          return (
            String(e.content || '').toLowerCase().includes(q) ||
            String((e.file && e.file.name) || '').toLowerCase().includes(q)
          )
        })
        .slice(-limit)
        .reverse()
      out.push(...dm.map((r) => ({ kind: 'dm', ...enrichMessage(r) })))
    }
  }
  out.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
  return out.slice(0, limit)
}

async function cleanupOld(api) {
  if (!boolVar(api, 'cleanup_enabled', true)) {
    return { ok: true, skipped: true, reason: 'disabled' }
  }
  const days = Math.max(1, Math.min(3650, numVar(api, 'retain_days', 30)))
  const cutoff = new Date(Date.now() - days * 86400000)
  let roomDeleted = 0
  let dmDeleted = 0
  if (api.db && api.db.available) {
    await ensureTables(api)
    const r1 = await api.db.execute(
      'DELETE FROM `' + api.db.table('room_msg') + '` WHERE created_at < ?',
      [cutoff]
    )
    const r2 = await api.db.execute(
      'DELETE FROM `' + api.db.table('dm_msg') + '` WHERE created_at < ?',
      [cutoff]
    )
    roomDeleted = r1.affectedRows || 0
    dmDeleted = r2.affectedRows || 0
  } else {
    const cutMs = cutoff.getTime()
    const room = loadJsonMessages(api, 'room_messages.json')
    const roomGone = room.filter((m) => Date.parse(m.createdAt) < cutMs)
    const roomNext = room.filter((m) => Date.parse(m.createdAt) >= cutMs)
    roomDeleted = room.length - roomNext.length
    saveJsonMessages(api, 'room_messages.json', roomNext)
    const dm = loadJsonMessages(api, 'dm_messages.json')
    const dmGone = dm.filter((m) => Date.parse(m.createdAt) < cutMs)
    const dmNext = dm.filter((m) => Date.parse(m.createdAt) >= cutMs)
    dmDeleted = dm.length - dmNext.length
    saveJsonMessages(api, 'dm_messages.json', dmNext)
    for (const m of roomGone.concat(dmGone)) {
      const fid = extractFileIdFromContent(m.content)
      if (fid) deleteFileById(api, fid)
    }
  }
  // prune orphaned / expired file blobs by meta time
  let filesDeleted = 0
  const cutMs2 = cutoff.getTime()
  const allFiles = loadFilesMeta(api)
  for (const id of Object.keys(allFiles)) {
    const meta = allFiles[id]
    const t = Date.parse(meta && meta.createdAt)
    if (Number.isFinite(t) && t < cutMs2) {
      if (deleteFileById(api, id)) filesDeleted += 1
    }
  }
  const result = {
    ok: true,
    retainDays: days,
    cutoff: cutoff.toISOString(),
    roomDeleted,
    dmDeleted,
    filesDeleted,
    at: nowIso()
  }
  api.writeJson('last_cleanup.json', result)
  api.log('cleanup', result)
  return result
}

function resolveOutgoingContent(api, body) {
  const cfg = publicConfig(api)
  const fileId = String((body && body.fileId) || '').trim()
  if (fileId) {
    const meta = getFileMeta(api, fileId)
    if (!meta) throw new Error('文件不存在或已过期')
    const caption = String((body && (body.caption || body.content)) || '').trim()
    if (caption.length > cfg.maxLen) throw new Error('说明过长（最多 ' + cfg.maxLen + ' 字）')
    return encodeFileContent(meta, caption)
  }
  const content = String((body && body.content) || '').trim()
  if (!content) throw new Error('消息不能为空')
  if (content.length > cfg.maxLen) throw new Error('消息过长（最多 ' + cfg.maxLen + ' 字）')
  return content
}

function canStartDm(api, user) {
  if (dmPolicy(api) === 'all') return true
  return isAdmin(user)
}

function resolvePeer(api, peerId) {
  const id = String(peerId || '')
  const online = presence.get(id)
  if (online) return online
  const roster = loadRoster(api)
  if (roster[id]) return roster[id]
  const u = api.findUser({ id })
  if (u) {
    return {
      userId: u.id,
      username: u.username,
      displayName: u.displayName || u.username,
      level: u.level
    }
  }
  return { userId: id, username: id.slice(0, 8), displayName: '用户', level: 'viewer' }
}

// exported for cron module
async function runCleanup(api) {
  return cleanupOld(api)
}

module.exports = {
  runCleanup,
  async register(api) {
    try {
      await ensureTables(api)
    } catch (e) {
      api.log('ensureTables', e)
    }

    api.registerRoute('GET', '/api/v1/company-chat/config', async () => ({
      ok: true,
      ...publicConfig(api)
    }))

    api.registerRoute('POST', '/api/v1/company-chat/heartbeat', async (req) => {
      const user = authUser(req)
      if (!user) return httpJson(401, { ok: false, message: '请先登录' })
      touchPresence(user)
      upsertRoster(api, user)
      return { ok: true, online: listOnline().length }
    })

    api.registerRoute('GET', '/api/v1/company-chat/online', async (req) => {
      const user = authUser(req)
      if (!user) return httpJson(401, { ok: false, message: '请先登录' })
      touchPresence(user)
      upsertRoster(api, user)
      prunePresence()
      const online = listOnline()
      const roster = loadRoster(api)
      const recent = Object.values(roster)
        .filter((r) => !presence.has(String(r.userId)))
        .sort((a, b) => Date.parse(b.lastSeenAt || 0) - Date.parse(a.lastSeenAt || 0))
        .slice(0, 40)
      return {
        ok: true,
        online,
        recent,
        me: {
          userId: user.id,
          username: user.username,
          displayName: user.displayName || user.username,
          level: user.level
        },
        config: publicConfig(api)
      }
    })

    api.registerRoute('GET', '/api/v1/company-chat/room', async (req) => {
      const user = authUser(req)
      if (!user) return httpJson(401, { ok: false, message: '请先登录' })
      const q = req.query || {}
      const messages = await listRoomMessages(api, {
        after: q.after || '',
        limit: q.limit || 50
      })
      return { ok: true, messages }
    })

    api.registerRoute('POST', '/api/v1/company-chat/upload', async (req) => {
      const user = authUser(req)
      if (!user) return httpJson(401, { ok: false, message: '请先登录' })
      try {
        const body = (req && req.body) || {}
        const meta = saveUploadedFile(api, user, body)
        return {
          ok: true,
          file: {
            id: meta.id,
            name: meta.name,
            mime: meta.mime,
            size: meta.size,
            url: '/api/v1/company-chat/file/' + encodeURIComponent(meta.id)
          }
        }
      } catch (e) {
        return httpJson(400, { ok: false, message: e instanceof Error ? e.message : String(e) })
      }
    })

    api.registerRoute('GET', '/api/v1/company-chat/file/:id', async (req) => {
      const user = authUser(req)
      if (!user) return httpJson(401, { ok: false, message: '请先登录' })
      const m = String(req.path || '').match(/\/api\/v1\/company-chat\/file\/([^/]+)$/)
      const fileId = m ? decodeURIComponent(m[1]) : String((req.query && req.query.id) || '')
      const meta = getFileMeta(api, fileId)
      if (!meta) return httpJson(404, { ok: false, message: '文件不存在' })
      const disk = path.join(filesDir(api), meta.id + '.bin')
      if (!fs.existsSync(disk)) return httpJson(404, { ok: false, message: '文件已丢失' })
      const buf = fs.readFileSync(disk)
      const filename = safeFileName(meta.name)
      return {
        __pluginHttp: {
          status: 200,
          headers: {
            'Content-Type': meta.mime || 'application/octet-stream',
            'Content-Length': String(buf.length),
            'Content-Disposition':
              "attachment; filename*=UTF-8''" + encodeURIComponent(filename),
            'Cache-Control': 'private, max-age=600'
          },
          body: buf
        }
      }
    })

    api.registerRoute('POST', '/api/v1/company-chat/room', async (req) => {
      const user = authUser(req)
      if (!user) return httpJson(401, { ok: false, message: '请先登录' })
      const body = (req && req.body) || {}
      let content
      try {
        content = resolveOutgoingContent(api, body)
      } catch (e) {
        return httpJson(400, { ok: false, message: e instanceof Error ? e.message : String(e) })
      }
      touchPresence(user)
      upsertRoster(api, user)
      const message = await addRoomMessage(api, user, content)
      return { ok: true, message }
    })

    api.registerRoute('GET', '/api/v1/company-chat/dm/threads', async (req) => {
      const user = authUser(req)
      if (!user) return httpJson(401, { ok: false, message: '请先登录' })
      const threads = await listDmThreads(api, user.id)
      const enriched = threads.map((t) => {
        const peer = resolvePeer(api, t.peerId)
        return Object.assign({}, t, {
          peer,
          online: presence.has(String(t.peerId))
        })
      })
      return { ok: true, threads: enriched, dmPolicy: dmPolicy(api) }
    })

    api.registerRoute('GET', '/api/v1/company-chat/dm', async (req) => {
      const user = authUser(req)
      if (!user) return httpJson(401, { ok: false, message: '请先登录' })
      const peerId = String((req.query && req.query.peerId) || '').trim()
      if (!peerId) return httpJson(400, { ok: false, message: '缺少 peerId' })
      const q = req.query || {}
      const messages = await listDmMessages(api, user.id, peerId, {
        after: q.after || '',
        limit: q.limit || 50
      })
      return {
        ok: true,
        peer: resolvePeer(api, peerId),
        messages
      }
    })

    api.registerRoute('POST', '/api/v1/company-chat/dm', async (req) => {
      const user = authUser(req)
      if (!user) return httpJson(401, { ok: false, message: '请先登录' })
      const body = (req && req.body) || {}
      const toId = String(body.toId || body.peerId || '').trim()
      if (!toId) return httpJson(400, { ok: false, message: '缺少对方用户' })
      if (toId === String(user.id)) {
        return httpJson(400, { ok: false, message: '不能给自己发私聊' })
      }
      if (!canStartDm(api, user)) {
        const existing = await listDmMessages(api, user.id, toId, { limit: 1 })
        if (!existing.length) {
          return httpJson(403, {
            ok: false,
            message: '当前仅管理员可发起私聊'
          })
        }
      }
      let content
      try {
        content = resolveOutgoingContent(api, body)
      } catch (e) {
        return httpJson(400, { ok: false, message: e instanceof Error ? e.message : String(e) })
      }
      const peer = resolvePeer(api, toId)
      if (!peer || !peer.userId) return httpJson(404, { ok: false, message: '用户不存在' })
      touchPresence(user)
      upsertRoster(api, user)
      const message = await addDmMessage(api, user, toId, content)
      return { ok: true, message, peer }
    })

    api.registerRoute('GET', '/api/v1/company-chat/admin/search', async (req) => {
      const user = authUser(req)
      if (!user || !isAdmin(user)) return httpJson(403, { ok: false, message: '需要管理员' })
      const q = req.query || {}
      const rows = await searchMessages(api, {
        q: q.q || '',
        type: q.type || 'all',
        limit: q.limit || 50
      })
      return { ok: true, rows }
    })

    api.registerRoute('POST', '/api/v1/company-chat/admin/cleanup', async (req) => {
      const user = authUser(req)
      if (!user || !isAdmin(user)) return httpJson(403, { ok: false, message: '需要管理员' })
      const result = await cleanupOld(api)
      return result
    })

    api.registerRoute('GET', '/api/v1/company-chat/admin/cleanup-status', async (req) => {
      const user = authUser(req)
      if (!user || !isAdmin(user)) return httpJson(403, { ok: false, message: '需要管理员' })
      return {
        ok: true,
        config: publicConfig(api),
        last: api.readJson('last_cleanup.json', null)
      }
    })

    api.log('company_chat routes ready')
  }
}
