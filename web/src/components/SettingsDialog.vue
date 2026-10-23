<script setup>
import { computed, reactive, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import { store, saveConfig, api } from '../lib/store.js'

const form = reactive({ ...store.config })
const saving = ref(false)
const models = ref([])
const ocDefault = ref('')
const modelsError = ref('')

const modelOptions = computed(() =>
  models.value.map((item) => ({
    value: `${item.providerID}/${item.modelID}`,
    label: `${item.providerName || item.providerID} · ${item.name || item.modelID}`,
  })),
)

const defaultInvalid = computed(() => {
  if (!ocDefault.value || !models.value.length) return false
  return !models.value.some((item) => `${item.providerID}/${item.modelID}` === ocDefault.value)
})

watch(
  () => store.settingsOpen,
  (open) => {
    if (open) {
      Object.assign(form, store.config)
      loadModels()
    }
  },
)

async function loadModels() {
  models.value = []
  ocDefault.value = ''
  modelsError.value = ''
  if (form.demo) return
  try {
    const data = await api('GET', '/api/opencode/models')
    if (data?.error) modelsError.value = data.error
    models.value = Array.isArray(data?.models) ? data.models : []
    ocDefault.value = data?.default || ''
  } catch (err) {
    modelsError.value = err.message
  }
}

async function save() {
  if (saving.value) return
  saving.value = true
  const ok = await saveConfig({ ...form })
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
            <p>配置 opencode 连接与被控制的目标项目</p>
          </div>
        </div>
        <button class="icon-btn" @click="close"><AppIcon name="x" :size="16" /></button>
      </header>

      <div class="dialog-body">
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
            <span class="field-label">模型</span>
            <input
              v-model="form.model"
              type="text"
              list="oc-model-options"
              placeholder="provider/model，留空用默认"
            />
            <datalist id="oc-model-options">
              <option v-for="item in modelOptions" :key="item.value" :value="item.value">
                {{ item.label }}
              </option>
            </datalist>
            <span v-if="modelsError" class="field-hint warn">{{ modelsError }}</span>
            <span v-else-if="defaultInvalid" class="field-hint warn">
              opencode 默认模型「{{ ocDefault }}」不存在，请从下拉列表选一个可用模型
            </span>
            <span v-else-if="ocDefault" class="field-hint">
              留空使用 opencode 默认模型：{{ ocDefault }}
            </span>
            <span v-else-if="models.length" class="field-hint">
              可从下拉列表选择模型，留空使用 opencode 默认模型
            </span>
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
