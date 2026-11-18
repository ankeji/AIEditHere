import crypto from 'node:crypto'
import { getPool } from './db.js'

function toModel(row) {
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    providerId: row.provider_id,
    modelId: row.model_id,
    value: `${row.provider_id}/${row.model_id}`,
    isDefault: Boolean(row.is_default),
    enabled: Boolean(row.enabled),
    createdAt: Number(row.created_at) || null,
    updatedAt: Number(row.updated_at) || null,
  }
}

export async function listUserModels(userId) {
  const [rows] = await getPool().query(
    `SELECT id, name, provider_id, model_id, is_default, enabled, created_at, updated_at
       FROM user_models WHERE user_id = ? ORDER BY is_default DESC, created_at ASC`,
    [userId],
  )
  return rows.map(toModel)
}

export async function getDefaultUserModel(userId) {
  if (!userId) return null
  const [rows] = await getPool().query(
    `SELECT id, name, provider_id, model_id, is_default, enabled, created_at, updated_at
       FROM user_models WHERE user_id = ? AND is_default = 1 AND enabled = 1 LIMIT 1`,
    [userId],
  )
  return toModel(rows[0])
}

export async function createUserModel(userId, { name, providerId, modelId, isDefault = false }) {
  const id = crypto.randomUUID()
  const now = Date.now()
  const pool = getPool()
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    if (isDefault) {
      await connection.query('UPDATE user_models SET is_default = 0 WHERE user_id = ?', [userId])
    }
    await connection.query(
      `INSERT INTO user_models
       (id, user_id, name, provider_id, model_id, is_default, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      [id, userId, name, providerId, modelId, isDefault ? 1 : 0, now, now],
    )
    await connection.commit()
  } catch (err) {
    await connection.rollback()
    throw err
  } finally {
    connection.release()
  }
  return getUserModel(userId, id)
}

export async function getUserModel(userId, id) {
  const [rows] = await getPool().query(
    `SELECT id, name, provider_id, model_id, is_default, enabled, created_at, updated_at
       FROM user_models WHERE user_id = ? AND id = ? LIMIT 1`,
    [userId, id],
  )
  return toModel(rows[0])
}

export async function updateUserModel(userId, id, patch) {
  const current = await getUserModel(userId, id)
  if (!current) return null
  const next = {
    name: patch.name === undefined ? current.name : patch.name,
    providerId: patch.providerId === undefined ? current.providerId : patch.providerId,
    modelId: patch.modelId === undefined ? current.modelId : patch.modelId,
    enabled: patch.enabled === undefined ? current.enabled : patch.enabled,
    isDefault: patch.isDefault === undefined ? current.isDefault : patch.isDefault,
  }
  const connection = await getPool().getConnection()
  try {
    await connection.beginTransaction()
    if (next.isDefault) {
      await connection.query('UPDATE user_models SET is_default = 0 WHERE user_id = ?', [userId])
    }
    await connection.query(
      `UPDATE user_models SET name = ?, provider_id = ?, model_id = ?, is_default = ?, enabled = ?, updated_at = ?
       WHERE user_id = ? AND id = ?`,
      [next.name, next.providerId, next.modelId, next.isDefault ? 1 : 0, next.enabled ? 1 : 0, Date.now(), userId, id],
    )
    await connection.commit()
  } catch (err) {
    await connection.rollback()
    throw err
  } finally {
    connection.release()
  }
  return getUserModel(userId, id)
}

export async function deleteUserModel(userId, id) {
  const [result] = await getPool().query('DELETE FROM user_models WHERE user_id = ? AND id = ?', [userId, id])
  return result.affectedRows > 0
}
