import fs from 'node:fs'
import http from 'node:http'
import zlib from 'node:zlib'
import httpProxy from 'http-proxy'

const pickerScript = fs.readFileSync(
  new URL('./preview-picker.client.js', import.meta.url),
  'utf8',
)

const proxies = new Map()

const STRIP_HEADERS = [
  'content-security-policy',
  'content-security-policy-report-only',
  'x-frame-options',
  'cross-origin-embedder-policy',
  'cross-origin-opener-policy',
  'cross-origin-resource-policy',
]

function normalizeTarget(raw) {
  const value = String(raw || '').trim()
  if (!value) return null
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol)) return null
    if (url.hostname.toLowerCase() === 'localhost') url.hostname = '127.0.0.1'
    return url
  } catch {
    return null
  }
}

function decodeBody(buffer, encoding) {
  const value = String(encoding || '').toLowerCase()
  try {
    if (value.includes('br')) return zlib.brotliDecompressSync(buffer)
    if (value.includes('gzip')) return zlib.gunzipSync(buffer)
    if (value.includes('deflate')) return zlib.inflateSync(buffer)
  } catch {
    /* 解压失败时按原始内容处理 */
  }
  return buffer
}

function injectPicker(html) {
  const tag = '<script src="/__ai_edit_picker.js"></script>'
  // 尽早注入，保证选择器的事件监听先于业务页面注册，避免点击时被业务代码先处理
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (match) => `${match}${tag}`)
  }
  if (/<body[^>]*>/i.test(html)) {
    return html.replace(/<body[^>]*>/i, (match) => `${match}${tag}`)
  }
  if (/<\/body\s*>/i.test(html)) return html.replace(/<\/body\s*>/i, `${tag}</body>`)
  if (/<\/html\s*>/i.test(html)) return html.replace(/<\/html\s*>/i, `${tag}</html>`)
  return `${html}${tag}`
}

function rewriteLocation(location, target, state) {
  if (!location) return location
  try {
    const url = new URL(location, target)
    if (url.origin !== target.origin) return location
    return `${String(state.url || '').replace(/\/$/, '')}${url.pathname}${url.search}${url.hash}`
  } catch {
    return location
  }
}

function copyHeaders(headers, { stripBodyHeaders = false } = {}) {
  const next = { ...headers }
  for (const name of STRIP_HEADERS) delete next[name]
  if (stripBodyHeaders) {
    delete next['content-length']
    delete next['content-encoding']
    delete next['transfer-encoding']
  }
  return next
}

function handleProxyResponse(proxyRes, req, res, target, state) {
  const contentType = String(proxyRes.headers['content-type'] || '')
  const isHtml = /text\/html|application\/xhtml\+xml/i.test(contentType)

  if (!isHtml) {
    const headers = copyHeaders(proxyRes.headers)
    if (headers.location) headers.location = rewriteLocation(headers.location, target, state)
    res.writeHead(proxyRes.statusCode || 200, headers)
    proxyRes.pipe(res)
    return
  }

  const chunks = []
  proxyRes.on('data', (chunk) => chunks.push(chunk))
  proxyRes.on('end', () => {
    const buffer = decodeBody(Buffer.concat(chunks), proxyRes.headers['content-encoding'])
    let body = buffer.toString('utf8')
    body = injectPicker(body)
    const headers = copyHeaders(proxyRes.headers, { stripBodyHeaders: true })
    headers['content-type'] = contentType || 'text/html; charset=utf-8'
    headers['content-length'] = Buffer.byteLength(body)
    res.writeHead(proxyRes.statusCode || 200, headers)
    res.end(body)
  })
  proxyRes.on('error', () => {
    try {
      res.destroy()
    } catch {
      /* 忽略 */
    }
  })
}

function createProxyEntry(target) {
  const state = { url: '' }
  const proxy = httpProxy.createProxyServer({
    target: target.href,
    changeOrigin: true,
    ws: true,
    secure: false,
    selfHandleResponse: true,
    prependPath: true,
    xfwd: false,
  })

  proxy.on('proxyReq', (proxyReq) => {
    // 关闭压缩，便于在 HTML 响应中注入选择脚本
    try {
      proxyReq.removeHeader('accept-encoding')
    } catch {
      /* 忽略 */
    }
  })

  proxy.on('proxyRes', (proxyRes, req, res) => {
    handleProxyResponse(proxyRes, req, res, target, state)
  })

  proxy.on('error', (err, req, res) => {
    if (res && typeof res.writeHead === 'function' && !res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end(`预览代理连接失败：${err?.message || err}`)
      return
    }
    if (res && typeof res.destroy === 'function') res.destroy()
  })

  const server = http.createServer((req, res) => {
    if (req.url === '/__ai_edit_picker.js' || req.url?.startsWith('/__ai_edit_picker.js?')) {
      res.writeHead(200, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'no-store',
      })
      res.end(pickerScript)
      return
    }
    proxy.web(req, res)
  })

  server.on('upgrade', (req, socket, head) => {
    proxy.ws(req, socket, head)
  })

  return { proxy, server, target, state }
}

function listen(server) {
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      server.removeListener('listening', onListening)
      reject(err)
    }
    const onListening = () => {
      server.removeListener('error', onError)
      resolve()
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(0, '127.0.0.1')
  })
}

export async function ensureProjectPreviewProxy(project) {
  if (!project?.id) return null
  const target = normalizeTarget(project.previewUrl)
  if (!target) return null

  const existing = proxies.get(project.id)
  if (existing && existing.target.href === target.href) return existing.state.url
  if (existing) await closeProjectPreviewProxy(project.id)

  const entry = createProxyEntry(target)
  try {
    await listen(entry.server)
  } catch (err) {
    try {
      entry.proxy.close()
    } catch {
      /* 忽略 */
    }
    throw err
  }

  const address = entry.server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  entry.state.url = `http://127.0.0.1:${port}/`
  proxies.set(project.id, entry)
  return entry.state.url
}

export async function closeProjectPreviewProxy(projectId) {
  const entry = proxies.get(projectId)
  if (!entry) return
  proxies.delete(projectId)
  await new Promise((resolve) => {
    try {
      entry.server.close(() => resolve())
    } catch {
      resolve()
    }
    setTimeout(resolve, 500).unref?.()
  })
  try {
    entry.proxy.close()
  } catch {
    /* 忽略 */
  }
}

export async function closeAllPreviewProxies() {
  await Promise.all([...proxies.keys()].map((projectId) => closeProjectPreviewProxy(projectId)))
}
