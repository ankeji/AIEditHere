<script setup>
import { computed, reactive, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import { store, saveConfig, api, pushToast } from '../lib/store.js'

const form = reactive({ ...store.config })
const saving = ref(false)

const modelTest = reactive({ loading: false, error: '', models: [...(store.config.apiModels || [])] })
const currentModel = computed(() => {
  if (store.config.apiBaseUrl && store.config.apiModelName) {
    return `aiedithere/${store.config.apiModelName}`
  }
  return store.config.model || '使用 OpenCode 默认模型'
})

watch(
  () => store.settingsOpen,
  (open) => {
    if (open) {
      Object.assign(form, store.config)
      // 已保存的 Key 不回显，占位提示即可；清空表示不修改
      form.apiKey = ''
      modelTest.error = ''
      modelTest.models = [...(store.config.apiModels || [])]
    }
  },
)

async function testModel() {
  if (modelTest.loading) return
  if (!String(form.apiBaseUrl || '').trim()) {
    pushToast('请先填写 API 地址', 'error')
    return
  }
  if (!String(form.apiModelName || '').trim()) {
    pushToast('请先填写模型名称，例如 deepseek-v4.1-flash', 'error')
    return
  }
  modelTest.loading = true
  modelTest.error = ''
  try {
    const data = await api('POST', '/api/opencode/test-model', {
      apiBaseUrl: form.apiBaseUrl,
      apiModelName: form.apiModelName,
      apiKey: form.apiKey || undefined,
    })
    if (data?.ok) {
      modelTest.models = Array.isArray(data.models) ? data.models : []
      store.config.apiModels = [...modelTest.models]
      if (data.reply) {
        pushToast(`连接成功：${String(data.reply).slice(0, 40)}…`, 'success')
      } else {
        pushToast('连接成功', 'success')
      }
    } else {
      modelTest.error = data?.error || '连接失败'
      pushToast(modelTest.error, 'error')
    }
  } catch (err) {
    modelTest.error = err.message
    pushToast(err.message, 'error')
  } finally {
    modelTest.loading = false
  }
}

async function save() {
  if (saving.value) return
  saving.value = true
  const merged = [...new Set([...(store.config.apiModels || []), ...modelTest.models])]
  if (String(form.apiModelName || '').trim()) merged.push(String(form.apiModelName).trim())
  const patch = { ...form, apiModels: [...new Set(merged)] }
  if (!String(patch.apiKey || '').trim()) delete patch.apiKey
  const ok = await saveConfig(patch)
  saving.value = false
  if (ok) store.settingsOpen = false
}

function close() {
  store.settingsOpen = false
}
</script>

<template>
  <div v-if="store.settingsOpen" class="overlay" @click.self="close">
    <div class="dialog">
      <header class="dialog-head">
        <div class="dialog-title">
          <span class="dialog-icon"><AppIcon name="gear" :size="17" /></span>
          <div>
            <h2>设置</h2>
            <p>配置统一模型 API、opencode 连接与被控制的目标项目</p>
          </div>
        </div>
        <button class="icon-btn" @click="close"><AppIcon name="x" :size="16" /></button>
      </header>

      <div class="dialog-body">
        <section class="section">
          <div class="section-head">
            <span class="section-title"><AppIcon name="bot" :size="14" /> 统一模型 API 配置</span>
            <button class="btn btn-ghost btn-xs" :disabled="modelTest.loading" @click="testModel">
              {{ modelTest.loading ? '测试中…' : '测试连接' }}
            </button>
          </div>
          <div class="current-model">
            <span class="current-label">当前正在使用</span>
            <strong>{{ currentModel }}</strong>
            <span v-if="store.config.apiBaseUrl" class="current-endpoint">{{ store.config.apiBaseUrl }}</span>
          </div>
          <span class="field-hint">
            配置 OpenAI 兼容接口（调用 /v1/chat/completions），所有用户共用。填好地址、模型名称和 Key 后可「测试连接」；测试通过的模型会加入下方列表，方便下次直接选择。
          </span>
          <label class="field">
            <span class="field-label">API 地址（Base URL）</span>
            <input v-model="form.apiBaseUrl" type="url" placeholder="https://api.example.com/v1" />
          </label>
          <label v-if="modelTest.models.length" class="field">
            <span class="field-label">选择已配置模型</span>
            <select v-model="form.apiModelName" class="model-select">
              <option value="">请选择模型</option>
              <option v-for="name in modelTest.models" :key="name" :value="name">{{ name }}</option>
            </select>
          </label>
          <label class="field">
            <span class="field-label">模型名称</span>
            <input v-model="form.apiModelName" type="text" placeholder="例如 gpt-4o、deepseek-chat" />
          </label>
          <label class="field">
            <span class="field-label">API Key</span>
            <input
              v-model="form.apiKey"
              type="password"
              autocomplete="new-password"
              :placeholder="store.config.apiKeyConfigured ? '已保存，留空保持不变' : '输入 API Key'"
            />
            <span class="field-hint">API Key 加密保存在服务端，不会返回到浏览器。</span>
          </label>
          <span v-if="modelTest.error" class="field-hint warn">{{ modelTest.error }}</span>
        </section>

        <div class="section-sep" />

        <label class="field">
          <span class="field-label"><AppIcon name="folder" :size="13" /> 默认项目目录</span>
          <input v-model="form.projectDir" type="text" placeholder="/path/to/your/project" />
          <span class="field-hint">
            新建项目时的初始目录，也是自动启动 opencode 时的工作目录；每个项目也可以单独配置自己的目录
          </span>
        </label>

        <label class="field">
          <span class="field-label"><AppIcon name="link" :size="13" /> opencode 服务地址</span>
          <input v-model="form.opencodeUrl" type="text" placeholder="http://127.0.0.1:4096" />
        </label>

        <div class="field-row">
          <label class="field">
            <span class="field-label">备用模型（未配置统一 API 时使用）</span>
            <input
              v-model="form.model"
              type="text"
              placeholder="provider/model，留空用 opencode 默认"
            />
            <span class="field-hint">配置了上面的统一 API 后，此项会被自动覆盖</span>
          </label>
          <label class="field">
            <span class="field-label">Agent</span>
            <input v-model="form.agent" type="text" placeholder="build / plan，可留空" />
          </label>
        </div>

        <label class="switch-row">
          <div class="switch-text">
            <span>自动启动 opencode</span>
            <span class="field-hint">连接失败时自动执行 `opencode serve`（需要已安装 opencode）</span>
          </div>
          <span class="switch" :class="{ on: form.autoStart }" @click.prevent="form.autoStart = !form.autoStart">
            <span class="knob" />
          </span>
        </label>

        <label class="switch-row">
          <div class="switch-text">
            <span>演示模式</span>
            <span class="field-hint">不调用 opencode，本地模拟拆解与执行，用于预览界面</span>
          </div>
          <span class="switch" :class="{ on: form.demo }" @click.prevent="form.demo = !form.demo">
            <span class="knob" />
          </span>
        </label>

        <div class="status-line">
          <span class="dot" :class="{ ok: store.health.connected && !form.demo }" />
          <template v-if="form.demo">当前将使用演示模式</template>
          <template v-else-if="store.health.connected">已连接 opencode {{ store.health.version }}</template>
          <template v-else>未连接 opencode</template>
        </div>

        <div class="install-hint">
          未安装 opencode？终端执行
          <code>npm i -g opencode-ai</code>
          后运行 <code>opencode auth login</code> 配置模型，再执行 <code>opencode serve</code>。
        </div>
      </div>

      <footer class="dialog-foot">
        <button class="btn btn-ghost" @click="close">取消</button>
        <button class="btn btn-primary" :disabled="saving" @click="save">
          {{ saving ? '保存中…' : '保存设置' }}
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
  width: 560px;
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

.section {
  display: flex;
  flex-direction: column;
  gap: 10px;
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 12px;
  background: #fbfcfd;
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.section-title {
  font-size: 13px;
  font-weight: 650;
  color: var(--text-soft);
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.current-model {
  display: flex;
  align-items: center;
  gap: 9px;
  flex-wrap: wrap;
  padding: 9px 10px;
  background: #eefaf4;
  border: 1px solid #c9eedb;
  border-radius: 9px;
  color: var(--green-dark);
}

.current-label {
  font-size: 11.5px;
  color: var(--muted);
}

.current-model strong {
  font-size: 12.5px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.current-endpoint {
  width: 100%;
  font-size: 10.5px;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-select {
  width: 100%;
  border: 1px solid var(--border-strong);
  border-radius: 9px;
  padding: 8px 11px;
  font-size: 13px;
  outline: none;
  background: #fff;
}

.section-sep {
  height: 1px;
  background: var(--border);
  margin: 2px 0;
}

.model-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.model-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 9px;
}

.model-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.model-name {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-soft);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-value {
  font-size: 11px;
  color: #9aa4b2;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.default-badge {
  flex: none;
  font-size: 10.5px;
  font-weight: 700;
  color: var(--green-dark);
  background: var(--green-soft);
  border-radius: 99px;
  padding: 1px 8px;
}

.link-btn {
  flex: none;
  font-size: 11.5px;
  color: var(--green-dark);
  padding: 2px 6px;
  border-radius: 6px;
}

.link-btn:hover {
  background: var(--green-soft);
}

.icon-btn.danger:hover {
  color: var(--red);
}

.model-empty {
  font-size: 12px;
  color: #9aa4b2;
  padding: 10px;
  text-align: center;
  border: 1px dashed var(--border-strong);
  border-radius: 9px;
}

.model-form {
  display: flex;
  flex-direction: column;
  gap: 9px;
  padding-top: 4px;
}

.model-form-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.check-line {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  color: var(--text-soft);
  cursor: pointer;
}

.check-line input {
  width: 14px;
  height: 14px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
  min-width: 0;
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

.field-hint.warn {
  color: #c96a1b;
}

.field-row {
  display: flex;
  gap: 12px;
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

.status-line {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12.5px;
  color: var(--muted);
  padding: 2px 4px;
}

.status-line .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #cbd3de;
}

.status-line .dot.ok {
  background: var(--green);
  box-shadow: 0 0 0 3px rgba(63, 185, 132, 0.18);
}

.install-hint {
  font-size: 12px;
  color: var(--muted);
  background: #f7f9fb;
  border: 1px dashed var(--border-strong);
  border-radius: 10px;
  padding: 10px 12px;
  line-height: 1.7;
}

.install-hint code {
  background: #eef1f5;
  border-radius: 5px;
  padding: 1px 5px;
  font-size: 11.5px;
  color: var(--text-soft);
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
