<script setup>
import { computed, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import {
  store,
  closeTeamDialog,
  createTeam,
  renameTeam,
  deleteTeam,
  addTeamMember,
  removeTeamMember,
  leaveTeam,
} from '../lib/store.js'

const selectedId = ref('')
const newTeamName = ref('')
const renameValue = ref('')
const memberEmail = ref('')
const busy = ref(false)

const teams = computed(() => store.teams)
const selectedTeam = computed(() => teams.value.find((team) => team.id === selectedId.value) || null)
const isOwner = computed(
  () => Boolean(selectedTeam.value && selectedTeam.value.ownerId === store.auth.user?.id),
)

watch(
  () => store.teamDialogOpen,
  (open) => {
    if (!open) return
    memberEmail.value = ''
    newTeamName.value = ''
    if (!selectedTeam.value) selectedId.value = teams.value[0]?.id || ''
    renameValue.value = selectedTeam.value?.name || ''
  },
  { immediate: true },
)

watch(
  () => teams.value.map((team) => team.id).join(','),
  () => {
    if (!teams.value.some((team) => team.id === selectedId.value)) {
      selectedId.value = teams.value[0]?.id || ''
    }
    if (selectedTeam.value) renameValue.value = selectedTeam.value.name
  },
)

function selectTeam(team) {
  selectedId.value = team.id
  renameValue.value = team.name
  memberEmail.value = ''
}

async function submitCreate() {
  const name = newTeamName.value.trim()
  if (!name || busy.value) return
  busy.value = true
  try {
    const team = await createTeam(name)
    if (team) {
      selectedId.value = team.id
      renameValue.value = team.name
      newTeamName.value = ''
    }
  } finally {
    busy.value = false
  }
}

async function saveRename() {
  const team = selectedTeam.value
  const name = renameValue.value.trim()
  if (!team || !name || name === team.name || busy.value) return
  busy.value = true
  try {
    await renameTeam(team.id, name)
  } finally {
    busy.value = false
  }
}

async function removeTeam() {
  const team = selectedTeam.value
  if (!team || !window.confirm(`删除团队「${team.name}」？已共享给该团队的项目会立即取消共享。`)) return
  busy.value = true
  try {
    const ok = await deleteTeam(team.id)
    if (ok) selectedId.value = teams.value[0]?.id || ''
  } finally {
    busy.value = false
  }
}

async function submitMember() {
  const team = selectedTeam.value
  const email = memberEmail.value.trim()
  if (!team || !email || busy.value) return
  busy.value = true
  try {
    const updated = await addTeamMember(team.id, email)
    if (updated) memberEmail.value = ''
  } finally {
    busy.value = false
  }
}

async function kickMember(member) {
  const team = selectedTeam.value
  if (!team || member.role === 'owner' || busy.value) return
  if (!window.confirm(`把 ${member.name || member.email} 移出团队？`)) return
  busy.value = true
  try {
    await removeTeamMember(team.id, member.id)
  } finally {
    busy.value = false
  }
}

async function exitTeam() {
  const team = selectedTeam.value
  if (!team || isOwner.value || busy.value) return
  if (!window.confirm(`确认退出团队「${team.name}」？`)) return
  busy.value = true
  try {
    const ok = await leaveTeam(team.id)
    if (ok) selectedId.value = teams.value[0]?.id || ''
  } finally {
    busy.value = false
  }
}

function initialOf(member) {
  const source = member.name || member.email || ''
  return source.trim().charAt(0).toUpperCase() || '?'
}
</script>

<template>
  <div v-if="store.teamDialogOpen" class="overlay" @click.self="closeTeamDialog">
    <div class="dialog">
      <header class="dialog-head">
        <div class="dialog-title">
          <span class="dialog-icon"><AppIcon name="users" :size="17" /></span>
          <div>
            <h2>我的团队</h2>
            <p>创建团队并邀请成员，之后可以把项目共享给整个团队</p>
          </div>
        </div>
        <button class="icon-btn" @click="closeTeamDialog"><AppIcon name="x" :size="16" /></button>
      </header>

      <div class="dialog-body">
        <aside class="team-list">
          <div class="create-row">
            <input
              v-model="newTeamName"
              type="text"
              placeholder="新团队名称"
              @keydown.enter.prevent="submitCreate"
            />
            <button class="btn btn-primary btn-sm" :disabled="busy || !newTeamName.trim()" @click="submitCreate">
              <AppIcon name="plus" :size="13" />
            </button>
          </div>

          <div v-if="!teams.length" class="empty-teams">
            <AppIcon name="users" :size="20" />
            <span>还没有团队</span>
          </div>

          <button
            v-for="team in teams"
            :key="team.id"
            type="button"
            class="team-item"
            :class="{ active: team.id === selectedId }"
            @click="selectTeam(team)"
          >
            <span class="team-mark"><AppIcon name="users" :size="14" /></span>
            <span class="team-item-text">
              <span class="team-item-name">{{ team.name }}</span>
              <span class="team-item-meta">{{ team.members?.length || 0 }} 位成员</span>
            </span>
            <span v-if="team.role === 'owner'" class="role-dot">创建者</span>
          </button>
        </aside>

        <section v-if="selectedTeam" class="team-detail">
          <div class="detail-head">
            <div class="detail-title">
              <input
                v-if="isOwner"
                v-model="renameValue"
                class="team-name-input"
                type="text"
                @keydown.enter.prevent="saveRename"
                @blur="saveRename"
              />
              <h3 v-else>{{ selectedTeam.name }}</h3>
              <span class="member-count">{{ selectedTeam.members?.length || 0 }} 位成员</span>
            </div>
            <button v-if="isOwner" class="btn btn-ghost btn-xs danger-text" :disabled="busy" @click="removeTeam">
              <AppIcon name="trash" :size="13" />
              删除团队
            </button>
            <button v-else class="btn btn-ghost btn-xs danger-text" :disabled="busy" @click="exitTeam">
              <AppIcon name="logout" :size="13" />
              退出团队
            </button>
          </div>

          <div class="member-list">
            <div v-for="member in selectedTeam.members" :key="member.id" class="member-row">
              <span class="member-avatar">{{ initialOf(member) }}</span>
              <div class="member-text">
                <span class="member-name">
                  {{ member.name || member.email }}
                  <span v-if="member.id === store.auth.user?.id" class="you">我</span>
                </span>
                <span class="member-email">{{ member.email }}</span>
              </div>
              <span class="member-role" :class="member.role">{{ member.role === 'owner' ? '创建者' : '成员' }}</span>
              <button
                v-if="isOwner && member.role !== 'owner'"
                class="icon-btn danger"
                title="移出团队"
                :disabled="busy"
                @click="kickMember(member)"
              >
                <AppIcon name="x" :size="13" />
              </button>
            </div>
          </div>

          <div v-if="isOwner" class="add-member">
            <div class="add-member-label">
              <AppIcon name="mail" :size="13" />
              邀请成员
            </div>
            <div class="add-member-row">
              <input
                v-model="memberEmail"
                type="email"
                placeholder="输入对方注册邮箱"
                @keydown.enter.prevent="submitMember"
              />
              <button class="btn btn-primary btn-sm" :disabled="busy || !memberEmail.trim()" @click="submitMember">
                加入团队
              </button>
            </div>
            <span class="hint">对方需要先在本站注册账号。</span>
          </div>
        </section>

        <section v-else class="team-empty">
          <div class="empty-icon"><AppIcon name="users" :size="22" /></div>
          <div>创建或选择一个团队</div>
          <span class="hint">团队创建后，可以把项目共享给团队里的所有成员。</span>
        </section>
      </div>
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
  z-index: 60;
}

