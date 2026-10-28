import crypto from 'node:crypto'
import { authConfig } from './config.js'
import { getPool } from './db.js'
import { AuthError } from './errors.js'
import { sendVerificationEmail } from './mailer.js'
import { getUserTeamIds } from './users.js'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex')
}

function hashCode(email, code) {
  return sha256(`${authConfig.secret}:${email}:${code}`)
}

export function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase()
  if (email.length > 190 || !EMAIL_RE.test(email)) {
    throw new AuthError(400, '请输入有效的邮箱地址')
  }
  return email
}

function normalizeName(value, email) {
  const name = String(value || '').trim()
  if (name.length > 40) throw new AuthError(400, '昵称不能超过 40 个字符')
  return name || email.split('@')[0]
}

function validatePassword(value) {
  const password = String(value || '')
  if (password.length < 8) throw new AuthError(400, '密码至少需要 8 个字符')
  if (password.length > 128) throw new AuthError(400, '密码不能超过 128 个字符')
  return password
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(password, salt, 64).toString('hex')
  return `scrypt$${salt}$${hash}`
}

export function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$')
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false
  const [, salt, expectedHex] = parts
  try {
    const actual = crypto.scryptSync(password, salt, 64)
    const expected = Buffer.from(expectedHex, 'hex')
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}

export function toPublicUser(row) {
  if (!row) return null
  return {
    id: row.id,
    email: row.email,
    name: row.name || '',
    createdAt: Number(row.created_at) || null,
    lastLoginAt: row.last_login_at ? Number(row.last_login_at) : null,
  }
}

export function parseCookies(header) {
  const result = {}
  for (const part of String(header || '').split(';')) {
    const index = part.indexOf('=')
    if (index <= 0) continue
    const key = part.slice(0, index).trim()
    if (!key) continue
    try {
      result[key] = decodeURIComponent(part.slice(index + 1).trim())
    } catch {
      result[key] = part.slice(index + 1).trim()
    }
  }
  return result
}

function sessionToken(req) {
  return parseCookies(req.headers?.cookie)[authConfig.cookieName] || ''
}

