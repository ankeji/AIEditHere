<script setup>
import { computed, onBeforeUnmount, onMounted } from 'vue'
import AppIcon from './components/AppIcon.vue'
import ProjectsView from './components/ProjectsView.vue'
import WorkspaceView from './components/WorkspaceView.vue'
import SettingsDialog from './components/SettingsDialog.vue'
import ProjectDialog from './components/ProjectDialog.vue'
import DeployDialog from './components/DeployDialog.vue'
import {
  store,
  loadState,
  connectEvents,
  refreshHealth,
  reconnectOpencode,
  saveConfig,
  initRouter,
  backToProjects,
  currentProject,
  openDeployDialog,
} from './lib/store.js'
import { ltr } from './lib/format.js'

let timer = null

onMounted(async () => {
  initRouter()
  await loadState()
  connectEvents()
  timer = setInterval(refreshHealth, 15000)
})

onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})

const project = computed(() => currentProject())

const connectionState = computed(() => {
  if (store.config.demo) return { kind: 'demo', label: '演示模式' }
  if (store.health.connected) {
    return {
      kind: 'online',
      label:
        store.health.version && store.health.version !== 'unknown'
          ? `opencode v${store.health.version}`
          : 'opencode 已连接',
    }
  }
  return { kind: 'offline', label: 'opencode 未连接' }
})

const showBanner = computed(() => !store.config.demo && !store.health.connected)

function enableDemo() {
  saveConfig({ demo: true })
}

function disableDemo() {
  saveConfig({ demo: false })
}
</script>

<template>
  <div class="app">
    <header class="topbar">
      <div class="brand">
        <span class="brand-mark">
          <AppIcon name="terminal" :size="17" :stroke="2.4" />
        </span>
        <div class="brand-text">
          <div class="brand-name">
            AutoCode
            <span class="brand-tag">opencode 控制台</span>
          </div>
          <div v-if="project" class="brand-sub">
            <button class="back-btn" title="返回项目列表" @click="backToProjects">
              <AppIcon name="chevron" :size="12" class="flip" />
              项目
            </button>
            <span class="project-name">{{ project.name }}</span>
            <span class="project-path" :title="project.path">{{ ltr(project.path) }}</span>
          </div>
          <div v-else class="brand-sub">
            <AppIcon name="folder" :size="11" />
            <span>本地项目管理</span>
          </div>
        </div>
      </div>

      <div class="topbar-right">
        <span class="conn-chip" :class="`conn-${connectionState.kind}`">
          <span class="dot" />
          {{ connectionState.label }}
        </span>
        <button v-if="project" class="btn btn-ghost btn-sm" @click="openDeployDialog(project)">
          <AppIcon name="upload" :size="14" />
          部署
        </button>
        <button class="btn btn-ghost btn-sm" @click="store.settingsOpen = true">
          <AppIcon name="gear" :size="14" />
          设置
        </button>
      </div>
    </header>

    <div v-if="showBanner" class="banner">
      <span class="banner-icon"><AppIcon name="bot" :size="15" /></span>
      <span class="banner-text">
        未连接到 <code>{{ store.config.opencodeUrl }}</code>。请先启动
        <code>opencode serve</code>，或开启演示模式预览流程。
      </span>
      <div class="banner-actions">
        <button class="btn btn-ghost btn-xs" @click="reconnectOpencode()">重新连接</button>
        <button class="btn btn-primary btn-xs" @click="enableDemo">开启演示模式</button>
      </div>
    </div>

    <div v-else-if="store.config.demo" class="banner banner-demo">
      <span class="banner-icon"><AppIcon name="spark" :size="15" /></span>
      <span class="banner-text">
        演示模式：不会调用 opencode 修改真实代码，仅模拟拆解与执行流程，用于预览界面。
      </span>
      <div class="banner-actions">
        <button class="btn btn-ghost btn-xs" @click="disableDemo">退出演示，连接真实 opencode</button>
      </div>
    </div>

    <ProjectsView v-if="store.route.view === 'projects'" />
    <WorkspaceView v-else />

    <SettingsDialog />
    <ProjectDialog />
    <DeployDialog />

    <div class="toasts">
      <transition-group name="toast">
        <div v-for="toast in store.toasts" :key="toast.id" class="toast" :class="`toast-${toast.kind}`">
          <span class="toast-icon">
            <AppIcon
              :name="toast.kind === 'success' ? 'check' : toast.kind === 'error' ? 'x' : 'spark'"
              :size="13"
              :stroke="2.4"
            />
          </span>
          <span class="toast-text">{{ toast.message }}</span>
        </div>
      </transition-group>
    </div>
  </div>
