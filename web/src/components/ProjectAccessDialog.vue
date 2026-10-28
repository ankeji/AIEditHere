<script setup>
import { computed, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import {
  store,
  closeAccessDialog,
  loadTeams,
  loadProjectAccess,
  saveProjectAccess,
  lookupUser,
  pushToast,
} from '../lib/store.js'

const loading = ref(false)
const busy = ref(false)
const teamIds = ref([])
const users = ref([])
const email = ref('')

const project = computed(
  () => store.projects.find((item) => item.id === store.accessDialog.projectId) || null,
)

watch(
  () => store.accessDialog.open,
  async (open) => {
    if (!open) return
    email.value = ''
    users.value = []
    teamIds.value = []
    await loadTeams({ silent: true })
    await refresh()
  },
  { immediate: true },
)

async function refresh() {
  const projectId = store.accessDialog.projectId
  if (!projectId) return
  loading.value = true
  try {
    const data = await loadProjectAccess(projectId)
    teamIds.value = Array.isArray(data?.teamIds) ? [...data.teamIds] : []
    users.value = Array.isArray(data?.users) ? [...data.users] : []
  } catch (err) {
    pushToast(err.message, 'error')
  } finally {
    loading.value = false
  }
}

function toggleTeam(id) {
  if (teamIds.value.includes(id)) teamIds.value = teamIds.value.filter((item) => item !== id)
  else teamIds.value = [...teamIds.value, id]
}

async function addUser() {
  const value = email.value.trim()
  if (!value || busy.value) return
  if (users.value.some((user) => user.email.toLowerCase() === value.toLowerCase())) {
    pushToast('该用户已经在可见名单中', 'info')
    return
  }
  busy.value = true
  try {
    const user = await lookupUser(value)
    if (user) {
      users.value = [...users.value, user]
      email.value = ''
    }
  } catch (err) {
    pushToast(err.message, 'error')
  } finally {
    busy.value = false
  }
}

function removeUser(user) {
  users.value = users.value.filter((item) => item.id !== user.id)
}

async function save() {
  if (!project.value || busy.value) return
  busy.value = true
  try {
    const data = await saveProjectAccess(project.value.id, {
      teamIds: teamIds.value,
      userIds: users.value.map((user) => user.id),
    })
    if (data) closeAccessDialog()
  } finally {
    busy.value = false
  }
}

function initialOf(user) {
  const source = user.name || user.email || ''
  return source.trim().charAt(0).toUpperCase() || '?'
}

const sharedCount = computed(() => teamIds.value.length + users.value.length)
</script>

<template>
  <div v-if="store.accessDialog.open" class="overlay" @click.self="closeAccessDialog">
    <div class="dialog">
      <header class="dialog-head">
        <div class="dialog-title">
          <span class="dialog-icon"><AppIcon name="share" :size="17" /></span>
          <div>
            <h2>项目可见范围</h2>
            <p>{{ project?.name || '项目' }} · 默认只有你自己可以看到</p>
          </div>
        </div>
        <button class="icon-btn" @click="closeAccessDialog"><AppIcon name="x" :size="16" /></button>
      </header>

      <div class="dialog-body">
        <div v-if="loading" class="loading">正在加载可见范围…</div>

        <template v-else>
          <section class="block">
            <div class="block-head">
              <div>
                <h3>共享给团队</h3>
                <p>团队里的所有成员都可以看到这个项目</p>
              </div>
              <span class="count">{{ teamIds.length }} 个团队</span>
            </div>
            <div v-if="!store.teams.length" class="empty-line">
              还没有团队，先到「我的团队」创建团队并邀请成员。
            </div>
            <div v-else class="team-grid">
              <button
                v-for="team in store.teams"
                :key="team.id"
                type="button"
                class="team-check"
                :class="{ active: teamIds.includes(team.id) }"
                @click="toggleTeam(team.id)"
              >
                <span class="check-box">
                  <AppIcon v-if="teamIds.includes(team.id)" name="check" :size="11" :stroke="2.6" />
                </span>
                <span class="team-check-text">
                  <span class="team-check-name">{{ team.name }}</span>
                  <span class="team-check-meta">{{ team.members?.length || 0 }} 位成员</span>
                </span>
              </button>
            </div>
          </section>

          <section class="block">
            <div class="block-head">
              <div>
                <h3>指定个人用户</h3>
                <p>只把项目开放给某几个已注册用户</p>
              </div>
              <span class="count">{{ users.length }} 位用户</span>
            </div>

            <div v-if="users.length" class="user-list">
              <div v-for="user in users" :key="user.id" class="user-row">
                <span class="user-avatar">{{ initialOf(user) }}</span>
                <div class="user-text">
                  <span class="user-name">{{ user.name || user.email }}</span>
                  <span class="user-email">{{ user.email }}</span>
                </div>
                <button class="icon-btn danger" title="移除" @click="removeUser(user)">
                  <AppIcon name="x" :size="13" />
                </button>
              </div>
            </div>

            <div class="add-row">
              <input
                v-model="email"
                type="email"
                placeholder="输入对方注册邮箱"
                @keydown.enter.prevent="addUser"
              />
              <button class="btn btn-soft btn-sm" :disabled="busy || !email.trim()" @click="addUser">
                <AppIcon name="plus" :size="13" />
                添加
              </button>
            </div>
          </section>

          <div class="summary">
            <AppIcon :name="sharedCount ? 'users' : 'lock'" :size="14" />
            <span v-if="!sharedCount">当前仅自己可见</span>
            <span v-else>已共享给 {{ sharedCount }} 个对象，保存后立即生效</span>
          </div>
        </template>
      </div>

      <footer class="dialog-foot">
        <button class="btn btn-ghost" @click="closeAccessDialog">取消</button>
        <button class="btn btn-primary" :disabled="loading || busy" @click="save">
          {{ busy ? '保存中…' : '保存可见范围' }}
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
  z-index: 62;
}

