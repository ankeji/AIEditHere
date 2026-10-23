<script setup>
import { computed, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import StatusPill from './StatusPill.vue'
import { fromNow } from '../lib/format.js'
import {
  store,
  addRequirement,
  splitRequirement,
  executeRequirement,
  abortRequirement,
  removeRequirement,
  removeAttachment,
  selectRequirement,
  projectRequirements,
  pushToast,
} from '../lib/store.js'

const text = ref('')
const submitting = ref(false)
const files = ref([])
const fileInput = ref(null)
const requirements = computed(() => projectRequirements())
const MAX_FILE_SIZE = 30 * 1024 * 1024

async function submit() {
  const value = text.value.trim()
  if (!value || submitting.value) return
  submitting.value = true
  const pending = files.value.slice()
  const requirement = await addRequirement(value, pending)
  submitting.value = false
  if (requirement) {
    text.value = ''
    files.value = []
  }
}

function pickFiles() {
  fileInput.value?.click()
}

function onFilesChange(event) {
  const selected = Array.from(event.target.files || [])
  for (const file of selected) {
    if (file.size > MAX_FILE_SIZE) {
      pushToast(`「${file.name}」超过 30MB，已跳过`, 'error')
      continue
    }
    const duplicate = files.value.some((item) => item.name === file.name && item.size === file.size)
    if (!duplicate) files.value.push(file)
  }
  event.target.value = ''
}

function removeFile(index) {
  files.value.splice(index, 1)
}

function formatSize(bytes) {
  if (!bytes && bytes !== 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

async function removeExistingAttachment(requirement, attachment) {
  if (!window.confirm(`删除附件「${attachment.name}」？`)) return
  await removeAttachment(requirement.id, attachment.id)
}

function split(requirement) {
  selectRequirement(requirement.id)
  splitRequirement(requirement.id)
}

async function run(requirement) {
  selectRequirement(requirement.id)
  if (requirement.status === 'running') {
    await abortRequirement(requirement.id)
    return
  }
  await executeRequirement(requirement.id)
}

function resplit(requirement) {
  if (requirement.tasks?.length && !window.confirm('重新拆解会清空当前任务列表，继续？')) return
  split(requirement)
}

function remove(requirement) {
  if (!window.confirm('确定删除这条需求？')) return
  removeRequirement(requirement.id)
}

function canSplit(requirement) {
  return ['pending', 'split', 'failed'].includes(requirement.status)
}

function canExecute(requirement) {
  return ['pending', 'split', 'failed'].includes(requirement.status)
}
</script>

<template>
  <section class="panel">
    <header class="panel-header">
      <div class="panel-title">
        <span class="step-badge">1</span>
        <h2>需求</h2>
      </div>
      <span class="count-pill">{{ requirements.length }}</span>
    </header>

    <div class="composer">
      <textarea
        v-model="text"
        rows="3"
        placeholder="描述需求，例如：为博客添加评论功能，支持回复与点赞，数据存本地…"
        @keydown.ctrl.enter.prevent="submit"
        @keydown.meta.enter.prevent="submit"
      />
      <div class="composer-tools">
        <button class="attach-btn" type="button" @click="pickFiles">
          <AppIcon name="paperclip" :size="13" />
          添加附件
        </button>
        <input ref="fileInput" class="file-input" type="file" multiple @change="onFilesChange" />
        <span class="composer-tip">可上传截图、日志、设计稿、文档等</span>
      </div>
      <div v-if="files.length" class="file-chips">
        <span v-for="(file, index) in files" :key="`${file.name}-${file.size}`" class="file-chip">
          <AppIcon name="file" :size="12" />
          <span class="file-chip-name">{{ file.name }}</span>
          <span class="file-chip-size">{{ formatSize(file.size) }}</span>
          <button class="chip-x" type="button" title="移除" @click="removeFile(index)">
            <AppIcon name="x" :size="11" />
          </button>
        </span>
      </div>
      <button class="btn btn-primary btn-block" :disabled="!text.trim() || submitting" @click="submit">
        <AppIcon name="plus" :size="15" />
        {{ submitting ? '添加中…' : '添加需求' }}
      </button>
      <p class="composer-hint">Ctrl / ⌘ + Enter 快速提交</p>
    </div>

    <div class="panel-body">
      <div v-if="!requirements.length" class="empty small">
        <div class="empty-icon"><AppIcon name="spark" :size="20" /></div>
        还没有需求，先在上方输入吧
      </div>

      <article
        v-for="requirement in requirements"
        :key="requirement.id"
        class="requirement"
        :class="{ active: requirement.id === store.selectedId }"
        @click="selectRequirement(requirement.id)"
      >
        <div class="requirement-top">
          <h3 class="requirement-title">{{ requirement.title }}</h3>
          <button class="icon-btn danger" title="删除需求" @click.stop="remove(requirement)">
            <AppIcon name="trash" :size="14" />
          </button>
        </div>

        <p v-if="requirement.text !== requirement.title" class="requirement-text">{{ requirement.text }}</p>

        <div v-if="requirement.attachments?.length" class="attachments">
          <a
            v-for="attachment in requirement.attachments"
            :key="attachment.id"
            class="attach-chip"
            :href="`/api/requirements/${requirement.id}/attachments/${attachment.id}`"
            :title="`下载 ${attachment.name}`"
            @click.stop
          >
            <AppIcon name="file" :size="11" />
            <span class="attach-name">{{ attachment.name }}</span>
            <button
              class="chip-x"
              type="button"
              title="删除附件"
              @click.prevent.stop="removeExistingAttachment(requirement, attachment)"
            >
              <AppIcon name="x" :size="10" />
            </button>
          </a>
        </div>

        <div class="requirement-meta">
          <StatusPill :status="requirement.status" />
          <span v-if="requirement.tasks?.length" class="task-count">{{ requirement.tasks.length }} 个任务</span>
          <span class="time">{{ fromNow(requirement.updatedAt || requirement.createdAt) }}</span>
        </div>

        <div class="requirement-actions">
          <template v-if="requirement.status === 'running'">
            <button class="btn btn-ghost btn-xs" disabled>
              <span class="spinner" style="border-top-color: var(--red); border-color: rgba(220, 38, 38, 0.25)" />
              执行中
            </button>
            <button class="btn btn-danger btn-xs" @click.stop="run(requirement)">
              <AppIcon name="stop" :size="12" />
              中止
            </button>
          </template>
          <template v-else-if="requirement.status === 'splitting'">
            <button class="btn btn-ghost btn-xs" disabled>
              <span class="spinner" style="border-top-color: var(--blue); border-color: rgba(59, 130, 246, 0.25)" />
              拆解中…
            </button>
            <button class="btn btn-ghost btn-xs" @click.stop="abortRequirement(requirement.id)">
              <AppIcon name="stop" :size="12" />
              中止
            </button>
          </template>
          <template v-else>
            <button
              v-if="canSplit(requirement)"
              class="btn btn-ghost btn-xs"
              @click.stop="split(requirement)"
            >
              <AppIcon name="split" :size="12" />
              {{ requirement.tasks?.length ? '重新拆解' : '拆解' }}
            </button>
            <button
              v-if="canExecute(requirement)"
              class="btn btn-primary btn-xs"
              @click.stop="run(requirement)"
            >
              <AppIcon name="play" :size="12" />
              {{ requirement.tasks?.length ? '执行' : '拆解并执行' }}
            </button>
          </template>
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.composer {
  padding: 12px 13px 6px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-bottom: 1px solid var(--border);
}

.composer textarea {
  width: 100%;
  resize: none;
  border: 1px solid var(--border-strong);
  background: #f8fafc;
  border-radius: 10px;
  padding: 9px 11px;
  font-size: 13px;
  line-height: 1.55;
  outline: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
}

.composer textarea::placeholder {
  color: #a2abba;
}

.composer textarea:focus {
  border-color: var(--green);
  background: #fff;
  box-shadow: 0 0 0 3px rgba(63, 185, 132, 0.13);
}

.composer-hint {
  font-size: 11px;
  color: #a8b1bf;
  text-align: right;
  margin-bottom: 4px;
}

.composer-tools {
  display: flex;
  align-items: center;
  gap: 8px;
}

.attach-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--text-soft);
  border: 1px dashed var(--border-strong);
  background: #fff;
  border-radius: 8px;
  padding: 4px 9px;
  transition: border-color 0.15s ease, color 0.15s ease, background 0.15s ease;
}

.attach-btn:hover {
  border-color: var(--green);
  color: var(--green-dark);
  background: #f6fffb;
}

.file-input {
  display: none;
}

.composer-tip {
  font-size: 11px;
  color: #a8b1bf;
}

.file-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.file-chip,
.attach-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  font-size: 11px;
  color: var(--text-soft);
  background: #f1f5f9;
  border: 1px solid var(--border);
  border-radius: 7px;
  padding: 2px 6px;
}

