/**
 * Import local JSON data into MySQL (hanye_printer).
 * Usage:
 *   node ops/scripts/import-mysql.mjs
 * Env: MYSQL_HOST MYSQL_PORT MYSQL_USER MYSQL_PASSWORD MYSQL_DATABASE DATA_ROOT
 */
import { readFileSync, existsSync } from 'fs'
import { join, resolve } from 'path'
import mysql from 'mysql2/promise'

const DATA_ROOT = resolve(process.env.DATA_ROOT || join(process.cwd(), 'data'))
const SCHEMA_PATH = (() => {
  const a = join(process.cwd(), 'ops', 'sql', 'schema.sql')
  const b = join(process.cwd(), 'sql', 'schema.sql')
  return existsSync(a) ? a : b
})()
const cfg = {
  host: process.env.MYSQL_HOST || '127.0.0.1',
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || 'hanye_printer',
  multipleStatements: true
}

function readJson(path, fallback = null) {
  if (!existsSync(path)) return fallback
  return JSON.parse(readFileSync(path, 'utf8'))
}

function readJsonl(path) {
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return null
      }
    })
    .filter(Boolean)
}

async function main() {
  console.log('[import] Connecting', `${cfg.user}@${cfg.host}:${cfg.port}/${cfg.database}`)
  const conn = await mysql.createConnection(cfg)

  const schemaPath = SCHEMA_PATH
  if (!existsSync(schemaPath)) throw new Error(`Missing ${schemaPath}`)
  const schema = readFileSync(schemaPath, 'utf8')
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
  for (const stmt of schema
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)) {
    await conn.query(stmt)
  }
  console.log('[import] Schema OK')

  // —— users.json ——
  const usersFile = readJson(join(DATA_ROOT, 'users.json'))
  if (usersFile?.users?.length) {
    if (usersFile.jwtSecret) {
      await conn.query(
        'INSERT INTO app_config (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)',
        ['jwt_secret', String(usersFile.jwtSecret)]
      )
    }
    let n = 0
    for (const u of usersFile.users) {
      await conn.query(
        `INSERT INTO users (
          id, username, display_name, level, enabled, password_hash, password_salt,
          permissions, device_acl, sso_provider, sso_external_id, banned_at, ban_reason,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          display_name = VALUES(display_name),
          level = VALUES(level),
          enabled = VALUES(enabled),
          password_hash = VALUES(password_hash),
          password_salt = VALUES(password_salt),
          permissions = VALUES(permissions),
          device_acl = VALUES(device_acl),
          sso_provider = VALUES(sso_provider),
          sso_external_id = VALUES(sso_external_id),
          banned_at = VALUES(banned_at),
          ban_reason = VALUES(ban_reason),
          updated_at = VALUES(updated_at)`,
        [
          u.id,
          u.username,
          u.displayName || '',
          u.level || 'viewer',
          u.enabled !== false ? 1 : 0,
          u.passwordHash,
          u.passwordSalt,
          JSON.stringify(u.permissions || []),
          JSON.stringify(u.deviceAcl || {}),
          u.ssoProvider || 'none',
          u.ssoExternalId || '',
          u.bannedAt ? new Date(u.bannedAt) : null,
          u.banReason || null,
          new Date(u.createdAt || Date.now()),
          new Date(u.updatedAt || Date.now())
        ]
      )
      n++
    }
    console.log(`[import] users: ${n}`)
  } else {
    console.log('[import] users: skip (no users.json)')
  }

  // —— app-settings.json ——
  const settings = readJson(join(DATA_ROOT, 'app-settings.json'))
  if (settings && typeof settings === 'object') {
    await conn.query(
      'INSERT INTO app_settings (id, data) VALUES (1, ?) ON DUPLICATE KEY UPDATE data = VALUES(data)',
      [JSON.stringify(settings)]
    )
    console.log('[import] app_settings: 1')
  } else {
    console.log('[import] app_settings: skip')
  }

  // —— devices.json ——
  const devices = readJson(join(DATA_ROOT, 'devices.json'), [])
  if (Array.isArray(devices) && devices.length) {
    for (const d of devices) {
      if (!d?.id) continue
      await conn.query(
        'INSERT INTO devices (id, data) VALUES (?, ?) ON DUPLICATE KEY UPDATE data = VALUES(data)',
        [String(d.id), JSON.stringify(d)]
      )
    }
    console.log(`[import] devices: ${devices.length}`)
  } else {
    console.log('[import] devices: skip')
  }

  // —— filament-spools.json ——
  const spools = readJson(join(DATA_ROOT, 'filament-spools.json'), [])
  if (Array.isArray(spools) && spools.length) {
    for (const s of spools) {
      if (!s?.id) continue
      await conn.query(
        'INSERT INTO filament_spools (id, data) VALUES (?, ?) ON DUPLICATE KEY UPDATE data = VALUES(data)',
        [String(s.id), JSON.stringify(s)]
      )
    }
    console.log(`[import] filament_spools: ${spools.length}`)
  } else {
    console.log('[import] filament_spools: skip')
  }

  // —— monitor-zones.json ——
  const zones = readJson(join(DATA_ROOT, 'monitor-zones.json'), [])
  if (Array.isArray(zones) && zones.length) {
    let i = 0
    for (const z of zones) {
      const id = String(z?.id || `zone-${i}`)
      await conn.query(
        'INSERT INTO monitor_zones (id, data, sort_order) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE data = VALUES(data), sort_order = VALUES(sort_order)',
        [id, JSON.stringify(z), i++]
      )
    }
    console.log(`[import] monitor_zones: ${zones.length}`)
  } else {
    console.log('[import] monitor_zones: skip')
  }

  // —— print-requests.json ——
  const prints = readJson(join(DATA_ROOT, 'print-requests.json'), [])
  if (Array.isArray(prints) && prints.length) {
    for (const r of prints) {
      if (!r?.id) continue
      await conn.query(
        `INSERT INTO print_requests (id, data, status, device_id, requester_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE data = VALUES(data), status = VALUES(status), updated_at = VALUES(updated_at)`,
        [
          r.id,
          JSON.stringify(r),
          r.status || 'pending',
          r.deviceId || '',
          r.requesterId || '',
          new Date(r.createdAt || Date.now()),
          new Date(r.updatedAt || Date.now())
        ]
      )
    }
    console.log(`[import] print_requests: ${prints.length}`)
  } else {
    console.log('[import] print_requests: skip')
  }

  // —— quote-history.json ——
  const qh = readJson(join(DATA_ROOT, 'quote-history.json'), [])
  if (Array.isArray(qh) && qh.length) {
    for (const r of qh) {
      if (!r?.id) continue
      await conn.query(
        `INSERT INTO quote_history (id, data, user_id, username, action, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE data = VALUES(data)`,
        [
          r.id,
          JSON.stringify(r),
          r.userId || null,
          r.username || null,
          r.action || null,
          new Date(r.createdAt || Date.now())
        ]
      )
    }
    console.log(`[import] quote_history: ${qh.length}`)
  } else {
    console.log('[import] quote_history: skip')
  }

  // —— quote-schemes.json ——
  const qs = readJson(join(DATA_ROOT, 'quote-schemes.json'), [])
  if (Array.isArray(qs) && qs.length) {
    for (const s of qs) {
      if (!s?.id) continue
      await conn.query(
        `INSERT INTO quote_schemes (id, name, data, gcode, gcode_file_name, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE name = VALUES(name), data = VALUES(data), gcode = VALUES(gcode),
           gcode_file_name = VALUES(gcode_file_name), updated_at = VALUES(updated_at)`,
        [
          s.id,
          s.name || '',
          JSON.stringify(s),
          s.gcode || null,
          s.gcodeFileName || null,
          new Date(s.updatedAt || Date.now())
        ]
      )
    }
    console.log(`[import] quote_schemes: ${qs.length}`)
  } else {
    console.log('[import] quote_schemes: skip')
  }

  // —— operation-logs.jsonl ——
  const logs = readJsonl(join(DATA_ROOT, 'operation-logs.jsonl'))
  if (logs.length) {
    for (const e of logs) {
      await conn.query(
        'INSERT INTO operation_logs (data, device_id, created_at) VALUES (?, ?, ?)',
        [JSON.stringify(e), e.deviceId || null, new Date(e.time || Date.now())]
      )
    }
    console.log(`[import] operation_logs: ${logs.length}`)
  } else {
    console.log('[import] operation_logs: skip')
  }

  // —— secrets.json (plain) → encrypted ——
  const secretsPath = join(DATA_ROOT, 'secrets.json')
  if (existsSync(secretsPath)) {
    const { createCipheriv, createHash, randomBytes } = await import('crypto')
    const master = createHash('sha256')
      .update(process.env.SECRETS_MASTER_KEY || process.env.JWT_SECRET || 'change-me-in-production')
      .digest()
    const encrypt = (plain) => {
      const iv = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', master, iv)
      const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
      const tag = cipher.getAuthTag()
      return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`
    }
    const secrets = readJson(secretsPath, {})
    let n = 0
    for (const [k, v] of Object.entries(secrets || {})) {
      if (typeof v !== 'string') continue
      await conn.query(
        'INSERT INTO device_secrets (secret_key, value_enc) VALUES (?, ?) ON DUPLICATE KEY UPDATE value_enc = VALUES(value_enc)',
        [k, encrypt(v)]
      )
      n++
    }
    console.log(`[import] device_secrets: ${n}`)
  } else {
    console.log('[import] device_secrets: skip')
  }

  // —— nav-config.json ——
  const navConfig = readJson(join(DATA_ROOT, 'nav-config.json'))
  if (navConfig && typeof navConfig === 'object') {
    await conn.query(
      'INSERT INTO nav_config (id, data) VALUES (1, ?) ON DUPLICATE KEY UPDATE data = VALUES(data)',
      [JSON.stringify(navConfig)]
    )
    console.log('[import] nav_config: 1')
  } else {
    console.log('[import] nav_config: skip')
  }

  // —— plugins-state.json ——
  const pluginsState = readJson(join(DATA_ROOT, 'plugins-state.json'))
  if (pluginsState && typeof pluginsState === 'object') {
    await conn.query(
      'INSERT INTO plugins_state (id, data) VALUES (1, ?) ON DUPLICATE KEY UPDATE data = VALUES(data)',
      [JSON.stringify(pluginsState)]
    )
    console.log('[import] plugins_state: 1')
  } else {
    console.log('[import] plugins_state: skip')
  }

  // —— themes-state.json ——
  const themesState = readJson(join(DATA_ROOT, 'themes-state.json'))
  if (themesState && typeof themesState === 'object') {
    await conn.query(
      'INSERT INTO themes_state (id, data) VALUES (1, ?) ON DUPLICATE KEY UPDATE data = VALUES(data)',
      [JSON.stringify(themesState)]
    )
    console.log('[import] themes_state: 1')
  } else {
    console.log('[import] themes_state: skip')
  }

  // —— plugin-data/{pluginId}/**/*.json ——
  {
    const { readdirSync, statSync } = await import('fs')
    const root = join(DATA_ROOT, 'plugin-data')
    let n = 0
    const collect = (dir, pluginId, prefix, out) => {
      if (!existsSync(dir)) return
      for (const name of readdirSync(dir)) {
        const full = join(dir, name)
        const st = statSync(full)
        if (st.isDirectory()) {
          collect(full, pluginId, prefix ? `${prefix}/${name}` : name, out)
          continue
        }
        if (!name.endsWith('.json')) continue
        const rel = (prefix ? `${prefix}/${name}` : name).replace(/\\/g, '/')
        try {
          out.push({ pluginId, rel, data: JSON.parse(readFileSync(full, 'utf8')) })
        } catch {
          /* skip */
        }
      }
    }
    if (existsSync(root)) {
      const files = []
      for (const pluginId of readdirSync(root)) {
        const pdir = join(root, pluginId)
        if (!statSync(pdir).isDirectory()) continue
        collect(pdir, pluginId, '', files)
      }
      for (const f of files) {
        await conn.query(
          `INSERT INTO plugin_data (plugin_id, rel_path, data) VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE data = VALUES(data)`,
          [f.pluginId, f.rel.slice(0, 255), JSON.stringify(f.data)]
        )
        n++
      }
    }
    console.log(`[import] plugin_data: ${n}`)
  }

  const [counts] = await conn.query(`
    SELECT
      (SELECT COUNT(*) FROM users) AS users,
      (SELECT COUNT(*) FROM devices) AS devices,
      (SELECT COUNT(*) FROM filament_spools) AS filament,
      (SELECT COUNT(*) FROM monitor_zones) AS zones,
      (SELECT COUNT(*) FROM app_settings) AS settings,
      (SELECT COUNT(*) FROM operation_logs) AS logs,
      (SELECT COUNT(*) FROM nav_config) AS nav_config,
      (SELECT COUNT(*) FROM plugins_state) AS plugins_state,
      (SELECT COUNT(*) FROM themes_state) AS themes_state,
      (SELECT COUNT(*) FROM plugin_data) AS plugin_data
  `)
  console.log('[import] Done. Counts:', counts[0])
  await conn.end()
}

main().catch((e) => {
  console.error('[import] FAILED:', e)
  process.exit(1)
})
