import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { bus } from './bus.js'
import { touch, broadcastState, persist, toast } from './store.js'

const MAX_LOG_ENTRIES = 2000

const activeRuns = new Map() // runId -> { child, conn, aborted }
const activeEnvRuns = new Map() // `${projectId}:${envId}` -> runId
const runLogs = new Map() // `${projectId}:${envId}` -> { entries, runId }

function logKey(projectId, envId) {
  return `${projectId}:${envId}`
}

function ensureBuffer(projectId, envId, reset = false) {
  const key = logKey(projectId, envId)
  if (reset || !runLogs.has(key)) runLogs.set(key, { entries: [], runId: null })
  return runLogs.get(key)
}

function emitLog(projectId, envId, level, text) {
  if (text === undefined || text === null || text === '') return
  const buf = ensureBuffer(projectId, envId)
  const chunk = String(text)
  const last = buf.entries[buf.entries.length - 1]
  if (
    level === 'out' &&
    last &&
    last.level === 'out' &&
    !last.text.endsWith('\n') &&
    last.text.length + chunk.length < 8000
  ) {
    last.text += chunk
  } else {
    buf.entries.push({ level, text: chunk })
  }
  while (buf.entries.length > MAX_LOG_ENTRIES) buf.entries.shift()
  bus.emit('deploy-log', { projectId, envId, level, text: chunk })
}

export function getDeployLogs(projectId, envId) {
  const buf = runLogs.get(logKey(projectId, envId))
  return buf ? buf.entries : []
}

function setEnvStatus(project, env, status, error = null) {
  env.lastStatus = status
  if (status === 'running') {
    env.lastError = null
  } else if (status === 'success') {
    env.lastDeployedAt = Date.now()
    env.lastError = null
  } else if (status === 'failed') {
    env.lastError = error || '部署失败'
  } else if (status === 'cancelled') {
    env.lastError = null
  }
  touch()
  broadcastState()
  bus.emit('deploy-status', {
    projectId: project.id,
    envId: env.id,
    status,
    error: env.lastError || null,
    at: env.lastDeployedAt || null,
  })
}

/* ------------------------------------------------------------------ */
/* 配置归一化                                                          */
/* ------------------------------------------------------------------ */

function normalizeEnv(raw, old) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const prev = old && typeof old === 'object' ? old : {}
  const id = typeof src.id === 'string' && src.id ? src.id : crypto.randomUUID()
  const port = Number(src.port)
  return {
    id,
    name: String(src.name ?? prev.name ?? '环境').trim() || '环境',
    host: String(src.host ?? prev.host ?? '').trim(),
    port: Number.isFinite(port) && port > 0 && port <= 65535 ? Math.floor(port) : prev.port || 22,
    username: String(src.username ?? prev.username ?? '').trim(),
    password: typeof src.password === 'string' ? src.password : prev.password || '',
    remoteDir: String(src.remoteDir ?? prev.remoteDir ?? '').trim(),
    buildCommand:
      typeof src.buildCommand === 'string' ? src.buildCommand.trim() : prev.buildCommand || '',
    outputPath: typeof src.outputPath === 'string' ? src.outputPath.trim() : prev.outputPath || '',
    lastStatus: prev.lastStatus || 'idle',
    lastDeployedAt: prev.lastDeployedAt || null,
    lastError: prev.lastError || null,
  }
}

export function normalizeDeploy(input, existingProject) {
  const src = input && typeof input === 'object' ? input : {}
  const prevDeploy = existingProject?.deploy && typeof existingProject.deploy === 'object'
    ? existingProject.deploy
    : {}
  const prevById = new Map()
  if (Array.isArray(prevDeploy.environments)) {
    for (const env of prevDeploy.environments) {
      if (env && env.id) prevById.set(env.id, env)
    }
  }
  const environments = (Array.isArray(src.environments) ? src.environments : []).map((raw) => {
    const id = raw && typeof raw.id === 'string' ? raw.id : null
    return normalizeEnv(raw, id ? prevById.get(id) : null)
  })
  return {
    buildCommand:
      typeof src.buildCommand === 'string'
        ? src.buildCommand.trim()
        : String(prevDeploy.buildCommand || ''),
    outputPath:
      typeof src.outputPath === 'string'
        ? src.outputPath.trim()
        : String(prevDeploy.outputPath || ''),
    ignorePatterns:
      typeof src.ignorePatterns === 'string'
        ? src.ignorePatterns
        : String(prevDeploy.ignorePatterns || ''),
    environments,
  }
}

