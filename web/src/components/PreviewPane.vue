<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import {
  store,
  startProjectRun,
  stopProjectRun,
  restartProjectRun,
  updatePreviewTab,
  updateProjectFields,
  loadRunLogs,
  openProjectDialog,
  pushToast,
} from '../lib/store.js'

const props = defineProps({
  tab: { type: Object, required: true },
  workspaceProjectId: { type: String, default: '' },
})

const source = computed(() =>
  props.tab.sourceProjectId
    ? store.projects.find((item) => item.id === props.tab.sourceProjectId) || null
    : null,
)
const isFrontend = computed(() => source.value?.type === 'frontend')
const canRun = computed(() => isFrontend.value && Boolean(source.value?.startCommand?.trim()))
const runtime = computed(
  () => (source.value ? store.runtime[source.value.id] : null) || { status: 'idle', url: '', error: null },
)
const status = computed(() => runtime.value.status || 'idle')
const logState = computed(
  () => (source.value ? store.runLogs[source.value.id] : null) || { entries: [], version: 0 },
)

const statusMeta = computed(() => {
  switch (status.value) {
    case 'starting':
      return { label: '启动中', cls: 'st-starting' }
    case 'running':
      return { label: '运行中', cls: 'st-running' }
    case 'stopping':
      return { label: '停止中', cls: 'st-starting' }
    case 'stopped':
      return { label: '已停止', cls: 'st-stopped' }
    case 'failed':
      return { label: '启动失败', cls: 'st-failed' }
    default:
      return { label: '未启动', cls: 'st-idle' }
  }
})

const detectedUrl = computed(() => {
  const value = runtime.value.url
  if (!value) return ''
  if (sameTarget(value, props.tab.url) || sameTarget(value, urlInput.value)) return ''
  return value
})

const urlInput = ref(props.tab.url || '')
const frameKey = ref(0)
const frameLoading = ref(true)
const logsOpen = ref(false)
const logsEl = ref(null)
let frameTimer = null

watch(
  () => props.tab.url,
  (value) => {
    if (value && value !== urlInput.value) urlInput.value = value
  },
)

watch(
  () => source.value?.previewUrl,
  (value) => {
    if (!value) return
    if (props.tab.url !== value) {
      updatePreviewTab(props.workspaceProjectId, props.tab.id, { url: value })
      urlInput.value = value
    }
  },
  { immediate: true },
)

watch(
  () => props.tab.url,
  () => startFrameTimer(),
  { immediate: true },
)

watch(
  () => frameKey.value,
  () => startFrameTimer(),
)

watch(
  [
    () => source.value?.id,
    () => source.value?.type,
    () => source.value?.startCommand,
    () => source.value?.autoStart,
  ],
  () => maybeAutoStart(),
  { immediate: true },
)

watch(
  () => logState.value.version,
  () => {
    if (logsOpen.value) scrollLogs()
  },
)

watch(
  () => status.value,
  (next, previous) => {
    if (next === 'running' && previous !== 'running') {
      frameKey.value += 1
    }
  },
)

onBeforeUnmount(() => {
  if (frameTimer) clearTimeout(frameTimer)
})

function maybeAutoStart() {
  const project = source.value
  if (!project || project.type !== 'frontend') return
  if (project.autoStart === false) return
  if (!String(project.startCommand || '').trim()) return
  if (['starting', 'running', 'stopping'].includes(runtime.value.status)) return
  startProjectRun(project.id)
}

function startFrameTimer() {
  if (frameTimer) clearTimeout(frameTimer)
  frameLoading.value = true
  frameTimer = setTimeout(() => {
    frameLoading.value = false
  }, 8000)
}

function onFrameLoad() {
  frameLoading.value = false
  if (frameTimer) clearTimeout(frameTimer)
}

