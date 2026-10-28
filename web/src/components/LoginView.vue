<script setup>
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import { requestEmailCode, loginAccount, registerAccount } from '../lib/store.js'

const mode = ref('login')
const busy = ref(false)
const error = ref('')
const notice = ref('')
const devCode = ref('')
const codeCooldown = ref(0)
let cooldownTimer = null

const loginForm = reactive({ email: '', password: '' })
const registerForm = reactive({ email: '', code: '', name: '', password: '', confirm: '' })

const showLoginPassword = ref(false)
const showRegisterPassword = ref(false)
const showConfirm = ref(false)

const loginEmailRef = ref(null)
const loginPasswordRef = ref(null)
const registerEmailRef = ref(null)
const registerCodeRef = ref(null)
const registerPasswordRef = ref(null)
const registerConfirmRef = ref(null)

const emailValid = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(value || '').trim())

const canSendCode = computed(
  () => !busy.value && codeCooldown.value === 0 && emailValid(registerForm.email),
)

const canLogin = computed(
  () => !busy.value && emailValid(loginForm.email) && loginForm.password.length > 0,
)

const canRegister = computed(
  () =>
    !busy.value &&
    emailValid(registerForm.email) &&
    /^\d{6}$/.test(registerForm.code.trim()) &&
    registerForm.password.length >= 8 &&
    registerForm.password === registerForm.confirm,
)

const passwordHint = computed(() => {
  if (!registerForm.password) return ''
  if (registerForm.password.length < 8) return '密码至少需要 8 个字符'
  if (registerForm.confirm && registerForm.password !== registerForm.confirm) return '两次输入的密码不一致'
  return ''
})

watch(mode, () => {
  error.value = ''
  notice.value = ''
  devCode.value = ''
})

onBeforeUnmount(() => {
  if (cooldownTimer) clearInterval(cooldownTimer)
})

function startCooldown() {
  if (cooldownTimer) clearInterval(cooldownTimer)
  cooldownTimer = setInterval(() => {
    if (codeCooldown.value > 0) {
      codeCooldown.value -= 1
    } else {
      clearInterval(cooldownTimer)
      cooldownTimer = null
    }
  }, 1000)
}

function switchMode(next) {
  mode.value = next
  error.value = ''
}

async function sendCode() {
  if (!canSendCode.value) return
  busy.value = true
  error.value = ''
  notice.value = ''
  devCode.value = ''
  try {
    const data = await requestEmailCode(registerForm.email.trim())
    if (data.delivered) {
      notice.value = '验证码已发送，请查收邮箱，10 分钟内有效。'
    } else {
      notice.value = '当前未配置 SMTP，验证码已输出到服务端控制台。'
      if (data.devCode) {
        devCode.value = data.devCode
        registerForm.code = data.devCode
        notice.value += '已自动填入下方验证码。'
      }
    }
    codeCooldown.value = Math.max(10, Number(data.cooldown) || 60)
    startCooldown()
  } catch (err) {
    error.value = err.message
  } finally {
    busy.value = false
  }
}

async function submitLogin() {
  if (!canLogin.value) return
  busy.value = true
  error.value = ''
  try {
    await loginAccount(loginForm.email.trim(), loginForm.password)
  } catch (err) {
    error.value = err.message
  } finally {
    busy.value = false
  }
}