.file-chip-name,
.attach-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 130px;
}

.file-chip-size {
  color: #9aa4b2;
  font-size: 10.5px;
}

.chip-x {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 15px;
  height: 15px;
  border-radius: 4px;
  color: #94a3b8;
  flex: none;
}

.chip-x:hover {
  background: rgba(220, 38, 38, 0.12);
  color: var(--red);
}

.attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 7px;
}

.attach-chip {
  text-decoration: none;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.attach-chip:hover {
  border-color: #c8dfd3;
  background: #f3fbf7;
  color: var(--green-dark);
}

.requirement {
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 10px 11px;
  background: #fff;
  cursor: pointer;
  transition: border-color 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
}

.requirement:hover {
  border-color: #c8dfd3;
}

.requirement.active {
  border-color: var(--green);
  background: #fbfffd;
  box-shadow: 0 0 0 3px rgba(63, 185, 132, 0.12);
}

.requirement-top {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  justify-content: space-between;
}

.requirement-title {
  font-size: 13px;
  font-weight: 650;
  line-height: 1.45;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  word-break: break-word;
}

.requirement-text {
  margin-top: 4px;
  font-size: 12px;
  color: var(--muted);
  line-height: 1.5;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  word-break: break-word;
}

.requirement-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  flex-wrap: wrap;
}

.task-count {
  font-size: 11.5px;
  color: var(--muted);
}

.time {
  font-size: 11px;
  color: #a8b1bf;
  margin-left: auto;
}

.requirement-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 9px;
}
</style>
