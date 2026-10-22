import crypto from 'node:crypto'
import { config } from './config.js'
import { findRequirement, findProject, touch, broadcastState, appendLog, toast } from './store.js'
import * as oc from './opencode.js'
import { OpencodeError } from './opencode.js'

const runningSessions = new Map() // sessionId -> { requirementId, taskId }
const cancelFlags = new Map() // requirementId -> { aborted: boolean }
const partText = new Map() // partId -> 已输出的文本
const partToolState = new Map() // partId -> 工具状态

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

/* ------------------------------------------------------------------ */
/* 事件流：把 opencode 的流式输出转发成任务日志                        */
/* ------------------------------------------------------------------ */

function partTextDiff(part, props) {
  const full = typeof part.text === 'string' ? part.text : ''
  const prev = partText.get(part.id) || ''
  partText.set(part.id, full)
  if (typeof props.delta === 'string' && props.delta) return props.delta
  if (full.length > prev.length) return full.slice(prev.length)
  return ''
}

export function handleOpencodeEvent(evt) {
  if (!evt || typeof evt !== 'object') return
  const type = evt.type || ''
  const props = evt.properties || {}
  const part = props.part
  if (!part || typeof part !== 'object') return
  const sessionId = part.sessionID || props.sessionID
  if (!sessionId) return
  const ctx = runningSessions.get(sessionId)
  if (!ctx) return

  if (type.includes('part.removed')) {
    partText.delete(part.id)
    partToolState.delete(part.id)
    return
  }

  if (type.includes('part.updated') || type.includes('part.created')) {
    if (part.type === 'text') {
      const diff = partTextDiff(part, props)
      if (diff) appendLog(ctx.requirementId, ctx.taskId, 'out', diff)
    } else if (part.type === 'tool') {
      const status = part.state?.status
      const prev = partToolState.get(part.id)
      if (status && status !== prev) {
        partToolState.set(part.id, status)
        const name = part.tool || 'tool'
        if (status === 'running') {
          appendLog(ctx.requirementId, ctx.taskId, 'tool', `⚙ 调用工具 ${name}`)
        } else if (status === 'completed') {
          appendLog(ctx.requirementId, ctx.taskId, 'tool', `⚙ ${name} 完成`)
        } else if (status === 'error') {
          appendLog(ctx.requirementId, ctx.taskId, 'err', `⚙ ${name} 失败`)
        }
      }
    }
  }

  if (type === 'session.error' && (props.sessionID === sessionId || part.sessionID === sessionId)) {
    const message = props.error?.message || props.error?.data?.message || '会话发生错误'
    appendLog(ctx.requirementId, ctx.taskId, 'err', `✖ ${message}`)
  }
}

/* ------------------------------------------------------------------ */
/* 拆解需求                                                            */
/* ------------------------------------------------------------------ */

const SPLIT_SCHEMA = {
  type: 'object',
  properties: {
    tasks: {
      type: 'array',
      description: '拆分后的可独立执行任务列表，按执行顺序排列',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '任务短标题，不超过 30 个字' },
          description: {
            type: 'string',
            description: '任务的具体内容、涉及范围与验收标准',
          },
        },
        required: ['title', 'description'],
      },
    },
  },
  required: ['tasks'],
}

function buildSplitPrompt(req, project) {
  return [
    '你是一名资深技术负责人，需要把需求拆解成可以逐个执行的开发任务。',
    '',
    `目标项目目录：${project?.path || config.projectDir}`,
    '需求内容：',
    '"""',
    req.text,
    '"""',
    '',
    '拆解要求：',
    '1. 拆成 3~8 个任务，每个任务都能独立执行、独立验证；',
    '2. 任务顺序符合依赖关系（先分析/数据层，再逻辑层，最后界面与验证）；',
    '3. 每个任务描述里写清楚要做什么、涉及哪些模块或文件、验收标准是什么；',
    '4. 只拆解需求，不要开始写代码，也不要输出与任务列表无关的内容。',
  ].join('\n')
}

/** 需求所属项目（决定 opencode 在哪个目录工作） */
export function projectOf(req) {
  return findProject(req?.projectId) || null
}

function normalizeTask(item) {
  if (!item || typeof item !== 'object') return null
  const title = String(item.title || item.name || item.task || '').trim()
  const description = String(item.description || item.detail || item.content || '').trim()
  if (!title && !description) return null
  return {
    title: (title || description).slice(0, 80),
    description: description || title,
  }
}

