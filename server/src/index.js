import express from 'express'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
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
  findProject,
  setProjectDeploy,
  findRequirement,
  removeRequirement,
  recoverInterrupted,
  persist,
  touch,
} from './store.js'
import { ensureProjectPath, normalizeProjectPath } from './projectPath.js'
import { bus } from './bus.js'
import * as oc from './opencode.js'
import {
  splitRequirement,
  executeRequirement,
  abortRequirement,
  handleOpencodeEvent,
  HttpError,
} from './executor.js'
import {
  normalizeDeploy,
  runDeploy,
  abortEnvDeploy,
  isEnvDeploying,
  getDeployLogs,
} from './deploy.js'
import { WEB_DIST, DATA_DIR } from './paths.js'

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

app.get('/api/opencode/models', asyncRoute(async (req, res) => {
  if (config.demo) return res.json({ models: [], default: '', error: null })
  try {
    const catalog = await oc.modelCatalog({ force: req.query.force === '1' })
    res.json({ models: catalog.models, default: catalog.default, error: null })
  } catch (err) {
    res.json({ models: [], default: '', error: err?.message || '无法获取 opencode 模型列表' })
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

/* -------------------------- 项目部署配置 & 部署 -------------------------- */

app.put('/api/projects/:id/deploy', (req, res, next) => {
  const project = findProject(req.params.id)
  if (!project) return next(new HttpError(404, '项目不存在'))
  const deploy = normalizeDeploy(req.body || {}, project)
  const updated = setProjectDeploy(project.id, deploy)
  res.json({ project: updated })
})

app.post('/api/projects/:id/deploy/:envId', (req, res, next) => {
  const project = findProject(req.params.id)
  if (!project) return next(new HttpError(404, '项目不存在'))
  const env = (project.deploy?.environments || []).find((item) => item.id === req.params.envId)
  if (!env) return next(new HttpError(404, '部署环境不存在'))
  if (isEnvDeploying(project.id, env.id) || env.lastStatus === 'running') {
    return next(new HttpError(409, '该环境正在部署中'))
  }
  if (!env.host || !env.username || !env.remoteDir) {
    return next(new HttpError(400, '请先填写服务器地址、用户名和远程目录'))
  }
  const runId = crypto.randomUUID()
  res.status(202).json({ runId })
  runDeploy(project, env, runId).catch((err) => console.error('[deploy]', err?.message))
})

app.post('/api/projects/:id/deploy/:envId/abort', (req, res, next) => {
  const project = findProject(req.params.id)
  if (!project) return next(new HttpError(404, '项目不存在'))
  const env = (project.deploy?.environments || []).find((item) => item.id === req.params.envId)
  if (!env) return next(new HttpError(404, '部署环境不存在'))
  const ok = abortEnvDeploy(project, env)
  res.json({ ok })
})

app.get('/api/projects/:id/deploy/:envId/logs', (req, res, next) => {
  const project = findProject(req.params.id)
  if (!project) return next(new HttpError(404, '项目不存在'))
  const env = (project.deploy?.environments || []).find((item) => item.id === req.params.envId)
  if (!env) return next(new HttpError(404, '部署环境不存在'))
  res.json({ logs: getDeployLogs(project.id, env.id) })
})

app.delete('/api/requirements/:id', (req, res) => {
  const req0 = findRequirement(req.params.id)
  if (!req0) return res.status(404).json({ error: '需求不存在' })
  removeRequirementFiles(req0)
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

/* --------------------------- 本地文件系统浏览 --------------------------- */

function listWindowsDrives() {
  const drives = []
  for (let i = 67; i <= 90; i += 1) {
    const letter = String.fromCharCode(i)
    const root = `${letter}:\\`
    try {
      if (fs.existsSync(root)) drives.push({ name: root, path: root })
    } catch {
      /* 忽略不可访问的盘符 */
    }
  }
  return drives
}

app.get('/api/fs/inspect', (req, res) => {
  const raw = String(req.query.path || '').trim()
  if (!raw) return res.json({ path: '', exists: false, isDir: false })
  let resolved
  try {
    resolved = normalizeProjectPath(raw)
  } catch (err) {
    return res.status(400).json({ error: `路径无效：${err?.message || err}` })
  }
  let exists = false
  let isDir = false
  try {
    const stat = fs.statSync(resolved)
    exists = true
    isDir = stat.isDirectory()
  } catch {
    exists = false
  }
  let packageName = ''
  let isGit = false
  if (exists && isDir) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(resolved, 'package.json'), 'utf8'))
      if (pkg && typeof pkg.name === 'string') packageName = pkg.name
    } catch {
      /* 没有 package.json */
    }
    try {
      isGit = fs.existsSync(path.join(resolved, '.git'))
    } catch {
      /* 忽略 */
    }
  }
  res.json({
    path: resolved,
    name: path.basename(resolved) || resolved,
    exists,
    isDir,
    packageName,
    isGit,
  })
})

app.get('/api/fs/list', (req, res) => {
  const target = String(req.query.path || '').trim()
  let resolved
  try {
    resolved = target ? normalizeProjectPath(target) : os.homedir()
  } catch {
    resolved = os.homedir()
  }
  let isDir = false
  try {
    isDir = fs.statSync(resolved).isDirectory()
  } catch {
    isDir = false
  }
  let dirs = []
  if (isDir) {
    try {
      dirs = fs
        .readdirSync(resolved, { withFileTypes: true })
        .filter((entry) => {
          if (entry.isDirectory()) return true
          if (entry.isSymbolicLink()) {
            try {
              return fs.statSync(path.join(resolved, entry.name)).isDirectory()
            } catch {
              return false
            }
          }
          return false
        })
        .map((entry) => ({ name: entry.name, path: path.join(resolved, entry.name) }))
        .filter((entry) => !entry.name.startsWith('.'))
        .sort((a, b) => a.name.localeCompare(b.name))
    } catch (err) {
      return res.status(400).json({ error: `无法读取目录：${err?.message || err}` })
    }
  }
  const parent = path.dirname(resolved)
  const atRoot = parent === resolved
  const payload = {
    path: resolved,
    exists: isDir,
    parent: atRoot ? null : parent,
    dirs,
    home: os.homedir(),
    isWindows: process.platform === 'win32',
  }
  if (atRoot && process.platform === 'win32') payload.drives = listWindowsDrives()
  res.json(payload)
})

/* ----------------------------- 需求附件 ----------------------------- */

const ATTACH_ROOT = path.join(DATA_DIR, 'attachments')

function attachmentDir(requirementId) {
  return path.join(ATTACH_ROOT, String(requirementId))
}

function sanitizeFileName(name) {
  const base = path
    .basename(String(name || 'file'))
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .trim()
  return base || 'file'
}

function removeRequirementFiles(requirement) {
  try {
    fs.rmSync(attachmentDir(requirement.id), { recursive: true, force: true })
  } catch {
    /* 忽略清理失败 */
  }
}

app.post(
  '/api/requirements/:id/attachments',
  express.raw({ type: () => true, limit: '30mb' }),
  (req, res, next) => {
    const requirement = findRequirement(req.params.id)
    if (!requirement) return next(new HttpError(404, '需求不存在'))
    const buffer = Buffer.isBuffer(req.body) ? req.body : null
    if (!buffer || !buffer.length) return next(new HttpError(400, '文件内容为空'))
    const name = sanitizeFileName(req.query.name)
    const id = crypto.randomUUID()
    const dir = attachmentDir(requirement.id)
    fs.mkdirSync(dir, { recursive: true })
    const filePath = path.join(dir, `${id}-${name}`)
    try {
      fs.writeFileSync(filePath, buffer)
    } catch (err) {
      return next(new HttpError(500, `保存附件失败：${err?.message || err}`))
    }
    const attachment = { id, name, size: buffer.length, path: filePath, createdAt: Date.now() }
    if (!Array.isArray(requirement.attachments)) requirement.attachments = []
    requirement.attachments.push(attachment)
    requirement.updatedAt = Date.now()
    touch()
    broadcastState()
    res.status(201).json({ attachment })
  },
)

app.get('/api/requirements/:id/attachments/:attId', (req, res, next) => {
  const requirement = findRequirement(req.params.id)
  if (!requirement) return next(new HttpError(404, '需求不存在'))
  const attachment = (requirement.attachments || []).find((item) => item.id === req.params.attId)
  if (!attachment || !fs.existsSync(attachment.path)) {
    return next(new HttpError(404, '附件不存在'))
  }
  res.download(attachment.path, attachment.name)
})

app.delete('/api/requirements/:id/attachments/:attId', (req, res, next) => {
  const requirement = findRequirement(req.params.id)
  if (!requirement) return next(new HttpError(404, '需求不存在'))
  const index = (requirement.attachments || []).findIndex((item) => item.id === req.params.attId)
  if (index < 0) return next(new HttpError(404, '附件不存在'))
  const [attachment] = requirement.attachments.splice(index, 1)
  try {
    fs.rmSync(attachment.path, { force: true })
  } catch {
    /* 忽略删除失败 */
  }
  requirement.updatedAt = Date.now()
  touch()
  broadcastState()
  res.json({ ok: true })
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

  let closed = false
  let heartbeat = null
  let unsubscribe = null

  // 连接可能被代理 / 浏览器悄悄掐断，必须主动清理，否则后续写入会抛出未捕获的 stream error 把进程带崩
  const stop = () => {
    if (closed) return
    closed = true
    if (heartbeat) clearInterval(heartbeat)
    if (unsubscribe) unsubscribe()
    heartbeat = null
    unsubscribe = null
  }

  const send = (type, data) => {
    if (closed || res.destroyed || res.writableEnded) return stop()
    try {
      res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`)
    } catch {
      stop()
    }
  }

  res.on('close', stop)
  res.on('error', stop)
  req.on('error', stop)

  send('state', publicState())

  unsubscribe = bus.subscribe(({ type, data }) => send(type, data))
  heartbeat = setInterval(() => {
    if (closed || res.destroyed || res.writableEnded) return stop()
    try {
      res.write(': ping\n\n')
    } catch {
      stop()
    }
  }, 20000)
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
