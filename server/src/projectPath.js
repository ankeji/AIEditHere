import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** 规范化项目目录：支持 ~ 开头，转成绝对路径 */
export function normalizeProjectPath(input) {
  let value = String(input || '').trim()
  if (!value) return ''
  if (value === '~') value = os.homedir()
  else if (value.startsWith('~/')) value = path.join(os.homedir(), value.slice(2))
  return path.resolve(value)
}

/** 解析项目目录，必要时创建 */
export function ensureProjectPath(input, { create = false } = {}) {
  const resolved = normalizeProjectPath(input)
  if (!resolved) return { path: '', exists: false, created: false }
  if (fs.existsSync(resolved)) {
    return { path: resolved, exists: true, created: false }
  }
  if (create) {
    fs.mkdirSync(resolved, { recursive: true })
    return { path: resolved, exists: true, created: true }
  }
  return { path: resolved, exists: false, created: false }
}
