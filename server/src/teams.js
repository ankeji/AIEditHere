import crypto from 'node:crypto'
import { getPool } from './auth/db.js'
import { findUserByEmail } from './auth/users.js'

function teamError(status, message) {
  const err = new Error(message)
  err.status = status
  return err
}

function memberRow(row) {
  return {
    id: row.id,
    email: row.email,
    name: row.name || '',
    role: row.role,
    joinedAt: Number(row.created_at),
  }
}

function teamRow(row, members = []) {
  return {
    id: row.id,
    name: row.name,
    ownerId: row.owner_id,
    role: row.role,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    members,
  }
}

async function membersOf(teamIds) {
  const ids = [...new Set((teamIds || []).filter(Boolean))]
  if (!ids.length) return new Map()
  const placeholders = ids.map(() => '?').join(',')
  const [rows] = await getPool().query(
    `SELECT tm.team_id, tm.role, tm.created_at, u.id, u.email, u.name
     FROM team_members tm
     JOIN users u ON u.id = tm.user_id
     WHERE tm.team_id IN (${placeholders})
     ORDER BY (tm.role = 'owner') DESC, tm.created_at ASC`,
    ids,
  )
  const map = new Map()
  for (const row of rows) {
    if (!map.has(row.team_id)) map.set(row.team_id, [])
    map.get(row.team_id).push(memberRow(row))
  }
  return map
}

export async function listTeamsForUser(userId) {
  const [rows] = await getPool().query(
    `SELECT t.id, t.name, t.owner_id, t.created_at, t.updated_at, tm.role
     FROM teams t
     JOIN team_members tm ON tm.team_id = t.id
     WHERE tm.user_id = ?
     ORDER BY t.created_at DESC`,
    [userId],
  )
  const memberMap = await membersOf(rows.map((row) => row.id))
  return rows.map((row) => teamRow(row, memberMap.get(row.id) || []))
}

export async function getTeamDetails(teamId) {
  const [rows] = await getPool().query(
    'SELECT id, name, owner_id, created_at, updated_at FROM teams WHERE id = ? LIMIT 1',
    [teamId],
  )
  if (!rows.length) return null
  const memberMap = await membersOf([teamId])
  const row = rows[0]
  const members = memberMap.get(teamId) || []
  return {
    ...teamRow({ ...row, role: members.find((m) => m.role === 'owner') ? 'owner' : 'member' }, members),
  }
}

export async function getTeamForUser(teamId, userId) {
  const [rows] = await getPool().query(
    `SELECT t.id, t.name, t.owner_id, t.created_at, t.updated_at, tm.role
     FROM teams t
     JOIN team_members tm ON tm.team_id = t.id
     WHERE t.id = ? AND tm.user_id = ?
     LIMIT 1`,
    [teamId, userId],
  )
  if (!rows.length) return null
  const memberMap = await membersOf([teamId])
  return teamRow(rows[0], memberMap.get(teamId) || [])
}

export async function isTeamOwner(teamId, userId) {
  const [rows] = await getPool().query(
    'SELECT owner_id FROM teams WHERE id = ? LIMIT 1',
    [teamId],
  )
  return rows[0]?.owner_id === userId
}

export async function createTeam(userId, name) {
  const id = crypto.randomUUID()
  const now = Date.now()
  const pool = getPool()
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    await connection.query(
      'INSERT INTO teams (id, name, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      [id, name, userId, now, now],
    )
    await connection.query(
      "INSERT INTO team_members (team_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)",
      [id, userId, now],
    )
    await connection.commit()
  } catch (err) {
    await connection.rollback().catch(() => {})
    throw err
  } finally {
    connection.release()
  }
  return getTeamDetails(id)
}

export async function renameTeam(teamId, name) {
  await getPool().query(
    'UPDATE teams SET name = ?, updated_at = ? WHERE id = ?',
    [name, Date.now(), teamId],
  )
  return getTeamDetails(teamId)
}

export async function deleteTeam(teamId) {
  await getPool().query('DELETE FROM teams WHERE id = ?', [teamId])
}

export async function addTeamMember(teamId, email) {
  const user = await findUserByEmail(email)
  if (!user) throw teamError(404, '该邮箱还没有注册账号')
  await getPool().query(
    `INSERT INTO team_members (team_id, user_id, role, created_at)
     VALUES (?, ?, 'member', ?)
     ON DUPLICATE KEY UPDATE role = role`,
    [teamId, user.id, Date.now()],
  )
  return getTeamDetails(teamId)
}

export async function removeTeamMember(teamId, userId) {
  const [rows] = await getPool().query(
    'SELECT role FROM team_members WHERE team_id = ? AND user_id = ? LIMIT 1',
    [teamId, userId],
  )
  if (!rows.length) throw teamError(404, '该成员不在团队中')
  if (rows[0].role === 'owner') throw teamError(400, '不能移除团队创建者')
  await getPool().query(
    'DELETE FROM team_members WHERE team_id = ? AND user_id = ?',
    [teamId, userId],
  )
  return getTeamDetails(teamId)
}

export async function leaveTeam(teamId, userId) {
  const [rows] = await getPool().query(
    'SELECT role FROM team_members WHERE team_id = ? AND user_id = ? LIMIT 1',
    [teamId, userId],
  )
  if (!rows.length) throw teamError(404, '你不在该团队中')
  if (rows[0].role === 'owner') throw teamError(400, '团队创建者不能退出，请直接删除团队')
  await getPool().query(
    'DELETE FROM team_members WHERE team_id = ? AND user_id = ?',
    [teamId, userId],
  )
  return { ok: true }
}
