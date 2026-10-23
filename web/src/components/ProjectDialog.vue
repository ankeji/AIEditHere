<script setup>
import { reactive, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import FolderPicker from './FolderPicker.vue'
import { store, saveProject, closeProjectDialog, inspectPath } from '../lib/store.js'

const form = reactive({ name: '', path: '', description: '', create: true })
const saving = ref(false)
const pickerOpen = ref(false)
const pathInfo = reactive({
  checking: false,
  checked: false,
  exists: false,
  isDir: false,
  packageName: '',
  isGit: false,
})
let inspectTimer = null

watch(
  () => store.projectDialog.open,
  (open) => {
    if (!open) return
    const project = store.projectDialog.project
    form.name = project?.name || ''
    form.path = project?.path || ''
    form.description = project?.description || ''
    form.create = true
    Object.assign(pathInfo, { checking: false, checked: false, exists: false, isDir: false, packageName: '', isGit: false })
    if (form.path) checkPath(form.path)
  },
)

watch(
  () => form.path,
  (value) => {
    if (inspectTimer) clearTimeout(inspectTimer)
    pathInfo.checked = false
    if (!value || !value.trim()) return
    inspectTimer = setTimeout(() => checkPath(value), 450)
  },
)

async function checkPath(value) {
  if (!value || !value.trim()) return null
  pathInfo.checking = true
  try {
    const info = await inspectPath(value.trim())
    pathInfo.checked = true
    pathInfo.exists = Boolean(info.exists)
    pathInfo.isDir = Boolean(info.isDir)
    pathInfo.packageName = info.packageName || ''
    pathInfo.isGit = Boolean(info.isGit)
    return info
  } catch {
    pathInfo.checked = false
    return null
  } finally {
    pathInfo.checking = false
  }
}

async function onPickFolder(path) {
  pickerOpen.value = false
  form.path = path
  const info = await checkPath(path)
  if (!form.name.trim()) {
    const suggested = info?.packageName || info?.name || ''
    if (suggested) form.name = suggested
  }
}

async function submit() {
  if (saving.value) return
  saving.value = true
  const ok = await saveProject({
    name: form.name,
    path: form.path,
    description: form.description,
    create: form.create,
  })
  saving.value = false
  if (!ok) return
}
</script>

<template>
  <div v-if="store.projectDialog.open" class="overlay" @click.self="closeProjectDialog">
    <div class="dialog">
      <header class="dialog-head">
        <div class="dialog-title">
          <span class="dialog-icon"><AppIcon name="folder" :size="17" /></span>
          <div>
            <h2>{{ store.projectDialog.project ? '编辑项目' : '新建项目' }}</h2>
            <p>指定项目对应的本地文件夹，需求产生的代码都会写进这里</p>
          </div>
        </div>
        <button class="icon-btn" @click="closeProjectDialog"><AppIcon name="x" :size="16" /></button>
      </header>

      <div class="dialog-body">
        <label class="field">
          <span class="field-label">项目名称</span>
          <input v-model="form.name" type="text" placeholder="例如：博客系统" />
        </label>

        <label class="field">
          <span class="field-label"><AppIcon name="link" :size="13" /> 本地文件夹位置</span>
          <div class="path-row">
            <input v-model="form.path" type="text" placeholder="/Users/you/projects/blog 或 D:\\projects\\blog" />
            <button class="btn btn-ghost btn-sm browse-btn" type="button" @click="pickerOpen = true">
              <AppIcon name="folder" :size="14" />
              浏览
            </button>
          </div>
          <div class="path-status">
            <span v-if="pathInfo.checking" class="ps ps-check">检测目录中…</span>
            <template v-else-if="pathInfo.checked">
              <span v-if="pathInfo.exists && pathInfo.isDir" class="ps ps-ok">
                <AppIcon name="check" :size="12" />
                目录已存在，可直接导入此项目
                <span v-if="pathInfo.isGit" class="tag">Git 仓库</span>
                <span v-if="pathInfo.packageName" class="tag">{{ pathInfo.packageName }}</span>
              </span>
              <span v-else-if="pathInfo.exists && !pathInfo.isDir" class="ps ps-err">
                <AppIcon name="alert" :size="12" />
                该路径是文件，不是文件夹
              </span>
              <span v-else class="ps ps-warn">
                <AppIcon name="alert" :size="12" />
                目录不存在
                <template v-if="form.create">，创建项目时会自动新建</template>
                <template v-else>，请先把项目下载到本地或选择其它目录</template>
              </span>
            </template>
          </div>
          <span class="field-hint">
            可点击「浏览」选择本地已有项目目录（导入），也可以直接填写新目录路径；支持 ~ 开头。
          </span>
        </label>

        <label class="field">
          <span class="field-label">项目说明</span>
          <input v-model="form.description" type="text" placeholder="这个项目是做什么的（可留空）" />
        </label>

        <label class="switch-row">
          <div class="switch-text">
            <span>目录不存在时自动创建</span>
            <span class="field-hint">关闭后目录必须已存在，否则无法创建项目</span>
          </div>
          <span class="switch" :class="{ on: form.create }" @click.prevent="form.create = !form.create">
            <span class="knob" />
          </span>
        </label>
      </div>

      <footer class="dialog-foot">
        <button class="btn btn-ghost" @click="closeProjectDialog">取消</button>
        <button class="btn btn-primary" :disabled="saving || !form.name.trim() || !form.path.trim()" @click="submit">
          {{ saving ? '保存中…' : store.projectDialog.project ? '保存修改' : '创建项目' }}
        </button>
      </footer>
    </div>

    <FolderPicker
      v-if="pickerOpen"
      :initial="form.path"
      @select="onPickFolder"
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
  width: 520px;
  max-width: 100%;
  max-height: 90vh;
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

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
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
  background: #fafbfc;
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

.path-row {
  display: flex;
  gap: 8px;
  align-items: stretch;
}

.path-row input {
  flex: 1;
  min-width: 0;
}

.browse-btn {
  flex: none;
  white-space: nowrap;
}

.path-status {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-height: 0;
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
  justify-content: flex-end;
  gap: 9px;
  padding: 13px 18px;
  border-top: 1px solid var(--border);
  background: #fbfcfd;
}
</style>
