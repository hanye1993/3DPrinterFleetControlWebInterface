import mysql, { type Pool, type PoolOptions, type RowDataPacket } from 'mysql2/promise'
import { readFileSync, existsSync } from 'fs'
import { sqlSchemaPath } from '../../shared/repoLayout'

let pool: Pool | null = null

export type MysqlConfig = {
  host: string
  port: number
  user: string
  password: string
  database: string
}

export function mysqlConfigFromEnv(): MysqlConfig {
  return {
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'hanye_printer'
  }
}

export function getPool(): Pool {
  if (!pool) throw new Error('MySQL pool not initialized')
  return pool
}

export async function initMysql(cfg?: MysqlConfig): Promise<Pool> {
  if (pool) return pool
  const c = cfg || mysqlConfigFromEnv()
  const opts: PoolOptions = {
    host: c.host,
    port: c.port,
    user: c.user,
    password: c.password,
    database: c.database,
    waitForConnections: true,
    connectionLimit: 10,
    charset: 'utf8mb4',
    timezone: '+00:00'
  }
  pool = mysql.createPool(opts)
  await pool.query('SELECT 1')
  return pool
}

export async function closeMysql(): Promise<void> {
  if (pool) {
    await pool.end()
    pool = null
  }
}

export async function runSchemaMigration(): Promise<void> {
  const p = getPool()
  const schemaPath = sqlSchemaPath()
  if (!existsSync(schemaPath)) {
    throw new Error(`Schema file not found: ${schemaPath}`)
  }
  const sql = readFileSync(schemaPath, 'utf8')
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
  const statements = sql
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
  for (const stmt of statements) {
    await p.query(stmt)
  }
}

export async function getConfigValue(key: string): Promise<string | null> {
  const [rows] = await getPool().query<RowDataPacket[]>(
    'SELECT `value` FROM app_config WHERE `key` = ? LIMIT 1',
    [key]
  )
  return rows[0]?.value != null ? String(rows[0].value) : null
}

export async function setConfigValue(key: string, value: string): Promise<void> {
  await getPool().query(
    'INSERT INTO app_config (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)',
    [key, value]
  )
}
