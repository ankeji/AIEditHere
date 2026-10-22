import { reactive } from 'vue'

export const store = reactive({
  ready: false,
  requirements: [],
  projects: [],
  config: {
    opencodeUrl: '',
    model: '',
    agent: '',
    projectDir: '',
    autoStart: true,
    demo: false,
  },
  health: { connected: false, demo: false, version: '' },
  selectedId: null,
  route: { view: 'projects', projectId: null },
  toasts: [],
  settingsOpen: false,
  projectDialog: { open: false, project: null },
  eventSource: null,
})

export async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  let data = null
  try {
    data = await res.json()
  } catch {
    /* 忽略空响应 */
  }
  if (!res.ok) throw new Error(data?.error || `请求失败 (${res.status})`)
  return data
}

export function pushToast(message, kind = 'info') {
  if (!message) return
  const item = { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, message, kind }
  store.toasts.push(item)
  setTimeout(() => {
    const index = store.toasts.indexOf(item)
    if (index >= 0) store.toasts.splice(index, 1)
  }, kind === 'error' ? 6500 : 3500)
}

/* ----------------------------- 路由 ----------------------------- */

function syncSelection() {
  const list = projectRequirements()
  if (!list.some((item) => item.id === store.selectedId)) {
    store.selectedId = list[0]?.id ?? null
  }
}