async function submitRegister() {
  if (registerEmailRef.value) registerForm.email = registerEmailRef.value.value
  if (registerCodeRef.value) registerForm.code = registerCodeRef.value.value
  if (registerPasswordRef.value) registerForm.password = registerPasswordRef.value.value
  if (registerConfirmRef.value) registerForm.confirm = registerConfirmRef.value.value
  if (!canRegister.value) {
    if (!emailValid(registerForm.email)) error.value = '请输入有效的邮箱地址'
    else if (!/^\d{6}$/.test(registerForm.code.trim())) error.value = '请输入 6 位数字验证码'
    else if (registerForm.password.length < 8) error.value = '密码至少需要 8 个字符'
    else if (registerForm.password !== registerForm.confirm) error.value = '两次输入的密码不一致'
    else error.value = '请检查输入信息'
    return
  }
  busy.value = true
  error.value = ''
  try {
    await registerAccount({
      email: registerForm.email.trim(),
      code: registerForm.code.trim(),
      password: registerForm.password,
      name: registerForm.name.trim(),
    })
  } catch (err) {
    error.value = err.message
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="login-page">
    <section class="login-brand">
      <div class="brand-glow" />
      <div class="brand-inner">
        <div class="logo-row">
          <span class="logo-mark"><AppIcon name="terminal" :size="22" :stroke="2.4" /></span>
          <div>
            <div class="logo-title">AIEditHere</div>
            <div class="logo-sub">opencode 控制台</div>
          </div>
        </div>

        <h1>把项目交给 AI，<br />把代码留在本地。</h1>
        <p class="brand-desc">
          项目预览、运行调试和部署上线，在同一个工作台里完成。登录后即可进入你的项目空间。
        </p>

        <ul class="feature-list">
          <li>
            <span class="feature-icon"><AppIcon name="folder" :size="14" /></span>
            <div>
              <strong>本地项目</strong>
              <span>直接关联你自己的代码目录</span>
            </div>
          </li>
          <li>
            <span class="feature-icon"><AppIcon name="terminal" :size="14" /></span>
            <div>
              <strong>真实执行</strong>
              <span>opencode 直接读写本地代码</span>
            </div>
          </li>
          <li>
            <span class="feature-icon"><AppIcon name="globe" :size="14" /></span>
            <div>
              <strong>浏览器式预览</strong>
              <span>前端服务多页签随时查看</span>
            </div>
          </li>
        </ul>

        <div class="brand-foot">本地优先 · 数据保存在你自己的电脑和数据库</div>
      </div>
    </section>

    <section class="login-panel">
      <div class="login-card">
        <div class="tabs">
          <button
            type="button"
            class="tab"
            :class="{ active: mode === 'login' }"
            @click="switchMode('login')"
          >
            登录
          </button>
          <button
            type="button"
            class="tab"
            :class="{ active: mode === 'register' }"
            @click="switchMode('register')"
          >
            注册
          </button>
        </div>

        <div class="card-head">
          <h2>{{ mode === 'login' ? '欢迎回来' : '创建账号' }}</h2>
          <p>
            {{ mode === 'login' ? '使用邮箱和密码登录你的工作台' : '通过邮箱验证码完成注册，验证码 10 分钟内有效' }}
          </p>
        </div>

        <div v-if="error" class="form-alert alert-error">
          <AppIcon name="alert" :size="14" />
          <span>{{ error }}</span>
        </div>
        <div v-if="notice" class="form-alert alert-info">
          <AppIcon name="mail" :size="14" />
          <span>{{ notice }}</span>
        </div>
        <div v-if="devCode" class="dev-code">
          <span>本地调试验证码</span>
          <code>{{ devCode }}</code>
        </div>

        <form v-if="mode === 'login'" class="form" @submit.prevent="submitLogin">
          <label class="field">
            <span class="field-label">邮箱</span>
            <span class="input-wrap">
              <AppIcon name="mail" :size="15" class="input-icon" />
              <input
                ref="loginEmailRef"
                v-model="loginForm.email"
                type="email"
                autocomplete="email"
                placeholder="you@example.com"
                autofocus
              />
            </span>
          </label>

          <label class="field">
            <span class="field-label">密码</span>
            <span class="input-wrap">
              <AppIcon name="lock" :size="15" class="input-icon" />
              <input
                ref="loginPasswordRef"
                v-model="loginForm.password"
                :type="showLoginPassword ? 'text' : 'password'"
                autocomplete="current-password"
                placeholder="输入登录密码"
              />
              <button
                class="eye-btn"
                type="button"
                :title="showLoginPassword ? '隐藏密码' : '显示密码'"
                @click="showLoginPassword = !showLoginPassword"
              >
                <AppIcon :name="showLoginPassword ? 'eye-off' : 'eye'" :size="15" />
              </button>
            </span>
          </label>

          <button class="submit-btn" type="submit" :disabled="busy">
            <span v-if="busy" class="spinner spinner-light" />
            {{ busy ? '登录中…' : '登录' }}
          </button>

          <p class="switch-tip">
            还没有账号？
            <button type="button" class="link-btn" @click="switchMode('register')">用邮箱验证码注册</button>
          </p>
        </form>

        <form v-else class="form" @submit.prevent="submitRegister">
          <label class="field">
            <span class="field-label">邮箱</span>
            <span class="input-wrap">
              <AppIcon name="mail" :size="15" class="input-icon" />
              <input
                ref="registerEmailRef"
                v-model="registerForm.email"
                type="email"
                autocomplete="email"
                placeholder="you@example.com"
                autofocus
              />
            </span>
          </label>

          <label class="field">
            <span class="field-label">邮箱验证码</span>
            <div class="code-row">
              <span class="input-wrap">
                <AppIcon name="key" :size="15" class="input-icon" />
                <input
                  ref="registerCodeRef"
                  v-model="registerForm.code"
                  type="text"
                  inputmode="numeric"
                  maxlength="6"
                  autocomplete="one-time-code"
                  placeholder="6 位数字验证码"
                  @input="registerForm.code = registerForm.code.replace(/\D/g, '').slice(0, 6)"
                />
              </span>
              <button class="code-btn" type="button" :disabled="!canSendCode" @click="sendCode">
                {{ codeCooldown > 0 ? `${codeCooldown}s 后重发` : '获取验证码' }}
              </button>
            </div>
          </label>

          <label class="field">
            <span class="field-label">昵称 <span class="optional">可选</span></span>
            <span class="input-wrap">
              <AppIcon name="spark" :size="15" class="input-icon" />
              <input
                v-model="registerForm.name"
                type="text"
                maxlength="40"
                autocomplete="nickname"
                placeholder="怎么称呼你"
              />
            </span>
          </label>

          <div class="field-grid">
            <label class="field">
              <span class="field-label">设置密码</span>
              <span class="input-wrap">
                <AppIcon name="lock" :size="15" class="input-icon" />
                <input
                  ref="registerPasswordRef"
                  v-model="registerForm.password"
                  :type="showRegisterPassword ? 'text' : 'password'"
                  autocomplete="new-password"
                  placeholder="至少 8 位"
                />
                <button
                  class="eye-btn"
                  type="button"
                  @click="showRegisterPassword = !showRegisterPassword"
                >
                  <AppIcon :name="showRegisterPassword ? 'eye-off' : 'eye'" :size="15" />
                </button>
              </span>
            </label>

            <label class="field">
              <span class="field-label">确认密码</span>
              <span class="input-wrap">
                <AppIcon name="lock" :size="15" class="input-icon" />
                <input
                  ref="registerConfirmRef"
                  v-model="registerForm.confirm"
                  :type="showConfirm ? 'text' : 'password'"
                  autocomplete="new-password"
                  placeholder="再次输入"
                />
                <button class="eye-btn" type="button" @click="showConfirm = !showConfirm">
                  <AppIcon :name="showConfirm ? 'eye-off' : 'eye'" :size="15" />
                </button>
              </span>
            </label>
          </div>

          <p v-if="passwordHint" class="field-hint">{{ passwordHint }}</p>

          <button class="submit-btn" type="submit" :disabled="busy">
            <span v-if="busy" class="spinner spinner-light" />
            {{ busy ? '提交中…' : '注册并登录' }}
          </button>

          <p class="switch-tip">
            已经有账号？
            <button type="button" class="link-btn" @click="switchMode('login')">直接登录</button>
          </p>
        </form>
      </div>
    </section>
  </div>
</template>

<style scoped>
.login-page {
  min-height: 100vh;
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(0, 0.95fr);
  background: #f5f7f9;
}

.login-brand {
  position: relative;
  overflow: hidden;
  background:
    radial-gradient(120% 90% at 8% 0%, rgba(76, 198, 147, 0.28), transparent 55%),
    radial-gradient(90% 80% at 100% 100%, rgba(59, 130, 246, 0.22), transparent 55%),
    linear-gradient(155deg, #111a24 0%, #16232f 48%, #101b25 100%);
  color: #e8eef5;
  display: flex;
  align-items: center;
  padding: 56px clamp(38px, 6vw, 92px);
}

.brand-glow {
  position: absolute;
  right: -140px;
  bottom: -220px;
  width: 520px;
  height: 520px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(63, 185, 132, 0.28), transparent 65%);
  filter: blur(10px);
  pointer-events: none;
}

.brand-inner {
  position: relative;
  z-index: 1;
  max-width: 520px;
}

.logo-row {
  display: flex;
  align-items: center;
  gap: 13px;
  margin-bottom: 58px;
}

.logo-mark {
  width: 46px;
  height: 46px;
  border-radius: 13px;
  background: linear-gradient(135deg, #4cc693, #2c9d6e);
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 10px 26px -10px rgba(76, 198, 147, 0.8);
}

.logo-title {
  font-size: 20px;
  font-weight: 700;
  letter-spacing: 0.3px;
}

.logo-sub {
  font-size: 11.5px;
  color: #9fb0c2;
  margin-top: 2px;
}

.login-brand h1 {
  font-size: clamp(30px, 3.4vw, 44px);
  line-height: 1.28;
  font-weight: 700;
  letter-spacing: 0.2px;
  margin-bottom: 18px;
}

.brand-desc {
  font-size: 14px;
  line-height: 1.8;
  color: #aebdcb;
  max-width: 440px;
}

.feature-list {
  list-style: none;
  margin: 38px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 17px;
}

.feature-list li {
  display: flex;
  align-items: center;
  gap: 12px;
}

.feature-icon {
  width: 32px;
  height: 32px;
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: #6ee0b0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
}

.feature-list div {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.feature-list strong {
  font-size: 13px;
  font-weight: 600;
  color: #e5edf5;
}

.feature-list span:last-child {
  font-size: 12px;
  color: #93a5b7;
}

.brand-foot {
  margin-top: 62px;
  font-size: 11.5px;
  color: #7f92a5;
  letter-spacing: 0.2px;
}

.login-panel {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 34px clamp(22px, 4vw, 66px);
}

.login-card {
  width: 420px;
  max-width: 100%;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 20px;
  box-shadow: 0 2px 4px rgba(23, 32, 43, 0.03), 0 34px 70px -34px rgba(23, 32, 43, 0.3);
  padding: 26px 28px 24px;
}

.tabs {
  display: inline-flex;
  gap: 2px;
  padding: 3px;
  border-radius: 10px;
  background: #f1f4f8;
  margin-bottom: 24px;
}

.tab {
  min-width: 82px;
  padding: 6px 16px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--muted);
  transition: background 0.16s ease, color 0.16s ease, box-shadow 0.16s ease;
}

.tab.active {
  background: #fff;
  color: var(--green-dark);
  box-shadow: 0 1px 4px rgba(23, 32, 43, 0.13);
}

.card-head h2 {
  font-size: 21px;
  font-weight: 700;
  letter-spacing: 0.2px;
}

.card-head p {
  margin-top: 6px;
  font-size: 12.5px;
  color: var(--muted);
  line-height: 1.6;
}

.form-alert {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  margin-top: 15px;
  padding: 9px 11px;
  border-radius: 9px;
  font-size: 12.5px;
  line-height: 1.55;
}

.form-alert svg {
  margin-top: 1px;
  flex: none;
}

.alert-error {
  background: var(--red-soft);
  border: 1px solid #f6d4d4;
  color: #a12626;
}

.alert-info {
  background: #f5f9ff;
  border: 1px solid #dbe8fb;
  color: #3a5a86;
}

.dev-code {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 9px;
  padding: 8px 11px;
  border-radius: 9px;
  background: #fff7ea;
  border: 1px dashed #f0d9b0;
  font-size: 12px;
  color: #8a5b12;
}

.dev-code code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 17px;
  font-weight: 700;
  letter-spacing: 3px;
  color: #7a4c07;
}

.form {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-top: 20px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.field-label {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-soft);
  display: flex;
  align-items: center;
  gap: 5px;
}

.optional {
  font-size: 10.5px;
  font-weight: 500;
  color: #a8b1bf;
}

.input-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  border: 1px solid var(--border-strong);
  background: #fafbfc;
  border-radius: 10px;
  padding: 0 11px;
  transition: border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;
}

.input-wrap:focus-within {
  border-color: var(--green);
  background: #fff;
  box-shadow: 0 0 0 3px rgba(63, 185, 132, 0.13);
}

.input-icon {
  color: #9aa4b2;
  flex: none;
}

.input-wrap input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  padding: 10px 0;
  font-size: 13.5px;
}

