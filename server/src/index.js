import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { config, saveConfig, publicConfig } from './config.js'
import {
  db,
  publicState,
  broadcastState,
  createRequirement,
  createProject,
  updateProject,
  removeProject,
  findRequirement,
  removeRequirement,
  recoverInterrupted,
  persist,
} from './store.js'
import { ensureProjectPath } from './projectPath.js'
import { bus } from './bus.js'
import * as oc from './opencode.js'
import {
  splitRequirement,
  executeRequirement,
  abortRequirement,
  handleOpencodeEvent,
  HttpError,
} from './executor.js'
import { WEB_DIST } from './paths.js'

const app = express()
app.use(express.json({ limit: '2mb' }))

const PORT = Number(process.env.PORT || 4400)

/* ------------------------------ 健康检查 ------------------------------ */

let healthCache = { at: 0, data: { connected: false, demo: config.demo, version: '' } }
let eventsStarted = false

async function getHealth(force = false) {
  if (config.demo) {
    return { connected: true, demo: true, version: 'demo', url: config.opencodeUrl }
  }
  if (!force && Date.now() - healthCache.at < 4000) {
    return { ...healthCache.data, url: config.opencodeUrl }
  }
  const data = await oc.health()
  healthCache = { at: Date.now(), data }
  return { ...data, url: config.opencodeUrl }
}

function broadcastHealth(health) {
  bus.emit('health', { ...health, url: config.opencodeUrl })
}

function ensureEventStream() {
  if (config.demo) return
  if (!eventsStarted) {
    eventsStarted = true
    oc.startEventStream(handleOpencodeEvent)
  }
}

/* --------------------------- opencode 自动启动 --------------------------- */

let opencodeProcess = null

function isLocalUrl(raw) {
  try {
    const url = new URL(raw)
    return ['127.0.0.1', 'localhost', '::1', '0.0.0.0'].includes(url.hostname)
  } catch {
    return false
  }
}

function spawnOpencode() {
  if (opencodeProcess || config.demo || !config.autoStart) return
  if (!isLocalUrl(config.opencodeUrl)) return
  let url
  try {
    url = new URL(config.opencodeUrl)
  } catch {
    return
  }
  const port = url.port || '4096'
  const hostname = url.hostname === 'localhost' || url.hostname === '0.0.0.0' ? '127.0.0.1' : url.hostname
  console.log(`[opencode] 未检测到服务，尝试自动启动：opencode serve --port ${port} --hostname ${hostname}（cwd: ${config.projectDir}）`)
  try {
    opencodeProcess = spawn(
      'opencode',
      ['serve', '--port', String(port), '--hostname', hostname],
      {
        cwd: config.projectDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env,
      },
    )
    opencodeProcess.on('error', (err) => {
      console.warn('[opencode] 自动启动失败（未安装或不在 PATH 中）:', err.message)
      opencodeProcess = null
    })
    opencodeProcess.stdout?.on('data', (chunk) => process.stdout.write(`[opencode] ${chunk}`))
    opencodeProcess.stderr?.on('data', (chunk) => process.stderr.write(`[opencode] ${chunk}`))
    opencodeProcess.on('exit', (code) => {
      console.log(`[opencode] 进程退出，code=${code}`)
      opencodeProcess = null
      eventsStarted = false
    })
  } catch (err) {
    console.warn('[opencode] 自动启动异常:', err?.message)
    opencodeProcess = null
  }
}

async function waitForHealth(maxMs = 20000) {
  const started = Date.now()
  while (Date.now() - started < maxMs) {
    const data = await oc.health()
    if (data.connected) return data
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  return { connected: false }
}

/* -------------------------------- API -------------------------------- */

const asyncRoute = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next)
}

app.get(
  '/api/health',
  asyncRoute(async (req, res) => {
    const health = await getHealth(req.query.force === '1')
    res.json(health)
  }),
)

app.get('/api/state', asyncRoute(async (req, res) => {
  const health = await getHealth()
  res.json({ ...publicState(), health })
}))

app.put(
  '/api/config',
  asyncRoute(async (req, res) => {
    const before = { ...config }
    const next = saveConfig(req.body || {})

    if (next.opencodeUrl !== before.opencodeUrl || next.projectDir !== before.projectDir) {
      for (const requirement of db.requirements) requirement.sessionId = null
      persist(true)
      eventsStarted = false
      oc.stopEventStream()
    }
    if (before.demo && !next.demo) {
      eventsStarted = false
      oc.stopEventStream()
    }

    healthCache.at = 0
    const health = await getHealth(true)
    if (health.connected) ensureEventStream()
    else if (next.autoStart) spawnOpencode()

    broadcastHealth(health)
    broadcastState()
    res.json({ config: publicConfig(), health })
  }),
)