function extractTasks(req, result) {
  const info = result?.info || {}
  const candidates = [
    info.structured_output,
    info.structuredOutput,
    result?.structured_output,
    result?.structuredOutput,
  ]
  let structured = null
  for (const candidate of candidates) {
    if (candidate && typeof candidate === 'object') {
      structured = candidate
      break
    }
  }
  if (!structured) {
    // 兼容结构化输出以工具调用形式返回的情况
    for (const part of result?.parts || []) {
      if (part?.type !== 'tool') continue
      const toolName = String(part.tool || '').toLowerCase()
      if (toolName !== 'structuredoutput' && toolName !== 'structured_output') continue
      const state = part.state || {}
      const value = state.input ?? state.output ?? state.metadata?.output
      if (value && typeof value === 'object') {
        structured = value
        break
      }
      if (typeof value === 'string') {
        try {
          structured = JSON.parse(value)
          break
        } catch {
          /* 继续尝试 */
        }
      }
    }
  }

  const text = (result?.parts || [])
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n')
    .trim()

  const lists = []
  if (structured) {
    lists.push(structured.tasks, structured.requirements, structured.items, structured)
  }

  const fromJsonText = () => {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
    const source = fenced ? fenced[1] : text
    const start = source.indexOf('[')
    const end = source.lastIndexOf(']')
    if (start >= 0 && end > start) {
      try {
        const parsed = JSON.parse(source.slice(start, end + 1))
        if (Array.isArray(parsed)) lists.push(parsed)
      } catch {
        /* 忽略 */
      }
    }
    if (!lists.length) {
      const objStart = source.indexOf('{')
      const objEnd = source.lastIndexOf('}')
      if (objStart >= 0 && objEnd > objStart) {
        try {
          const parsed = JSON.parse(source.slice(objStart, objEnd + 1))
          lists.push(parsed.tasks, parsed.requirements, parsed)
        } catch {
          /* 忽略 */
        }
      }
    }
  }

  if (!structured) fromJsonText()

  for (const list of lists) {
    const source = Array.isArray(list) ? list : Array.isArray(list?.tasks) ? list.tasks : null
    if (!source || !source.length) continue
    const tasks = source.map(normalizeTask).filter(Boolean)
    if (tasks.length) return tasks
  }

  // 兜底：从文本中提取列表项
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const bulletTasks = []
  for (const line of lines) {
    const match = line.match(/^(?:\d+[.、)]|[-*•])\s+(.+)$/)
    if (!match) continue
    const content = match[1].replace(/\*\*/g, '').trim()
    if (content.length < 4) continue
    bulletTasks.push({
      title: content.slice(0, 60),
      description: content,
    })
  }
  if (bulletTasks.length >= 2) return bulletTasks.slice(0, 8)

  if (text.length > 20) {
    return [{ title: req.title.slice(0, 60), description: text.slice(0, 2000) }]
  }
  return []
}

export async function splitRequirement(requirementId) {
  const req = findRequirement(requirementId)
  if (!req) throw new HttpError(404, '需求不存在')
  if (req.status === 'splitting' || req.status === 'running') {
    throw new HttpError(409, '该需求正在处理中')
  }
  if (req.status === 'done') {
    throw new HttpError(400, '已完成的需求不能重新拆解')
  }

  const project = projectOf(req)
  const directory = project?.path || config.projectDir

  const token = { aborted: false }
  cancelFlags.set(req.id, token)

  req.status = 'splitting'
  req.error = null
  req.tasks = []
  touch()
  broadcastState()

  try {
    if (config.demo) {
      await sleep(900)
      req.tasks = demoTasks(req)
    } else {
      await oc.health().then((h) => {
        if (!h.connected) {
          throw new OpencodeError(
            'opencode 未连接。请先运行 `opencode serve`，或在设置中开启「演示模式」。',
          )
        }
      })
      const sessionId = await oc.createSession(`需求拆解 · ${req.title}`, directory)
      req.plannerSessionId = sessionId
      const result = await oc.prompt(
        sessionId,
        {
          text: buildSplitPrompt(req, project),
          format: { type: 'json_schema', schema: SPLIT_SCHEMA, retryCount: 2 },
        },
        directory,
      )
      const tasks = extractTasks(req, result)
      if (!tasks.length) throw new Error('模型没有返回有效的任务列表，请重试或调整需求描述')
      req.tasks = tasks.map((task, index) => ({
        id: crypto.randomUUID(),
        index: index + 1,
        title: task.title,
        description: task.description,
        status: 'pending',
        summary: '',
        error: null,
        logs: [],
        startedAt: null,
        finishedAt: null,
      }))
    }

    if (token.aborted) {
      req.status = 'pending'
      req.error = '拆解已中止'
      req.tasks = []
    } else {
      req.status = 'split'
      req.updatedAt = Date.now()
      toast(`需求已拆解为 ${req.tasks.length} 个任务`, 'success')
    }
  } catch (err) {
    if (token.aborted) {
      req.status = 'pending'
      req.error = '拆解已中止'
      req.tasks = []
    } else {
      req.status = 'failed'
      req.error = err?.message || String(err)
      toast(`拆解失败：${req.error}`, 'error')
    }
  }

  cancelFlags.delete(req.id)
  touch()
  broadcastState()
  return req
}