/* ------------------------------------------------------------------ */
/* 执行部署                                                            */
/* ------------------------------------------------------------------ */

function resolveBuildCommand(project, env) {
  return String(env.buildCommand || project.deploy?.buildCommand || '').trim()
}

function resolveOutputPath(project, env) {
  const raw = String(env.outputPath || project.deploy?.outputPath || '').trim()
  if (!raw) return null
  return path.isAbsolute(raw) ? raw : path.resolve(project.path, raw)
}

/* ------------------------------ 忽略规则 ------------------------------ */

/** 把 gitignore 风格的通配符转成正则片段 */
function globToRegExp(pattern) {
  let out = ''
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i]
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        if (pattern[i + 2] === '/') {
          out += '(?:.*/)?'
          i += 2
        } else {
          out += '.*'
          i += 1
        }
      } else {
        out += '[^/]*'
      }
    } else if (ch === '?') {
      out += '[^/]'
    } else if ('\\^$.|+()[]{}'.includes(ch)) {
      out += `\\${ch}`
    } else {
      out += ch
    }
  }
  return out
}

/** 解析多行忽略配置，语义尽量贴近 .gitignore */
export function parseIgnoreRules(text) {
  const rules = []
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    let line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    let negate = false
    if (line.startsWith('!')) {
      negate = true
      line = line.slice(1).trim()
    }
    if (!line) continue
    let dirOnly = false
    if (line.endsWith('/')) {
      dirOnly = true
      line = line.replace(/\/+$/, '')
    }
    let anchored = false
    if (line.startsWith('/')) {
      anchored = true
      line = line.replace(/^\/+/, '')
    }
    if (!line) continue
    rules.push({
      negate,
      dirOnly,
      anchored,
      hasSlash: line.includes('/'),
      regex: new RegExp(`^${globToRegExp(line)}$`),
    })
  }
  return rules
}

function ruleMatches(rule, relPath, isDir) {
  const parts = relPath.split('/')
  if (rule.anchored || rule.hasSlash) {
    if (rule.regex.test(relPath) && (!rule.dirOnly || isDir)) return true
    if (rule.dirOnly) {
      for (let i = 1; i < parts.length; i += 1) {
        if (rule.regex.test(parts.slice(0, i).join('/'))) return true
      }
    }
    return false
  }
  for (let i = 0; i < parts.length; i += 1) {
    const isLast = i === parts.length - 1
    if (rule.dirOnly && isLast && !isDir) continue
    if (rule.regex.test(parts[i])) return true
  }
  return false
}

/** 相对输出目录的路径是否被忽略（后面的规则优先级更高，支持 ! 取反） */
export function isIgnored(rules, relPath, isDir = false) {
  if (!rules?.length) return false
  const normalized = String(relPath || '')
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
  if (!normalized) return false
  let ignored = false
  for (const rule of rules) {
    if (ruleMatches(rule, normalized, isDir)) ignored = !rule.negate
  }
  return ignored
}

/* ------------------------------ 中止支持 ------------------------------ */

function throwIfAborted(run) {
  if (run.aborted) throw new Error('已中止')
}

