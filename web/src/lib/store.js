import { reactive } from 'vue'

export const store = reactive({
  ready: false,
  auth: { ready: false, user: null },
  requirements: [],
  projects: [],
  teams: [],
  teamsLoaded: false,
  config: {
    opencodeUrl: '',
    model: '',
    agent: '',
    projectDir: '',
    autoStart: true,
    demo: false,
  },
  health: { connected: false, demo: false, version: '' },
  runtime: {},
  runLogs: {},
  selectedId: null,
  route: { view: 'projects', projectId: null },
  toasts: [],
  settingsOpen: false,
  projectDialog: { open: false, project: null },
  deployDialog: { open: false, projectId: null },
  teamDialogOpen: false,
  accessDialog: { open: false, projectId: null },
  deployLogs: {},
  eventSource: null,
})

export async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  let data = null
  try {
    data = await res.json()
  } catch {
    /* 忽略空响应 */
  }
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/api/auth/')) {
      if (store.auth.user) pushToast('登录已过期，请重新登录', 'error')
      store.auth.user = null
    }
    const message =
      data?.error ||
      (res.status >= 500
        ? `服务暂时不可用（${res.status}），后端可能正在重启，请稍后重试`
        : `请求失败 (${res.status})`)
    throw new Error(message)
  }
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

/* ----------------------------- 登录 / 注册 ----------------------------- */

export async function initAuth() {
  try {
    const data = await api('GET', '/api/auth/me')
    store.auth.user = data?.user || null
  } catch {
    store.auth.user = null
  } finally {
    store.auth.ready = true
  }
}

export async function requestEmailCode(email) {
  return api('POST', '/api/auth/request-code', { email })
}

export async function loginAccount(email, password) {
  const data = await api('POST', '/api/auth/login', { email, password })
  store.auth.user = data?.user || null
  store.auth.ready = true
  return data?.user || null
}

export async function registerAccount(payload) {
  const data = await api('POST', '/api/auth/register', payload)
  store.auth.user = data?.user || null
  store.auth.ready = true
  return data?.user || null
}

export async function logoutAccount() {
  try {
    await api('POST', '/api/auth/logout')
  } catch {
    /* 会话可能已过期，仍然清理本地状态 */
  }
  store.auth.user = null
  resetSessionData()
}

function resetSessionData() {
  store.ready = false
  store.requirements = []
  store.projects = []
  store.teams = []
  store.teamsLoaded = false
  store.runtime = {}
  store.runLogs = {}
  store.deployLogs = {}
  store.selectedId = null
  store.route = { view: 'projects', projectId: null }
  store.settingsOpen = false
  store.projectDialog = { open: false, project: null }
  store.deployDialog = { open: false, projectId: null }
  store.teamDialogOpen = false
  store.accessDialog = { open: false, projectId: null }
  disconnectEvents()
  window.location.hash = '#/'
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
  if (Array.isArray(data.teams)) {
    store.teams = data.teams
    store.teamsLoaded = true
    if (store.auth.user) store.auth.user.teamIds = store.teams.map((item) => item.id)
  }
  if (data.config) store.config = { ...store.config, ...data.config }
  if (data.runtime && typeof data.runtime === 'object') store.runtime = data.runtime
  if (
    store.route.view === 'workspace' &&
    store.route.projectId &&
    !store.projects.some((project) => project.id === store.route.projectId)
  ) {
    backToProjects()
  }
  if (
    store.accessDialog.open &&
    store.accessDialog.projectId &&
    !store.projects.some((project) => project.id === store.accessDialog.projectId)
  ) {
    closeAccessDialog()
  }
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
  if (!store.auth.user || store.eventSource) return
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
  source.addEventListener('deploy-log', (event) => {
    try {
      const data = JSON.parse(event.data)
      appendDeployLog(data.projectId, data.envId, data.level, data.text)
    } catch {
      /* 忽略无效数据 */
    }
  })
  source.addEventListener('deploy-status', (event) => {
    try {
      updateEnvStatus(JSON.parse(event.data))
    } catch {
      /* 忽略无效数据 */
    }
  })
  source.addEventListener('run-status', (event) => {
    try {
      applyRunStatus(JSON.parse(event.data))
    } catch {
      /* 忽略无效数据 */
    }
  })
  source.addEventListener('run-log', (event) => {
    try {
      const data = JSON.parse(event.data)
      appendRunLog(data.projectId, data.level, data.text)
    } catch {
      /* 忽略无效数据 */
    }
  })
}

