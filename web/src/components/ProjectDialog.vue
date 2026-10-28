<script setup>
import { computed, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import FolderPicker from './FolderPicker.vue'
import {
  store,
  closeProjectDialog,
  inspectPath,
  createProjects,
  updateProjectFields,
  pushToast,
} from '../lib/store.js'

const editingProject = computed(() => store.projectDialog.project)
const isEdit = computed(() => Boolean(editingProject.value))

const entries = ref([])
const description = ref('')
const createIfMissing = ref(true)
const saving = ref(false)
const pickerOpen = ref(false)
const manualPath = ref('')
const addingManual = ref(false)

let entrySeq = 0

function newEntry(partial = {}) {
  entrySeq += 1
  return {
    key: `entry-${Date.now()}-${entrySeq}`,
    path: '',
    name: '',
    type: null,
    startCommand: '',
    previewUrl: '',
    autoStart: true,
    checking: false,
    checked: false,
    exists: null,
    isDir: false,
    packageName: '',
    error: '',
    ...partial,
  }
}

function folderName(value) {
  const normalized = String(value || '').replace(/[\\/]+$/, '')
  const parts = normalized.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] || normalized
}

function samePath(a, b) {
  return (
    String(a || '')
      .replace(/\\/g, '/')
      .replace(/\/+$/, '')
      .toLowerCase() ===
    String(b || '')
      .replace(/\\/g, '/')
      .replace(/\/+$/, '')
      .toLowerCase()
  )
}

function typeOf(entry) {
  return entry.type === 'frontend' ? 'frontend' : 'backend'
}

async function hydrate(entry, rawPath, { keepProfile = false, profileOnly = false } = {}) {
  const value = String(rawPath || '').trim()
  entry.path = value
  if (!value) return null
  if (!profileOnly) {
    entry.checking = true
    entry.error = ''
  }
  try {
    const info = await inspectPath(value)
    if (!profileOnly) {
      entry.checked = true
      entry.exists = Boolean(info.exists)
      entry.isDir = Boolean(info.isDir)
    } else {
      entry.checked = true
      entry.exists = true
      entry.isDir = true
      entry.error = ''
    }
    entry.packageName = info.packageName || ''
    if (!entry.name.trim()) {
      entry.name = info.profile?.packageName || info.packageName || info.name || folderName(value)
    }
    if (!keepProfile) {
      if (!entry.type) entry.type = info.profile?.type || 'backend'
      if (!entry.startCommand && info.profile?.startCommand) entry.startCommand = info.profile.startCommand
      if (!entry.previewUrl && info.profile?.previewUrl) entry.previewUrl = info.profile.previewUrl
    }
    return info
  } catch (err) {
    if (!profileOnly) {
      entry.error = err.message || '无法检测目录'
    }
    return null
  } finally {
    if (!profileOnly) entry.checking = false
  }
}

watch(
  () => store.projectDialog.open,
  (open) => {
    if (!open) return
    const project = editingProject.value
    if (project) {
      const entry = newEntry({
        path: project.path,
        name: project.name,
        type: project.type || 'backend',
        startCommand: project.startCommand || '',
        previewUrl: project.previewUrl || '',
        autoStart: project.autoStart !== false,
        checked: true,
        exists: true,
        isDir: true,
      })
      entries.value = [entry]
      description.value = project.description || ''
      createIfMissing.value = false
      pickerOpen.value = false
      hydrate(entry, entry.path, { keepProfile: true })
    } else {
      entries.value = []
      description.value = ''
      createIfMissing.value = true
      manualPath.value = ''
      pickerOpen.value = true
    }
  },
  { immediate: true },
)

const canSave = computed(() => {
  if (saving.value || !entries.value.length) return false
  return entries.value.every((entry) => {
    const name = entry.name.trim() || folderName(entry.path)
    if (!name || !entry.path.trim()) return false
    if (typeOf(entry) === 'frontend') {
      if (!entry.startCommand.trim()) return false
      if (!entry.previewUrl.trim()) return false
    }
    return true
  })
})

function onPickFolders(paths) {
  pickerOpen.value = false
  const list = Array.isArray(paths) ? paths : [paths]
  let added = 0
  for (const raw of list) {
    const value = String(raw || '').trim()
    if (!value) continue
    if (entries.value.some((entry) => samePath(entry.path, value))) continue
    const entry = newEntry({ path: value, checked: true, exists: true, isDir: true })
    entries.value.push(entry)
    added += 1
    hydrate(entry, value, { profileOnly: true })
  }
  if (added) pushToast(`已添加 ${added} 个文件夹`, 'success')
}