/** 让任意异步操作在收到中止信号时立刻失败，避免卡在构建 / 上传回调上 */
function raceAbort(run, promise) {
  let cleanup = () => {}
  const guard = new Promise((_, reject) => {
    const onAbort = () => reject(new Error('已中止'))
    if (run.aborted) {
      onAbort()
      return
    }
    run.signal.addEventListener('abort', onAbort, { once: true })
    cleanup = () => run.signal.removeEventListener('abort', onAbort)
  })
  guard.catch(() => {})
  return Promise.race([promise, guard]).finally(cleanup)
}

/** Windows 上 shell 拉起的是 cmd.exe，必须连同子进程一起杀掉（npm/vite 等） */
function killProcessTree(child) {
  if (!child || child.exitCode !== null || child.signalCode) return
  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      }).on('error', () => {})
    } catch {
      /* 忽略 */
    }
    try {
      child.kill()
    } catch {
      /* 忽略 */
    }
    return
  }
  try {
    child.kill('SIGTERM')
  } catch {
    /* 忽略 */
  }
  const timer = setTimeout(() => {
    try {
      child.kill('SIGKILL')
    } catch {
      /* 忽略 */
    }
  }, 3000)
  timer.unref?.()
}

function runBuild(run, project, env, command) {
  return new Promise((resolve, reject) => {
    emitLog(project.id, env.id, 'sys', `$ ${command}\n`)
    let child
    try {
      child = spawn(command, {
        cwd: project.path,
        shell: true,
        env: process.env,
        windowsHide: true,
      })
    } catch (err) {
      return reject(err)
    }
    run.child = child

    const onAbort = () => killProcessTree(child)
    if (run.aborted) onAbort()
    else run.signal.addEventListener('abort', onAbort, { once: true })
    const cleanup = () => run.signal.removeEventListener('abort', onAbort)

    child.stdout?.on('data', (data) => emitLog(project.id, env.id, 'out', data.toString()))
    child.stderr?.on('data', (data) => emitLog(project.id, env.id, 'out', data.toString()))
    child.on('error', (err) => {
      cleanup()
      reject(new Error(`无法执行构建命令：${err.message}`))
    })
    child.on('exit', (code, signal) => {
      cleanup()
      if (run.aborted) return reject(new Error('已中止'))
      if (code === 0) resolve()
      else reject(new Error(`构建失败，退出码 ${code ?? signal}`))
    })
  })
}

/* ------------------------------ SSH / SFTP ------------------------------ */

let ssh2ClientClass = null

async function loadSsh2() {
  if (ssh2ClientClass) return ssh2ClientClass
  let mod
  try {
    mod = await import('ssh2')
  } catch {
    throw new Error('缺少 ssh2 依赖，请在项目根目录执行 npm install')
  }
  const Client = mod.Client || mod.default?.Client
  if (!Client) throw new Error('ssh2 模块加载失败')
  ssh2ClientClass = Client
  return Client
}

function posixJoin(base, name) {
  const left = String(base || '/').replace(/\\/g, '/').replace(/\/+$/, '')
  const right = String(name || '').replace(/^\/+/, '')
  return `${left}/${right}`.replace(/\/{2,}/g, '/')
}

function connectSsh(Client, env) {
  return new Promise((resolve, reject) => {
    const conn = new Client()
    let settled = false
    const settle = (fn, value) => {
      if (settled) return
      settled = true
      fn(value)
    }
    conn.on('ready', () => settle(resolve, conn))
    conn.on('error', (err) => settle(reject, err))
    conn.on('keyboard-interactive', (name, instructions, lang, prompts, done) => {
      done(prompts.map(() => env.password || ''))
    })
    try {
      conn.connect({
        host: env.host,
        port: env.port || 22,
        username: env.username,
        password: env.password,
        readyTimeout: 25000,
        keepaliveInterval: 10000,
      })
    } catch (err) {
      settle(reject, err)
    }
  })
}

function getSftp(conn) {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => (err ? reject(err) : resolve(sftp)))
  })
}