/* ------------------------------------------------------------------ */
/* 执行需求                                                            */
/* ------------------------------------------------------------------ */

function buildTaskPrompt(req, task, total, project) {
  return [
    `你正在开发项目：${project?.path || config.projectDir}`,
    '',
    '整体需求：',
    '"""',
    req.text,
    '"""',
    '',
    `现在只需要完成子任务 ${task.index}/${total}：${task.title}`,
    task.description ? `任务说明：${task.description}` : '',
    '',
    '执行要求：',
    '1. 先阅读相关代码理解现状，再动手修改；',
    '2. 只做这个子任务需要的改动，不要做无关重构；',
    '3. 修改后做必要的自检（语法、构建或测试）；',
    '4. 不要执行任何破坏性命令；',
    '5. 完成后用不超过 5 行中文总结：改了哪些文件、关键实现点、如何验证。',
  ]
    .filter(Boolean)
    .join('\n')
}

function extractSummary(result) {
  const info = result?.info || {}
  const text = (result?.parts || [])
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n')
    .trim()
  return text || info?.summary || '任务已完成（模型未返回总结）'
}

async function runDemoTask(req, task, token) {
  const steps = [
    '读取项目结构与相关文件',
    '分析现有实现与依赖关系',
    `编写代码实现：${task.title}`,
    '运行自检与格式检查',
    '核对验收标准',
  ]
  for (const step of steps) {
    if (token.aborted) break
    appendLog(req.id, task.id, 'out', `[演示] ${step}…\n`)
    await sleep(650 + Math.random() * 550)
  }
  if (token.aborted) {
    task.status = 'failed'
    task.error = '已中止'
    appendLog(req.id, task.id, 'err', '✖ 已中止')
  } else {
    task.status = 'done'
    task.summary = `【演示模式】已完成「${task.title}」。${
      task.description ? `\n任务内容：${task.description}` : ''
    }\n（开启真实模式后会由 opencode 实际修改代码）`
    appendLog(req.id, task.id, 'ok', '✔ 任务完成（演示模式）\n')
  }
  task.finishedAt = Date.now()
}

async function runRealTask(req, task, token, sessionId, directory, project) {
  runningSessions.set(sessionId, { requirementId: req.id, taskId: task.id })
  try {
    const result = await oc.prompt(
      sessionId,
      {
        text: buildTaskPrompt(req, task, req.tasks.length, project),
      },
      directory,
    )
    if (token.aborted) {
      task.status = 'failed'
      task.error = '已中止'
      appendLog(req.id, task.id, 'err', '✖ 已中止')
    } else if (result?.info?.error) {
      throw new Error(result.info.error.message || 'opencode 返回错误')
    } else {
      task.summary = extractSummary(result)
      task.status = 'done'
      appendLog(req.id, task.id, 'ok', '✔ 任务完成\n')
    }
  } catch (err) {
    if (token.aborted) {
      task.status = 'failed'
      task.error = '已中止'
      appendLog(req.id, task.id, 'err', '✖ 已中止\n')
    } else {
      task.status = 'failed'
      task.error = err?.message || String(err)
      appendLog(req.id, task.id, 'err', `✖ ${task.error}\n`)
    }
  } finally {
    runningSessions.delete(sessionId)
  }
}