export function disconnectEvents() {
  if (!store.eventSource) return
  try {
    store.eventSource.close()
  } catch {
    /* 忽略 */
  }
  store.eventSource = null
}

/* ----------------------------- 项目运行状态 ----------------------------- */

function ensureRunLog(projectId) {
  if (!store.runLogs[projectId]) {
    store.runLogs[projectId] = { entries: [], version: 0 }
  }
  return store.runLogs[projectId]
}

function appendRunLog(projectId, level, text) {
  if (!projectId || !text) return
  const buf = ensureRunLog(projectId)
  const last = buf.entries[buf.entries.length - 1]
  if (
    level === 'out' &&
    last &&
    last.level === 'out' &&
    !last.text.endsWith('\n') &&
    last.text.length + text.length < 8000
  ) {
    last.text += text
  } else {
    buf.entries.push({ level, text })
  }
  while (buf.entries.length > 1200) buf.entries.shift()
  buf.version += 1
}

function resetRunLog(projectId) {
  const buf = ensureRunLog(projectId)
  buf.entries = []
  buf.version += 1
}

function applyRunStatus(data) {
  if (!data?.projectId) return
  store.runtime[data.projectId] = {
    status: data.status || 'idle',
    url: data.url || '',
    error: data.error || null,
    startedAt: data.startedAt || null,
    command: data.command || '',
  }
}

const runStarting = new Set()

export async function startProjectRun(projectId) {
  if (!projectId || runStarting.has(projectId)) return null
  runStarting.add(projectId)
  resetRunLog(projectId)
  try {
    const data = await api('POST', `/api/projects/${projectId}/start`)
    if (data) applyRunStatus({ ...data, projectId })
    return data
  } catch (err) {
    pushToast(err.message, 'error')
    return null
  } finally {
    runStarting.delete(projectId)
  }
}

export async function stopProjectRun(projectId) {
  if (!projectId) return null
  try {
    const data = await api('POST', `/api/projects/${projectId}/stop`)
    if (data) applyRunStatus({ ...data, projectId })
    return data
  } catch (err) {
    pushToast(err.message, 'error')
    return null
  }
}

export async function restartProjectRun(projectId) {
  if (!projectId || runStarting.has(projectId)) return null
  runStarting.add(projectId)
  resetRunLog(projectId)
  try {
    const data = await api('POST', `/api/projects/${projectId}/restart`)
    if (data) applyRunStatus({ ...data, projectId })
    return data
  } catch (err) {
    pushToast(err.message, 'error')
    return null
  } finally {
    runStarting.delete(projectId)
  }
}