function applyRoute() {
  const hash = window.location.hash.replace(/^#/, '')
  const match = hash.match(/^\/p\/([^/?]+)/)
  if (match) {
    store.route.view = 'workspace'
    store.route.projectId = match[1]
  } else {
    store.route.view = 'projects'
    store.route.projectId = null
  }
  syncSelection()
}

export function openProject(id) {
  window.location.hash = `#/p/${id}`
}

export function backToProjects() {
  window.location.hash = '#/'
}

/* ----------------------------- 状态 ----------------------------- */

function applyState(data) {
  if (Array.isArray(data.requirements)) store.requirements = data.requirements
  if (Array.isArray(data.projects)) store.projects = data.projects
  if (data.config) store.config = { ...store.config, ...data.config }
  syncSelection()
  store.ready = true
}

function appendLogEntry(requirementId, taskId, level, text) {
  const requirement = store.requirements.find((item) => item.id === requirementId)
  const task = requirement?.tasks?.find((item) => item.id === taskId)
  if (!task || !text) return
  if (!Array.isArray(task.logs)) task.logs = []
  const last = task.logs[task.logs.length - 1]
  if (
    level === 'out' &&
    last &&
    last.level === 'out' &&
    !last.text.endsWith('\n') &&
    last.text.length + text.length < 8000
  ) {
    last.text += text
  } else {
    task.logs.push({ level, text })
  }
  while (task.logs.length > 300) task.logs.shift()
  task.logVersion = (task.logVersion || 0) + 1
}

export async function loadState() {
  try {
    const data = await api('GET', '/api/state')
    applyState(data)
    if (data.health) store.health = data.health
  } catch (err) {
    pushToast(`加载状态失败：${err.message}`, 'error')
  }
}

export function connectEvents() {
  if (store.eventSource) return
  const source = new EventSource('/api/events')
  store.eventSource = source

  source.addEventListener('state', (event) => {
    try {
      applyState(JSON.parse(event.data))
    } catch {
      /* 忽略无效数据 */
    }
  })
  source.addEventListener('health', (event) => {
    try {
      store.health = JSON.parse(event.data)
    } catch {
      /* 忽略无效数据 */
    }
  })
  source.addEventListener('toast', (event) => {
    try {
      const data = JSON.parse(event.data)
      pushToast(data.message, data.kind)
    } catch {
      /* 忽略无效数据 */
    }
  })
  source.addEventListener('log', (event) => {
    try {
      const data = JSON.parse(event.data)
      appendLogEntry(data.requirementId, data.taskId, data.level, data.text)
    } catch {
      /* 忽略无效数据 */
    }
  })
}

/* ----------------------------- 选择器 ----------------------------- */

export function currentProject() {
  return store.projects.find((item) => item.id === store.route.projectId) || null
}

export function projectRequirements() {
  const projectId = store.route.projectId
  if (!projectId) return []
  return store.requirements.filter((item) => item.projectId === projectId)
}

export function selectedRequirement() {
  return projectRequirements().find((item) => item.id === store.selectedId) || null
}

export function selectRequirement(id) {
  store.selectedId = id
}

/* ----------------------------- 需求操作 ----------------------------- */

export async function addRequirement(text) {
  try {
    const requirement = await api('POST', '/api/requirements', {
      text,
      projectId: store.route.projectId || undefined,
    })
    store.selectedId = requirement.id
  } catch (err) {
    pushToast(err.message, 'error')
  }
}

export async function splitRequirement(id) {
  try {
    await api('POST', `/api/requirements/${id}/split`)
  } catch (err) {
    pushToast(err.message, 'error')
  }
}

export async function executeRequirement(id) {
  try {
    store.selectedId = id
    await api('POST', `/api/requirements/${id}/execute`)
  } catch (err) {
    pushToast(err.message, 'error')
  }
}

export async function abortRequirement(id) {
  try {
    await api('POST', `/api/requirements/${id}/abort`)
    pushToast('已发送中止请求', 'info')
  } catch (err) {
    pushToast(err.message, 'error')
  }
}

export async function retryTask(requirementId, taskId) {
  try {
    await api('POST', `/api/requirements/${requirementId}/tasks/${taskId}/retry`)
  } catch (err) {
    pushToast(err.message, 'error')
  }
}

export async function removeRequirement(id) {
  try {
    await api('DELETE', `/api/requirements/${id}`)
    if (store.selectedId === id) store.selectedId = null
  } catch (err) {
    pushToast(err.message, 'error')
  }
}

/* ----------------------------- 项目操作 ----------------------------- */

export function openProjectDialog(project = null) {
  store.projectDialog = { open: true, project }
}

export function closeProjectDialog() {
  store.projectDialog = { open: false, project: null }
}

export async function saveProject(payload) {
  const editing = store.projectDialog.project
  try {
    if (editing) {
      await api('PATCH', `/api/projects/${editing.id}`, payload)
      pushToast('项目已更新', 'success')
    } else {
      const data = await api('POST', '/api/projects', payload)
      pushToast(data.created ? '项目已创建，目录已自动生成' : '项目已创建', 'success')
    }
    closeProjectDialog()
    return true
  } catch (err) {
    pushToast(err.message, 'error')
    return false
  }
}

export async function removeProject(id) {
  try {
    await api('DELETE', `/api/projects/${id}`)
    if (store.route.projectId === id) backToProjects()
    pushToast('项目已删除', 'success')
  } catch (err) {
    pushToast(err.message, 'error')
  }
}

/* ----------------------------- 全局设置 ----------------------------- */

export async function saveConfig(patch) {
  try {
    const data = await api('PUT', '/api/config', patch)
    if (data.config) store.config = { ...store.config, ...data.config }
    if (data.health) store.health = data.health
    pushToast('设置已保存', 'success')
    return true
  } catch (err) {
    pushToast(err.message, 'error')
    return false
  }
}

export async function reconnectOpencode() {
  try {
    const health = await api('POST', '/api/opencode/reconnect')
    store.health = health
    pushToast(
      health.connected ? 'opencode 已连接' : '仍未连接到 opencode',
      health.connected ? 'success' : 'error',
    )
    return health
  } catch (err) {
    pushToast(err.message, 'error')
    return null
  }
}

export async function refreshHealth() {
  try {
    const health = await api('GET', '/api/health?force=1')
    store.health = health
  } catch {
    /* 忽略 */
  }
}

export function initRouter() {
  applyRoute()
  window.addEventListener('hashchange', applyRoute)
}