.dialog {
  width: 620px;
  max-width: 100%;
  max-height: 88vh;
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
  gap: 16px;
}

.loading {
  padding: 30px;
  text-align: center;
  font-size: 12.5px;
  color: var(--muted);
}

.block {
  display: flex;
  flex-direction: column;
  gap: 9px;
}

.block-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.block-head h3 {
  font-size: 13.5px;
  font-weight: 650;
}

.block-head p {
  margin-top: 2px;
  font-size: 11.5px;
  color: var(--muted);
}

.count {
  font-size: 11px;
  color: var(--muted);
  background: #f1f3f6;
  border-radius: 99px;
  padding: 2px 8px;
  flex: none;
}

.team-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.team-check {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 10px;
  border: 1px solid var(--border);
  border-radius: 10px;
  text-align: left;
  background: #fcfdfe;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.team-check:hover {
  border-color: #c8dfd3;
}

.team-check.active {
  border-color: var(--green);
  background: var(--green-soft);
}

.check-box {
  width: 17px;
  height: 17px;
  border-radius: 5px;
  border: 1px solid var(--border-strong);
  background: #fff;
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
}

.team-check.active .check-box {
  background: var(--green);
  border-color: var(--green);
}

.team-check-text {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.team-check-name {
  font-size: 12.5px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.team-check-meta {
  font-size: 10.5px;
  color: var(--muted);
}

.empty-line {
  font-size: 12px;
  color: var(--muted);
  padding: 12px;
  border: 1px dashed var(--border-strong);
  border-radius: 10px;
  background: #fcfdfe;
}

.user-list {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
}

.user-row {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
}

.user-row:last-child {
  border-bottom: none;
}

.user-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: linear-gradient(135deg, #4cc693, #2c9d6e);
  color: #fff;
  font-size: 11.5px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
}

.user-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.user-name {
  font-size: 12.5px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.user-email {
  font-size: 11px;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.add-row {
  display: flex;
  gap: 7px;
}

.add-row input {
  flex: 1;
  min-width: 0;
  border: 1px solid var(--border-strong);
  border-radius: 9px;
  padding: 7px 10px;
  font-size: 12.5px;
  outline: none;
  background: #fff;
}

.add-row input:focus {
  border-color: var(--green);
  box-shadow: 0 0 0 3px rgba(63, 185, 132, 0.13);
}

.summary {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  color: var(--text-soft);
  background: #f6f8fa;
  border: 1px solid var(--border);
  border-radius: 9px;
  padding: 9px 11px;
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
</style>
