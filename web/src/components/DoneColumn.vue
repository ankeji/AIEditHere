<script setup>
import { computed, reactive } from 'vue'
import AppIcon from './AppIcon.vue'
import { fromNow, duration } from '../lib/format.js'
import { store, retryTask, selectedRequirement } from '../lib/store.js'

const expanded = reactive(new Set())

const requirement = computed(() => selectedRequirement())
const doneTasks = computed(
  () => (requirement.value?.tasks || []).filter((task) => task.status === 'done'),
)
const failedTasks = computed(
  () => (requirement.value?.tasks || []).filter((task) => task.status === 'failed'),
)
const total = computed(() => requirement.value?.tasks?.length || 0)

function summaryOpen(task) {
  return expanded.has(task.id)
}

function toggle(task) {
  if (expanded.has(task.id)) expanded.delete(task.id)
  else expanded.add(task.id)
}

function isLong(text) {
  return (text || '').length > 180
}

function retry(task) {
  if (requirement.value) retryTask(requirement.value.id, task.id)
}
</script>

<template>
  <section class="panel">
    <header class="panel-header">
      <div class="panel-title">
        <span class="step-badge step-done">3</span>
        <h2>已完成</h2>
      </div>
      <span class="count-pill">{{ doneTasks.length }}/{{ total }}</span>
    </header>

    <div v-if="!requirement" class="panel-body">
      <div class="empty">
        <div class="empty-icon"><AppIcon name="check" :size="20" /></div>
        执行完成后，需求点会出现在这里
      </div>
    </div>

    <div v-else-if="!doneTasks.length && !failedTasks.length" class="panel-body">
      <div class="empty">
        <div class="empty-icon"><AppIcon name="bot" :size="21" /></div>
        <div>
          还没有完成的需求点
          <br />
          <span class="hint">拆解并执行后，这里会实时出现执行结果</span>
        </div>
      </div>
    </div>

    <div v-else class="panel-body done-body">
      <TransitionGroup :key="requirement.id" name="done" tag="div" class="done-list">
      <article v-for="task in doneTasks" :key="task.id" class="done-card">
        <div class="done-head">
          <span class="done-check"><AppIcon name="check" :size="12" :stroke="2.8" /></span>
          <h3 class="done-title">{{ task.title }}</h3>
          <span class="done-index">{{ task.index }}/{{ total }}</span>
        </div>
        <div class="done-meta">
          <span v-if="task.startedAt">
            <AppIcon name="clock" :size="11" />
            {{ duration(task.startedAt, task.finishedAt) }}
          </span>
          <span v-if="task.finishedAt" class="muted">完成于 {{ fromNow(task.finishedAt) }}</span>
        </div>
        <p class="done-summary" :class="{ clipped: isLong(task.summary) && !summaryOpen(task) }">
          {{ task.summary || '任务已完成' }}
        </p>
        <button v-if="isLong(task.summary)" class="link-btn" @click="toggle(task)">
          {{ summaryOpen(task) ? '收起' : '展开全部' }}
        </button>
      </article>
      </TransitionGroup>

      <template v-if="failedTasks.length">
        <div class="failed-divider">
          <span>未完成（{{ failedTasks.length }}）</span>
        </div>
        <article v-for="task in failedTasks" :key="task.id" class="failed-card">
          <div class="done-head">
            <span class="failed-mark"><AppIcon name="x" :size="12" :stroke="2.8" /></span>
            <h3 class="done-title">{{ task.title }}</h3>
          </div>
          <p class="failed-message">{{ task.error || '执行失败' }}</p>
          <button class="btn btn-ghost btn-xs" @click="retry(task)">
            <AppIcon name="refresh" :size="12" />
            重试任务
          </button>
        </article>
      </template>
    </div>
  </section>
</template>

<style scoped>
.step-done {
  background: #e8f7f0;
  color: var(--green-dark);
}

.done-body {
  padding-top: 12px;
}

.done-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  position: relative;
}

/* 任务执行完成、从第 2 列挪到第 3 列：由左滑入并淡入 */
.done-card.done-enter-active {
  transition:
    opacity 0.4s ease,
    transform 0.42s cubic-bezier(0.22, 1, 0.36, 1);
}

.done-enter-from {
  opacity: 0;
  transform: translateX(-22px) scale(0.96);
}

.done-enter-to {
  opacity: 1;
  transform: translateX(0) scale(1);
}

.done-card.done-move {
  transition: transform 0.4s cubic-bezier(0.22, 1, 0.36, 1);
}

.done-card.done-leave-active {
  transition: opacity 0.2s ease;
  position: absolute;
  width: 100%;
}

.done-leave-to {
  opacity: 0;
}

.done-card {
  border: 1px solid #d9efe4;
  background: linear-gradient(180deg, #ffffff, #f4fdf8);
  border-radius: 12px;
  padding: 11px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.done-head {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.done-check {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--green);
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  margin-top: 1px;
  box-shadow: 0 1px 3px rgba(44, 157, 110, 0.4);
}

.done-title {
  font-size: 13px;
  font-weight: 650;
  flex: 1;
  min-width: 0;
  line-height: 1.45;
  word-break: break-word;
}

.done-index {
  font-size: 11px;
  color: var(--green-dark);
  background: var(--green-soft);
  border-radius: 99px;
  padding: 0 7px;
  line-height: 1.7;
  flex: none;
  font-variant-numeric: tabular-nums;
}

.done-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-left: 28px;
  font-size: 11px;
  color: #97a1b0;
}

.done-meta span {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.done-summary {
  margin-left: 28px;
  font-size: 12px;
  color: var(--text-soft);
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  background: #fff;
  border: 1px solid #e8f1ec;
  border-radius: 8px;
  padding: 8px 10px;
}

.done-summary.clipped {
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.link-btn {
  align-self: flex-start;
  margin-left: 28px;
  font-size: 11.5px;
  color: var(--green-dark);
  border-radius: 6px;
  padding: 1px 4px;
  transition: background 0.15s ease;
}

.link-btn:hover {
  background: var(--green-soft);
}

.failed-divider {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 4px 0 0;
  color: var(--red);
  font-size: 11.5px;
  font-weight: 600;
}

.failed-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: #f4d9d9;
}

.failed-card {
  border: 1px solid #f4d9d9;
  background: #fffafa;
  border-radius: 12px;
  padding: 11px 12px;
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.failed-mark {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--red);
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  margin-top: 1px;
}

.failed-message {
  margin-left: 28px;
  font-size: 12px;
  color: #b91c1c;
  line-height: 1.55;
  word-break: break-word;
}

.failed-card .btn {
  align-self: flex-start;
  margin-left: 28px;
}

.hint {
  font-size: 12px;
  color: #a8b1bf;
}
</style>