function normalizeUrl(value) {
  let input = String(value || '').trim()
  if (!input) return null
  if (!/^https?:\/\//i.test(input)) input = `http://${input}`
  try {
    const parsed = new URL(input)
    if (!['http:', 'https:'].includes(parsed.protocol)) return null
    return parsed.toString()
  } catch {
    return null
  }
}

function sameTarget(a, b) {
  const left = normalizeUrl(a)
  const right = normalizeUrl(b)
  if (!left || !right) return left === right
  try {
    const ua = new URL(left)
    const ub = new URL(right)
    const pathA = ua.pathname.replace(/\/+$/, '')
    const pathB = ub.pathname.replace(/\/+$/, '')
    return ua.origin === ub.origin && pathA === pathB
  } catch {
    return left === right
  }
}

async function applyUrl() {
  const value = normalizeUrl(urlInput.value)
  if (!value) {
    pushToast('请输入有效的 http / https 地址', 'error')
    return
  }
  urlInput.value = value
  updatePreviewTab(props.workspaceProjectId, props.tab.id, {
    url: value,
    ...(props.tab.sourceProjectId ? {} : { title: new URL(value).host }),
  })
  frameKey.value += 1
  if (source.value) {
    await updateProjectFields(source.value.id, { previewUrl: value }, { silent: true })
  }
}

async function useDetectedUrl() {
  if (!detectedUrl.value) return
  urlInput.value = detectedUrl.value
  await applyUrl()
}

function reload() {
  frameKey.value += 1
}

function openExternal() {
  const value = normalizeUrl(urlInput.value || props.tab.url)
  if (!value) return
  window.open(value, '_blank', 'noopener,noreferrer')
}

function startRun() {
  if (source.value) startProjectRun(source.value.id)
}

function stopRun() {
  if (source.value) stopProjectRun(source.value.id)
}

function restartRun() {
  if (source.value) restartProjectRun(source.value.id)
}

async function toggleLogs() {
  logsOpen.value = !logsOpen.value
  if (logsOpen.value && source.value) {
    await loadRunLogs(source.value.id)
    scrollLogs()
  }
}

async function showLogs() {
  logsOpen.value = true
  if (source.value) await loadRunLogs(source.value.id)
  scrollLogs()
}

function scrollLogs() {
  nextTick(() => {
    const el = logsEl.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

function editProject() {
  if (source.value) openProjectDialog(source.value)
}
</script>

<template>
  <div class="preview-pane">
    <div class="preview-toolbar">
      <button class="icon-btn" type="button" title="刷新" @click="reload">
        <AppIcon name="refresh" :size="15" />
      </button>
      <div class="url-box">
        <AppIcon name="globe" :size="13" class="url-icon" />
        <input
          v-model="urlInput"
          type="text"
          spellcheck="false"
          placeholder="http://localhost:8080/#/"
          @keydown.enter.prevent="applyUrl"
          @focus="$event.target.select()"
        />
      </div>
      <button class="btn btn-ghost btn-xs" type="button" @click="applyUrl">前往</button>

      <span v-if="source" class="run-chip" :class="statusMeta.cls">
        <span class="dot" />
        {{ statusMeta.label }}
      </span>

      <div class="spacer" />

      <template v-if="isFrontend">
        <button
          v-if="status === 'starting' || status === 'running' || status === 'stopping'"
          class="btn btn-ghost btn-xs"
          type="button"
          @click="stopRun"
        >
          <AppIcon name="stop" :size="11" />
          停止
        </button>
        <button v-else class="btn btn-soft btn-xs" type="button" :disabled="!canRun" @click="startRun">
          <AppIcon name="play" :size="11" />
          启动
        </button>
        <button
          class="icon-btn"
          type="button"
          title="重启服务"
          :disabled="!canRun"
          @click="restartRun"
        >
          <AppIcon name="refresh" :size="14" />
        </button>
      </template>

      <button
        class="btn btn-ghost btn-xs"
        :class="{ 'is-on': logsOpen }"
        type="button"
        @click="toggleLogs"
      >
        <AppIcon name="terminal" :size="12" />
        日志
      </button>
      <button class="btn btn-ghost btn-xs" type="button" title="目标页面若禁止嵌入，请在新窗口打开" @click="openExternal">
        <AppIcon name="external" :size="12" />
        新窗口
      </button>
    </div>

    <div v-if="source && isFrontend && !canRun" class="preview-banner banner-config">
      <AppIcon name="alert" :size="14" />
      <span>该项目还没有配置启动命令，无法自动启动预览服务。</span>
      <button v-if="source?.isOwner" class="btn btn-soft btn-xs" @click="editProject">去配置</button>
    </div>
    <div v-else-if="status === 'failed'" class="preview-banner banner-error">
      <AppIcon name="alert" :size="14" />
      <span>{{ runtime.error || '预览服务启动失败' }}</span>
      <button class="btn btn-ghost btn-xs" @click="showLogs">查看日志</button>
      <button class="btn btn-soft btn-xs" :disabled="!canRun" @click="restartRun">重试</button>
    </div>
    <div v-if="detectedUrl" class="preview-banner banner-info">
      <AppIcon name="spark" :size="14" />
      <span>检测到服务实际地址 <code>{{ detectedUrl }}</code></span>
      <button class="btn btn-ghost btn-xs" @click="useDetectedUrl">使用此地址</button>
    </div>

    <div class="frame-wrap">
      <iframe
        v-if="tab.url"
        :key="`${frameKey}-${tab.url}`"
        :src="tab.url"
        class="preview-frame"
        allow="clipboard-read; clipboard-write; fullscreen"
        referrerpolicy="no-referrer"
        @load="onFrameLoad"
      />
      <div v-else class="frame-empty">
        <div class="empty-icon"><AppIcon name="globe" :size="20" /></div>
        <div>还没有预览地址</div>
        <span class="field-hint">在上方输入运行后的访问地址，例如 http://localhost:8080/#/</span>
      </div>
      <div v-if="tab.url && frameLoading" class="frame-loading">
        <span class="spinner" />
        <span>正在加载 {{ tab.url }}</span>
      </div>
    </div>

    <div v-if="logsOpen" class="run-logs">
      <div class="run-logs-head">
        <span class="run-logs-title">
          <AppIcon name="terminal" :size="13" />
          运行日志
          <span v-if="source" class="muted">{{ source.name }}</span>
        </span>
        <span class="run-logs-cmd">{{ source?.startCommand || '' }}</span>
        <button class="icon-btn" type="button" title="收起日志" @click="logsOpen = false">
          <AppIcon name="x" :size="14" />
        </button>
      </div>
      <div ref="logsEl" class="run-logs-body">
        <div v-for="(entry, index) in logState.entries" :key="index" class="log-line" :class="`log-${entry.level}`">{{ entry.text }}</div>
        <div v-if="!logState.entries.length" class="log-empty">暂无日志</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.preview-pane {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 9px;
  padding: 11px 18px 16px;
}

.preview-toolbar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 7px;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 11px;
  padding: 7px 9px;
  box-shadow: 0 1px 2px rgba(23, 32, 43, 0.03);
}

.url-box {
  flex: 1;
  min-width: 120px;
  display: flex;
  align-items: center;
  gap: 6px;
  background: #f5f7fa;
  border: 1px solid transparent;
  border-radius: 8px;
  padding: 0 9px;
  transition: border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;
}

.url-box:focus-within {
  background: #fff;
  border-color: var(--green);
  box-shadow: 0 0 0 3px rgba(63, 185, 132, 0.13);
}

.url-icon {
  color: #9aa4b2;
  flex: none;
}

.url-box input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  font-size: 12.5px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  padding: 6px 0;
  color: var(--text-soft);
}

.spacer {
  flex: 1;
}

.run-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
  font-weight: 600;
  border-radius: 99px;
  padding: 3px 9px;
  white-space: nowrap;
  flex: none;
}

.run-chip .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}

