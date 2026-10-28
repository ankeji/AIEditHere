import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR, ROOT_DIR } from './paths.js'

const CONFIG_FILE = path.join(DATA_DIR, 'config.json')

const DEFAULTS = {
  /** opencode serve 地址 */
  opencodeUrl: process.env.OPENCODE_URL || 'http://127.0.0.1:4096',
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

function readFile() {
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8')
    const data = JSON.parse(raw)
    return data && typeof data === 'object' ? data : {}
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
  if (typeof patch.model === 'string') next.model = patch.model.trim()
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
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2), 'utf8')
  fs.renameSync(tmp, CONFIG_FILE)
  return config
}

export function publicConfig() {
  return {
    opencodeUrl: config.opencodeUrl,
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
