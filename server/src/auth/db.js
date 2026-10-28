import mysql from 'mysql2/promise'
import { authConfig } from './config.js'

let pool = null
let info = null

const TABLES = [
  `CREATE TABLE IF NOT EXISTS users (
    id CHAR(36) NOT NULL PRIMARY KEY,
    email VARCHAR(190) NOT NULL,
    name VARCHAR(80) NOT NULL DEFAULT '',
    password_hash VARCHAR(255) NOT NULL,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    last_login_at BIGINT NULL,
    email_verified_at BIGINT NULL,
    UNIQUE KEY uniq_users_email (email)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS teams (
    id CHAR(36) NOT NULL PRIMARY KEY,
    name VARCHAR(80) NOT NULL,
    owner_id CHAR(36) NOT NULL,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    KEY idx_teams_owner (owner_id),
    CONSTRAINT fk_teams_owner FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS team_members (
    team_id CHAR(36) NOT NULL,
    user_id CHAR(36) NOT NULL,
    role VARCHAR(16) NOT NULL DEFAULT 'member',
    created_at BIGINT NOT NULL,
    PRIMARY KEY (team_id, user_id),
    KEY idx_team_members_user (user_id),
    CONSTRAINT fk_team_members_team FOREIGN KEY (team_id) REFERENCES teams (id) ON DELETE CASCADE,
    CONSTRAINT fk_team_members_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id CHAR(36) NOT NULL PRIMARY KEY,
    user_id CHAR(36) NOT NULL,
    token_hash CHAR(64) NOT NULL,
    created_at BIGINT NOT NULL,
    expires_at BIGINT NOT NULL,
    user_agent VARCHAR(255) NOT NULL DEFAULT '',
    ip VARCHAR(64) NOT NULL DEFAULT '',
    UNIQUE KEY uniq_sessions_token (token_hash),
    KEY idx_sessions_user (user_id),
    KEY idx_sessions_expires (expires_at),
    CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS email_codes (
    id CHAR(36) NOT NULL PRIMARY KEY,
    email VARCHAR(190) NOT NULL,
    purpose VARCHAR(32) NOT NULL,
    code_hash CHAR(64) NOT NULL,
    expires_at BIGINT NOT NULL,
    used_at BIGINT NULL,
    attempts INT NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL,
    KEY idx_email_codes_email (email, purpose, created_at),
    KEY idx_email_codes_expires (expires_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS app_state (
    id VARCHAR(32) NOT NULL PRIMARY KEY,
    state_json LONGTEXT NOT NULL,
    updated_at BIGINT NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
]

export async function initAuthDb() {
  if (pool) return info
  const { host, port, user, password, database } = authConfig.db
  if (!/^[A-Za-z0-9_]+$/.test(database)) {
    throw new Error(`数据库名只能包含字母、数字和下划线：${database}`)
  }

  const bootstrap = await mysql.createConnection({
    host,
    port,
    user,
    password,
    connectTimeout: 10000,
    charset: 'utf8mb4',
  })
  try {
    await bootstrap.query(
      `CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    )
  } finally {
    await bootstrap.end().catch(() => {})
  }

  pool = mysql.createPool({
    host,
    port,
    user,
    password,
    database,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    charset: 'utf8mb4',
    connectTimeout: 10000,
  })

  for (const sql of TABLES) {
    await pool.query(sql)
  }

  info = { host, port, user, database: database }
  return info
}

export function getPool() {
  if (!pool) throw new Error('MySQL 尚未初始化')
  return pool
}

export async function loadAppState() {
  if (!pool) return null
  const [rows] = await pool.query('SELECT state_json FROM app_state WHERE id = ? LIMIT 1', ['main'])
  if (!rows?.length || !rows[0]?.state_json) return null
  try {
    return JSON.parse(rows[0].state_json)
  } catch {
    return null
  }
}

export async function saveAppState(state) {
  if (!pool) return
  const json = JSON.stringify(state || {})
  await pool.query(
    `INSERT INTO app_state (id, state_json, updated_at)
     VALUES ('main', ?, ?)
     ON DUPLICATE KEY UPDATE state_json = VALUES(state_json), updated_at = VALUES(updated_at)`,
    [json, Date.now()],
  )
}
