<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import {
  pushToast,
  projectAiQueue,
  startQueuedAiTask,
  resumeAiQueue,
  stopAiQueue,
  retryAiTask,
  removeAiTask,
  clearFinishedAiTasks,
} from '../lib/store.js'

const props = defineProps({
  iframe: { type: Object, default: null },
  project: { type: Object, default: null },
  previewUrl: { type: String, default: '' },
})

const emit = defineEmits(['close', 'refresh'])

const instruction = ref('')
const elements = ref([])
const busy = ref(false)
const picking = ref(false)
const sameOrigin = ref(false)
const bodyEl = ref(null)
const activeTab = ref('new')

const queue = computed(() => (props.project ? projectAiQueue(props.project.id) : null))
const tasks = computed(() => queue.value?.items || [])
const running = computed(() => tasks.value.find((item) => item.status === 'running'))
const isRunning = computed(() => Boolean(running.value))
const pendingCount = computed(() => tasks.value.filter((item) => item.status === 'pending').length)
const canAdd = computed(() => Boolean(elements.value.length && instruction.value.trim()))
const MAX_ELEMENTS = 10

let boundIframe = null
let pickCleanup = null
let pickRemove = null
let pickTimer = null

function checkIframe() {
  sameOrigin.value = false
  const el = props.iframe
  if (!el) return
  try {
    const doc = el.contentDocument
    sameOrigin.value = Boolean(doc && doc.body)
  } catch {
    sameOrigin.value = false
  }
}

watch(
  () => props.iframe,
  (el) => {
    if (boundIframe) boundIframe.removeEventListener('load', checkIframe)
    boundIframe = el
    if (el) {
      el.addEventListener('load', checkIframe)
      checkIframe()
    } else {
      sameOrigin.value = false
    }
  },
  { immediate: true },
)

onMounted(() => {
  window.addEventListener('message', onWindowMessage)
})

onBeforeUnmount(() => {
  window.removeEventListener('message', onWindowMessage)
  if (boundIframe) boundIframe.removeEventListener('load', checkIframe)
  stopPicking()
})

function clearPickTimer() {
  if (pickTimer) {
    clearTimeout(pickTimer)
    pickTimer = null
  }
}

function onWindowMessage(event) {
  const win = props.iframe?.contentWindow
  if (!win || event.source !== win) return
  const data = event.data
  if (!data || data.source !== 'ai-edit-picker') return
  if (data.type === 'ai-picker:started') {
    clearPickTimer()
    picking.value = true
    pushToast('请点击预览页面中要修改的元素', 'info')
    return
  }
  if (data.type === 'ai-picker:selected') {
    clearPickTimer()
    if (data.element) {
      addElement(data.element)
      picking.value = Boolean(data.multi)
    } else {
      picking.value = false
      pushToast('元素信息为空，请重试', 'error')
    }
    return
  }
  if (data.type === 'ai-picker:removed') {
    removeElementByKey(data.key)
    return
  }
  if (data.type === 'ai-picker:finished') {
    clearPickTimer()
    picking.value = false
    pushToast(`已选择 ${elements.value.length} 个元素`, 'success')
    return
  }
  if (data.type === 'ai-picker:error') {
    clearPickTimer()
    picking.value = false
    pushToast(data.message || '无法读取该元素的信息', 'error')
    return
  }
  if (data.type === 'ai-picker:cancelled') {
    clearPickTimer()
    picking.value = false
    if (data.clear) elements.value = []
    pushToast(data.clear ? '已取消元素选择' : '已结束元素选择', 'info')
  }
}

function shortcutLabel() {
  return props.previewUrl ? `当前预览：${props.previewUrl}` : '当前项目预览'
}

function elementKey(info) {
  return info?.selector || `${info?.tag || ''}:${info?.id || ''}:${info?.text || ''}`
}

