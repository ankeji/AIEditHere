<script setup>
import { computed, reactive, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import LogPanel from './LogPanel.vue'
import { fromNow } from '../lib/format.js'
import {
  store,
  closeDeployDialog,
  saveDeploy,
  runDeploy,
  abortDeploy,
  loadDeployLogs,
  pushToast,
} from '../lib/store.js'

const form = reactive({
  buildCommand: '',
  outputPath: '',
  ignorePatterns: '',
  environments: [],
})
const activeEnvId = ref('')
const saving = ref(false)
const aborting = ref(false)

const project = computed(
  () => store.projects.find((item) => item.id === store.deployDialog.projectId) || null,
)

const environments = computed(() => form.environments)
const currentEnv = computed(
  () => form.environments.find((item) => item.id === activeEnvId.value) || null,
)
const liveEnv = computed(() => {
  const id = activeEnvId.value
  return project.value?.deploy?.environments?.find((item) => item.id === id) || null
})
const status = computed(() => liveEnv.value?.lastStatus || currentEnv.value?.lastStatus || 'idle')
const isRunning = computed(() => status.value === 'running')
const lastError = computed(() => liveEnv.value?.lastError || currentEnv.value?.lastError || '')

const logState = computed(() => {
  const pid = project.value?.id
  const eid = activeEnvId.value
  if (!pid || !eid) return { entries: [], version: 0 }
  return store.deployLogs[`${pid}:${eid}`] || { entries: [], version: 0 }
})

const canDeploy = computed(() => {
  const env = currentEnv.value
  if (!env) return false
  return Boolean(
    env.host.trim() &&
      env.username.trim() &&
      env.remoteDir.trim() &&
      (env.outputPath || form.outputPath || '').trim(),
  )
})

const statusMeta = computed(() => {
  switch (status.value) {
    case 'running':
      return { label: '部署中', cls: 'st-running' }
    case 'success':
      return { label: '部署成功', cls: 'st-success' }
    case 'failed':
      return { label: '部署失败', cls: 'st-failed' }
    case 'cancelled':
      return { label: '已中止', cls: 'st-cancelled' }
    default:
      return { label: '待部署', cls: 'st-idle' }
  }
})

function newId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `env-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function cloneEnvironments(list) {
  return (list || []).map((env) => ({
    id: env.id || newId(),
    name: env.name || '环境',
    host: env.host || '',
    port: env.port || 22,
    username: env.username || '',
    password: env.password || '',
    remoteDir: env.remoteDir || '',
    buildCommand: env.buildCommand || '',
    outputPath: env.outputPath || '',
    lastStatus: env.lastStatus || 'idle',
    lastDeployedAt: env.lastDeployedAt || null,
    lastError: env.lastError || null,
  }))
}

function initForm() {
  const deploy = project.value?.deploy
  form.buildCommand = deploy?.buildCommand ?? 'npm run build'
  form.outputPath = deploy?.outputPath ?? 'dist'
  form.ignorePatterns = deploy?.ignorePatterns ?? ''
  form.environments = cloneEnvironments(deploy?.environments)
  aborting.value = false
  if (!form.environments.length) addEnv()
  const first = form.environments[0]
  activeEnvId.value = first ? first.id : ''
}

function addEnv() {
  const env = {
    id: newId(),
    name: `环境 ${form.environments.length + 1}`,
    host: '',
    port: 22,
    username: 'root',
    password: '',
    remoteDir: '',
    buildCommand: '',
    outputPath: '',
    lastStatus: 'idle',
    lastDeployedAt: null,
    lastError: null,
  }
  form.environments.push(env)
  activeEnvId.value = env.id
}

function removeEnv(env) {
  if (form.environments.length <= 1) {
    pushToast('至少保留一个部署环境', 'info')
    return
  }
  if (!window.confirm(`删除环境「${env.name}」？`)) return
  const index = form.environments.indexOf(env)
  form.environments.splice(index, 1)
  if (activeEnvId.value === env.id) {
    activeEnvId.value = form.environments[0]?.id || ''
  }
}

function selectEnv(env) {
  activeEnvId.value = env.id
}

/** 优先用服务端最新状态，保证中止 / 完成能立刻反映到环境标签上 */
function envLive(env) {
  return project.value?.deploy?.environments?.find((item) => item.id === env.id) || env
}

function applyPreset(preset) {
  form.buildCommand = preset.buildCommand
  form.outputPath = preset.outputPath
}

const PRESETS = [
  { key: 'vue', label: 'Vue', buildCommand: 'npm run build', outputPath: 'dist' },
  { key: 'react', label: 'React (CRA)', buildCommand: 'npm run build', outputPath: 'build' },
  { key: 'vite', label: 'Vite', buildCommand: 'npm run build', outputPath: 'dist' },
  { key: 'java', label: 'Java', buildCommand: 'mvn clean package -DskipTests', outputPath: 'target' },
  { key: 'static', label: '纯静态', buildCommand: '', outputPath: '.' },
]

function payload() {
  return {
    buildCommand: form.buildCommand,
    outputPath: form.outputPath,
    ignorePatterns: form.ignorePatterns,
    environments: form.environments,
  }
}

async function save() {
  const p = project.value
  if (!p || saving.value) return
  saving.value = true
  const ok = await saveDeploy(p.id, payload())
  saving.value = false
  return ok
}

async function deploy() {
  const p = project.value
  const env = currentEnv.value
  if (!p || !env || saving.value) return
  if (!canDeploy.value) {
    pushToast('请先完整填写服务器地址、用户名、远程目录和输出目录', 'error')
    return
  }
  saving.value = true
  const ok = await saveDeploy(p.id, payload(), { silent: true })
  saving.value = false
  if (!ok) return
  await runDeploy(p.id, env.id)
}

async function abort() {
  const p = project.value
  const env = currentEnv.value
  if (!p || !env || aborting.value) return
  aborting.value = true
  try {
    await abortDeploy(p.id, env.id)
  } finally {
    setTimeout(() => {
      aborting.value = false
    }, 1500)
  }
}

watch(
  () => store.deployDialog.open,
  async (open) => {
    if (!open) return
    initForm()
    const p = project.value
    if (!p) return
    for (const env of form.environments) {
      if (env.lastStatus && env.lastStatus !== 'idle') {
        loadDeployLogs(p.id, env.id)
      }
    }
  },
)
</script>

<template>
  <div v-if="store.deployDialog.open" class="overlay" @click.self="closeDeployDialog">
    <div class="dialog deploy-dialog">
      <header class="dialog-head">
        <div class="dialog-title">
          <span class="dialog-icon"><AppIcon name="upload" :size="17" /></span>
          <div>
            <h2>部署上线</h2>
            <p>{{ project ? project.name : '项目' }} · 构建后通过 SCP 上传到服务器</p>
          </div>
        </div>
        <button class="icon-btn" @click="closeDeployDialog"><AppIcon name="x" :size="16" /></button>
      </header>

      <div v-if="!project" class="dialog-body">
        <div class="empty small">项目不存在或已删除</div>
      </div>

      <div v-else class="dialog-body">
        <!-- 构建配置 -->
        <section class="card">
          <div class="card-head">
            <span class="card-step"><AppIcon name="terminal" :size="14" /></span>
            <div class="card-title">
              <h3>构建配置</h3>
              <p>部署前先执行构建命令；纯静态页面可留空跳过构建</p>
            </div>
          </div>

          <div class="preset-row">
            <span class="preset-label">快速填充</span>
            <button
              v-for="preset in PRESETS"
              :key="preset.key"
              class="preset-chip"
              type="button"
              @click="applyPreset(preset)"
            >
              {{ preset.label }}
            </button>
          </div>

          <div class="field-row">
            <label class="field">
              <span class="field-label"><AppIcon name="terminal" :size="13" /> 构建命令</span>
              <input v-model="form.buildCommand" type="text" placeholder="例如 npm run build（留空则不构建）" />
              <span class="field-hint">Vue/React 一般为 <code>npm run build</code>，Java 可为 <code>mvn package</code>，原生页面留空</span>
            </label>
            <label class="field">
              <span class="field-label"><AppIcon name="folder" :size="13" /> 输出目录</span>
              <input v-model="form.outputPath" type="text" placeholder="例如 dist" />
              <span class="field-hint">相对项目目录，支持目录或单个文件（如 jar）</span>
            </label>
          </div>

          <label class="field">
            <span class="field-label"><AppIcon name="x" :size="13" /> 忽略文件（类似 .gitignore）</span>
            <textarea
              v-model="form.ignorePatterns"
              rows="4"
              spellcheck="false"
              placeholder="每行一条规则，例如：&#10;node_modules/&#10;*.map&#10;.git/&#10;!keep.map"
            />
            <span class="field-hint">
              上传时跳过命中的文件/目录：支持 <code>*</code>、<code>**</code>、<code>?</code>，目录以
              <code>/</code> 结尾，<code>!</code> 开头表示不忽略；留空即上传全部文件
            </span>
          </label>
        </section>

        <!-- 环境 -->
        <section class="card">
          <div class="env-tabs">
            <button
              v-for="env in environments"
              :key="env.id"
              class="env-tab"
              :class="{ active: env.id === activeEnvId }"
              type="button"
              @click="selectEnv(env)"
            >
              <span class="env-dot" :class="`dot-${envLive(env).lastStatus || 'idle'}`" />
              {{ env.name }}
            </button>
            <button class="env-add" type="button" title="添加环境" @click="addEnv">
              <AppIcon name="plus" :size="14" />
            </button>
          </div>

          <template v-if="currentEnv">
            <div class="env-header">
              <label class="field env-name">
                <span class="field-label">环境名称</span>
                <input v-model="currentEnv.name" type="text" placeholder="测试环境 / 生产环境" />
              </label>
              <div class="env-status">
                <span class="status-pill" :class="statusMeta.cls">
                  <span v-if="isRunning" class="spinner" />
                  {{ statusMeta.label }}
                </span>
                <button
                  v-if="environments.length > 1"
                  class="icon-btn danger"
                  title="删除该环境"
                  type="button"
                  @click="removeEnv(currentEnv)"
                >
                  <AppIcon name="trash" :size="14" />
                </button>
              </div>
            </div>

            <div class="field-row">
              <label class="field grow-2">
                <span class="field-label"><AppIcon name="server" :size="13" /> 服务器 IP / 域名</span>
                <input v-model="currentEnv.host" type="text" placeholder="例如 192.168.1.10 或 example.com" />
              </label>
              <label class="field">
                <span class="field-label">端口</span>
                <input v-model.number="currentEnv.port" type="number" min="1" max="65535" placeholder="22" />
              </label>
            </div>

            <div class="field-row">
              <label class="field">
                <span class="field-label">用户名</span>
                <input v-model="currentEnv.username" type="text" placeholder="root" />
              </label>
              <label class="field">
                <span class="field-label"><AppIcon name="key" :size="13" /> 密码</span>
                <input v-model="currentEnv.password" type="password" placeholder="SSH 密码" autocomplete="new-password" />
              </label>
            </div>

            <label class="field">
              <span class="field-label"><AppIcon name="folder" :size="13" /> 远程目录</span>
              <input v-model="currentEnv.remoteDir" type="text" placeholder="例如 /var/www/html 或 /opt/app" />
              <span class="field-hint">
                构建产物会通过 SCP 上传到这个目录；目录不存在会自动创建，同名文件将被覆盖
              </span>
            </label>

            <details class="advanced">
              <summary>高级：为该环境单独设置构建命令 / 输出目录</summary>
              <div class="field-row">
                <label class="field">
                  <span class="field-label">构建命令覆盖</span>
                  <input
                    v-model="currentEnv.buildCommand"
                    type="text"
                    :placeholder="form.buildCommand || '继承项目配置（留空跳过构建）'"
                  />
                </label>
                <label class="field">
                  <span class="field-label">输出目录覆盖</span>
                  <input
                    v-model="currentEnv.outputPath"
                    type="text"
                    :placeholder="form.outputPath || '继承项目配置'"
                  />
                </label>
              </div>
            </details>
          </template>

          <div v-else class="empty small">暂无环境，点击上方 + 添加</div>
        </section>

        <!-- 操作 -->
        <div class="deploy-actions">
          <div class="deploy-meta">
            <template v-if="liveEnv?.lastDeployedAt">
              上次部署：{{ fromNow(liveEnv.lastDeployedAt) }}
            </template>
            <span v-else>尚未部署</span>
            <span v-if="lastError && status === 'failed'" class="last-error" :title="lastError">
              · {{ lastError }}
            </span>
          </div>
          <div class="deploy-btns">
            <button class="btn btn-ghost btn-sm" :disabled="saving || isRunning" @click="save">
              {{ saving ? '保存中…' : '保存配置' }}
            </button>
            <button v-if="isRunning" class="btn btn-danger btn-sm" :disabled="aborting" @click="abort">
              <AppIcon name="stop" :size="13" />
              {{ aborting ? '正在中止…' : '中止部署' }}
            </button>
            <button
              v-else
              class="btn btn-primary btn-sm"
              :disabled="saving || !canDeploy"
              @click="deploy"
            >
              <AppIcon name="upload" :size="13" />
              开始部署
            </button>
          </div>
        </div>

        <LogPanel
          :logs="logState.entries"
          :version="logState.version"
          :live="isRunning"
          :max-height="360"
          :min-height="200"
        />
      </div>

      <footer class="dialog-foot">
        <button class="btn btn-ghost" @click="closeDeployDialog">关闭</button>
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
  z-index: 55;
}

.dialog {
  width: 700px;
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

.card {
  border: 1px solid var(--border);
  border-radius: 13px;
  padding: 13px 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: #fcfdfe;
}

.card-head {
  display: flex;
  align-items: center;
  gap: 9px;
}

.card-step {
  width: 28px;
  height: 28px;
  border-radius: 9px;
  background: var(--green-soft);
  color: var(--green-dark);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
}

.card-title h3 {
  font-size: 13.5px;
  font-weight: 650;
}

.card-title p {
  font-size: 11.5px;
  color: var(--muted);
  margin-top: 1px;
}

.preset-row {
  display: flex;
  align-items: center;
  gap: 7px;
  flex-wrap: wrap;
}

.preset-label {
  font-size: 11.5px;
  color: var(--muted);
}

.preset-chip {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--text-soft);
  border: 1px solid var(--border-strong);
  background: #fff;
  border-radius: 99px;
  padding: 3px 10px;
  transition: border-color 0.15s ease, color 0.15s ease, background 0.15s ease;
}

.preset-chip:hover {
  border-color: var(--green);
  color: var(--green-dark);
  background: #f6fffb;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
  min-width: 0;
}

.field.grow-2 {
  flex: 2;
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
  width: 100%;
}

.field input:focus {
  border-color: var(--green);
  background: #fff;
  box-shadow: 0 0 0 3px rgba(63, 185, 132, 0.13);
}

.field textarea {
  border: 1px solid var(--border-strong);
  border-radius: 9px;
  padding: 8px 11px;
  font-size: 12.5px;
  line-height: 1.6;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  outline: none;
  resize: vertical;
  min-height: 76px;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
  background: #fff;
  width: 100%;
}

.field textarea:focus {
  border-color: var(--green);
  background: #fff;
  box-shadow: 0 0 0 3px rgba(63, 185, 132, 0.13);
}

.field-hint {
  font-size: 11.5px;
  color: #9aa4b2;
  line-height: 1.5;
}

.field-hint code {
  background: #eef1f5;
  border-radius: 5px;
  padding: 0 4px;
  font-size: 11px;
}

.field-row {
  display: flex;
  gap: 12px;
}

.env-tabs {
  display: flex;
  align-items: center;
  gap: 7px;
  flex-wrap: wrap;
  border-bottom: 1px solid var(--border);
  padding-bottom: 11px;
}

.env-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-soft);
  border: 1px solid var(--border-strong);
  background: #fff;
  border-radius: 9px;
  padding: 5px 11px;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.env-tab:hover {
  border-color: #c8dfd3;
}

.env-tab.active {
  border-color: var(--green);
  background: var(--green-soft);
  color: var(--green-dark);
}

.env-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #cbd3de;
  flex: none;
}

.dot-running {
  background: var(--amber);
  animation: pulse 1.1s ease-in-out infinite;
}

.dot-success {
  background: var(--green);
}

.dot-failed {
  background: var(--red);
}

.dot-cancelled {
  background: #9aa4b2;
}

.env-add {
  width: 27px;
  height: 27px;
  border-radius: 8px;
  border: 1px dashed var(--border-strong);
  color: var(--muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: border-color 0.15s ease, color 0.15s ease;
}

.env-add:hover {
  border-color: var(--green);
  color: var(--green-dark);
}

.env-header {
  display: flex;
  align-items: flex-end;
  gap: 12px;
}

.env-name {
  flex: 1;
}

.env-status {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-bottom: 2px;
  flex: none;
}

.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
  font-weight: 600;
  border-radius: 99px;
  padding: 3px 10px;
  white-space: nowrap;
}

.st-idle {
  color: #7a8494;
  background: #f1f3f6;
}

.st-running {
  color: var(--amber);
  background: var(--amber-soft);
}

.st-success {
  color: var(--green-dark);
  background: var(--green-soft);
}

.st-failed {
  color: var(--red);
  background: var(--red-soft);
}

.st-cancelled {
  color: #6b7684;
  background: #eef1f5;
}

.advanced {
  border: 1px dashed var(--border-strong);
  border-radius: 10px;
  padding: 9px 11px;
  background: #fff;
}

.advanced summary {
  font-size: 12px;
  color: var(--muted);
  cursor: pointer;
  user-select: none;
}

.advanced[open] summary {
  margin-bottom: 10px;
  color: var(--text-soft);
}

.deploy-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.deploy-meta {
  font-size: 11.5px;
  color: var(--muted);
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.last-error {
  color: var(--red);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 320px;
}

.deploy-btns {
  display: flex;
  gap: 8px;
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