.st-idle,
.st-stopped {
  color: var(--muted);
  background: #f1f3f6;
}

.st-starting {
  color: var(--amber);
  background: var(--amber-soft);
}

.st-running {
  color: var(--green-dark);
  background: var(--green-soft);
}

.st-failed {
  color: var(--red);
  background: var(--red-soft);
}

.st-starting .dot {
  animation: pulse 1.2s ease-in-out infinite;
}

.btn.is-on {
  border-color: var(--green);
  color: var(--green-dark);
  background: #f3fbf7;
}

.preview-banner {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  border-radius: 9px;
  padding: 7px 11px;
  font-size: 12px;
}

.preview-banner span {
  flex: 1;
}

.banner-config {
  background: #fff7ea;
  border: 1px solid #f4e3c4;
  color: #8a5b12;
}

.banner-error {
  background: var(--red-soft);
  border: 1px solid #f6d4d4;
  color: #a12626;
}

.banner-info {
  background: #f5f9ff;
  border: 1px solid #dbe8fb;
  color: #3a5a86;
}

.banner-info code {
  background: rgba(0, 0, 0, 0.06);
  border-radius: 4px;
  padding: 0 4px;
  font-size: 11px;
}

.frame-wrap {
  flex: 1;
  min-height: 0;
  position: relative;
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: hidden;
  background: #fff;
  box-shadow: var(--shadow-panel);
}

.preview-frame {
  width: 100%;
  height: 100%;
  border: 0;
  display: block;
  background: #fff;
}

.frame-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
  background: rgba(255, 255, 255, 0.86);
  backdrop-filter: blur(2px);
  font-size: 12.5px;
  color: var(--muted);
  pointer-events: none;
}

.frame-empty {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: var(--muted);
  font-size: 13px;
}

.frame-empty .empty-icon {
  width: 44px;
  height: 44px;
  border-radius: 13px;
  background: #f1f4f8;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #9aa4b2;
  margin-bottom: 2px;
}

.field-hint {
  font-size: 11.5px;
  color: #9aa4b2;
}

.run-logs {
  flex: none;
  height: 210px;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: 11px;
  overflow: hidden;
  background: #121a23;
  box-shadow: var(--shadow-panel);
}

.run-logs-head {
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 10px;
  background: #18222d;
  border-bottom: 1px solid #26323f;
}

.run-logs-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: #dfe7ef;
}

.run-logs-title .muted {
  color: #8fa0b3;
  font-weight: 400;
}

.run-logs-cmd {
  margin-left: auto;
  max-width: 45%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  color: #8fa0b3;
}

.run-logs-head .icon-btn {
  color: #95a6b9;
}

.run-logs-head .icon-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
}

.run-logs-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px 11px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11.5px;
  line-height: 1.55;
  color: #c8d3df;
  white-space: pre-wrap;
  word-break: break-word;
}

.run-logs-body::-webkit-scrollbar {
  width: 8px;
}

.run-logs-body::-webkit-scrollbar-thumb {
  background: #33404e;
  border-radius: 99px;
}

.log-line {
  margin: 0;
}

.log-sys {
  color: #7aa2c9;
}

.log-ok {
  color: #63c794;
}

.log-err {
  color: #f08a8a;
}

.log-empty {
  color: #6f8194;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 0.35;
    transform: scale(0.85);
  }
  50% {
    opacity: 1;
    transform: scale(1.1);
  }
}

@media (max-width: 1080px) {
  .run-chip {
    display: none;
  }

  .preview-toolbar {
    flex-wrap: wrap;
  }

  .url-box {
    order: -1;
    flex-basis: 100%;
  }
}
</style>
