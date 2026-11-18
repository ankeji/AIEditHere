import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CUSTOM_PROVIDER_ID, config } from './config.js'

let cachedFile = null

/**
 * 解析 opencode 的全局配置文件路径。
 * 优先用 `opencode debug paths config` 探测（跨平台、跟随安装版本），
 * 失败时回退到 ~/.config/opencode/opencode.jsonc。
 */
export function resolveOpencodeConfigFile() {
  if (cachedFile) return cachedFile
  let detected = ''
  try {
    const res = spawnSync('opencode', ['debug', 'paths', 'config'], {
      encoding: 'utf8',
      timeout: 8000,
      windowsHide: true,
    })
    if (res.status === 0 && res.stdout) {
      detected = res.stdout.trim().split(/\r?\n/).pop().trim()
    }
  } catch {
    /* 探测失败按默认路径处理 */
  }
  let file
  if (detected) {
    file = /\.jsonc?$/i.test(detected) ? detected : path.join(detected, 'opencode.jsonc')
  } else {
    const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')
    file = path.join(base, 'opencode', 'opencode.jsonc')
  }
  cachedFile = file
  return file
}

/** 去掉 JSONC 的注释与尾随逗号，得到可 JSON.parse 的字符串。 */
function stripJsonc(text) {
  let out = ''
  let inStr = false
  let quote = ''
  let esc = false
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]
    const n = text[i + 1]
    if (inStr) {
      out += c
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === quote) inStr = false
      continue
    }
    if (c === '"') {
      inStr = true
      quote = c
      out += c
      continue
    }
    if (c === '/' && n === '/') {
      while (i < text.length && text[i] !== '\n') i += 1
      out += '\n'
      continue
    }
    if (c === '/' && n === '*') {
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1
      i += 1
      continue
    }
    out += c
  }
  return out.replace(/,(\s*[}\]])/g, '$1')
}

function writeSecretFile(value) {
  const secretFile = path.join(path.dirname(resolveOpencodeConfigFile()), 'aiedithere-api-key')
  if (value) {
    fs.mkdirSync(path.dirname(secretFile), { recursive: true })
    fs.writeFileSync(secretFile, `${value}\n`, { encoding: 'utf8', mode: 0o600 })
  } else {
    try {
      fs.unlinkSync(secretFile)
    } catch {
      /* 文件不存在 */
    }
  }
  // 相对路径，opencode 会相对配置文件所在目录解析
  return value ? `{file:${path.basename(secretFile)}}` : ''
}

function readConfigFile(file) {
  let raw = ''
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch {
    return {}
  }
  if (!raw.trim()) return {}
  return JSON.parse(stripJsonc(raw))
}

function buildLegacyEntry(settings, keyReference) {
  const model = settings.apiModelName
  const auth = keyReference ? { apiKey: keyReference } : {}
  return {
    name: 'AIEditHere',
    npm: '@ai-sdk/openai-compatible',
    options: { baseURL: settings.apiBaseUrl, ...auth },
    models: { [model]: { name: model } },
  }
}

/**
 * 把统一配置的 API（Base URL / 模型名 / API Key）写入 opencode 全局配置。
 * 未配置时移除之前写入的 provider。返回写入的文件与是否已应用。
 */
export function syncCustomProvider() {
  const file = resolveOpencodeConfigFile()
  const json = readConfigFile(file)
  const hasCustom = Boolean(config.apiBaseUrl && config.apiModelName)

  if (!json.provider || typeof json.provider !== 'object') json.provider = {}
  if (!json.providers || typeof json.providers !== 'object') json.providers = {}

  if (hasCustom) {
    const keyReference = writeSecretFile(config.apiKey)
    json.provider[CUSTOM_PROVIDER_ID] = buildLegacyEntry(config, keyReference)
    json.model = `${CUSTOM_PROVIDER_ID}/${config.apiModelName}`
  } else {
    delete json.provider[CUSTOM_PROVIDER_ID]
    if (String(json.model || '').startsWith(`${CUSTOM_PROVIDER_ID}/`)) delete json.model
  }

  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(json, null, 2), 'utf8')
  fs.renameSync(tmp, file)
  return { file, applied: hasCustom }
}