function addElement(info) {
  if (!info) return
  if (elements.value.length >= MAX_ELEMENTS) {
    pushToast(`最多选择 ${MAX_ELEMENTS} 个元素`, 'info')
    return
  }
  const key = elementKey(info)
  if (elements.value.some((item) => elementKey(item) === key)) {
    pushToast('该元素已经选过了', 'info')
    return
  }
  elements.value.push(info)
}

function removeElementByKey(key) {
  const index = elements.value.findIndex((item) => elementKey(item) === key)
  if (index >= 0) elements.value.splice(index, 1)
}

function removeElement(index) {
  const item = elements.value[index]
  if (!item) return
  const key = elementKey(item)
  elements.value.splice(index, 1)
  if (pickRemove) pickRemove(key)
  else {
    try {
      props.iframe?.contentWindow?.postMessage(
        { source: 'ai-edit-parent', type: 'ai-picker:remove', key },
        '*',
      )
    } catch {
      /* 忽略 */
    }
  }
}

function itemElements(item) {
  if (Array.isArray(item?.elements) && item.elements.length) return item.elements
  return item?.element ? [item.element] : []
}

/* ------------------------------ 选取元素 ------------------------------ */

function finishPicking() {
  if (!picking.value) return
  stopPicking()
  pushToast(`已完成元素选择，共 ${elements.value.length} 个`, 'info')
}

function pickElement() {
  if (picking.value) {
    finishPicking()
    return
  }
  const doc = props.iframe?.contentDocument
  if (doc) {
    startPicking(doc)
    return
  }
  const win = props.iframe?.contentWindow
  if (!win) {
    pushToast('预览还没有加载完成，请稍后再试', 'error')
    return
  }
  stopPicking()
  picking.value = true
  clearPickTimer()
  pickTimer = setTimeout(() => {
    if (!picking.value) return
    picking.value = false
    try {
      win.postMessage({ source: 'ai-edit-parent', type: 'ai-picker:stop' }, '*')
    } catch {
      /* 忽略 */
    }
    pushToast('没有检测到元素选择脚本，请刷新预览后重试', 'error')
  }, 2500)
  win.postMessage({ source: 'ai-edit-parent', type: 'ai-picker:start', multi: true }, '*')
}

function startPicking(doc) {
  stopPicking()
  picking.value = true
  const overlay = doc.createElement('div')
  overlay.setAttribute('data-ai-picker', '')
  overlay.style.cssText = [
    'position:fixed',
    'pointer-events:none',
    'z-index:2147483647',
    'border:2px solid #2c9d6e',
    'background:rgba(44,157,110,0.12)',
    'border-radius:4px',
    'box-shadow:0 0 0 9999px rgba(15,23,32,0.12)',
  ].join(';')
  doc.body.appendChild(overlay)

  let hovered = null

  const finish = () => {
    picking.value = false
    overlay.remove()
    doc.removeEventListener('mousemove', onMove, true)
    doc.removeEventListener('click', onClick, true)
    doc.removeEventListener('keydown', onKey, true)
    pickCleanup = null
  }

  const onMove = (event) => {
    let target = event.target
    if (!target || target === overlay) return
    if (target.nodeType !== 1) target = target.parentElement
    if (!target || target === doc.documentElement || target === hovered) return
    hovered = target
    const rect = target.getBoundingClientRect()
    overlay.style.left = `${rect.left}px`
    overlay.style.top = `${rect.top}px`
    overlay.style.width = `${rect.width}px`
    overlay.style.height = `${rect.height}px`
  }

  const onClick = (event) => {
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    const info = describeElement(event.target, doc)
    if (info) addElement(info)
    else pushToast('无法读取该元素的信息', 'error')
  }

  const onKey = (event) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    finish()
    pushToast(`已完成元素选择，共 ${elements.value.length} 个`, 'info')
  }

  doc.addEventListener('mousemove', onMove, true)
  doc.addEventListener('click', onClick, true)
  doc.addEventListener('keydown', onKey, true)
  pickCleanup = finish
}

