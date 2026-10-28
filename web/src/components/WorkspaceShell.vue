<script setup>
import { computed, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import PreviewPane from './PreviewPane.vue'
import {
  store,
  currentProject,
  ensureProjectTabs,
  projectTabs,
  setActiveTab,
  addPreviewTab,
  ensureProjectPreviewTab,
  closeTab,
  startProjectRun,
  openProjectDialog,
} from '../lib/store.js'

const project = computed(() => currentProject())
const projectId = computed(() => project.value?.id || null)
const entry = computed(() => projectTabs(projectId.value))
const tabs = computed(() => entry.value?.tabs || [])
const activeId = computed(() => entry.value?.activeId || '')
const activeTab = computed(
  () => tabs.value.find((tab) => tab.id === activeId.value) || tabs.value[0] || null,
)
const previewTabs = computed(() => tabs.value.filter((tab) => tab.kind === 'preview'))
const otherFrontends = computed(() =>
  store.projects.filter((item) => item.type === 'frontend' && item.id !== projectId.value),
)

const menuOpen = ref(false)
const customOpen = ref(false)
const customUrl = ref('http://localhost:8080/#/')

function ensureStarted(source) {
  if (!source || source.type !== 'frontend') return
  if (source.autoStart === false) return
  if (!String(source.startCommand || '').trim()) return
  const runtime = store.runtime[source.id]
  if (runtime && (runtime.status === 'starting' || runtime.status === 'running')) return
  startProjectRun(source.id)
}

function focusPreview(source) {
  if (!projectId.value || !source) return
  const tab = ensureProjectPreviewTab(projectId.value, source, { activate: true })
  if (tab) setActiveTab(projectId.value, tab.id)
  ensureStarted(source)
  menuOpen.value = false
  customOpen.value = false
  return tab
}

function focusCurrentPreview() {
  focusPreview(project.value)
}

function addCustomTab() {
  let value = String(customUrl.value || '').trim()
  if (!value) return
  if (!/^https?:\/\//i.test(value)) value = `http://${value}`
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    return
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) return
  const tab = addPreviewTab(projectId.value, {
    url: parsed.toString(),
    title: parsed.host,
    sourceProjectId: null,
  })
  setActiveTab(projectId.value, tab.id)
  menuOpen.value = false
  customOpen.value = false
}

function openMenu() {
  menuOpen.value = !menuOpen.value
  customOpen.value = false
}

function onProjectChange(id) {
  if (!id) return
  ensureProjectTabs(id)
  const current = project.value
  if (current?.type === 'frontend') {
    const tab = focusPreview(current)
    if (tab) setActiveTab(id, tab.id)
  }
}

function openCurrentPreview() {
  if (project.value) focusPreview(project.value)
}

function editCurrentProject() {
  if (project.value) openProjectDialog(project.value)
}

watch(
  () => projectId.value,
  (id) => onProjectChange(id),
  { immediate: true },
)

watch(
  () => project.value?.type,
  (type) => {
    if (type === 'frontend' && project.value) {
      const tab = focusPreview(project.value)
      if (tab) setActiveTab(project.value.id, tab.id)
    }
  },
)
</script>

<template>
  <div class="workspace-shell">
    <div class="tabbar">
      <div class="tab-scroll">
        <div
          v-for="tab in tabs"
          :key="tab.id"
          class="tab"
          :class="{ active: tab.id === activeTab?.id }"
          :title="tab.url"
          @click="setActiveTab(projectId, tab.id)"
        >
          <AppIcon name="globe" :size="13" />
          <span class="tab-title">{{ tab.title }}</span>
          <button
            v-if="tab.closable"
            class="tab-close"
            type="button"
            title="关闭页签"
            @click.stop="closeTab(projectId, tab.id)"
          >
            <AppIcon name="x" :size="11" :stroke="2.4" />
          </button>
        </div>
      </div>

      <div class="tabbar-actions">
        <button class="new-tab-btn" type="button" title="新建页签" @click="openMenu">
          <AppIcon name="plus" :size="15" :stroke="2.2" />
        </button>
      </div>

      <div v-if="menuOpen" class="menu-backdrop" @click="menuOpen = false" />
      <div v-if="menuOpen" class="tab-menu" @click.stop>
        <button v-if="project" class="menu-item" @click="focusCurrentPreview">
          <AppIcon name="globe" :size="14" />
          当前项目预览
          <span class="menu-sub">{{ project.previewUrl || '未配置预览地址' }}</span>
        </button>
        <div v-if="otherFrontends.length" class="menu-label">其他前端项目</div>
        <button
          v-for="item in otherFrontends"
          :key="item.id"
          class="menu-item"
          @click="focusPreview(item)"
        >
          <AppIcon name="folder" :size="14" />
          {{ item.name }}
          <span class="menu-sub">{{ item.previewUrl || '未配置预览地址' }}</span>
        </button>
        <div class="menu-sep" />
        <button class="menu-item" @click="customOpen = !customOpen">
          <AppIcon name="link" :size="14" />
          自定义网址…
        </button>
        <form v-if="customOpen" class="custom-form" @submit.prevent="addCustomTab">
          <input
            v-model="customUrl"
            type="text"
            placeholder="http://localhost:8080/#/"
            autofocus
            @keydown.enter.prevent="addCustomTab"
          />
          <button class="btn btn-primary btn-xs" type="submit">打开</button>
        </form>
      </div>
    </div>

    <div class="tab-content">
      <PreviewPane
        v-for="tab in previewTabs"
        v-show="activeTab?.id === tab.id"
        :key="tab.id"
        :tab="tab"
        :workspace-project-id="projectId"
      />
      <div v-if="!tabs.length" class="workspace-empty">
        <div class="empty-icon"><AppIcon name="globe" :size="22" /></div>
        <div class="empty-title">还没有打开的预览页</div>
        <span class="empty-hint">
          打开当前项目的预览，或通过右上角「+」添加其他前端项目的预览页。
        </span>
        <div class="empty-actions">
          <button v-if="project" class="btn btn-primary btn-sm" @click="openCurrentPreview">
            <AppIcon name="globe" :size="13" />
            打开项目预览
          </button>
          <button v-if="project?.isOwner" class="btn btn-ghost btn-sm" @click="editCurrentProject">
            <AppIcon name="gear" :size="13" />
            配置项目
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.workspace-shell {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.tabbar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 18px 0;
  background: #f0f3f7;
  border-bottom: 1px solid var(--border);
  position: relative;
}

.tab-scroll {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: flex-end;
  gap: 3px;
  overflow-x: auto;
  scrollbar-width: none;
}

.tab-scroll::-webkit-scrollbar {
  display: none;
}

.tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 220px;
  padding: 8px 10px 7px;
  border: 1px solid transparent;
  border-bottom: none;
  border-radius: 9px 9px 0 0;
  font-size: 12.5px;
  color: var(--muted);
  cursor: pointer;
  user-select: none;
  transition: background 0.14s ease, color 0.14s ease, border-color 0.14s ease;
  flex: none;
}