.input-wrap input::placeholder {
  color: #aeb6c2;
}

.eye-btn {
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #9aa4b2;
  border-radius: 6px;
  flex: none;
}

.eye-btn:hover {
  color: var(--green-dark);
  background: var(--green-soft);
}

.code-row {
  display: flex;
  gap: 8px;
}

.code-row .input-wrap {
  flex: 1;
}

.code-btn {
  flex: none;
  padding: 0 13px;
  border-radius: 10px;
  border: 1px solid #c8dfd3;
  background: var(--green-soft);
  color: var(--green-dark);
  font-size: 12.5px;
  font-weight: 600;
  white-space: nowrap;
  transition: background 0.15s ease, border-color 0.15s ease, opacity 0.15s ease;
}

.code-btn:hover:not(:disabled) {
  background: #d9f3e7;
  border-color: var(--green);
}

.code-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.field-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.field-hint {
  font-size: 11.5px;
  color: #a8b1bf;
  margin-top: -4px;
}

.submit-btn {
  height: 42px;
  margin-top: 4px;
  border-radius: 10px;
  background: linear-gradient(135deg, #4cc693, #2c9d6e);
  color: #fff;
  font-size: 13.5px;
  font-weight: 650;
  letter-spacing: 0.3px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  box-shadow: 0 10px 22px -10px rgba(44, 157, 110, 0.65);
  transition: transform 0.15s ease, box-shadow 0.15s ease, opacity 0.15s ease;
}

.submit-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 14px 28px -12px rgba(44, 157, 110, 0.8);
}

.submit-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
  box-shadow: none;
}

.switch-tip {
  text-align: center;
  font-size: 12px;
  color: var(--muted);
}

.link-btn {
  color: var(--green-dark);
  font-weight: 600;
  font-size: 12px;
}

.link-btn:hover {
  text-decoration: underline;
}

.spinner-light {
  border-color: rgba(255, 255, 255, 0.35);
  border-top-color: #fff;
}

@media (max-width: 900px) {
  .login-page {
    grid-template-columns: 1fr;
  }

  .login-brand {
    padding: 38px 28px 34px;
  }

  .logo-row {
    margin-bottom: 30px;
  }

  .feature-list,
  .brand-foot {
    display: none;
  }

  .login-brand h1 {
    font-size: 27px;
  }

  .brand-desc {
    font-size: 13px;
  }

  .login-panel {
    padding: 24px 18px 40px;
  }
}
</style>