app.post(
  '/api/opencode/reconnect',
  asyncRoute(async (req, res) => {
    healthCache.at = 0
    let health = await getHealth(true)
    if (!health.connected && config.autoStart && !config.demo) {
      spawnOpencode()
      health = await waitForHealth(12000)
      health = { ...health, url: config.opencodeUrl }
      healthCache = { at: Date.now(), data: health }
    }
    if (health.connected) ensureEventStream()
    broadcastHealth(health)
    res.json(health)
  }),
)

app.get('/api/opencode/agents', asyncRoute(async (req, res) => {
  try {
    const data = await fetch(`${config.opencodeUrl}/agent`)
    if (!data.ok) throw new Error(`HTTP ${data.status}`)
    res.json(await data.json())
  } catch (err) {
    res.json({ error: err?.message || '无法获取 agents' })
  }
}))

app.post('/api/requirements', (req, res) => {
  const text = String(req.body?.text || '').trim()
  if (!text) return res.status(400).json({ error: '需求内容不能为空' })
  if (text.length > 20000) return res.status(400).json({ error: '需求内容过长（最多 20000 字）' })
  const projectId = String(req.body?.projectId || '') || null
  if (projectId && !db.projects.some((p) => p.id === projectId)) {
    return res.status(400).json({ error: '项目不存在' })
  }
  const requirement = createRequirement(text, projectId)
  res.status(201).json(requirement)
})

/* ----------------------------- 项目管理 ----------------------------- */

app.get('/api/projects', (req, res) => {
  res.json({ projects: db.projects })
})

app.post('/api/projects', (req, res) => {
  const name = String(req.body?.name || '').trim()
  const rawPath = String(req.body?.path || '').trim()
  if (!name) return res.status(400).json({ error: '项目名称不能为空' })
  if (!rawPath) return res.status(400).json({ error: '请填写项目的本地文件夹位置' })

  const create = req.body?.create !== false
  let info
  try {
    info = ensureProjectPath(rawPath, { create })
  } catch (err) {
    return res.status(400).json({ error: `目录处理失败：${err?.message || err}` })
  }
  if (!info.exists) {
    return res.status(400).json({ error: `目录不存在：${info.path}` })
  }

  const project = createProject({
    name,
    path: info.path,
    description: req.body?.description,
  })
  res.status(201).json({ project, created: info.created })
})

app.patch('/api/projects/:id', (req, res) => {
  const project = db.projects.find((p) => p.id === req.params.id)
  if (!project) return res.status(404).json({ error: '项目不存在' })

  const patch = {}
  if (req.body?.name !== undefined) {
    const name = String(req.body.name).trim()
    if (!name) return res.status(400).json({ error: '项目名称不能为空' })
    patch.name = name
  }
  if (req.body?.path !== undefined) {
    const rawPath = String(req.body.path).trim()
    if (!rawPath) return res.status(400).json({ error: '请填写项目的本地文件夹位置' })
    const info = ensureProjectPath(rawPath, { create: req.body?.create !== false })
    if (!info.exists) return res.status(400).json({ error: `目录不存在：${info.path}` })
    patch.path = info.path
  }
  if (req.body?.description !== undefined) patch.description = String(req.body.description)

  const updated = updateProject(project.id, patch)
  res.json(updated)
})

app.delete('/api/projects/:id', (req, res) => {
  const project = db.projects.find((p) => p.id === req.params.id)
  if (!project) return res.status(404).json({ error: '项目不存在' })
  removeProject(project.id)
  res.json({ ok: true })
})

app.delete('/api/requirements/:id', (req, res) => {
  const req0 = findRequirement(req.params.id)
  if (!req0) return res.status(404).json({ error: '需求不存在' })
  removeRequirement(req.params.id)
  res.json({ ok: true })
})

app.post('/api/requirements/:id/split', (req, res, next) => {
  const requirement = findRequirement(req.params.id)
  if (!requirement) return next(new HttpError(404, '需求不存在'))
  if (requirement.status === 'splitting' || requirement.status === 'running') {
    return next(new HttpError(409, '该需求正在处理中'))
  }
  if (requirement.status === 'done') {
    return next(new HttpError(400, '已完成的需求不能重新拆解'))
  }
  res.status(202).json({ ok: true })
  splitRequirement(requirement.id).catch((err) => console.error('[split]', err?.message))
})