.tab:hover {
  background: #e7ecf2;
  color: var(--text-soft);
}

.tab.active {
  background: var(--bg);
  border-color: var(--border);
  color: var(--green-dark);
  font-weight: 600;
}

.tab-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tab-close {
  width: 17px;
  height: 17px;
  border-radius: 5px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #9aa4b2;
  flex: none;
}

.tab-close:hover {
  background: rgba(220, 38, 38, 0.12);
  color: var(--red);
}

.tabbar-actions {
  flex: none;
  padding-bottom: 4px;
}

.new-tab-btn {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--text-soft);
  background: #fff;
  border: 1px solid var(--border-strong);
  transition: border-color 0.15s ease, color 0.15s ease, background 0.15s ease;
}

.new-tab-btn:hover {
  border-color: var(--green);
  color: var(--green-dark);
  background: #fbfffd;
}

.menu-backdrop {
  position: fixed;
  inset: 0;
  z-index: 30;
}

.tab-menu {
  position: absolute;
  right: 18px;
  top: 42px;
  width: 300px;
  max-height: 60vh;
  overflow-y: auto;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: 0 18px 50px -16px rgba(15, 23, 32, 0.4);
  padding: 6px;
  z-index: 40;
}

.menu-label {
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.4px;
  color: #9aa4b2;
  text-transform: uppercase;
  padding: 7px 8px 3px;
}

.menu-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px 9px;
  border-radius: 8px;
  font-size: 12.5px;
  color: var(--text-soft);
  text-align: left;
}

.menu-item:hover {
  background: #f3fbf7;
  color: var(--green-dark);
}

.menu-sub {
  margin-left: auto;
  max-width: 130px;
  font-size: 10.5px;
  color: #a8b1bf;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.menu-sep {
  height: 1px;
  background: var(--border);
  margin: 5px 4px;
}

.custom-form {
  display: flex;
  gap: 6px;
  padding: 4px 6px 6px;
}

.custom-form input {
  flex: 1;
  min-width: 0;
  border: 1px solid var(--border-strong);
  border-radius: 7px;
  padding: 5px 8px;
  font-size: 12px;
  outline: none;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.custom-form input:focus {
  border-color: var(--green);
  box-shadow: 0 0 0 3px rgba(63, 185, 132, 0.13);
}

.tab-content {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg);
}

.workspace-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 32px;
  text-align: center;
  color: var(--muted);
}

.workspace-empty .empty-icon {
  width: 46px;
  height: 46px;
  border-radius: 13px;
  background: #f1f4f8;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #9aa4b2;
  margin-bottom: 2px;
}

.empty-title {
  font-size: 14px;
  font-weight: 650;
  color: var(--text-soft);
}

.empty-hint {
  max-width: 380px;
  font-size: 12px;
  line-height: 1.6;
  color: #9aa4b2;
}

.empty-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

@media (max-width: 1000px) {
  .tab {
    max-width: 160px;
  }
}
</style>