export async function loadRunLogs(projectId) {
  if (!projectId) return
  try {
    const data = await api('GET', `/api/projects/${projectId}/run/logs`)
    const buf = ensureRunLog(projectId)
    if (Array.isArray(data?.logs)) {
      buf.entries = data.logs
      buf.version += 1
    }
  } catch {
    /* 忽略 */
  }
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

export async function inspectPath(targetPath) {
  return api('GET', `/api/fs/inspect?path=${encodeURIComponent(targetPath || '')}`)
}

export async function listDir(targetPath) {
  return api('GET', `/api/fs/list?path=${encodeURIComponent(targetPath || '')}`)
}

async function uploadAttachment(requirementId, file) {
  const res = await fetch(
    `/api/requirements/${requirementId}/attachments?name=${encodeURIComponent(file.name)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: file,
    },
  )
  let data = null
  try {
    data = await res.json()
  } catch {
    /* 忽略空响应 */
  }
  if (!res.ok) throw new Error(data?.error || `附件上传失败 (${res.status})`)
  return data?.attachment
}

export async function addRequirement(text, files = []) {
  try {
    const requirement = await api('POST', '/api/requirements', {
      text,
      projectId: store.route.projectId || undefined,
    })
    store.selectedId = requirement.id
    if (files.length) {
      let uploaded = 0
      for (const file of files) {
        try {
          await uploadAttachment(requirement.id, file)
          uploaded += 1
        } catch (err) {
          pushToast(`附件「${file.name}」上传失败：${err.message}`, 'error')
        }
      }
      if (uploaded) pushToast(`已上传 ${uploaded} 个附件`, 'success')
    }
    return requirement
  } catch (err) {
    pushToast(err.message, 'error')
    return null
  }
}

export async function removeAttachment(requirementId, attachmentId) {
  try {
    await api('DELETE', `/api/requirements/${requirementId}/attachments/${attachmentId}`)
    return true
  } catch (err) {
    pushToast(err.message, 'error')
    return false
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
      const data = await api('PATCH', `/api/projects/${editing.id}`, payload)
      const updated = data?.project || data
      if (updated) applyProjectUpdate(updated)
      pushToast('项目已更新', 'success')
    } else {
      const data = await api('POST', '/api/projects', payload)
      if (data?.project) applyProjectUpdate(data.project)
      pushToast(data.created ? '项目已创建，目录已自动生成' : '项目已创建', 'success')
    }
    closeProjectDialog()
    return true
  } catch (err) {
    pushToast(err.message, 'error')
    return false
  }
}

export function applyProjectUpdate(project) {
  if (!project?.id) return
  const index = store.projects.findIndex((item) => item.id === project.id)
  if (index >= 0) store.projects[index] = project
  else store.projects.unshift(project)
}

export async function updateProjectFields(id, patch, { silent = false } = {}) {
  try {
    const data = await api('PATCH', `/api/projects/${id}`, patch)
    const updated = data?.project || data
    if (updated) applyProjectUpdate(updated)
    if (!silent) pushToast('项目已更新', 'success')
    return updated
  } catch (err) {
    if (!silent) pushToast(err.message, 'error')
    return null
  }
}

export async function createProjects(entries) {
  let ok = 0
  const errors = []
  for (const entry of entries) {
    try {
      const data = await api('POST', '/api/projects', entry)
      if (data?.project) applyProjectUpdate(data.project)
      ok += 1
    } catch (err) {
      errors.push(`「${entry.name || entry.path}」${err.message}`)
    }
  }
  if (ok) pushToast(ok === 1 ? '项目已创建' : `已创建 ${ok} 个项目`, 'success')
  if (errors.length) {
    pushToast(
      errors.length === 1 ? errors[0] : `${errors[0]}（另有 ${errors.length - 1} 个失败）`,
      'error',
    )
  }
  return { ok, errors }
}

export async function removeProject(id) {
  try {
    await api('DELETE', `/api/projects/${id}`)
    if (tabState.byProject[id]) {
      delete tabState.byProject[id]
      persistTabs()
    }
    delete store.runtime[id]
    if (store.route.projectId === id) backToProjects()
    pushToast('项目已删除', 'success')
  } catch (err) {
    pushToast(err.message, 'error')
  }
}

/* ------------------------------- 团队 ------------------------------- */

function replaceTeam(team) {
  if (!team?.id) return
  const index = store.teams.findIndex((item) => item.id === team.id)
  if (index >= 0) store.teams[index] = team
  else store.teams.unshift(team)
  if (store.auth.user) store.auth.user.teamIds = store.teams.map((item) => item.id)
}

export async function loadTeams({ silent = false } = {}) {
  try {
    const data = await api('GET', '/api/teams')
    store.teams = Array.isArray(data?.teams) ? data.teams : []
    store.teamsLoaded = true
    if (store.auth.user) store.auth.user.teamIds = store.teams.map((item) => item.id)
    return store.teams
  } catch (err) {
    if (!silent) pushToast(err.message, 'error')
    return []
  }
}

export function openTeamDialog() {
  store.teamDialogOpen = true
  loadTeams()
}

export function closeTeamDialog() {
  store.teamDialogOpen = false
}

export async function createTeam(name) {
  try {
    const data = await api('POST', '/api/teams', { name })
    if (data?.team) replaceTeam(data.team)
    pushToast('团队已创建', 'success')
    return data?.team || null
  } catch (err) {
    pushToast(err.message, 'error')
    return null
  }
}

export async function renameTeam(id, name) {
  try {
    const data = await api('PATCH', `/api/teams/${id}`, { name })
    if (data?.team) replaceTeam(data.team)
    pushToast('团队名称已更新', 'success')
    return data?.team || null
  } catch (err) {
    pushToast(err.message, 'error')
    return null
  }
}

export async function deleteTeam(id) {
  try {
    await api('DELETE', `/api/teams/${id}`)
    store.teams = store.teams.filter((item) => item.id !== id)
    if (store.auth.user) store.auth.user.teamIds = store.teams.map((item) => item.id)
    pushToast('团队已删除', 'success')
    return true
  } catch (err) {
    pushToast(err.message, 'error')
    return false
  }
}

export async function addTeamMember(id, email) {
  try {
    const data = await api('POST', `/api/teams/${id}/members`, { email })
    if (data?.team) replaceTeam(data.team)
    pushToast('成员已加入团队', 'success')
    return data?.team || null
  } catch (err) {
    pushToast(err.message, 'error')
    return null
  }
}

export async function removeTeamMember(id, userId) {
  try {
    const data = await api('DELETE', `/api/teams/${id}/members/${userId}`)
    if (data?.team) replaceTeam(data.team)
    pushToast('成员已移出团队', 'success')
    return data?.team || null
  } catch (err) {
    pushToast(err.message, 'error')
    return null
  }
}

export async function leaveTeam(id) {
  try {
    await api('POST', `/api/teams/${id}/leave`)
    store.teams = store.teams.filter((item) => item.id !== id)
    if (store.auth.user) store.auth.user.teamIds = store.teams.map((item) => item.id)
    pushToast('已退出团队', 'success')
    return true
  } catch (err) {
    pushToast(err.message, 'error')
    return false
  }
}

/* --------------------------- 项目可见范围 --------------------------- */

export function openAccessDialog(project) {
  if (!project?.id) return
  store.accessDialog = { open: true, projectId: project.id }
}

export function closeAccessDialog() {
  store.accessDialog = { open: false, projectId: null }
}

export async function loadProjectAccess(projectId) {
  return api('GET', `/api/projects/${projectId}/access`)
}

export async function lookupUser(email) {
  const data = await api('GET', `/api/users/lookup?email=${encodeURIComponent(email)}`)
  return data?.user || null
}

export async function saveProjectAccess(projectId, { teamIds, userIds }) {
  try {
    const data = await api('PUT', `/api/projects/${projectId}/access`, { teamIds, userIds })
    const project = store.projects.find((item) => item.id === projectId)
    if (project) {
      project.teamIds = data?.teamIds || []
      project.userIds = data?.userIds || (data?.users || []).map((user) => user.id)
    }
    pushToast('项目可见范围已更新', 'success')
    return data
  } catch (err) {
    pushToast(err.message, 'error')
    return null
  }
}

/* ----------------------------- 浏览器式页签 ----------------------------- */

const TABS_KEY = 'aiedithere.workspace.tabs.v1'

function sanitizeTabEntry(entry) {
  const tabs = (Array.isArray(entry?.tabs) ? entry.tabs : []).filter(
    (tab) => tab && tab.kind !== 'workspace',
  )
  const activeId = tabs.some((tab) => tab.id === entry?.activeId)
    ? entry.activeId
    : tabs[0]?.id || null
  return { tabs, activeId }
}

function loadTabState() {
  try {
    const raw = localStorage.getItem(TABS_KEY)
    const data = JSON.parse(raw)
    if (!data || typeof data !== 'object') return {}
    const next = {}
    for (const [projectId, entry] of Object.entries(data)) {
      next[projectId] = sanitizeTabEntry(entry)
    }
    return next
  } catch {
    return {}
  }
}

export const tabState = reactive({ byProject: loadTabState() })
let tabPersistTimer = null

function persistTabs() {
  if (tabPersistTimer) clearTimeout(tabPersistTimer)
  tabPersistTimer = setTimeout(() => {
    try {
      localStorage.setItem(TABS_KEY, JSON.stringify(tabState.byProject))
    } catch {
      /* 忽略存储失败 */
    }
  }, 150)
}

export function ensureProjectTabs(projectId) {
  if (!projectId) return { tabs: [], activeId: null }
  const entry = sanitizeTabEntry(tabState.byProject[projectId])
  tabState.byProject[projectId] = entry
  persistTabs()
  return entry
}

export function projectTabs(projectId) {
  if (!projectId) return { tabs: [], activeId: null }
  return tabState.byProject[projectId] || { tabs: [], activeId: null }
}

export function setActiveTab(projectId, tabId) {
  const entry = ensureProjectTabs(projectId)
  if (!entry.tabs.some((tab) => tab.id === tabId)) return
  entry.activeId = tabId
  persistTabs()
}

export function addPreviewTab(projectId, { url, title, sourceProjectId = null, activate = true } = {}) {
  const entry = ensureProjectTabs(projectId)
  const tab = {
    id: `preview:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
    kind: 'preview',
    title: title || '预览',
    url: url || 'http://localhost:5173/',
    sourceProjectId,
    closable: true,
  }
  entry.tabs.push(tab)
  if (activate) entry.activeId = tab.id
  persistTabs()
  return tab
}

export function ensureProjectPreviewTab(workspaceProjectId, sourceProject, { activate = false } = {}) {
  if (!workspaceProjectId || !sourceProject) return null
  const entry = ensureProjectTabs(workspaceProjectId)
  let tab = entry.tabs.find(
    (item) => item.kind === 'preview' && item.sourceProjectId === sourceProject.id,
  )
  if (!tab) {
    tab = addPreviewTab(workspaceProjectId, {
      title: sourceProject.name || '预览',
      url: sourceProject.previewUrl || 'http://localhost:5173/',
      sourceProjectId: sourceProject.id,
      activate,
    })
    return tab
  }
  if (!tab.url) tab.url = sourceProject.previewUrl || 'http://localhost:5173/'
  const title = sourceProject.name || '预览'
  if (tab.title !== title) tab.title = title
  if (activate) entry.activeId = tab.id
  persistTabs()
  return tab
}

export function updatePreviewTab(projectId, tabId, patch) {
  const entry = ensureProjectTabs(projectId)
  const tab = entry.tabs.find((item) => item.id === tabId)
  if (!tab) return null
  Object.assign(tab, patch)
  persistTabs()
  return tab
}

export function closeTab(projectId, tabId) {
  const entry = ensureProjectTabs(projectId)
  const index = entry.tabs.findIndex((item) => item.id === tabId)
  if (index < 0) return
  if (!entry.tabs[index].closable) return
  entry.tabs.splice(index, 1)
  if (entry.activeId === tabId) {
    const next = entry.tabs[index] || entry.tabs[index - 1] || entry.tabs[0]
    entry.activeId = next ? next.id : null
  }
  persistTabs()
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

/* ----------------------------- 部署 ----------------------------- */

export function openDeployDialog(project) {
  if (!project) return
  store.deployDialog = { open: true, projectId: project.id }
}

export function closeDeployDialog() {
  store.deployDialog = { open: false, projectId: null }
}

function deployKey(projectId, envId) {
  return `${projectId}:${envId}`
}

function ensureDeployLog(projectId, envId) {
  const key = deployKey(projectId, envId)
  if (!store.deployLogs[key]) store.deployLogs[key] = { entries: [], version: 0, runId: null }
  return store.deployLogs[key]
}

function appendDeployLog(projectId, envId, level, text) {
  if (!text) return
  const buf = ensureDeployLog(projectId, envId)
  const last = buf.entries[buf.entries.length - 1]
  if (
    level === 'out' &&
    last &&
    last.level === 'out' &&
    !last.text.endsWith('\n') &&
    last.text.length + text.length < 8000
  ) {
    last.text += text
  } else {
    buf.entries.push({ level, text })
  }
  while (buf.entries.length > 2000) buf.entries.shift()
  buf.version++
}

function updateEnvStatus({ projectId, envId, status, error, at }) {
  const project = store.projects.find((item) => item.id === projectId)
  const env = project?.deploy?.environments?.find((item) => item.id === envId)
  if (!env) return
  env.lastStatus = status
  if (status === 'success') {
    env.lastDeployedAt = at || Date.now()
    env.lastError = null
  } else if (status === 'failed') {
    env.lastError = error || '部署失败'
  } else if (status === 'cancelled' || status === 'running') {
    env.lastError = null
  }
}

export async function saveDeploy(projectId, deploy, { silent = false } = {}) {
  try {
    const data = await api('PUT', `/api/projects/${projectId}/deploy`, deploy)
    if (data?.project) {
      const index = store.projects.findIndex((item) => item.id === projectId)
      if (index >= 0) store.projects[index] = data.project
    }
    if (!silent) pushToast('部署配置已保存', 'success')
    return true
  } catch (err) {
    pushToast(err.message, 'error')
    return false
  }
}

export async function runDeploy(projectId, envId) {
  const buf = ensureDeployLog(projectId, envId)
  buf.entries = []
  buf.version++
  buf.runId = null
  try {
    const data = await api('POST', `/api/projects/${projectId}/deploy/${envId}`)
    buf.runId = data?.runId || null
    return data
  } catch (err) {
    pushToast(err.message, 'error')
    return null
  }
}

export async function abortDeploy(projectId, envId) {
  try {
    await api('POST', `/api/projects/${projectId}/deploy/${envId}/abort`)
    pushToast('已请求中止部署', 'info')
  } catch (err) {
    pushToast(err.message, 'error')
  }
}

export async function loadDeployLogs(projectId, envId) {
  try {
    const data = await api('GET', `/api/projects/${projectId}/deploy/${envId}/logs`)
    const buf = ensureDeployLog(projectId, envId)
    buf.entries = Array.isArray(data?.logs) ? data.logs : []
    buf.version++
  } catch {
    /* 忽略 */
  }
}
