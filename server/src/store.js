import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { DATA_DIR } from './paths.js'
import { bus } from './bus.js'
import { publicConfig } from './config.js'

const STATE_FILE = path.join(DATA_DIR, 'state.json')

export const db = {
  requirements: [],
  projects: [],
}

const MAX_LOG_ENTRIES = 300

function load() {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8')
    const data = JSON.parse(raw)
    if (data && Array.isArray(data.requirements)) {
      db.requirements = data.requirements
    }
    if (data && Array.isArray(data.projects)) {
      db.projects = data.projects
    }
  } catch {
    db.requirements = []
    db.projects = []
  }
}

let saveTimer = null

export function persist(immediate = false) {
  if (saveTimer) clearTimeout(saveTimer)
  const run = () => {
    saveTimer = null
    try {
      const tmp = `${STATE_FILE}.tmp`
      fs.writeFileSync(
        tmp,
        JSON.stringify({ requirements: db.requirements, projects: db.projects }),
        'utf8',
      )
      fs.renameSync(tmp, STATE_FILE)
    } catch (err) {
      console.warn('[store] 保存状态失败:', err?.message)
    }
  }
  if (immediate) run()
  else saveTimer = setTimeout(run, 400)
}

export function publicState() {
  return {
    requirements: db.requirements,
    projects: db.projects,
    config: publicConfig(),
  }
}

export function broadcastState() {
  bus.emit('state', publicState())
}

export function touch() {
  persist()
}

load()

export function findRequirement(id) {
  return db.requirements.find((r) => r.id === id)
}

function titleOf(text) {
  const firstLine = String(text).split('\n').map((s) => s.trim()).find(Boolean) || '未命名需求'
  return firstLine.length > 60 ? `${firstLine.slice(0, 60)}…` : firstLine
}

export function createRequirement(text, projectId) {
  const requirement = {
    id: crypto.randomUUID(),
    projectId: projectId || db.projects[0]?.id || null,
    text: String(text).trim(),
    title: titleOf(text),
    status: 'pending',
    error: null,
    sessionId: null,
    plannerSessionId: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    tasks: [],
  }
  db.requirements.unshift(requirement)
  touch()
  broadcastState()
  return requirement
}

/* ----------------------------- 项目 ----------------------------- */

export function findProject(id) {
  return db.projects.find((p) => p.id === id) || null
}

export function createProject({ name, path: projectPath, description = '' }) {
  const project = {
    id: crypto.randomUUID(),
    name: String(name).trim(),
    path: String(projectPath).trim(),
    description: String(description || '').trim(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  db.projects.unshift(project)
  touch()
  broadcastState()
  return project
}

export function updateProject(id, patch) {
  const project = findProject(id)
  if (!project) return null
  if (patch.name !== undefined) project.name = String(patch.name).trim()
  if (patch.path !== undefined) project.path = String(patch.path).trim()
  if (patch.description !== undefined) project.description = String(patch.description).trim()
  project.updatedAt = Date.now()
  touch()
  broadcastState()
  return project
}

export function removeProject(id) {
  const idx = db.projects.findIndex((p) => p.id === id)
  if (idx < 0) return false
  db.projects.splice(idx, 1)
  db.requirements = db.requirements.filter((r) => r.projectId !== id)
  touch()
  broadcastState()
  return true
}

export function removeRequirement(id) {
  const idx = db.requirements.findIndex((r) => r.id === id)
  if (idx >= 0) {
    db.requirements.splice(idx, 1)
    touch()
    broadcastState()
    return true
  }
  return false
}

export function findTask(requirementId, taskId) {
  const req = findRequirement(requirementId)
  if (!req) return null
  return req.tasks.find((t) => t.id === taskId) || null
}

export function appendLog(requirementId, taskId, level, text) {
  const task = findTask(requirementId, taskId)
  if (!task || !text) return
  if (!Array.isArray(task.logs)) task.logs = []

  const chunk = String(text)
  const last = task.logs[task.logs.length - 1]
  if (
    level === 'out' &&
    last &&
    last.level === 'out' &&
    !last.text.endsWith('\n') &&
    last.text.length + chunk.length < 8000
  ) {
    last.text += chunk
  } else {
    task.logs.push({ level, text: chunk })
  }

  while (task.logs.length > MAX_LOG_ENTRIES) task.logs.shift()

  bus.emit('log', { requirementId, taskId, level, text: chunk })
}

export function toast(message, kind = 'info') {
  bus.emit('toast', { message, kind, time: Date.now() })
}

/** 服务重启后，把中断的任务标记为失败，避免界面卡在“执行中” */
export function recoverInterrupted() {
  let changed = false
  for (const req of db.requirements) {
    if (req.status === 'splitting' || req.status === 'running') {
      req.status = 'failed'
      req.error = req.error || '服务重启，任务已中断'
      changed = true
    }
    for (const task of req.tasks || []) {
      if (task.status === 'running') {
        task.status = 'failed'
        task.error = '服务重启，任务已中断'
        changed = true
      }
    }
  }
  if (changed) persist(true)
}