/** 递归创建远程目录（已存在则忽略） */
function mkdirp(sftp, dir) {
  return new Promise((resolve) => {
    const normalized = String(dir || '/').replace(/\\/g, '/')
    const absolute = normalized.startsWith('/')
    const parts = normalized.split('/').filter(Boolean)
    if (!parts.length) return resolve()
    let current = absolute ? '' : '.'
    let index = 0
    const next = () => {
      if (index >= parts.length) return resolve()
      current = current === '' ? `/${parts[index]}` : current === '.' ? parts[index] : `${current}/${parts[index]}`
      index += 1
      sftp.mkdir(current, { mode: 0o755 }, () => next())
    }
    next()
  })
}

function fastPut(sftp, local, remote) {
  return new Promise((resolve, reject) => {
    sftp.fastPut(local, remote, (err) => (err ? reject(err) : resolve()))
  })
}

async function uploadDir(run, sftp, stats, project, env, localDir, rootDir, remoteDir, rules) {
  throwIfAborted(run)
  const entries = fs.readdirSync(localDir, { withFileTypes: true })
  for (const entry of entries) {
    throwIfAborted(run)
    const local = path.join(localDir, entry.name)
    const rel = path.relative(rootDir, local).split(path.sep).join('/')
    const remote = posixJoin(remoteDir, entry.name)

    if (entry.isSymbolicLink()) {
      emitLog(project.id, env.id, 'sys', `· 跳过软链接 ${rel}\n`)
      stats.skipped += 1
      continue
    }

    const isDir = entry.isDirectory()
    if (isIgnored(rules, rel, isDir)) {
      if (isDir) emitLog(project.id, env.id, 'sys', `· 已忽略 ${rel}/\n`)
      stats.skipped += 1
      continue
    }

    if (isDir) {
      await raceAbort(run, mkdirp(sftp, remote))
      await uploadDir(run, sftp, stats, project, env, local, rootDir, remote, rules)
    } else if (entry.isFile()) {
      await raceAbort(run, fastPut(sftp, local, remote))
      stats.files += 1
      emitLog(project.id, env.id, 'out', `↑ ${rel}\n`)
    }
  }
}

async function uploadOutput(run, project, env, outputPath) {
  const rules = parseIgnoreRules(project.deploy?.ignorePatterns)
  const Client = await loadSsh2()
  emitLog(project.id, env.id, 'sys', `▶ 连接 ${env.username}@${env.host}:${env.port || 22}…\n`)
  const conn = await raceAbort(
    run,
    connectSsh(Client, env).then((client) => {
      if (run.aborted) {
        try {
          client.end()
        } catch {
          /* 忽略 */
        }
        throw new Error('已中止')
      }
      run.conn = client
      return client
    }),
  )
  throwIfAborted(run)
  emitLog(project.id, env.id, 'ok', '✔ SSH 连接成功\n')

  const sftp = await raceAbort(run, getSftp(conn))
  run.sftp = sftp
  const remoteBase = (env.remoteDir || '/').replace(/\\/g, '/').replace(/\/+$/, '') || '/'
  await raceAbort(run, mkdirp(sftp, remoteBase))

  const stat = fs.statSync(outputPath)
  const stats = { files: 0, skipped: 0 }
  if (stat.isDirectory()) {
    emitLog(project.id, env.id, 'sys', `▶ 上传目录 → ${remoteBase}\n`)
    await uploadDir(run, sftp, stats, project, env, outputPath, outputPath, remoteBase, rules)
  } else {
    const name = path.basename(outputPath)
    if (isIgnored(rules, name, false)) {
      emitLog(project.id, env.id, 'sys', `· 输出文件 ${name} 命中忽略规则，未上传\n`)
      return
    }
    const remote = posixJoin(remoteBase, name)
    emitLog(project.id, env.id, 'sys', `▶ 上传文件 → ${remote}\n`)
    await raceAbort(run, fastPut(sftp, outputPath, remote))
    stats.files = 1
    emitLog(project.id, env.id, 'out', `↑ ${name}\n`)
  }
  throwIfAborted(run)
  const skippedText = stats.skipped ? `，忽略 ${stats.skipped} 项` : ''
  emitLog(project.id, env.id, 'ok', `✔ 已上传 ${stats.files} 个文件${skippedText}\n`)
}

