<script setup>
import { onMounted, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import { listDir, pushToast } from '../lib/store.js'

const props = defineProps({
  initial: { type: String, default: '' },
})
const emit = defineEmits(['select', 'close'])

const current = ref('')
const parent = ref(null)
const dirs = ref([])
const drives = ref([])
const home = ref('')
const isWindows = ref(false)
const loading = ref(false)
const error = ref('')
const manual = ref('')

async function load(target) {
  loading.value = true
  error.value = ''
  try {
    const data = await listDir(target)
    current.value = data.path || ''
    parent.value = data.parent || null
    dirs.value = data.dirs || []
    drives.value = data.drives || []
    home.value = data.home || ''
    isWindows.value = Boolean(data.isWindows)
    manual.value = data.path || ''
    if (!data.exists) {
      error.value = '目录不存在，请检查路径或选择上级目录'
    }
  } catch (err) {
    error.value = err.message || '无法读取目录'
    pushToast(err.message, 'error')
  } finally {
    loading.value = false
  }
}

function enter(dir) {
  load(dir.path)
}

function goUp() {
  if (parent.value) load(parent.value)
}

function goHome() {
  if (home.value) load(home.value)
}

function goManual() {
  const value = manual.value.trim()
  if (value) load(value)
}

function choose() {
  if (!current.value) return
  emit('select', current.value)
}

onMounted(() => load(props.initial || ''))
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <div class="picker">
      <header class="picker-head">
        <div class="picker-title">
          <span class="picker-icon"><AppIcon name="folder" :size="16" /></span>
          <div>
            <h2>选择项目文件夹</h2>
            <p>浏览并选择本地已存在的项目目录，或用于导入现有项目</p>
          </div>
        </div>
        <button class="icon-btn" @click="emit('close')"><AppIcon name="x" :size="16" /></button>
      </header>

      <div class="picker-bar">
        <button class="icon-btn" title="上一级" :disabled="!parent || loading" @click="goUp">
          <AppIcon name="chevron" :size="15" class="up" />
        </button>
        <button class="icon-btn" title="主目录" :disabled="loading" @click="goHome">
          <AppIcon name="folder" :size="15" />
        </button>
        <input
          v-model="manual"
          class="path-input"
          type="text"
          placeholder="输入或粘贴绝对路径后回车"
          @keydown.enter.prevent="goManual"
        />
        <button class="btn btn-ghost btn-sm" :disabled="loading" @click="goManual">前往</button>
      </div>

      <div v-if="drives.length" class="drives">
        <button v-for="drive in drives" :key="drive.path" class="drive-chip" @click="load(drive.path)">
          {{ drive.name }}
        </button>
      </div>

      <div class="current-path" :title="current">
        <AppIcon name="folder" :size="13" />
        <span>{{ current || '（未选择）' }}</span>
        <span v-if="loading" class="spinner" />
      </div>

      <p v-if="error" class="picker-error">{{ error }}</p>

      <div class="dir-list">
        <button
          v-for="dir in dirs"
          :key="dir.path"
          class="dir-row"
          @click="enter(dir)"
        >
          <AppIcon name="folder" :size="15" />
          <span class="dir-name">{{ dir.name }}</span>
          <AppIcon name="chevron" :size="14" class="dir-arrow" />
        </button>
        <div v-if="!dirs.length && !loading" class="dir-empty">
          该目录下没有子文件夹
        </div>
      </div>

      <footer class="picker-foot">
        <span class="foot-hint">选择后可创建新项目或导入此目录中的现有项目</span>
        <div class="foot-btns">
          <button class="btn btn-ghost" @click="emit('close')">取消</button>
          <button class="btn btn-primary" :disabled="!current || loading" @click="choose">
            选择此文件夹
          </button>
        </div>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(18, 26, 36, 0.42);
  backdrop-filter: blur(3px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  z-index: 60;
}

.picker {
  width: 640px;
  max-width: 100%;
  max-height: 86vh;
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 30px 80px -20px rgba(15, 23, 32, 0.5);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.picker-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 15px 18px;
  border-bottom: 1px solid var(--border);
}

.picker-title {
  display: flex;
  gap: 10px;
  align-items: center;
}

.picker-icon {
  width: 32px;
  height: 32px;
  border-radius: 10px;
  background: var(--green-soft);
  color: var(--green-dark);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.picker-title h2 {
  font-size: 15px;
  font-weight: 650;
}

.picker-title p {
  font-size: 12px;
  color: var(--muted);
  margin-top: 1px;
}

.picker-bar {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 11px 14px 8px;
}

.path-input {
  flex: 1;
  border: 1px solid var(--border-strong);
  border-radius: 9px;
  padding: 7px 10px;
  font-size: 12.5px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  outline: none;
  background: #fafbfc;
}

.path-input:focus {
  border-color: var(--green);
  background: #fff;
  box-shadow: 0 0 0 3px rgba(63, 185, 132, 0.13);
}

.up {
  transform: rotate(180deg);
}

.drives {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 0 14px 6px;
}

.drive-chip {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--text-soft);
  border: 1px solid var(--border-strong);
  background: #fff;
  border-radius: 7px;
  padding: 3px 9px;
}

.drive-chip:hover {
  border-color: var(--green);
  color: var(--green-dark);
}

.current-path {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 14px;
  padding: 7px 10px;
  border-radius: 8px;
  background: #f6f8fa;
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  color: var(--text-soft);
  overflow: hidden;
}

.current-path span:first-of-type {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  direction: rtl;
  text-align: left;
  flex: 1;
}

.picker-error {
  margin: 8px 14px 0;
  font-size: 12px;
  color: var(--red);
}

.dir-list {
  flex: 1;
  min-height: 180px;
  overflow-y: auto;
  margin: 10px 14px;
  border: 1px solid var(--border);
  border-radius: 11px;
  background: #fcfdfe;
}

.dir-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 9px 12px;
  border-bottom: 1px solid #f1f4f7;
  text-align: left;
  color: var(--text);
  transition: background 0.12s ease;
}

.dir-row:last-child {
  border-bottom: none;
}

.dir-row:hover {
  background: #f3fbf7;
  color: var(--green-dark);
}

.dir-name {
  flex: 1;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dir-arrow {
  transform: rotate(-90deg);
  color: #b9c2ce;
}

.dir-empty {
  padding: 28px;
  text-align: center;
  font-size: 12.5px;
  color: #a8b1bf;
}

.picker-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 18px;
  border-top: 1px solid var(--border);
  background: #fbfcfd;
}

.foot-hint {
  font-size: 11.5px;
  color: #9aa4b2;
}

.foot-btns {
  display: flex;
  gap: 8px;
}
</style>
