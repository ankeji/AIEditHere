import { spawn } from 'node:child_process'
import { bus } from './bus.js'
import { broadcastState } from './store.js'

const MAX_LOG_ENTRIES = 1200
const LOCAL_URL_RE =
  /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?(?:\/[^\s"'`<>]*)?/i

/** projectId -> 运行时状态与日志 */
const runs = new Map()

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function normalizeDetectedUrl(raw) {
  let value = String(raw || '')
    .replace(/\u001b\[[0-9;]*m/g, '')
    .trim()
    .replace(/[),.;，。；]+$/, '')
  try {
    const url = new URL(value)
    if (['0.0.0.0', '[::1]', '::1', '::'].includes(url.hostname)) url.hostname = 'localhost'
    value = url.toString()
  } catch {
    /* 保留原始文本 */
  }
  return value.replace(/\/$/, '')
}

function detectUrl(text) {
  const clean = String(text || '').replace(/\u001b\[[0-9;]*m/g, '')
  const matches = clean.match(new RegExp(LOCAL_URL_RE.source, 'gi'))
  if (!matches || !matches.length) return ''
  return normalizeDetectedUrl(matches[matches.length - 1])
}

function createRun(projectId) {
  return {
    projectId,
    command: '',
    status: 'idle',
    url: '',
    error: null,
    startedAt: null,
    logs: [],
    child: null,
    stopping: false,
    finished: false,
    scanTail: '',
  }
}

function getRun(projectId, create = false) {
  let run = runs.get(projectId)
  if (!run && create) {
    run = createRun(projectId)
    runs.set(projectId, run)
  }
  return run || null
}

function snapshot(run) {
  if (!run) return null
  return {
    projectId: run.projectId,
    status: run.status,
    url: run.url,
    error: run.error,
    startedAt: run.startedAt,
    command: run.command,
  }
}

function broadcastRun(run) {
  bus.emit('run-status', snapshot(run))
  broadcastState()
}

function emitLog(run, level, text) {
  const chunk = String(text ?? '')
  if (!chunk) return
  const last = run.logs[run.logs.length - 1]
  if (
    level === 'out' &&
    last &&
    last.level === 'out' &&
    !last.text.endsWith('\n') &&
    last.text.length + chunk.length < 8000
  ) {
    last.text += chunk
  } else {
    run.logs.push({ level, text: chunk })
  }
  while (run.logs.length > MAX_LOG_ENTRIES) run.logs.shift()
  bus.emit('run-log', { projectId: run.projectId, level, text: chunk })

  run.scanTail = `${run.scanTail || ''}${chunk}`.slice(-2000)
  const url = detectUrl(run.scanTail)
  if (url && url !== run.url) {
    run.url = url
    if (run.status === 'starting') run.status = 'running'
    broadcastRun(run)
  }
}

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
    // detached 启动后会形成独立进程组，整组杀掉可以顺带结束 vite / npm 子进程
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    try {
      child.kill('SIGTERM')
    } catch {
      /* 忽略 */
    }
  }
  const timer = setTimeout(() => {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {
      try {
        child.kill('SIGKILL')
      } catch {
        /* 忽略 */
      }
    }
  }, 3000)
  timer.unref?.()
}

function portOfUrl(raw) {
  try {
    const url = new URL(String(raw || ''))
    return Number(url.port) || 0
  } catch {
    return 0
  }
}

/**
 * Windows 上 npm / cmd 会再派生子进程，父进程可能先退出，taskkill /T 偶尔抓不到整棵树。
 * 预览地址通常固定端口，直接找出监听该端口的进程并结束它，保证停止 / 重启真正释放端口。
 */
function killPortOnWindows(port) {
  if (!port || process.platform !== 'win32') return
  try {
    const child = spawn('netstat', ['-ano'], { windowsHide: true })
    let output = ''
    child.stdout?.on('data', (data) => {
      output += data.toString()
    })
    child.on('error', () => {})
    child.on('close', () => {
      const pids = new Set()
      for (const line of output.split(/\r?\n/)) {
        const match = line.match(/^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i)
        if (match && Number(match[1]) === port) pids.add(match[2])
      }
      for (const pid of pids) {
        try {
          spawn('taskkill', ['/pid', pid, '/T', '/F'], {
            stdio: 'ignore',
            windowsHide: true,
          }).on('error', () => {})
        } catch {
          /* 忽略 */
        }
      }
    })
  } catch {
    /* 忽略 */
  }
}

function killRunProcesses(run) {
  if (!run) return
  if (run.child) killProcessTree(run.child)
  killPortOnWindows(portOfUrl(run.url))
}

export function runtimeSnapshot() {
  const result = {}
  for (const [projectId, run] of runs) {
    if (!run || run.status === 'idle') continue
    result[projectId] = snapshot(run)
  }
  return result
}

export function getProjectRuntime(projectId) {
  return snapshot(getRun(projectId))
}

export function getProjectRunLogs(projectId) {
  return getRun(projectId)?.logs || []
}

export function startProject(project) {
  if (!project) {
    const err = new Error('项目不存在')
    err.status = 404
    throw err
  }
  const command = String(project.startCommand || '').trim()
  if (!command) {
    const err = new Error('请先为前端项目配置启动命令')
    err.status = 400
    throw err
  }

  const existing = getRun(project.id)
  if (existing && (existing.status === 'starting' || existing.status === 'running')) {
    return snapshot(existing)
  }
  if (existing && existing.status === 'stopping') {
    const err = new Error('项目正在停止，请稍后再启动')
    err.status = 409
    throw err
  }

  const run = existing || getRun(project.id, true)
  run.command = command
  run.status = 'starting'
  run.url = String(project.previewUrl || '').trim()
  run.error = null
  run.startedAt = Date.now()
  run.stopping = false
  run.finished = false
  run.logs = []
  run.scanTail = ''

  emitLog(run, 'sys', `$ ${command}\n`)
  broadcastRun(run)

  let child
  try {
    // 不要透传 AIEditHere 自己的 PORT，否则很多前端工具会抢用同一个端口
    const childEnv = { ...process.env }
    delete childEnv.PORT
    child = spawn(command, {
      cwd: project.path,
      shell: true,
      env: childEnv,
      windowsHide: true,
      detached: process.platform !== 'win32',
    })
  } catch (err) {
    run.status = 'failed'
    run.error = err?.message || '启动失败'
    emitLog(run, 'err', `✖ ${run.error}\n`)
    broadcastRun(run)
    return snapshot(run)
  }

  run.child = child
  child.stdout?.on('data', (data) => emitLog(run, 'out', data.toString()))
  child.stderr?.on('data', (data) => emitLog(run, 'out', data.toString()))
  child.on('error', (err) => {
    if (run.finished) return
    run.finished = true
    run.status = 'failed'
    run.error = `无法执行启动命令：${err?.message || err}`
    emitLog(run, 'err', `✖ ${run.error}\n`)
    broadcastRun(run)
  })
  child.on('exit', (code, signal) => {
    if (run.finished) return
    run.finished = true
    run.child = null
    if (run.stopping) {
      run.status = 'stopped'
      run.error = null
      emitLog(run, 'sys', '· 已停止\n')
    } else if (code === 0) {
      run.status = 'stopped'
      run.error = null
      emitLog(run, 'sys', '· 进程已退出\n')
    } else {
      run.status = 'failed'
      run.error = `进程已退出（${code ?? signal ?? '未知状态'}）`
      emitLog(run, 'err', `✖ ${run.error}\n`)
    }
    broadcastRun(run)
  })

  // 有些启动命令不会打印 URL，给一个宽限期后直接视为运行中
  const timer = setTimeout(() => {
    if (run.status === 'starting' && run.child) {
      run.status = 'running'
      broadcastRun(run)
    }
  }, 2500)
  timer.unref?.()

  return snapshot(run)
}

export function stopProject(projectId) {
  const run = getRun(projectId)
  if (!run) return null
  if (!run.child) {
    if (run.status !== 'idle') {
      run.status = 'stopped'
      run.stopping = false
      run.error = null
      broadcastRun(run)
    }
    return snapshot(run)
  }
  run.stopping = true
  run.status = 'stopping'
  broadcastRun(run)
  killRunProcesses(run)

  const timer = setTimeout(() => {
    if (run.status === 'stopping') {
      run.finished = true
      run.child = null
      run.status = 'stopped'
      run.stopping = false
      broadcastRun(run)
    }
  }, 4000)
  timer.unref?.()
  return snapshot(run)
}

export async function restartProject(project) {
  stopProject(project.id)
  const run = getRun(project.id)
  const startedAt = Date.now()
  while (run && run.status === 'stopping' && Date.now() - startedAt < 6000) {
    await sleep(150)
  }
  return startProject(project)
}

export function stopAllProjects() {
  for (const run of runs.values()) {
    if (run?.child) {
      run.stopping = true
      killRunProcesses(run)
    }
  }
}