function stopPicking() {
  if (pickCleanup) pickCleanup()
  clearPickTimer()
  if (picking.value) {
    try {
      props.iframe?.contentWindow?.postMessage({ source: 'ai-edit-parent', type: 'ai-picker:stop' }, '*')
    } catch {
      /* 忽略 */
    }
  }
  picking.value = false
}

function cssEscape(value, doc) {
  const escape = doc?.defaultView?.CSS?.escape || window.CSS?.escape
  return escape ? escape(value) : String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&')
}

function describeElement(target, doc) {
  let el = target
  if (!el || el.nodeType !== 1) el = el?.parentElement
  if (!el) return null
  const rect = el.getBoundingClientRect()
  const attrs = {}
  for (const attr of el.attributes || []) {
    if (['style', 'class', 'id'].includes(attr.name)) continue
    if (!attr.value || attr.value.length > 120) continue
    attrs[attr.name] = attr.value
  }
  return {
    tag: el.tagName.toLowerCase(),
    id: el.id || '',
    className: typeof el.className === 'string' ? el.className : '',
    selector: cssSelector(el, doc),
    text: (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 200),
    rect: {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
    attrs,
  }
}

function cssSelector(el, doc) {
  const parts = []
  let node = el
  while (node && node.nodeType === 1) {
    if (node === doc.documentElement) break
    if (node.id) {
      parts.unshift(`#${cssEscape(node.id, doc)}`)
      break
    }
    let part = node.tagName.toLowerCase()
    const classes = [...(node.classList || [])].filter(Boolean).slice(0, 2)
    if (classes.length) part += classes.map((name) => `.${cssEscape(name, doc)}`).join('')
    const parent = node.parentElement
    if (parent) {
      const siblings = [...parent.children].filter((item) => item.tagName === node.tagName)
      if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(node) + 1})`
    }
    parts.unshift(part)
    node = node.parentElement
  }
  return parts.join(' > ')
}

/* ------------------------------ 提交任务 ------------------------------ */

function buildPrompt(note) {
  const lines = ['请根据下面的说明修改这个前端项目。']
  if (props.project) {
    lines.push(`项目：${props.project.name}（${props.project.path}）`)
  }
  if (props.previewUrl) lines.push(`预览地址：${props.previewUrl}`)

  if (elements.value.length) {
    lines.push('', `用户在预览中选中的页面元素（共 ${elements.value.length} 个）：`)
    elements.value.forEach((info, index) => {
      lines.push('', `元素 ${index + 1}：`)
      lines.push(`- 标签：<${info.tag}>`)
      if (info.id) lines.push(`- id：${info.id}`)
      if (info.className) lines.push(`- class：${info.className}`)
      if (info.selector) lines.push(`- 选择器：${info.selector}`)
      if (info.text) lines.push(`- 文本：${info.text}`)
      lines.push(
        `- 位置与尺寸：x=${info.rect.x}, y=${info.rect.y}, 宽=${info.rect.width}, 高=${info.rect.height}`,
      )
      const attrEntries = Object.entries(info.attrs || {})
      if (attrEntries.length) {
        lines.push(`- 属性：${attrEntries.map(([key, value]) => `${key}="${value}"`).join(' ')}`)
      }
    })
  }

  lines.push('', '用户希望这样修改：', note)
  lines.push('', '要求：')
  lines.push('1. 只修改与所选元素相关的代码，不要做无关重构；')
  lines.push('2. 先阅读相关代码理解现有实现，再动手修改；')
  lines.push('3. 修改后做必要自检，并在最后用不超过 5 行中文总结改动。')
  return lines.join('\n')
}

async function addTask() {
  if (!props.project) {
    pushToast('请先打开一个项目', 'error')
    return
  }
  if (!elements.value.length) {
    pushToast('请先在预览中点击选中要修改的元素', 'error')
    return
  }
  const note = instruction.value.trim()
  if (!note) {
    pushToast('请填写修改说明', 'error')
    return
  }
  busy.value = true
  try {
    if (picking.value) stopPicking()
    await startQueuedAiTask({
      projectId: props.project.id,
      text: buildPrompt(note),
      instruction: note,
      elements: elements.value.slice(),
      element: elements.value[0],
      autoStart: false,
    })
    instruction.value = ''
    elements.value = []
    pushToast('已加入任务队列', 'success')
  } finally {
    busy.value = false
  }
}

async function addAndStart() {
  await addTask()
  activeTab.value = 'tasks'
  resumeAiQueue(props.project.id)
}

function startQueue() {
  resumeAiQueue(props.project.id)
}

function stopQueue() {
  stopAiQueue(props.project.id)
}

function retryTask(item) {
  retryAiTask(props.project.id, item.id)
}

function removeTask(item) {
  removeAiTask(props.project.id, item.id)
}

function clearFinished() {
  clearFinishedAiTasks(props.project.id)
}

function toggleLogs(item) {
  item.expanded = !item.expanded
}

function statusLabel(item) {
  if (item.status === 'pending') return { label: '待执行', cls: 'pending' }
  if (item.status === 'aborted') return { label: '已中止', cls: 'failed' }
  if (item.status === 'failed') return { label: '失败', cls: 'failed' }
  if (item.status === 'done') return { label: '已完成', cls: 'done' }
  if (item.status === 'running') {
    if (item.phase === 'creating') return { label: '创建中', cls: 'running' }
    if (item.phase === 'splitting') return { label: '分析中', cls: 'running' }
    if (item.phase === 'executing') {
      return {
        label: `执行中 ${item.completed}/${item.total || 0}`,
        cls: 'running',
      }
    }
    return { label: '运行中', cls: 'running' }
  }
  return { label: item.status || '未知', cls: 'idle' }
}

function progressPercent(item) {
  if (item.status === 'done') return 100
  if (item.total > 0) return Math.round((item.completed / item.total) * 100)
  if (item.status === 'running') return null
  return 0
}

function scrollLogsToBottom() {
  nextTick(() => {
    bodyEl.value?.querySelectorAll('.task-log').forEach((el) => {
      el.scrollTop = el.scrollHeight
    })
  })
}

watch(
  () => tasks.value.reduce((sum, item) => sum + (item.logs?.length || 0), 0),
  scrollLogsToBottom,
)

watch(activeTab, (tab) => {
  if (tab !== 'new') stopPicking()
})
</script>

<template>
  <aside class="ai-edit-drawer" @click.stop>
    <header class="ai-head">
      <div class="ai-title">
        <span class="ai-mark"><AppIcon name="spark" :size="15" /></span>
        <div>
          <h3>AI 修改</h3>
          <p>{{ shortcutLabel() }}</p>
        </div>
      </div>
      <button class="icon-btn" type="button" title="关闭" @click="emit('close')">
        <AppIcon name="x" :size="15" />
      </button>
    </header>

    <div ref="bodyEl" class="ai-body">
      <div v-if="!project" class="ai-hint">
        当前预览页没有关联项目，无法修改代码。
      </div>

      <template v-else>
        <div class="ai-tabs">
          <button
            class="ai-tab"
            type="button"
            :class="{ active: activeTab === 'new' }"
            @click="activeTab = 'new'"
          >
            新建任务
          </button>
          <button
            class="ai-tab"
            type="button"
            :class="{ active: activeTab === 'tasks' }"
            @click="activeTab = 'tasks'"
          >
            任务记录
            <span v-if="tasks.length" class="tab-badge">{{ tasks.length }}</span>
            <span v-if="isRunning" class="tab-running-dot" />
          </button>
        </div>

        <template v-if="activeTab === 'new'">
        <div class="new-task">
          <div class="new-task-head">
            <span class="new-task-title">新建修改任务</span>
            <span class="muted">{{ elements.length }} 个元素 · {{ pendingCount }} 个待执行</span>
          </div>

          <button
            class="element-pick-btn"
            :class="{ 'is-picking': picking }"
            type="button"
            @click="pickElement"
          >
            <span class="pick-icon"><AppIcon name="pointer" :size="18" /></span>
            <span class="pick-text">
              <strong>{{ picking ? '正在选择，点击这里完成' : '选取页面元素（可多选）' }}</strong>
              <small>
                {{
                  picking
                    ? '继续点击可添加更多元素，按 Esc 完成'
                    : sameOrigin
                      ? '可连续点击多个页面元素'
                      : '点击预览中的元素，可连续选择多个'
                }}
              </small>
            </span>
            <span v-if="picking" class="pick-pulse" />
            <AppIcon v-else name="chevron" :size="14" class="pick-arrow" />
          </button>

          <div v-if="picking" class="picking-bar">
            <span class="picking-count">已选 {{ elements.length }} 个</span>
            <span class="picking-tip">点击元素可添加/取消</span>
            <button class="btn btn-primary btn-xs" type="button" @click="finishPicking">
              完成选择
            </button>
          </div>

          <div v-if="elements.length" class="selection-list">
            <div v-for="(item, index) in elements" :key="index" class="selection-card">
              <span class="selection-icon"><AppIcon name="pointer" :size="13" /></span>
              <div class="selection-text">
                <div class="selection-name">
                  {{ index + 1 }}. &lt;{{ item.tag }}&gt;
                  <span v-if="item.id">#{{ item.id }}</span>
                </div>
                <div class="selection-path">{{ item.selector || item.className }}</div>
                <div v-if="item.text" class="selection-snippet">{{ item.text }}</div>
              </div>
              <button class="icon-btn" type="button" title="移除元素" @click="removeElement(index)">
                <AppIcon name="x" :size="12" />
              </button>
            </div>
          </div>

          <div class="field">
            <label>修改说明</label>
            <textarea
              v-model="instruction"
              rows="3"
              placeholder="例如：把这个按钮改成绿色，圆角再大一点，并加上 hover 动效"
            />
          </div>

          <div class="new-task-actions">
            <button class="btn btn-soft btn-sm" type="button" :disabled="busy || !canAdd" @click="addTask">
              添加任务
            </button>
            <button
              class="btn btn-primary btn-sm"
              type="button"
              :disabled="busy || !canAdd || isRunning"
              @click="addAndStart"
            >
              <AppIcon name="spark" :size="13" />
              添加并开始执行
            </button>
          </div>
        </div>

        <div v-if="tasks.length" class="queue-summary">
          <span>队列中 {{ pendingCount }} 个待执行 / 共 {{ tasks.length }} 个任务</span>
          <button class="btn btn-ghost btn-xs" type="button" @click="activeTab = 'tasks'">
            查看任务记录
          </button>
        </div>
        <div v-else class="ai-hint">
          先选取页面元素、填写修改说明并添加任务，队列进度会在「任务记录」中显示。
        </div>
        </template>

        <template v-else>
        <div v-if="tasks.length" class="queue-section">
          <div class="queue-head">
            <div class="queue-head-text">
              <span class="queue-title">任务记录（{{ tasks.length }}）</span>
              <span class="queue-sub">独立会话 · 最多同时执行 2 个</span>
            </div>
            <div class="queue-actions">
              <button
                v-if="!isRunning && pendingCount"
                class="btn btn-soft btn-sm"
                type="button"
                @click="startQueue"
              >
                开始执行
              </button>
              <button v-if="isRunning" class="btn btn-soft btn-sm danger-text" type="button" @click="stopQueue">
                停止执行
              </button>
              <button
                v-if="tasks.some((i) => i.status === 'done' || i.status === 'failed' || i.status === 'aborted')"
                class="btn btn-ghost btn-sm"
                type="button"
                @click="clearFinished"
              >
                清空已完成
              </button>
            </div>
          </div>

          <div class="task-list">
            <div
              v-for="(item, index) in tasks"
              :key="item.id"
              class="task-card"
              :class="{ 'is-running': item.status === 'running', 'is-done': item.status === 'done' }"
            >
              <div class="task-head">
                <span class="task-index">#{{ index + 1 }}</span>
                <span class="task-tags">
                  <span v-for="(el, elIndex) in itemElements(item)" :key="elIndex" class="task-tag">
                    &lt;{{ el.tag }}&gt;
                    <span v-if="el.id">#{{ el.id }}</span>
                  </span>
                </span>
                <span class="status-chip" :class="statusLabel(item).cls">{{ statusLabel(item).label }}</span>
              </div>

              <div class="task-instruction">{{ item.instruction || '' }}</div>

              <div class="task-meta">
                <span v-for="(el, elIndex) in itemElements(item).slice(0, 2)" :key="elIndex">
                  {{ el.selector }}
                </span>
                <span v-if="item.requirementStatus">{{ item.requirementStatus }}</span>
                <span v-if="item.runningTaskTitle">当前：{{ item.runningTaskTitle }}</span>
                <span v-if="item.error" class="error-text">{{ item.error }}</span>
              </div>

              <div class="task-progress">
                <div class="progress-track">
                  <div
                    v-if="progressPercent(item) !== null"
                    class="progress-bar"
                    :style="{ width: progressPercent(item) + '%' }"
                  />
                  <div v-else class="progress-bar indeterminate" />
                </div>
                <span class="progress-text">
                  {{
                    item.total > 0
                      ? `已完成 ${item.completed}/${item.total}`
                      : item.status === 'running'
                        ? '正在处理…'
                        : '等待执行'
                  }}
                </span>
              </div>

              <div class="task-actions">
                <button
                  v-if="item.status === 'failed' || item.status === 'aborted'"
                  class="btn btn-soft btn-xs"
                  type="button"
                  :disabled="isRunning"
                  @click="retryTask(item)"
                >
                  重试
                </button>
                <button
                  v-if="item.status !== 'running'"
                  class="btn btn-ghost btn-xs"
                  type="button"
                  @click="removeTask(item)"
                >
                  移除
                </button>
                <button class="btn btn-ghost btn-xs" type="button" @click="toggleLogs(item)">
                  {{ item.expanded ? '隐藏日志' : '查看日志' }}
                </button>
              </div>

              <div v-if="item.expanded" class="task-logs">
                <div
                  v-for="(entry, logIndex) in item.logs"
                  :key="logIndex"
                  class="task-log"
                  :class="`lvl-${entry.level}`"
                >{{ entry.text }}</div>
                <div v-if="!item.logs.length" class="task-log-empty">暂无日志</div>
              </div>
            </div>
          </div>
        </div>

        <div v-else class="ai-hint">
          还没有任务记录。回到「新建任务」添加，然后开始执行。
        </div>
        </template>
      </template>
    </div>
  </aside>
</template>

<style scoped>
.ai-edit-drawer {
  position: relative;
  width: 100%;
  height: 100%;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: var(--shadow-panel);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.ai-head {
  flex: none;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  padding: 13px 14px;
  border-bottom: 1px solid var(--border);
  background: #fcfdfe;
}

.ai-title {
  display: flex;
  gap: 9px;
  align-items: center;
  min-width: 0;
}

.ai-mark {
  width: 30px;
  height: 30px;
  border-radius: 9px;
  background: linear-gradient(135deg, #4cc693, #2c9d6e);
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
}

.ai-title h3 {
  font-size: 13.5px;
  font-weight: 700;
}

.ai-title p {
  max-width: 260px;
  margin-top: 1px;
  font-size: 10.5px;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ai-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 13px 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 11px;
}

.ai-tabs {
  flex: none;
  display: flex;
  gap: 4px;
  padding: 4px;
  background: #f1f4f7;
  border-radius: 10px;
}

.ai-tab {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 0;
  background: transparent;
  color: var(--muted);
  font-size: 12px;
  font-weight: 600;
  padding: 7px 10px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
}

.ai-tab.active {
  background: #fff;
  color: var(--text);
  box-shadow: 0 1px 3px rgba(15, 23, 32, 0.12);
}

.tab-badge {
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 99px;
  background: var(--green-soft);
  color: var(--green-dark);
  font-size: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.tab-running-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--green);
  animation: pickPulse 1.1s ease-in-out infinite;
}

.queue-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 11px;
  color: var(--muted);
  background: #f6f8fa;
  border: 1px dashed var(--border-strong);
  border-radius: 9px;
  padding: 8px 10px;
}

.new-task {
  border: 1px solid var(--border-strong);
  border-radius: 11px;
  padding: 11px 12px;
  background: #fcfdfe;
}

.new-task-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
}

.new-task .muted {
  font-weight: 400;
  font-size: 11px;
  color: var(--muted);
}

.element-pick-btn {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 11px 12px;
  border: 1px solid var(--border-strong);
  border-radius: 11px;
  background: #fff;
  color: var(--text-soft);
  text-align: left;
  transition: border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;
}

.element-pick-btn:hover {
  border-color: var(--green);
  background: #f8fffb;
}

.element-pick-btn.is-picking {
  border-color: var(--green);
  background: #f3fbf7;
  box-shadow: 0 0 0 3px rgba(63, 185, 132, 0.13);
}

.pick-icon {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  background: var(--green-soft);
  color: var(--green-dark);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
}

.pick-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.pick-text strong {
  font-size: 12.5px;
  font-weight: 650;
  color: var(--text);
}

.pick-text small {
  font-size: 11px;
  color: var(--muted);
  line-height: 1.4;
}

.pick-arrow {
  color: #9aa4b2;
  flex: none;
}

.pick-pulse {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--green);
  flex: none;
  animation: pickPulse 1.1s ease-in-out infinite;
}

@keyframes pickPulse {
  0%,
  100% {
    box-shadow: 0 0 0 0 rgba(63, 185, 132, 0.45);
  }
  50% {
    box-shadow: 0 0 0 6px rgba(63, 185, 132, 0);
  }
}

.selection-list {
  display: flex;
  flex-direction: column;
  gap: 7px;
  margin-top: 8px;
}

.picking-bar {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-top: 7px;
  padding: 6px 8px;
  border: 1px solid #cdeadd;
  background: #f3fbf7;
  border-radius: 9px;
  font-size: 11px;
  color: var(--text-soft);
}

.picking-count {
  font-weight: 700;
  color: var(--green-dark);
  flex: none;
}

.picking-tip {
  flex: 1;
  min-width: 0;
  color: var(--muted);
}

.selection-card {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 9px 10px;
  border: 1px solid #cdeadd;
  background: #f5fbf8;
  border-radius: 10px;
  margin-top: 0;
}

.selection-icon {
  width: 24px;
  height: 24px;
  border-radius: 7px;
  background: var(--green-soft);
  color: var(--green-dark);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
}

.selection-text {
  flex: 1;
  min-width: 0;
}

.selection-name {
  font-size: 12px;
  font-weight: 650;
  color: var(--green-dark);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.selection-path {
  margin-top: 2px;
  font-size: 10.5px;
  color: var(--muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  word-break: break-all;
}

.selection-snippet {
  margin-top: 3px;
  font-size: 11px;
  color: var(--text-soft);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-top: 8px;
}

.field label {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--text-soft);
}

.field textarea {
  width: 100%;
  resize: vertical;
  min-height: 72px;
  border: 1px solid var(--border-strong);
  border-radius: 9px;
  padding: 8px 10px;
  font-size: 12.5px;
  line-height: 1.55;
  outline: none;
  font-family: inherit;
  color: var(--text);
}

.field textarea:focus {
  border-color: var(--green);
  box-shadow: 0 0 0 3px rgba(63, 185, 132, 0.13);
}

.new-task-actions {
  display: flex;
  justify-content: flex-end;
  gap: 7px;
  margin-top: 8px;
}

.queue-section {
  padding-top: 0;
}

.queue-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}

.queue-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
}

.queue-sub {
  font-size: 10px;
  font-weight: 400;
  color: var(--muted);
}

.queue-actions {
  display: flex;
  align-items: center;
  gap: 7px;
}

.danger-text {
  color: var(--red);
}

.danger-text:hover {
  background: var(--red-soft);
}

.task-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.task-card {
  border: 1px solid var(--border-strong);
  border-radius: 10px;
  padding: 9px 10px;
  background: #fff;
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.task-card.is-running {
  border-color: var(--green);
  background: #f8fffb;
}

.task-card.is-done {
  border-color: #cdeadd;
  background: #f5fbf8;
}

.task-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.task-index {
  font-size: 11px;
  font-weight: 700;
  color: var(--muted);
  flex: none;
}

.task-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  flex: 1;
  min-width: 0;
}

.task-tag {
  font-size: 10.5px;
  font-weight: 600;
  color: var(--text-soft);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  word-break: break-all;
  background: #f1f4f8;
  border-radius: 5px;
  padding: 1px 5px;
  flex: none;
}

.status-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border-radius: 99px;
  padding: 2px 8px;
  font-size: 10.5px;
  font-weight: 600;
  flex: none;
}

.status-chip .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}

.status-chip.pending {
  color: var(--muted);
  background: #f1f3f6;
}

.status-chip.running {
  color: #8a5b12;
  background: #fff7ea;
}

.status-chip.done {
  color: var(--green-dark);
  background: var(--green-soft);
}

.status-chip.failed {
  color: var(--red);
  background: var(--red-soft);
}

.task-instruction {
  font-size: 12px;
  line-height: 1.5;
  color: var(--text);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 5.4em;
  overflow: hidden;
}

.task-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 10.5px;
  color: var(--muted);
}

.task-meta .error-text {
  color: var(--red);
}

.task-progress {
  display: flex;
  align-items: center;
  gap: 8px;
}

.progress-track {
  flex: 1;
  height: 6px;
  background: #e4e8ee;
  border-radius: 3px;
  overflow: hidden;
  position: relative;
}

.progress-bar {
  height: 100%;
  background: var(--green);
  border-radius: 3px;
  transition: width 0.3s ease;
}

.progress-bar.indeterminate {
  background: linear-gradient(90deg, #4cc693, #2c9d6e, #4cc693);
  background-size: 200% 100%;
  animation: progressShimmer 1.2s infinite;
}

@keyframes progressShimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

.progress-text {
  font-size: 10.5px;
  color: var(--muted);
  flex: none;
  white-space: nowrap;
}

.task-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.task-logs {
  margin-top: 7px;
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  background: #121a23;
  max-height: 200px;
  overflow: auto;
  padding: 7px 9px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 10.5px;
  line-height: 1.5;
  color: #c8d3df;
}

.task-log {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
}

.lvl-sys { color: #7aa2c9; }
.lvl-ok { color: #63c794; }
.lvl-tool { color: #d6b36a; }
.lvl-err { color: #f08a8a; }

.task-log-empty {
  color: #6f8194;
  font-size: 10.5px;
}

.ai-hint {
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--muted);
  background: #f6f8fa;
  border: 1px dashed var(--border-strong);
  border-radius: 9px;
  padding: 9px 10px;
}

@media (max-width: 760px) {
  .ai-edit-drawer {
    border-radius: 10px;
  }
  .element-pick-btn {
    padding: 9px 10px;
  }
  .pick-text strong {
    font-size: 12px;
  }
}
</style>