app.post('/api/requirements/:id/execute', (req, res, next) => {
  const requirement = findRequirement(req.params.id)
  if (!requirement) return next(new HttpError(404, '需求不存在'))
  if (requirement.status === 'running' || requirement.status === 'splitting') {
    return next(new HttpError(409, '该需求正在执行中'))
  }
  const taskIds = Array.isArray(req.body?.taskIds) ? req.body.taskIds : undefined
  res.status(202).json({ ok: true })
  executeRequirement(requirement.id, taskIds).catch((err) => console.error('[execute]', err?.message))
})

app.post('/api/requirements/:id/abort', asyncRoute(async (req, res) => {
  const requirement = findRequirement(req.params.id)
  if (!requirement) throw new HttpError(404, '需求不存在')
  await abortRequirement(requirement.id)
  res.json({ ok: true })
}))

app.post('/api/requirements/:id/tasks/:taskId/retry', (req, res, next) => {
  const requirement = findRequirement(req.params.id)
  if (!requirement) return next(new HttpError(404, '需求不存在'))
  const task = requirement.tasks.find((item) => item.id === req.params.taskId)
  if (!task) return next(new HttpError(404, '任务不存在'))
  if (requirement.status === 'running' || requirement.status === 'splitting') {
    return next(new HttpError(409, '该需求正在执行中'))
  }
  task.status = 'pending'
  task.error = null
  res.status(202).json({ ok: true })
  executeRequirement(requirement.id, [task.id]).catch((err) => console.error('[retry]', err?.message))
})

/* ------------------------------- SSE ------------------------------- */

app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  res.write('retry: 3000\n\n')

  const send = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`)

  send('state', publicState())

  const unsubscribe = bus.subscribe(({ type, data }) => send(type, data))
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 20000)

  req.on('close', () => {
    clearInterval(heartbeat)
    unsubscribe()
  })
})

/* ------------------------------ 静态资源 ------------------------------ */

if (fs.existsSync(WEB_DIST)) {
  app.use(express.static(WEB_DIST))
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next()
    res.sendFile(path.join(WEB_DIST, 'index.html'))
  })
} else {
  app.get('/', (req, res) => {
    res
      .status(200)
      .send('前端尚未构建。开发模式请访问 Vite 服务（npm run dev），或先执行 npm run build。')
  })
}

/* ------------------------------ 错误处理 ------------------------------ */

app.use((err, req, res, next) => {
  const status = err?.status || 500
  if (status >= 500) console.error('[server]', err)
  res.status(status).json({ error: err?.message || '服务器内部错误' })
})

/* ------------------------------ 启动 ------------------------------ */

process.on('SIGINT', () => {
  if (opencodeProcess) opencodeProcess.kill()
  persist(true)
  process.exit(0)
})
process.on('SIGTERM', () => {
  if (opencodeProcess) opencodeProcess.kill()
  persist(true)
  process.exit(0)
})

recoverInterrupted()

/** 首次启动时创建一个默认项目，并把历史需求归入该项目 */
function ensureDefaultProject() {
  if (!db.projects.length) {
    const project = createProject({
      name: '默认项目',
      path: config.projectDir,
      description: '自动创建，可以随时改名或换目录',
    })
    console.log(`[project] 已创建默认项目：${project.name}（${project.path}）`)
  }
  let changed = false
  for (const requirement of db.requirements) {
    if (!requirement.projectId) {
      requirement.projectId = db.projects[0].id
      changed = true
    }
  }
  if (changed) persist(true)
}

ensureDefaultProject()

app.listen(PORT, async () => {
  console.log(`\n  AutoCode 服务已启动: http://localhost:${PORT}`)
  console.log(`  opencode 服务地址: ${config.opencodeUrl}${config.demo ? '（演示模式）' : ''}`)
  if (!config.demo && !fs.existsSync(WEB_DIST)) {
    console.log('  提示：前端开发模式请运行 npm run dev，然后访问 http://localhost:5173')
  }

  const health = await getHealth(true)
  broadcastHealth(health)

  if (health.connected) {
    ensureEventStream()
  } else if (config.autoStart) {
    spawnOpencode()
    waitForHealth(20000).then((result) => {
      const latest = { ...result, url: config.opencodeUrl }
      healthCache = { at: Date.now(), data: latest }
      broadcastHealth(latest)
      if (latest.connected) {
        ensureEventStream()
        console.log('[opencode] 自动启动成功')
      }
    })
  }

  setInterval(async () => {
    const previous = healthCache.data
    const latest = await getHealth(true)
    if (!latest.connected) eventsStarted = false
    const changed =
      previous.connected !== latest.connected || previous.demo !== latest.demo || previous.version !== latest.version
    if (changed) broadcastHealth(latest)
    if (latest.connected) ensureEventStream()
  }, 15000).unref()
})
