<script setup>
import { reactive, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import { store, saveProject, closeProjectDialog } from '../lib/store.js'

const form = reactive({ name: '', path: '', description: '', create: true })
const saving = ref(false)

watch(
  () => store.projectDialog.open,
  (open) => {
    if (!open) return
    const project = store.projectDialog.project
    form.name = project?.name || ''
    form.path = project?.path || ''
    form.description = project?.description || ''
    form.create = true
  },
)

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
          <input v-model="form.path" type="text" placeholder="/Users/you/projects/blog" />
          <span class="field-hint">
            填绝对路径最稳妥（支持 ~ 开头）。opencode 会在这个目录里读写代码，需求产出的所有文件都会保留在这里。
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
