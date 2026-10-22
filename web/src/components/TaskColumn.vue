<script setup>
import { computed, reactive, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import StatusPill from './StatusPill.vue'
import LogPanel from './LogPanel.vue'
import { duration } from '../lib/format.js'
import {
  store,
  splitRequirement,
  executeRequirement,
  abortRequirement,
  retryTask,
  selectedRequirement,
} from '../lib/store.js'

const expanded = reactive(new Set())

const requirement = computed(() => selectedRequirement())
const tasks = computed(() => requirement.value?.tasks || [])

/**
 * 排序规则：正在执行的永远排第一，其次是待执行、失败，最后是已完成的需求点沉底。
 * 同一状态内保持原始任务序号。
 */
const STATUS_ORDER = { running: 0, pending: 1, failed: 2, done: 3 }
const orderedTasks = computed(() =>
  tasks.value
    .slice()
    .sort((a, b) => {
      const pa = STATUS_ORDER[a.status] ?? 4
      const pb = STATUS_ORDER[b.status] ?? 4
      if (pa !== pb) return pa - pb
      return (a.index || 0) - (b.index || 0)
    }),
)

const doneCount = computed(() => tasks.value.filter((task) => task.status === 'done').length)
const percent = computed(() => (tasks.value.length ? Math.round((doneCount.value / tasks.value.length) * 100) : 0))
const processing = computed(() => ['splitting', 'running'].includes(requirement.value?.status))

function logsOpen(task) {
  return task.status === 'running' || expanded.has(task.id)
}

// 任务开始执行时自动展开日志，执行结束后保持展开，方便回看
watch(
  () => (requirement.value?.tasks || []).map((task) => task.status).join(','),
  () => {
    for (const task of requirement.value?.tasks || []) {
      if (task.status === 'running') expanded.add(task.id)
    }
  },
)

function toggleLogs(task) {
  if (expanded.has(task.id)) expanded.delete(task.id)
  else expanded.add(task.id)
}

function resplit() {
  const req = requirement.value
  if (!req) return
  if (req.tasks?.length && !window.confirm('重新拆解会清空当前任务列表，继续？')) return
  splitRequirement(req.id)
}

function execute() {
  const req = requirement.value
  if (!req) return
  if (!req.tasks?.length) splitRequirement(req.id)
  else executeRequirement(req.id)
}

function abort() {
  if (requirement.value) abortRequirement(requirement.value.id)
}

function retry(task) {
  if (requirement.value) retryTask(requirement.value.id, task.id)
}

function taskStateClass(task) {
  return `task-${task.status}`
}
</script>

<template>
  <section class="panel">
    <header class="panel-header">
      <div class="panel-title">
        <span class="step-badge">2</span>
        <h2>需求拆解</h2>
      </div>
      <div class="header-right">
        <span v-if="tasks.length" class="count-pill">{{ doneCount }}/{{ tasks.length }}</span>
        <StatusPill v-if="requirement" :status="requirement.status" />
      </div>
    </header>

    <div v-if="!requirement" class="panel-body">
      <div class="empty">
        <div class="empty-icon"><AppIcon name="split" :size="20" /></div>
        选择左侧的需求，查看拆解结果
      </div>
    </div>

    <template v-else>
      <div class="requirement-summary">
        <p class="summary-text">{{ requirement.text }}</p>
        <div class="progress-row">
          <div class="progress">
            <div class="progress-bar" :style="{ width: `${percent}%` }" />
          </div>
          <span class="progress-label">{{ percent }}%</span>
        </div>
        <div class="toolbar">
          <button
            class="btn btn-ghost btn-sm"
            :disabled="processing || requirement.status === 'done'"
            :title="requirement.status === 'done' ? '已完成的需求不能重新拆解' : '重新拆解并生成新的任务清单'"
            @click="resplit"
          >
            <AppIcon name="refresh" :size="13" />
            {{ tasks.length ? '重新拆解' : '拆解需求' }}
          </button>
          <button
            v-if="requirement.status !== 'done'"
            class="btn btn-primary btn-sm"
            :disabled="processing"
            @click="execute"
          >
            <AppIcon name="play" :size="13" />
            {{ tasks.length ? '执行任务' : '拆解并执行' }}
          </button>
          <button v-else class="btn btn-soft btn-sm" disabled>
            <AppIcon name="check" :size="13" />
            已全部完成
          </button>
          <button v-if="requirement.status === 'running'" class="btn btn-danger btn-sm" @click="abort">
            <AppIcon name="stop" :size="13" />
            中止
          </button>
        </div>
        <div v-if="requirement.error" class="error-box">{{ requirement.error }}</div>
      </div>

      <div class="panel-body task-body">
        <div v-if="requirement.status === 'splitting'" class="skeletons">
          <div v-for="index in 4" :key="index" class="skeleton" style="height: 74px" />
        </div>

        <div v-else-if="!tasks.length" class="empty small">
          <div class="empty-icon"><AppIcon name="zap" :size="20" /></div>
          还没有拆解结果，点击上方「拆解需求」让 AI 生成任务列表
        </div>

        <article
          v-for="task in orderedTasks"
          :key="task.id"
          class="task"
          :class="taskStateClass(task)"
        >
          <div class="task-head">
            <span class="task-index" :class="`idx-${task.status}`">
              <span v-if="task.status === 'done'"><AppIcon name="check" :size="12" :stroke="2.6" /></span>
              <span v-else-if="task.status === 'running'" class="spinner" />
              <span v-else-if="task.status === 'failed'"><AppIcon name="x" :size="12" :stroke="2.6" /></span>
              <template v-else>{{ task.index }}</template>
            </span>
            <div class="task-main">
              <h3 class="task-title">{{ task.title }}</h3>
              <p v-if="task.description && task.description !== task.title" class="task-desc">
                {{ task.description }}
              </p>
            </div>
            <div class="task-aside">
              <StatusPill :status="task.status" />
            </div>
          </div>

          <div class="task-foot">
            <span v-if="task.startedAt" class="task-time">
              <AppIcon name="clock" :size="12" />
              {{ duration(task.startedAt, task.finishedAt) }}
            </span>
            <button
              v-if="task.logs?.length"
              class="link-btn"
              @click="toggleLogs(task)"
            >
              <AppIcon name="terminal" :size="12" />
              {{ logsOpen(task) ? '收起日志' : `查看日志 (${task.logs.length})` }}
            </button>
            <button
              v-if="task.status === 'failed'"
              class="btn btn-ghost btn-xs retry"
              @click="retry(task)"
            >
              <AppIcon name="refresh" :size="12" />
              重试
            </button>
          </div>

          <div v-if="task.error && !logsOpen(task)" class="error-box">{{ task.error }}</div>

          <LogPanel
            v-if="logsOpen(task)"
            :logs="task.logs || []"
            :version="task.logVersion || 0"
            :live="task.status === 'running'"
          />
        </article>
      </div>
    </template>
  </section>
</template>

<style scoped>
.header-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.requirement-summary {
  padding: 12px 14px;
  border-bottom: 1px solid var(--border);
  background: #fcfdfe;
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 9px;
}

.summary-text {
  font-size: 12.5px;
  color: var(--text-soft);
  line-height: 1.6;
  max-height: 64px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-word;
}

.progress-row {
  display: flex;
  align-items: center;
  gap: 9px;
}

.progress {
  flex: 1;
  height: 6px;
  border-radius: 99px;
  background: #edf1f5;
  overflow: hidden;
}

.progress-bar {
  height: 100%;
  border-radius: 99px;
  background: linear-gradient(90deg, #4cc693, var(--green));
  transition: width 0.4s ease;
}

.progress-label {
  font-size: 11.5px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
  width: 34px;
  text-align: right;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.task-body {
  padding-top: 11px;
}

.skeletons {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.task {
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 11px 12px;
  background: #fff;
  display: flex;
  flex-direction: column;
  gap: 8px;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.task-running {
  border-color: #f3d9ae;
  box-shadow: 0 0 0 3px rgba(217, 119, 6, 0.08);
}

.task-done {
  border-color: #d6efe3;
}

.task-failed {
  border-color: #f4cfcf;
}

.task-head {
  display: flex;
  align-items: flex-start;
  gap: 9px;
}

.task-index {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  flex: none;
  background: #f1f3f6;
  color: #7a8494;
  margin-top: 1px;
}

.idx-done {
  background: var(--green-soft);
  color: var(--green-dark);
}

.idx-running {
  background: var(--amber-soft);
}

.idx-failed {
  background: var(--red-soft);
  color: var(--red);
}

.task-main {
  min-width: 0;
  flex: 1;
}

.task-title {
  font-size: 13px;
  font-weight: 650;
  line-height: 1.45;
  word-break: break-word;
}

.task-desc {
  margin-top: 2px;
  font-size: 12px;
  color: var(--muted);
  line-height: 1.55;
  word-break: break-word;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.task-aside {
  flex: none;
}

.task-foot {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-left: 31px;
  min-height: 18px;
}

.task-time {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: #a8b1bf;
}

.link-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11.5px;
  color: var(--muted);
  border-radius: 6px;
  padding: 1px 5px;
  transition: color 0.15s ease, background 0.15s ease;
}

.link-btn:hover {
  color: var(--green-dark);
  background: var(--green-soft);
}

.retry {
  margin-left: auto;
}
</style>