</template>

<style scoped>
.app {
  height: 100vh;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.topbar {
  flex: none;
  height: 62px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 0 22px;
  background: #fff;
  border-bottom: 1px solid var(--border);
}

.brand {
  display: flex;
  align-items: center;
  gap: 11px;
  min-width: 0;
}

.brand-mark {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  background: linear-gradient(135deg, #4cc693, #2c9d6e);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 3px 10px -2px rgba(44, 157, 110, 0.55);
  flex: none;
}

.brand-name {
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 0.2px;
  display: flex;
  align-items: center;
  gap: 9px;
}

.brand-tag {
  font-size: 11px;
  font-weight: 600;
  color: var(--green-dark);
  background: var(--green-soft);
  border-radius: 99px;
  padding: 1px 8px;
  letter-spacing: 0;
}

.brand-sub {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 11.5px;
  color: var(--muted);
  margin-top: 1px;
  min-width: 0;
}

.back-btn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 11.5px;
  color: var(--muted);
  border-radius: 6px;
  padding: 1px 6px;
  transition: color 0.15s ease, background 0.15s ease;
}

.back-btn:hover {
  color: var(--green-dark);
  background: var(--green-soft);
}

.flip {
  transform: rotate(90deg);
}

.project-name {
  color: var(--text-soft);
  font-weight: 600;
  white-space: nowrap;
}

.project-path {
  max-width: 380px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  direction: rtl;
  text-align: left;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.topbar-right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: none;
}

.conn-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  border-radius: 99px;
  padding: 4px 11px;
  white-space: nowrap;
}

.conn-chip .dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: currentColor;
}

.conn-online {
  color: var(--green-dark);
  background: var(--green-soft);
}

.conn-demo {
  color: var(--amber);
  background: var(--amber-soft);
}

.conn-offline {
  color: var(--muted);
  background: #f1f3f6;
}

.banner {
  flex: none;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 8px 22px;
  background: #fff7ea;
  border-bottom: 1px solid #f4e3c4;
  font-size: 12.5px;
  color: #8a5b12;
}

.banner-demo {
  background: #f5f9ff;
  border-bottom-color: #dbe8fb;
  color: #3a5a86;
}

.banner-icon {
  display: inline-flex;
  flex: none;
}

.banner-text {
  flex: 1;
  min-width: 0;
  line-height: 1.5;
}

.banner code {
  background: rgba(0, 0, 0, 0.06);
  border-radius: 5px;
  padding: 0 4px;
  font-size: 11.5px;
}

.banner-actions {
  display: flex;
  gap: 8px;
  flex: none;
}

.toasts {
  position: fixed;
  right: 20px;
  bottom: 20px;
  display: flex;
  flex-direction: column;
  gap: 9px;
  z-index: 80;
  pointer-events: none;
}

.toast {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  background: #1e2733;
  color: #f1f5f9;
  font-size: 12.5px;
  line-height: 1.5;
  border-radius: 10px;
  padding: 9px 13px;
  max-width: 380px;
  box-shadow: 0 10px 30px -8px rgba(10, 16, 24, 0.5);
}

.toast-icon {
  display: inline-flex;
  margin-top: 2px;
  flex: none;
}

.toast-success {
  background: #176a4b;
}

.toast-error {
  background: #8f2323;
}

.toast-enter-active,
.toast-leave-active {
  transition: all 0.22s ease;
}

.toast-enter-from {
  opacity: 0;
  transform: translateY(8px);
}

.toast-leave-to {
  opacity: 0;
  transform: translateX(12px);
}

@media (max-width: 1080px) {
  .app {
    height: auto;
    min-height: 100vh;
  }

  .project-path {
    max-width: 160px;
  }
}
</style>