export async function runDeploy(project, env, runId) {
  const controller = new AbortController()
  const run = {
    child: null,
    conn: null,
    sftp: null,
    aborted: false,
    signal: controller.signal,
    controller,
    project,
    env,
  }
  activeRuns.set(runId, run)
  activeEnvRuns.set(logKey(project.id, env.id), runId)

  const buf = ensureBuffer(project.id, env.id, true)
  buf.runId = runId

  setEnvStatus(project, env, 'running')
  emitLog(project.id, env.id, 'sys', `▶ 开始部署到「${env.name}」\n`)

  try {
    if (!env.host || !env.username || !env.remoteDir) {
      throw new Error('请先填写服务器地址、用户名和远程目录')
    }
    const outputPath = resolveOutputPath(project, env)
    if (!outputPath) throw new Error('请先配置要上传的输出目录（build 产物路径）')

    const buildCommand = resolveBuildCommand(project, env)
    if (buildCommand) {
      emitLog(project.id, env.id, 'sys', '▶ 开始构建…\n')
      await raceAbort(run, runBuild(run, project, env, buildCommand))
      emitLog(project.id, env.id, 'ok', '✔ 构建完成\n')
    } else {
      emitLog(project.id, env.id, 'sys', '· 跳过构建（未配置构建命令）\n')
    }

    throwIfAborted(run)

    if (!fs.existsSync(outputPath)) {
      throw new Error(`构建产物不存在：${outputPath}（请检查输出目录配置）`)
    }

    await uploadOutput(run, project, env, outputPath)

    throwIfAborted(run)
    closeConn(run)
    setEnvStatus(project, env, 'success')
    emitLog(project.id, env.id, 'ok', '✔ 部署完成\n')
    toast(`「${env.name}」部署成功`, 'success')
  } catch (err) {
    closeConn(run)
    if (run.aborted) {
      const message = '部署已中止'
      emitLog(project.id, env.id, 'err', `✖ ${message}\n`)
      setEnvStatus(project, env, 'cancelled')
      toast(`「${env.name}」部署已中止`, 'info')
    } else {
      const message = err?.message || String(err)
      emitLog(project.id, env.id, 'err', `✖ ${message}\n`)
      setEnvStatus(project, env, 'failed', message)
      toast(`「${env.name}」部署失败：${message}`, 'error')
    }
  } finally {
    activeRuns.delete(runId)
    activeEnvRuns.delete(logKey(project.id, env.id))
    persist(true)
  }
}

function closeConn(run) {
  try {
    run?.sftp?.end?.()
  } catch {
    /* 忽略 */
  }
  try {
    run?.conn?.end()
  } catch {
    /* 忽略 */
  }
  run.sftp = null
  run.conn = null
}

export function abortDeploy(runId) {
  const run = activeRuns.get(runId)
  if (!run) return false
  if (run.aborted) return true
  run.aborted = true
  emitLog(run.project.id, run.env.id, 'sys', '· 正在中止部署…\n')
  try {
    run.controller?.abort()
  } catch {
    /* 忽略 */
  }
  killProcessTree(run.child)
  closeConn(run)
  // 立刻把状态刷新到前端，不必等子进程 / 网络请求真正退出
  setEnvStatus(run.project, run.env, 'cancelled')
  return true
}

export function isEnvDeploying(projectId, envId) {
  return activeEnvRuns.has(logKey(projectId, envId))
}

export function abortEnvDeploy(project, env) {
  const runId = activeEnvRuns.get(logKey(project.id, env.id))
  if (runId) return abortDeploy(runId)
  // 没有活跃任务但状态卡在 running（例如服务重启遗留），直接复位
  if (env.lastStatus === 'running') {
    setEnvStatus(project, env, 'cancelled')
    return true
  }
  return false
}