export function sessionCookie(token, maxAgeSeconds) {
  const parts = [
    `${authConfig.cookieName}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
  ]
  if (authConfig.cookieSecure) parts.push('Secure')
  return parts.join('; ')
}

export function clearSessionCookie() {
  const parts = [`${authConfig.cookieName}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0']
  if (authConfig.cookieSecure) parts.push('Secure')
  return parts.join('; ')
}

export async function createSession(userId, req) {
  const pool = getPool()
  const token = crypto.randomBytes(32).toString('base64url')
  const tokenHash = sha256(token)
  const now = Date.now()
  const expiresAt = now + authConfig.sessionDays * 86400000
  const userAgent = String(req.headers?.['user-agent'] || '').slice(0, 255)
  const ip = String(req.ip || req.socket?.remoteAddress || '').slice(0, 64)
  await pool.query(
    'INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at, user_agent, ip) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [crypto.randomUUID(), userId, tokenHash, now, expiresAt, userAgent, ip],
  )
  return { token, expiresAt, maxAgeSeconds: Math.floor((expiresAt - now) / 1000) }
}

export async function getSessionUser(req) {
  const token = sessionToken(req)
  if (!token) return null
  const pool = getPool()
  const [rows] = await pool.query(
    `SELECT u.id, u.email, u.name, u.created_at, u.last_login_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?
      LIMIT 1`,
    [sha256(token), Date.now()],
  )
  if (!rows.length) return null
  const user = toPublicUser(rows[0])
  return { ...user, teamIds: await getUserTeamIds(user.id) }
}

export async function destroySession(req) {
  const token = sessionToken(req)
  if (!token) return
  await getPool().query('DELETE FROM sessions WHERE token_hash = ?', [sha256(token)])
}

export async function requestRegisterCode(rawEmail) {
  const email = normalizeEmail(rawEmail)
  const pool = getPool()
  const now = Date.now()

  const [users] = await pool.query('SELECT id FROM users WHERE email = ? LIMIT 1', [email])
  if (users.length) throw new AuthError(409, '该邮箱已注册，请直接登录')

  const [recent] = await pool.query(
    `SELECT created_at FROM email_codes
      WHERE email = ? AND purpose = 'register'
      ORDER BY created_at DESC LIMIT 1`,
    [email],
  )
  if (recent.length) {
    const elapsed = now - Number(recent[0].created_at)
    const cooldownMs = authConfig.codeCooldownSeconds * 1000
    if (elapsed < cooldownMs) {
      const wait = Math.ceil((cooldownMs - elapsed) / 1000)
      throw new AuthError(429, `验证码发送太频繁，请 ${wait} 秒后再试`)
    }
  }

  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0')
  const id = crypto.randomUUID()
  const expiresAt = now + authConfig.codeTtlMinutes * 60000

  await pool.query(
    `UPDATE email_codes SET used_at = ?
      WHERE email = ? AND purpose = 'register' AND used_at IS NULL`,
    [now, email],
  )
  await pool.query(
    `INSERT INTO email_codes (id, email, purpose, code_hash, expires_at, used_at, attempts, created_at)
     VALUES (?, ?, 'register', ?, ?, NULL, 0, ?)`,
    [id, email, hashCode(email, code), expiresAt, now],
  )

  try {
    const delivery = await sendVerificationEmail(email, code)
    return {
      ok: true,
      email,
      delivered: delivery.delivered,
      devCode: delivery.devCode || '',
      cooldown: authConfig.codeCooldownSeconds,
      expiresIn: authConfig.codeTtlMinutes * 60,
    }
  } catch (err) {
    await pool.query('DELETE FROM email_codes WHERE id = ?', [id]).catch(() => {})
    throw new AuthError(502, `验证码邮件发送失败：${err?.message || err}`)
  }
}

export async function registerAccount({ email: rawEmail, code: rawCode, password, name, req }) {
  const email = normalizeEmail(rawEmail)
  const validPassword = validatePassword(password)
  const displayName = normalizeName(name, email)
  const code = String(rawCode || '').trim()
  if (!/^\d{6}$/.test(code)) throw new AuthError(400, '请输入 6 位数字验证码')

  const pool = getPool()
  const now = Date.now()
  const [rows] = await pool.query(
    `SELECT id, code_hash, expires_at, attempts, used_at
       FROM email_codes
      WHERE email = ? AND purpose = 'register'
      ORDER BY created_at DESC LIMIT 1`,
    [email],
  )
  const record = rows[0]
  if (!record || record.used_at) throw new AuthError(400, '验证码无效，请重新获取')
  if (Number(record.expires_at) <= now) throw new AuthError(400, '验证码已过期，请重新获取')
  if (Number(record.attempts) >= 5) throw new AuthError(429, '验证码尝试次数过多，请重新获取')

  const expected = Buffer.from(record.code_hash, 'hex')
  const actual = Buffer.from(hashCode(email, code), 'hex')
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    await pool.query('UPDATE email_codes SET attempts = attempts + 1 WHERE id = ?', [record.id])
    throw new AuthError(400, '验证码不正确')
  }

  const [used] = await pool.query(
    'UPDATE email_codes SET used_at = ? WHERE id = ? AND used_at IS NULL',
    [now, record.id],
  )
  if (!used.affectedRows) throw new AuthError(400, '验证码已使用，请重新获取')

  const userId = crypto.randomUUID()
  try {
    await pool.query(
      `INSERT INTO users (id, email, name, password_hash, created_at, updated_at, last_login_at, email_verified_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, email, displayName, hashPassword(validPassword), now, now, now, now],
    )
  } catch (err) {
    if (err?.code === 'ER_DUP_ENTRY') throw new AuthError(409, '该邮箱已注册，请直接登录')
    throw err
  }

  const session = await createSession(userId, req)
  const [userRows] = await pool.query(
    'SELECT id, email, name, created_at, last_login_at FROM users WHERE id = ? LIMIT 1',
    [userId],
  )
  return { user: { ...toPublicUser(userRows[0]), teamIds: [] }, session }
}

export async function loginAccount({ email: rawEmail, password, req }) {
  const email = normalizeEmail(rawEmail)
  const validPassword = String(password || '')
  if (!validPassword) throw new AuthError(400, '请输入密码')

  const pool = getPool()
  const [rows] = await pool.query(
    'SELECT id, email, name, password_hash, created_at, last_login_at FROM users WHERE email = ? LIMIT 1',
    [email],
  )
  const user = rows[0]
  if (!user || !verifyPassword(validPassword, user.password_hash)) {
    throw new AuthError(401, '邮箱或密码不正确')
  }
  const now = Date.now()
  await pool.query('UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?', [now, now, user.id])
  user.last_login_at = now
  const session = await createSession(user.id, req)
  return { user: { ...toPublicUser(user), teamIds: await getUserTeamIds(user.id) }, session }
}

export async function cleanupAuthData() {
  const pool = getPool()
  const now = Date.now()
  await pool.query('DELETE FROM sessions WHERE expires_at < ?', [now])
  await pool.query('DELETE FROM email_codes WHERE expires_at < ? OR (used_at IS NOT NULL AND used_at < ?)', [
    now,
    now - 7 * 86400000,
  ])
}