async function addManual() {
  const value = manualPath.value.trim()
  if (!value || addingManual.value) return
  if (entries.value.some((entry) => samePath(entry.path, value))) {
    pushToast('该文件夹已在列表中', 'info')
    return
  }
  addingManual.value = true
  const entry = newEntry({ path: value })
  entries.value.push(entry)
  manualPath.value = ''
  await hydrate(entry, value)
  addingManual.value = false
}

function removeEntry(entry) {
  entries.value = entries.value.filter((item) => item.key !== entry.key)
}

function setType(entry, type) {
  entry.type = type
  if (type === 'frontend' && !entry.previewUrl) {
    entry.previewUrl = 'http://localhost:5173/'
  }
}

async function submit() {
  if (!canSave.value) return
  saving.value = true
  try {
    if (isEdit.value) {
      const entry = entries.value[0]
      const type = typeOf(entry)
      const updated = await updateProjectFields(editingProject.value.id, {
        name: entry.name.trim(),
        path: entry.path.trim(),
        description: description.value.trim(),
        type,
        startCommand: entry.startCommand.trim(),
        previewUrl: type === 'frontend' ? entry.previewUrl.trim() : '',
        autoStart: entry.autoStart,
        create: false,
      })
      if (updated) closeProjectDialog()
      return
    }

    const payloads = entries.value.map((entry) => {
      const type = typeOf(entry)
      return {
        name: (entry.name.trim() || folderName(entry.path)),
        path: entry.path.trim(),
        description: description.value.trim(),
        type,
        startCommand: type === 'frontend' ? entry.startCommand.trim() : '',
        previewUrl: type === 'frontend' ? entry.previewUrl.trim() : '',
        autoStart: entry.autoStart,
        create: createIfMissing.value,
      }
    })
    const result = await createProjects(payloads)
    if (result.ok) closeProjectDialog()
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div v-if="store.projectDialog.open" class="overlay" @click.self="closeProjectDialog">
    <div class="dialog">
      <header class="dialog-head">
        <div class="dialog-title">
          <span class="dialog-icon"><AppIcon name="folder" :size="17" /></span>
          <div>
            <h2>{{ isEdit ? '编辑项目' : '新建项目' }}</h2>
            <p v-if="isEdit">配置项目类型、启动命令和预览地址</p>
            <p v-else>一次可以添加多个文件夹，每个文件夹会创建一个项目</p>
          </div>
        </div>
        <button class="icon-btn" @click="closeProjectDialog"><AppIcon name="x" :size="16" /></button>
      </header>

      <div class="dialog-body">
        <div v-if="!isEdit" class="picker-block">
          <button class="btn btn-soft" type="button" @click="pickerOpen = true">
            <AppIcon name="folder" :size="14" />
            选择文件夹（可多选）
          </button>
          <div class="manual-row">
            <input
              v-model="manualPath"
              type="text"
              placeholder="或手动输入文件夹路径，回车添加"
              @keydown.enter.prevent="addManual"
            />
            <button class="btn btn-ghost btn-sm" type="button" :disabled="addingManual" @click="addManual">
              添加
            </button>
          </div>
          <span class="field-hint">支持 ~ 开头；一次多选多个文件夹会批量创建项目。</span>
        </div>

        <div v-if="entries.length" class="entry-list">
          <article v-for="entry in entries" :key="entry.key" class="entry-card">
            <div class="entry-head">
              <span class="entry-icon"><AppIcon name="folder" :size="15" /></span>
              <div class="entry-title">
                <input v-model="entry.name" class="name-input" type="text" placeholder="项目名称" />
                <input
                  v-if="isEdit"
                  v-model="entry.path"
                  class="path-input"
                  type="text"
                  placeholder="项目文件夹路径"
                  @change="hydrate(entry, entry.path)"
                />
                <span v-else class="entry-path" :title="entry.path">{{ entry.path }}</span>
              </div>
              <button
                v-if="!isEdit"
                class="icon-btn danger"
                type="button"
                title="移除"
                @click="removeEntry(entry)"
              >
                <AppIcon name="x" :size="14" />
              </button>
            </div>

            <div class="entry-status">
              <span v-if="entry.checking" class="ps ps-check">检测目录中…</span>
              <template v-else-if="entry.error">
                <span class="ps ps-err"><AppIcon name="alert" :size="12" />{{ entry.error }}</span>
              </template>
              <template v-else-if="entry.checked">
                <span v-if="entry.exists && entry.isDir" class="ps ps-ok">
                  <AppIcon name="check" :size="12" />
                  目录已存在
                  <span v-if="entry.packageName" class="tag">{{ entry.packageName }}</span>
                </span>
                <span v-else-if="entry.exists && !entry.isDir" class="ps ps-err">
                  <AppIcon name="alert" :size="12" />
                  该路径是文件，不是文件夹
                </span>
                <span v-else class="ps ps-warn">
                  <AppIcon name="alert" :size="12" />
                  目录不存在
                  <template v-if="isEdit || createIfMissing">，保存时会自动创建</template>
                </span>
              </template>
            </div>

            <div class="type-row">
              <span class="type-label">项目类型</span>
              <div class="type-switch">
                <button
                  type="button"
                  class="type-btn"
                  :class="{ active: typeOf(entry) === 'frontend' }"
                  @click="setType(entry, 'frontend')"
                >
                  <AppIcon name="globe" :size="13" />
                  前端
                </button>
                <button
                  type="button"
                  class="type-btn"
                  :class="{ active: typeOf(entry) === 'backend' }"
                  @click="setType(entry, 'backend')"
                >
                  <AppIcon name="server" :size="13" />
                  后端
                </button>
              </div>
            </div>

            <div v-if="typeOf(entry) === 'frontend'" class="frontend-config">
              <label class="field">
                <span class="field-label">启动命令 <b class="required">*</b></span>
                <input
                  v-model="entry.startCommand"
                  type="text"
                  placeholder="例如：npm run dev / pnpm dev / yarn start"
                />
              </label>
              <label class="field">
                <span class="field-label"><AppIcon name="globe" :size="12" /> 预览地址 <b class="required">*</b></span>
                <input
                  v-model="entry.previewUrl"
                  type="text"
                  placeholder="例如：http://localhost:8080/#/"
                />
              </label>
              <label class="switch-row compact">
                <div class="switch-text">
                  <span>进入项目时自动启动</span>
                  <span class="field-hint">自动执行启动命令并打开预览页签</span>
                </div>
                <span
                  class="switch"
                  :class="{ on: entry.autoStart }"
                  @click.prevent="entry.autoStart = !entry.autoStart"
                >
                  <span class="knob" />
                </span>
              </label>
            </div>
          </article>
        </div>

        <div v-else class="empty-pick">
          <div class="empty-icon"><AppIcon name="folder" :size="20" /></div>
          <div>还没有选择文件夹</div>
          <span class="field-hint">点击「选择文件夹（可多选）」，勾选一个或多个本地项目目录</span>
        </div>

        <label class="field">
          <span class="field-label">{{ isEdit ? '项目说明' : '统一项目说明（可选）' }}</span>
          <input v-model="description" type="text" placeholder="这些项目是做什么的（可留空）" />
        </label>

        <label v-if="!isEdit" class="switch-row">
          <div class="switch-text">
            <span>目录不存在时自动创建</span>
            <span class="field-hint">关闭后文件夹必须已存在，否则无法创建对应项目</span>
          </div>
          <span class="switch" :class="{ on: createIfMissing }" @click.prevent="createIfMissing = !createIfMissing">
            <span class="knob" />
          </span>
        </label>
      </div>

      <footer class="dialog-foot">
        <span v-if="!isEdit && entries.length" class="foot-count">将创建 {{ entries.length }} 个项目</span>
        <button class="btn btn-ghost" @click="closeProjectDialog">取消</button>
        <button class="btn btn-primary" :disabled="!canSave" @click="submit">
          {{ saving ? '保存中…' : isEdit ? '保存修改' : entries.length > 1 ? `创建 ${entries.length} 个项目` : '创建项目' }}
        </button>
      </footer>
    </div>

    <FolderPicker
      v-if="pickerOpen"
      multiple
      :initial="''"
      @select="onPickFolders"
      @close="pickerOpen = false"
    />
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(18, 26, 36, 0.38);
  backdrop-filter: blur(3px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  z-index: 50;
}

.dialog {
  width: 600px;
  max-width: 100%;
  max-height: 92vh;
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 30px 80px -20px rgba(15, 23, 32, 0.45);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.dialog-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 16px 18px;
  border-bottom: 1px solid var(--border);
}

.dialog-title {
  display: flex;
  gap: 10px;
  align-items: center;
}

.dialog-icon {
  width: 32px;
  height: 32px;
  border-radius: 10px;
  background: var(--green-soft);
  color: var(--green-dark);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.dialog-title h2 {
  font-size: 15px;
  font-weight: 650;
}

.dialog-title p {
  font-size: 12px;
  color: var(--muted);
  margin-top: 1px;
}

.dialog-body {
  padding: 16px 18px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.picker-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.picker-block > .btn {
  align-self: flex-start;
}

.manual-row {
  display: flex;
  gap: 8px;
}

.manual-row input {
  flex: 1;
  min-width: 0;
  border: 1px solid var(--border-strong);
  border-radius: 9px;
  padding: 7px 10px;
  font-size: 12.5px;
  outline: none;
  background: #fafbfc;
}

.manual-row input:focus {
  border-color: var(--green);
  background: #fff;
  box-shadow: 0 0 0 3px rgba(63, 185, 132, 0.13);
}

.entry-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.entry-card {
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 11px 12px;
  background: #fcfdfe;
  display: flex;
  flex-direction: column;
  gap: 9px;
}

.entry-head {
  display: flex;
  align-items: flex-start;
  gap: 9px;
}

.entry-icon {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  background: var(--green-soft);
  color: var(--green-dark);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
}

.entry-title {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.name-input {
  border: 1px solid transparent;
  background: transparent;
  border-radius: 6px;
  padding: 2px 5px;
  font-size: 13.5px;
  font-weight: 650;
  outline: none;
}

.name-input:hover {
  border-color: var(--border);
  background: #fff;
}

.name-input:focus {
  border-color: var(--green);
  background: #fff;
  box-shadow: 0 0 0 3px rgba(63, 185, 132, 0.13);
}

.path-input {
  border: 1px solid var(--border-strong);
  background: #fff;
  border-radius: 7px;
  padding: 4px 7px;
  font-size: 11.5px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  outline: none;
  color: var(--text-soft);
}

.path-input:focus {
  border-color: var(--green);
  box-shadow: 0 0 0 3px rgba(63, 185, 132, 0.13);
}

.entry-path {
  font-size: 11.5px;
  color: var(--muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  direction: rtl;
  text-align: left;
  padding: 0 5px;
}

.entry-status {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.ps {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
  border-radius: 7px;
  padding: 3px 8px;
  line-height: 1.4;
}

.ps-check {
  color: var(--muted);
  background: #f1f3f6;
}

.ps-ok {
  color: var(--green-dark);
  background: var(--green-soft);
}

.ps-warn {
  color: #8a5b12;
  background: #fff7ea;
}

.ps-err {
  color: var(--red);
  background: var(--red-soft);
}

.tag {
  font-size: 10.5px;
  font-weight: 600;
  border-radius: 5px;
  padding: 0 5px;
  background: rgba(0, 0, 0, 0.06);
}

.type-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.type-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-soft);
  flex: none;
}

.type-switch {
  display: inline-flex;
  padding: 2px;
  border-radius: 9px;
  background: #eef1f5;
  gap: 2px;
}

.type-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
  border-radius: 7px;
  padding: 4px 11px;
  transition: background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
}

.type-btn.active {
  background: #fff;
  color: var(--green-dark);
  box-shadow: 0 1px 3px rgba(23, 32, 43, 0.14);
}

.frontend-config {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  padding: 10px;
  border-radius: 10px;
  background: #f5faf7;
  border: 1px solid #e2f1e9;
}

.frontend-config .field:first-child {
  grid-column: 1 / -1;
}

.required {
  color: var(--red);
  font-weight: 700;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.field-label {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-soft);
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.field input {
  border: 1px solid var(--border-strong);
  border-radius: 9px;
  padding: 8px 11px;
  font-size: 13px;
  outline: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
  background: #fff;
}

.field input:focus {
  border-color: var(--green);
  background: #fff;
  box-shadow: 0 0 0 3px rgba(63, 185, 132, 0.13);
}

.field-hint {
  font-size: 11.5px;
  color: #9aa4b2;
  line-height: 1.5;
}

.empty-pick {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 26px 16px;
  border: 1px dashed var(--border-strong);
  border-radius: 12px;
  color: var(--muted);
  font-size: 12.5px;
  background: #fcfdfe;
  text-align: center;
}

.empty-pick .empty-icon {
  width: 38px;
  height: 38px;
  border-radius: 11px;
  background: #f1f4f8;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #9aa4b2;
  margin-bottom: 2px;
}

.switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 11px;
  cursor: pointer;
}

.switch-row.compact {
  padding: 8px 10px;
  background: #fff;
}

.switch-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.switch-text > span:first-child {
  font-size: 13px;
  font-weight: 600;
}

.switch {
  width: 38px;
  height: 22px;
  border-radius: 99px;
  background: #dfe4eb;
  position: relative;
  transition: background 0.18s ease;
  flex: none;
}

.switch .knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(23, 32, 43, 0.25);
  transition: transform 0.18s ease;
}

.switch.on {
  background: var(--green);
}

.switch.on .knob {
  transform: translateX(16px);
}

.dialog-foot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 9px;
  padding: 13px 18px;
  border-top: 1px solid var(--border);
  background: #fbfcfd;
}

.foot-count {
  margin-right: auto;
  font-size: 12px;
  color: var(--muted);
}
</style>
