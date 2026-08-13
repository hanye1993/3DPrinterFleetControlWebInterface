/**
 * Scoped MySQL access for plugins / themes.
 * Tables must be prefixed: plugin_{id}_* or theme_{id}_*
 * Does NOT allow CREATE/DROP DATABASE — only tables inside the app database.
 *
 * High-level CRUD: insert / select / update / remove / getOne / count / upsert
 * Low-level: query / execute
 */
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise'

export type ExtensionOwnerKind = 'plugin' | 'theme'

export type DbWhere = Record<string, unknown>

export type DbSelectOpts = {
  where?: DbWhere
  columns?: string[]
  orderBy?: string
  limit?: number
  offset?: number
}

export type ExtensionDbApi = {
  /** true when USE_MYSQL pool is ready */
  available: boolean
  /**
   * Build physical table name: plugin_qq_login_sessions
   * shortName: letters, digits, underscore only
   */
  table: (shortName: string) => string

  // —— 增查改删（推荐）——
  /** 插入一行 → { affectedRows, insertId } */
  insert: (
    shortName: string,
    row: Record<string, unknown>
  ) => Promise<{ affectedRows: number; insertId: number }>
  /** 查询多行 */
  select: (shortName: string, opts?: DbSelectOpts) => Promise<unknown[]>
  /** 查询一行，没有则 null */
  getOne: (shortName: string, where: DbWhere) => Promise<unknown | null>
  /** 按条件更新 */
  update: (
    shortName: string,
    patch: Record<string, unknown>,
    where: DbWhere
  ) => Promise<{ affectedRows: number }>
  /** 按条件删除 */
  remove: (shortName: string, where: DbWhere) => Promise<{ affectedRows: number }>
  /** 计数 */
  count: (shortName: string, where?: DbWhere) => Promise<number>
  /**
   * 有则更新、无则插入（需 uniqueKeys 对应唯一索引/主键列）
   */
  upsert: (
    shortName: string,
    row: Record<string, unknown>,
    uniqueKeys: string[]
  ) => Promise<{ affectedRows: number; insertId: number }>

  // —— 底层 SQL ——
  /** SELECT… → rows */
  query: (sql: string, params?: unknown[]) => Promise<unknown[]>
  /** INSERT/UPDATE/DELETE/DDL → meta */
  execute: (
    sql: string,
    params?: unknown[]
  ) => Promise<{ affectedRows: number; insertId: number }>
  /**
   * CREATE TABLE IF NOT EXISTS `plugin_x_y` ( …columns… )
   * Pass column / index definitions only.
   */
  ensureTable: (shortName: string, columnsSql: string) => Promise<string>
  /** DROP TABLE IF EXISTS own table */
  dropTable: (shortName: string) => Promise<void>
}

export type ExtensionDbPoolGetter = () => Pool | null

function safeOwnerId(id: string): string {
  const s = String(id || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
  if (!s || s.includes('..')) throw new Error('非法 extension id')
  return s.slice(0, 48)
}

function safeShortName(name: string): string {
  const s = String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
  if (!s || s.startsWith('_')) throw new Error('非法表短名')
  return s.slice(0, 48)
}

function safeIdent(name: string, label = '字段'): string {
  const s = String(name || '').trim()
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s)) throw new Error(`非法${label}名: ${name}`)
  return s
}

function ownerPrefix(kind: ExtensionOwnerKind, id: string): string {
  return `${kind}_${safeOwnerId(id)}_`
}

function stripSqlLiterals(sql: string): string {
  return sql.replace(/'([^'\\]|\\.)*'/g, "''").replace(/"([^"\\]|\\.)*"/g, '""')
}

