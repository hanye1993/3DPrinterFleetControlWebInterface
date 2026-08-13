import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import mysql from 'mysql2/promise'

const conn = await mysql.createConnection({
  host: '127.0.0.1',
  port: 3306,
  user: 'root',
  password: '',
  multipleStatements: true
})
await conn.query(
  'CREATE DATABASE IF NOT EXISTS hanye_printer CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci'
)
await conn.changeUser({ database: 'hanye_printer' })
const schemaFile = existsSync(join(process.cwd(), 'ops/sql/schema.sql'))
  ? join(process.cwd(), 'ops/sql/schema.sql')
  : join(process.cwd(), 'sql/schema.sql')
const schema = readFileSync(schemaFile, 'utf8')
  .split('\n')
  .filter((l) => !l.trim().startsWith('--'))
  .join('\n')
for (const stmt of schema
  .split(';')
  .map((s) => s.trim())
  .filter(Boolean)) {
  await conn.query(stmt)
}
await conn.end()
console.log('ok')
