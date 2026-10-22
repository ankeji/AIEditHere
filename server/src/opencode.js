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
  // opencode 支持用 x-opencode-directory 指定项目目录，
  // 这样同一个 opencode 服务可以服务多个项目，代码只会写在对应项目里。
  if (directory) {
    headers['x-opencode-directory'] = encodeURIComponent(directory)
    if (method === 'GET' || method === 'HEAD') {
      target.searchParams.set('directory', directory)
    }
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
  const model = parseModel()
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
