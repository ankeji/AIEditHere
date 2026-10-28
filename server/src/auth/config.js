function num(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export const authConfig = {
  db: {
    host: process.env.MYSQL_HOST || process.env.DB_HOST || '127.0.0.1',
    port: num(process.env.MYSQL_PORT || process.env.DB_PORT, 3306),
    user: process.env.MYSQL_USER || process.env.DB_USER || 'root',
    password: process.env.MYSQL_PASSWORD ?? process.env.DB_PASSWORD ?? '',
    database: process.env.MYSQL_DATABASE || process.env.DB_NAME || 'aiedithere',
  },
  secret: process.env.AUTH_SECRET || 'aiedithere-local-dev-secret',
  sessionDays: num(process.env.AUTH_SESSION_DAYS, 14),
  codeTtlMinutes: num(process.env.AUTH_CODE_TTL_MINUTES, 10),
  codeCooldownSeconds: num(process.env.AUTH_CODE_COOLDOWN_SECONDS, 60),
  allowDevCode: process.env.AUTH_ALLOW_DEV_CODE !== '0',
  cookieName: process.env.AUTH_COOKIE_NAME || 'aiedithere_session',
  cookieSecure: process.env.AUTH_COOKIE_SECURE === '1',
  smtp: {
    host: String(process.env.SMTP_HOST || '').trim(),
    port: num(process.env.SMTP_PORT, 587),
    secure:
      process.env.SMTP_SECURE === '1' ||
      process.env.SMTP_SECURE === 'true' ||
      Number(process.env.SMTP_PORT) === 465,
    user: String(process.env.SMTP_USER || '').trim(),
    pass: String(process.env.SMTP_PASS || ''),
    from: String(process.env.SMTP_FROM || process.env.SMTP_USER || '').trim(),
  },
}

export function mailConfigured() {
  return Boolean(authConfig.smtp.host && authConfig.smtp.from)
}
