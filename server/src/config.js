import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { authConfig } from './auth/config.js'
import { DATA_DIR, ROOT_DIR } from './paths.js'

const CONFIG_FILE = path.join(DATA_DIR, 'config.json')
export const CUSTOM_PROVIDER_ID = 'aiedithere'

const DEFAULTS = {
  /** opencode serve 地址 */
  opencodeUrl: process.env.OPENCODE_URL || 'http://127.0.0.1:4096',
  /** 统一配置的 API 地址（OpenAI-compatible Base URL） */
  apiBaseUrl: process.env.OPENCODE_API_BASE_URL || '',
  /** 统一配置的模型名称，发送给 API 的 model 字段 */
  apiModelName: process.env.OPENCODE_API_MODEL || '',
  /** 统一配置的 API Key；不会通过 publicConfig 返回 */
  apiKey: process.env.OPENCODE_API_KEY || '',
  /** 模型，格式 provider/model，留空使用 opencode 默认模型 */
  model: process.env.OPENCODE_MODEL || '',
  /** agent，留空使用默认 agent */
  agent: process.env.OPENCODE_AGENT || '',
  /** 被控制的目标项目目录 */
  projectDir: process.env.AIEDITHERE_PROJECT || ROOT_DIR,
  /** 连接不到时自动执行 opencode serve */
  autoStart: true,
  /** 演示模式：不调用 opencode，本地模拟拆解与执行 */
  demo: process.env.DEMO === '1' || process.env.DEMO === 'true',
}

function deriveKey() {
  return crypto.createHash('sha256').update(String(authConfig.secret || 'aiedithere')).digest()
}

function encryptSecret(plain) {
  const value = String(plain || '')
  if (!value) return ''
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(), iv)
  const enc = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return `enc:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${enc.toString('base64')}`
}

function decryptSecret(blob) {
  const value = String(blob || '')
  if (!value) return ''
  if (!value.startsWith('enc:')) return value
  try {
    const [, ivB64, tagB64, dataB64] = value.split(':')
    const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(), Buffer.from(ivB64, 'base64'))
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8')
  } catch {
    return ''
  }
}

function readFile() {
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8')
    const data = JSON.parse(raw)
    if (!data || typeof data !== 'object') return {}
    if (typeof data.apiKey === 'string' && data.apiKey) data.apiKey = decryptSecret(data.apiKey)
    return data
  } catch {
    return {}
  }
}

export const config = { ...DEFAULTS, ...readFile() }

function normalize(patch) {
  const next = { ...config }
  if (typeof patch.opencodeUrl === 'string' && patch.opencodeUrl.trim()) {
    let url = patch.opencodeUrl.trim().replace(/\/+$/, '')
    if (!/^https?:\/\//i.test(url)) url = `http://${url}`
    next.opencodeUrl = url
  }
  if (typeof patch.apiBaseUrl === 'string') {
    next.apiBaseUrl = patch.apiBaseUrl.trim().replace(/\/+$/, '')
  }
  if (typeof patch.apiModelName === 'string') next.apiModelName = patch.apiModelName.trim()
  if (typeof patch.apiKey === 'string') next.apiKey = patch.apiKey.trim()
  if (typeof patch.model === 'string') next.model = patch.model.trim()
  // 配置了统一 API 后，执行时使用该 provider 下的模型
  if (next.apiBaseUrl && next.apiModelName) {
    next.model = `${CUSTOM_PROVIDER_ID}/${next.apiModelName}`
  } else if (String(next.model || '').startsWith(`${CUSTOM_PROVIDER_ID}/`)) {
    // 清空自定义 API 后，移除指向该 provider 的默认模型，避免指向不存在的模型
    next.model = ''
  }
  if (typeof patch.agent === 'string') next.agent = patch.agent.trim()
  if (typeof patch.projectDir === 'string' && patch.projectDir.trim()) {
    next.projectDir = path.resolve(patch.projectDir.trim())
  }
  if (typeof patch.autoStart === 'boolean') next.autoStart = patch.autoStart
  if (typeof patch.demo === 'boolean') next.demo = patch.demo
  return next
}

export function saveConfig(patch = {}) {
  Object.assign(config, normalize(patch))
  const tmp = `${CONFIG_FILE}.tmp`
  const persisted = { ...config, apiKey: encryptSecret(config.apiKey) }
  fs.writeFileSync(tmp, JSON.stringify(persisted, null, 2), 'utf8')
  fs.renameSync(tmp, CONFIG_FILE)
  return config
}

export function publicConfig() {
  return {
    opencodeUrl: config.opencodeUrl,
    apiBaseUrl: config.apiBaseUrl,
    apiModelName: config.apiModelName,
    apiKeyConfigured: Boolean(config.apiKey),
    model: config.model,
    agent: config.agent,
    projectDir: config.projectDir,
    autoStart: config.autoStart,
    demo: config.demo,
  }
}

/** "anthropic/claude-sonnet-4-5" => { providerID, modelID } */
export function parseModel(value = config.model) {
  const raw = String(value || '').trim()
  if (!raw) return undefined
  const idx = raw.indexOf('/')
  if (idx <= 0 || idx === raw.length - 1) return undefined
  return { providerID: raw.slice(0, idx), modelID: raw.slice(idx + 1) }
}