function assertSqlAllowed(sql: string, prefix: string): void {
  const raw = String(sql || '').trim()
  if (!raw) throw new Error('空 SQL')
  const s = stripSqlLiterals(raw)
  if (/;\s*\S/.test(s)) throw new Error('不允许一次执行多条 SQL')
  if (/\b(create|drop|alter)\s+database\b/i.test(s)) {
    throw new Error('禁止 CREATE/DROP/ALTER DATABASE（请用 ensureTable 建插件/主题表）')
  }
  if (/\b(grant|revoke|create\s+user|drop\s+user|alter\s+user)\b/i.test(s)) {
    throw new Error('禁止用户权限类 SQL')
  }
  if (/\b(load_file|into\s+outfile|into\s+dumpfile)\b/i.test(s)) {
    throw new Error('禁止文件读写类 SQL')
  }
  const ddl = s.match(
    /\b(?:create|drop|alter|truncate|rename)\s+table\s+(?:if\s+(?:not\s+)?exists\s+)?`?([a-zA-Z0-9_]+)`?/i
  )
  if (ddl) {
    const t = ddl[1]!
    if (!t.startsWith(prefix)) {
      throw new Error(`只能操作自有表（前缀 ${prefix}），收到: ${t}`)
    }
  }
  const touchesHost =
    /\b(users|devices|device_secrets|filament_spools|monitor_zones|app_settings|print_requests|quote_schemes|quote_history|operation_logs|nav_config|plugins_state|themes_state|plugin_data|app_config|extension_schema)\b/i.test(
      s
    ) && !s.includes(prefix)
  if (touchesHost && /\b(insert|update|delete|replace|drop|alter|truncate)\b/i.test(s)) {
    throw new Error('禁止直接改写宿主核心表，请使用 PluginApi 或自有表')
  }
}

function buildWhere(where: DbWhere | undefined): { sql: string; params: unknown[] } {
  if (!where || !Object.keys(where).length) return { sql: '', params: [] }
  const parts: string[] = []
  const params: unknown[] = []
  for (const [k, v] of Object.entries(where)) {
    const col = safeIdent(k)
    if (v === null) {
      parts.push(`\`${col}\` IS NULL`)
    } else {
      parts.push(`\`${col}\` = ?`)
      params.push(v)
    }
  }
  return { sql: ` WHERE ${parts.join(' AND ')}`, params }
}

async function registerExtensionTable(
  getPool: ExtensionDbPoolGetter,
  kind: ExtensionOwnerKind,
  ownerId: string,
  tableName: string
): Promise<void> {
  const pool = getPool()
  if (!pool) return
  await pool.query(
    `INSERT INTO extension_schema (owner_kind, owner_id, table_name)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE owner_id = VALUES(owner_id)`,
    [kind, safeOwnerId(ownerId), tableName]
  )
}

