import { getPool } from './db.js'

function toPublicUser(row) {
  if (!row) return null
  return {
    id: row.id,
    email: row.email,
    name: row.name || '',
  }
}

export async function findUserByEmail(email) {
  const value = String(email || '').trim().toLowerCase()
  if (!value) return null
  const [rows] = await getPool().query(
    'SELECT id, email, name FROM users WHERE email = ? LIMIT 1',
    [value],
  )
  return toPublicUser(rows[0])
}

export async function getUsersByIds(ids) {
  const list = [...new Set((ids || []).map(String).filter(Boolean))]
  if (!list.length) return []
  const placeholders = list.map(() => '?').join(',')
  const [rows] = await getPool().query(
    `SELECT id, email, name FROM users WHERE id IN (${placeholders})`,
    list,
  )
  return rows.map(toPublicUser)
}

export async function getFirstUserId() {
  const [rows] = await getPool().query(
    'SELECT id FROM users ORDER BY created_at ASC LIMIT 1',
  )
  return rows[0]?.id || null
}

export async function getUserTeamIds(userId) {
  if (!userId) return []
  const [rows] = await getPool().query(
    'SELECT team_id FROM team_members WHERE user_id = ?',
    [userId],
  )
  return rows.map((row) => row.team_id)
}