export async function executeRequirement(requirementId, taskIds) {
  const req = findRequirement(requirementId)
  if (!req) throw new HttpError(404, '需求不存在')
  if (req.status === 'running' || req.status === 'splitting') {
    throw new HttpError(409, '该需求正在执行中')
  }

  if (!req.tasks?.length) {
    await splitRequirement(requirementId)
    if (!req.tasks?.length) return req
  }

  const targets = req.tasks.filter((task) => {
    if (task.status === 'done') return false
    if (Array.isArray(taskIds) && !taskIds.includes(task.id)) return false
    return true
  })
  if (!targets.length) {
    toast('没有需要执行的任务', 'info')
    return req
  }

  const token = { aborted: false }
  cancelFlags.set(req.id, token)

  req.status = 'running'
  req.error = null
  req.updatedAt = Date.now()
  touch()
  broadcastState()

  const project = projectOf(req)
  const directory = project?.path || config.projectDir

  try {
    if (!config.demo) {
      const h = await oc.health()
      if (!h.connected) {
        throw new OpencodeError(
          'opencode 未连接。请先运行 `opencode serve`，或在设置中开启「演示模式」。',
        )
      }
      if (!req.sessionId) {
        req.sessionId = await oc.createSession(`需求执行 · ${req.title}`, directory)
        touch()
      }
    }

    for (const task of targets) {
      if (token.aborted) {
        if (task.status !== 'done') {
          task.status = 'failed'
          task.error = '已中止'
        }
        continue
      }
      task.status = 'running'
      task.error = null
      task.summary = ''
      task.logs = []
      task.startedAt = Date.now()
      task.finishedAt = null
      touch()
      broadcastState()
      appendLog(
        req.id,
        task.id,
        'sys',
        `▶ 开始执行任务 ${task.index}/${req.tasks.length}：${task.title}\n`,
      )

      if (config.demo) {
        await runDemoTask(req, task, token)
      } else {
        await runRealTask(req, task, token, req.sessionId, directory, project)
      }

      task.finishedAt = task.finishedAt || Date.now()
      req.updatedAt = Date.now()
      touch()
      broadcastState()
    }

    const failed = req.tasks.filter((task) => task.status === 'failed')
    req.status = failed.length ? 'failed' : 'done'
    if (req.status === 'failed') {
      req.error = token.aborted ? '执行已中止' : `${failed.length} 个任务执行失败`
      toast('执行结束，部分任务失败', 'error')
    } else {
      toast('全部任务执行完成', 'success')
    }
  } catch (err) {
    req.status = 'failed'
    req.error = err?.message || String(err)
    toast(`执行失败：${req.error}`, 'error')
  } finally {
    cancelFlags.delete(req.id)
    req.updatedAt = Date.now()
    touch()
    broadcastState()
  }

  return req
}

export async function abortRequirement(requirementId) {
  const req = findRequirement(requirementId)
  if (!req) throw new HttpError(404, '需求不存在')
  const token = cancelFlags.get(requirementId)
  if (token) token.aborted = true
  const project = projectOf(req)
  const directory = project?.path || config.projectDir

  if (req.status === 'splitting') {
    if (req.plannerSessionId && !config.demo) {
      await oc.abortSession(req.plannerSessionId, directory)
    }
    req.error = '拆解已中止'
    touch()
    broadcastState()
    return req
  }

  if (req.sessionId && !config.demo) {
    await oc.abortSession(req.sessionId, directory)
  }
  if (!req.tasks?.some((task) => task.status === 'running') && req.status !== 'running') {
    return req
  }
  req.error = '执行已中止'
  touch()
  broadcastState()
  return req
}

/* ------------------------------------------------------------------ */
/* 演示模式：本地模拟拆解                                             */
/* ------------------------------------------------------------------ */

function demoTasks(req) {
  const text = req.text
  const pieces = text
    .split(/[\n；;。！!？?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 3)

  if (pieces.length >= 3) {
    return pieces.slice(0, 6).map((piece, index) => ({
      id: crypto.randomUUID(),
      index: index + 1,
      title: piece.length > 26 ? `${piece.slice(0, 26)}…` : piece,
      description: piece,
      status: 'pending',
      summary: '',
      error: null,
      logs: [],
      startedAt: null,
      finishedAt: null,
    }))
  }

  const summary = text.length > 40 ? `${text.slice(0, 40)}…` : text
  const templates = [
    { title: '梳理需求与现有代码', description: `阅读项目结构与相关模块，明确「${summary}」的实现范围、技术方案与改动点。` },
    { title: '实现核心逻辑', description: `完成「${summary}」的核心功能实现，包括数据层与业务逻辑。` },
    { title: '完善界面与交互', description: '补充界面呈现、交互细节、加载与异常状态，保证体验完整。' },
    { title: '自测与修复问题', description: '启动项目验证功能，修复发现的问题，补齐必要说明。' },
  ]
  return templates.map((item, index) => ({
    id: crypto.randomUUID(),
    index: index + 1,
    title: item.title,
    description: item.description,
    status: 'pending',
    summary: '',
    error: null,
    logs: [],
    startedAt: null,
    finishedAt: null,
  }))
}

export { HttpError }
