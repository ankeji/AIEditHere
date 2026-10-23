import { config, parseModel } from './config.js'

export class OpencodeError extends Error {
  constructor(message) {
    super(message)
    this.name = 'OpencodeError'
  }
}

function base() {
  return config.opencodeUrl.replace(/\/+$/, '')
}

async function request(pathname, { method = 'GET', body, timeout = 30000, directory } = {}) {
  const controller = new AbortController()
  const timer = timeout > 0 ? setTimeout(() => controller.abort(), timeout) : null
  const target = new URL(base() + pathname)
  const headers = {
    Accept: 'application/json',
    ...(body ? { 'Content-Type': 'application/json' } : {}),
  }
  // opencode 1.19 起通过查询参数 directory 指定项目目录（同一个服务可以服务多个项目），
  // 老版本用的是 x-opencode-directory 头，这里同时带上，兼容两种实现。
  if (directory) {
    target.searchParams.set('directory', directory)
    headers['x-opencode-directory'] = encodeURIComponent(directory)
  }
  try {
    const res = await fetch(target.toString(), {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })
    const text = await res.text()
    let data = null
    if (text) {
      try {
        data = JSON.parse(text)
      } catch {
        data = text
      }
    }
    if (!res.ok) {
      const detail = typeof data === 'string' ? data.slice(0, 400) : JSON.stringify(data).slice(0, 400)
      throw new OpencodeError(`opencode 接口 ${method} ${pathname} 返回 ${res.status} ${detail}`)
    }
    return data
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new OpencodeError(`请求 opencode 超时：${method} ${pathname}`)
    }
    if (err instanceof OpencodeError) throw err
    throw new OpencodeError(`无法连接 opencode（${base()}）：${err?.message || err}`)
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export async function health() {
  if (config.demo) {
    return { connected: true, demo: true, version: 'demo' }
  }
  try {
    const data = await request('/global/health', { timeout: 2500 })
    return { connected: true, demo: false, version: data?.version || 'unknown' }
  } catch {
    return { connected: false, demo: false, version: '' }
  }
}

/* --------------------------- 模型目录 / 校验 --------------------------- */

let catalogCache = { at: 0, data: null }
const CATALOG_TTL = 5 * 60 * 1000

/**
 * 拉取 opencode 当前可用的模型列表。
 * 返回 { models: [{ providerID, providerName, modelID, name }], default: 'provider/model' }
 */
export async function modelCatalog({ force = false } = {}) {
  if (!force && catalogCache.data && Date.now() - catalogCache.at < CATALOG_TTL) {
    return catalogCache.data
  }
  const [providers, cfg] = await Promise.all([
    request('/config/providers', { timeout: 8000 }),
    request('/config', { timeout: 8000 }).catch(() => null),
  ])
  const list = Array.isArray(providers?.providers)
    ? providers.providers
    : Object.values(providers?.providers || {})
  const models = []
  for (const provider of list) {
    if (!provider || typeof provider !== 'object') continue
    const providerID = provider.id || provider.providerID || ''
    if (!providerID) continue
    const providerName = provider.name || providerID
    const source = provider.models && typeof provider.models === 'object' ? provider.models : {}
    for (const [modelID, meta] of Object.entries(source)) {
      models.push({
        providerID,
        providerName,
        modelID,
        name: meta?.name || modelID,
      })
    }
  }
  const data = { models, default: String(cfg?.model || '').trim() }
  catalogCache = { at: Date.now(), data }
  return data
}

function modelLabel(model) {
  return `${model.providerID}/${model.modelID}`
}

/**
 * 解析出这次请求要用的模型，并校验它确实存在于 opencode 里。
 * 不存在时直接抛出可读的错误（而不是让 opencode 返回 500）。
 */
export async function resolveModel() {
  const wanted = String(config.model || '').trim()
  if (wanted && !parseModel(wanted)) {
    throw new OpencodeError(`设置中的模型「${wanted}」格式不正确，应为 provider/model，例如 opencode/big-pickle`)
  }
  let catalog = null
  try {
    catalog = await modelCatalog()
  } catch {
    // 老版本 opencode 没有 /config/providers，跳过校验
    return wanted ? parseModel(wanted) : null
  }
  const raw = wanted || catalog.default
  if (!raw) return wanted ? parseModel(wanted) : null
  const parsed = parseModel(raw)
  if (!parsed) return null
  const exists = catalog.models.some(
    (m) => m.providerID === parsed.providerID && m.modelID === parsed.modelID,
  )
  if (!exists) {
    const sameProvider = catalog.models
      .filter((m) => m.providerID === parsed.providerID)
      .map(modelLabel)
    const suggestions = (sameProvider.length ? sameProvider : catalog.models.map(modelLabel)).slice(0, 8)
    const hint = suggestions.length
      ? `可用模型：${suggestions.join('、')}${sameProvider.length > 8 ? ' …' : ''}`
      : 'opencode 中没有可用模型，请先执行 `opencode auth login` 配置模型'
    const source = wanted ? 'AutoCode 设置中的模型' : 'opencode 默认模型'
    throw new OpencodeError(
      `${source}「${raw}」不存在。${hint}。请在设置中选择可用模型，或修改 opencode 配置。`,
    )
  }
  return parsed
}

export async function createSession(title, directory) {
  const data = await request('/session', { method: 'POST', body: { title }, directory })
  const id = data?.id || data?.session?.id
  if (!id) throw new OpencodeError('创建 opencode 会话失败：响应中缺少会话 ID')
  return id
}

export async function deleteSession(id) {
  try {
    await request(`/session/${encodeURIComponent(id)}`, { method: 'DELETE' })
  } catch {
    /* 会话删除失败不影响主流程 */
  }
}

/**
 * 发送消息并等待回复。
 * @param {string} sessionId
 * @param {{ text: string, format?: object, system?: string }} options
 */
export async function prompt(sessionId, { text, format, system, timeout = 30 * 60 * 1000 } = {}, directory) {
  if (!config.demo) {
    const h = await health()
    if (!h.connected) {
      throw new OpencodeError(
        'opencode 未连接。请先启动 `opencode serve`，或在设置中开启「演示模式」。',
      )
    }
  }
  const body = {
    parts: [{ type: 'text', text }],
  }
  const model = await resolveModel()
  if (model) body.model = model
  if (config.agent) body.agent = config.agent
  if (format) body.format = format
  if (system) body.system = system
  return request(`/session/${encodeURIComponent(sessionId)}/message`, {
    method: 'POST',
    body,
    timeout,
    directory,
  })
}

export async function abortSession(sessionId, directory) {
  try {
    await request(`/session/${encodeURIComponent(sessionId)}/abort`, {
      method: 'POST',
      timeout: 8000,
      directory,
    })
  } catch {
    /* 中止失败可忽略 */
  }
}

let streamController = null

export function stopEventStream() {
  if (streamController) {
    streamController.abort()
    streamController = null
  }
}

/**
 * 订阅 opencode 的 SSE 事件流（自动重连）。
 */
export function startEventStream(onEvent) {
  stopEventStream()
  if (config.demo) return
  const controller = new AbortController()
  streamController = controller

  const run = async () => {
    while (!controller.signal.aborted) {
      try {
        const res = await fetch(`${base()}/event`, {
          headers: { Accept: 'text/event-stream' },
          signal: controller.signal,
        })
        if (!res.ok || !res.body) throw new Error(`事件流不可用 (${res.status})`)
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        while (!controller.signal.aborted) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          let idx
          while ((idx = buffer.indexOf('\n\n')) >= 0) {
            const frame = buffer.slice(0, idx)
            buffer = buffer.slice(idx + 2)
            const dataLines = frame
              .split('\n')
              .filter((line) => line.startsWith('data:'))
              .map((line) => line.slice(5).trim())
            if (!dataLines.length) continue
            try {
              const evt = JSON.parse(dataLines.join('\n'))
              onEvent(evt)
            } catch {
              /* 忽略无法解析的事件 */
            }
          }
        }
      } catch {
        /* 连接断开后重试 */
      }
      if (controller.signal.aborted) return
      await new Promise((resolve) => setTimeout(resolve, 2500))
    }
  }

  run()
}