export function createExtensionDbApi(opts: {
  kind: ExtensionOwnerKind
  id: string
  enabled: boolean
  getPool: ExtensionDbPoolGetter
}): ExtensionDbApi {
  const kind = opts.kind
  const id = safeOwnerId(opts.id)
  const prefix = ownerPrefix(kind, id)
  const enabled = opts.enabled === true
  const getPool = opts.getPool

  const table = (shortName: string) => `${prefix}${safeShortName(shortName)}`

  const requirePool = () => {
    if (!enabled) throw new Error('当前未启用 MySQL（USE_MYSQL=1），无法使用 api.db')
    const pool = getPool()
    if (!pool) throw new Error('MySQL 连接池未初始化')
    return pool
  }

  const runQuery = async (sql: string, params: unknown[] = []) => {
    const pool = requirePool()
    assertSqlAllowed(sql, prefix)
    const [rows] = await pool.query<RowDataPacket[]>(sql, params as never[])
    return rows as unknown[]
  }

  const runExec = async (sql: string, params: unknown[] = []) => {
    const pool = requirePool()
    assertSqlAllowed(sql, prefix)
    const [res] = await pool.query<ResultSetHeader>(sql, params as never[])
    return {
      affectedRows: Number(res.affectedRows || 0),
      insertId: Number(res.insertId || 0)
    }
  }

  return {
    available: enabled,
    table,

    insert: async (shortName, row) => {
      const t = table(shortName)
      const keys = Object.keys(row || {})
      if (!keys.length) throw new Error('insert 需要至少一个字段')
      const cols = keys.map((k) => `\`${safeIdent(k)}\``)
      const placeholders = keys.map(() => '?')
      const params = keys.map((k) => row[k])
      return runExec(
        `INSERT INTO \`${t}\` (${cols.join(',')}) VALUES (${placeholders.join(',')})`,
        params
      )
    },

    select: async (shortName, opts = {}) => {
      const t = table(shortName)
      const cols =
        opts.columns && opts.columns.length
          ? opts.columns.map((c) => `\`${safeIdent(c)}\``).join(',')
          : '*'
      const { sql: whereSql, params } = buildWhere(opts.where)
      let sql = `SELECT ${cols} FROM \`${t}\`${whereSql}`
      if (opts.orderBy) {
        const ob = String(opts.orderBy).trim()
        if (!/^[a-zA-Z0-9_]+(\s+(ASC|DESC))?$/i.test(ob)) {
          throw new Error('非法 orderBy')
        }
        sql += ` ORDER BY ${ob}`
      }
      if (opts.limit != null) {
        const lim = Math.max(0, Math.floor(Number(opts.limit)))
        sql += ` LIMIT ${lim}`
        if (opts.offset != null) {
          const off = Math.max(0, Math.floor(Number(opts.offset)))
          sql += ` OFFSET ${off}`
        }
      }
      return runQuery(sql, params)
    },

    getOne: async (shortName, where) => {
      const rows = await (async () => {
        const t = table(shortName)
        const { sql: whereSql, params } = buildWhere(where)
        if (!whereSql) throw new Error('getOne 需要 where 条件')
        return runQuery(`SELECT * FROM \`${t}\`${whereSql} LIMIT 1`, params)
      })()
      return rows[0] ?? null
    },

    update: async (shortName, patch, where) => {
      const t = table(shortName)
      const keys = Object.keys(patch || {})
      if (!keys.length) throw new Error('update 需要至少一个字段')
      const { sql: whereSql, params: whereParams } = buildWhere(where)
      if (!whereSql) throw new Error('update 必须带 where，避免全表更新')
      const sets = keys.map((k) => `\`${safeIdent(k)}\` = ?`)
      const params = [...keys.map((k) => patch[k]), ...whereParams]
      const res = await runExec(`UPDATE \`${t}\` SET ${sets.join(',')}${whereSql}`, params)
      return { affectedRows: res.affectedRows }
    },

    remove: async (shortName, where) => {
      const t = table(shortName)
      const { sql: whereSql, params } = buildWhere(where)
      if (!whereSql) throw new Error('remove 必须带 where，避免全表删除')
      const res = await runExec(`DELETE FROM \`${t}\`${whereSql}`, params)
      return { affectedRows: res.affectedRows }
    },

    count: async (shortName, where) => {
      const t = table(shortName)
      const { sql: whereSql, params } = buildWhere(where)
      const rows = await runQuery(
        `SELECT COUNT(*) AS c FROM \`${t}\`${whereSql}`,
        params
      )
      const first = rows[0] as { c?: number | string } | undefined
      return Number(first?.c || 0)
    },

    upsert: async (shortName, row, uniqueKeys) => {
      const t = table(shortName)
      const keys = Object.keys(row || {})
      if (!keys.length) throw new Error('upsert 需要至少一个字段')
      const uniq = (uniqueKeys || []).map((k) => safeIdent(k))
      if (!uniq.length) throw new Error('upsert 需要 uniqueKeys')
      const cols = keys.map((k) => `\`${safeIdent(k)}\``)
      const placeholders = keys.map(() => '?')
      const updateKeys = keys.filter((k) => !uniq.includes(safeIdent(k)))
      const updates =
        updateKeys.length > 0
          ? updateKeys.map((k) => `\`${safeIdent(k)}\` = VALUES(\`${safeIdent(k)}\`)`).join(',')
          : `\`${uniq[0]}\` = \`${uniq[0]}\``
      const params = keys.map((k) => row[k])
      return runExec(
        `INSERT INTO \`${t}\` (${cols.join(',')}) VALUES (${placeholders.join(',')})
         ON DUPLICATE KEY UPDATE ${updates}`,
        params
      )
    },

    query: (sql, params = []) => runQuery(sql, params),
    execute: (sql, params = []) => runExec(sql, params),

    ensureTable: async (shortName, columnsSql) => {
      const pool = requirePool()
      const name = table(shortName)
      const body = String(columnsSql || '').trim()
      if (!body) throw new Error('ensureTable 需要列定义')
      if (/;/.test(body)) throw new Error('列定义不能包含分号')
      const ddl = `CREATE TABLE IF NOT EXISTS \`${name}\` (${body}) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
      assertSqlAllowed(ddl, prefix)
      await pool.query(ddl)
      await registerExtensionTable(getPool, kind, id, name)
      return name
    },

    dropTable: async (shortName) => {
      const pool = requirePool()
      const name = table(shortName)
      const ddl = `DROP TABLE IF EXISTS \`${name}\``
      assertSqlAllowed(ddl, prefix)
      await pool.query(ddl)
      try {
        await pool.query('DELETE FROM extension_schema WHERE table_name = ?', [name])
      } catch {
        /* ignore */
      }
    }
  }
}

export function createDisabledExtensionDbApi(kind: ExtensionOwnerKind, id: string): ExtensionDbApi {
  return createExtensionDbApi({
    kind,
    id,
    enabled: false,
    getPool: () => null
  })
}