.dialog {
  width: 780px;
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
  display: flex;
  min-height: 420px;
  max-height: 70vh;
}

.team-list {
  width: 260px;
  flex: none;
  border-right: 1px solid var(--border);
  padding: 14px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: #fbfcfd;
}

.create-row {
  display: flex;
  gap: 6px;
  margin-bottom: 6px;
}

.create-row input {
  flex: 1;
  min-width: 0;
  border: 1px solid var(--border-strong);
  border-radius: 9px;
  padding: 7px 9px;
  font-size: 12.5px;
  outline: none;
  background: #fff;
}

.create-row input:focus,
.add-member-row input:focus,
.team-name-input:focus {
  border-color: var(--green);
  box-shadow: 0 0 0 3px rgba(63, 185, 132, 0.13);
}

.team-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  border-radius: 10px;
  text-align: left;
  color: var(--text-soft);
  transition: background 0.15s ease;
}

.team-item:hover {
  background: #f1f6f3;
}

.team-item.active {
  background: var(--green-soft);
  color: var(--green-dark);
}

.team-mark {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: #eef2f5;
  color: #6d7b8b;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
}

.team-item.active .team-mark {
  background: #fff;
  color: var(--green-dark);
}

.team-item-text {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.team-item-name {
  font-size: 12.5px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.team-item-meta {
  font-size: 10.5px;
  color: var(--muted);
}

.role-dot {
  font-size: 10px;
  color: var(--green-dark);
  background: #fff;
  border-radius: 99px;
  padding: 1px 6px;
  flex: none;
}

.empty-teams {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 28px 8px;
  color: var(--muted);
  font-size: 12px;
}

.team-detail {
  flex: 1;
  min-width: 0;
  padding: 16px 18px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.detail-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.detail-title {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.detail-title h3 {
  font-size: 15px;
  font-weight: 700;
}

.team-name-input {
  border: 1px solid transparent;
  background: transparent;
  border-radius: 7px;
  padding: 3px 6px;
  font-size: 15px;
  font-weight: 700;
  outline: none;
  min-width: 180px;
}

.team-name-input:hover {
  border-color: var(--border);
  background: #fff;
}

.member-count {
  font-size: 11px;
  color: var(--muted);
  background: #f1f3f6;
  border-radius: 99px;
  padding: 2px 8px;
  flex: none;
}

.danger-text {
  color: var(--red);
}

.danger-text:hover {
  background: var(--red-soft);
}

.member-list {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: 11px;
  overflow: hidden;
}

.member-row {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 9px 11px;
  border-bottom: 1px solid var(--border);
}

.member-row:last-child {
  border-bottom: none;
}

.member-avatar {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: linear-gradient(135deg, #4cc693, #2c9d6e);
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
}

.member-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.member-name {
  font-size: 12.5px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.member-email {
  font-size: 11px;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.you {
  font-size: 10px;
  color: var(--green-dark);
  background: var(--green-soft);
  border-radius: 4px;
  padding: 0 4px;
  margin-left: 3px;
}

.member-role {
  font-size: 10.5px;
  color: var(--muted);
  background: #f1f3f6;
  border-radius: 99px;
  padding: 2px 7px;
  flex: none;
}

.member-role.owner {
  color: var(--green-dark);
  background: var(--green-soft);
}

.add-member {
  border: 1px solid var(--border);
  border-radius: 11px;
  padding: 11px;
  background: #fcfdfe;
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.add-member-label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-soft);
}

.add-member-row {
  display: flex;
  gap: 7px;
}

.add-member-row input {
  flex: 1;
  min-width: 0;
  border: 1px solid var(--border-strong);
  border-radius: 9px;
  padding: 7px 10px;
  font-size: 12.5px;
  outline: none;
  background: #fff;
}

.hint {
  font-size: 11px;
  color: #9aa4b2;
}

.team-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 7px;
  color: var(--muted);
  font-size: 12.5px;
  padding: 24px;
  text-align: center;
}

.empty-icon {
  width: 42px;
  height: 42px;
  border-radius: 12px;
  background: #f1f4f8;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #9aa4b2;
  margin-bottom: 2px;
}

.btn-xs {
  padding: 4px 8px;
  font-size: 11.5px;
}

@media (max-width: 720px) {
  .dialog-body {
    flex-direction: column;
  }

  .team-list {
    width: 100%;
    max-height: 180px;
    border-right: none;
    border-bottom: 1px solid var(--border);
  }
}
</style>
