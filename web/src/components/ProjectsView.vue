<script setup>
import { computed, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import { fromNow, ltr } from '../lib/format.js'
import {
  store,
  openProject,
  openProjectDialog,
  openDeployDialog,
  openAccessDialog,
  removeProject,
  inspectPath,
  pushToast,
} from '../lib/store.js'

const projects = computed(() => store.projects)
const missing = ref(null)
const checking = ref(null)

async function open(project) {
  if (checking.value) return
  checking.value = project.id
  try {
    const info = await inspectPath(project.path)
    if (info?.exists && info?.isDir) {
      openProject(project.id)
    } else {
      missing.value = project
    }
  } catch (err) {
    pushToast(err.message || '无法检查项目目录', 'error')
  } finally {
    checking.value = null
  }
}

function fixMissing() {
  const project = missing.value
  missing.value = null
  if (project) openProjectDialog(project)
}

function enterAnyway() {
  const project = missing.value
  missing.value = null
  if (project) openProject(project.id)
}

function edit(project) {
  openProjectDialog(project)
}

function typeLabel(project) {
  return project.type === 'frontend' ? '前端' : '后端'
}

function pathLabel(project) {
  return ltr(project.path)
}

function createdLabel(project) {
  return fromNow(project.createdAt)
}

function deploy(project) {
  openDeployDialog(project)
}

function share(project) {
  openAccessDialog(project)
}

function remove(project) {
  if (!window.confirm(`删除项目「${project.name}」？`)) return
  removeProject(project.id)
}
</script>

<template>
  <div class="projects-page">
    <div class="page-head">
      <div>
        <h1>项目</h1>
        <p>每个项目对应一个本地文件夹，代码、预览和部署都在这里管理</p>
      </div>
      <button class="btn btn-primary" @click="openProjectDialog(null)">
        <AppIcon name="plus" :size="15" />
        新建项目
      </button>
    </div>

    <div v-if="!projects.length" class="empty">
      <div class="empty-icon"><AppIcon name="folder" :size="22" /></div>
      <div>
        还没有项目
        <br />
        <span class="hint">创建项目时填写本地文件夹位置，opencode 就会在这个目录里干活</span>
      </div>
      <button class="btn btn-primary btn-sm" @click="openProjectDialog(null)">
        <AppIcon name="plus" :size="14" />
        新建第一个项目
      </button>
    </div>

    <div v-else class="project-grid">
      <article
        v-for="project in projects"
        :key="project.id"
        class="project-card"
        @click="open(project)"
      >
        <div class="card-head">
          <span class="card-icon"><AppIcon name="folder" :size="16" /></span>
          <div class="card-title">
            <div class="title-row">
              <h2>{{ project.name }}</h2>
              <span v-if="!project.isOwner" class="share-badge">共享给我</span>
              <span class="type-badge" :class="project.type || 'backend'">
                {{ typeLabel(project) }}
              </span>
            </div>
            <p class="card-path" :title="project.path">{{ pathLabel(project) }}</p>
          </div>
          <div class="card-actions" @click.stop>
            <template v-if="project.isOwner">
              <button class="icon-btn" title="可见范围" @click="share(project)">
                <AppIcon name="share" :size="14" />
              </button>
              <button class="icon-btn" title="部署上线" @click="deploy(project)">
                <AppIcon name="upload" :size="14" />
              </button>
              <button class="icon-btn" title="编辑项目" @click="edit(project)">
                <AppIcon name="gear" :size="14" />
              </button>
              <button class="icon-btn danger" title="删除项目" @click="remove(project)">
                <AppIcon name="trash" :size="14" />
              </button>
            </template>
          </div>
        </div>

        <p class="card-desc">{{ project.description || '暂无描述' }}</p>

        <div class="card-stats">
          <span class="stat">
            <AppIcon name="folder" :size="12" />
            {{ typeLabel(project) }}项目
          </span>
          <span v-if="project.previewUrl" class="stat cmd" :title="project.previewUrl">
            <AppIcon name="globe" :size="12" />
            {{ project.previewUrl }}
          </span>
          <span class="stat time">创建于 {{ createdLabel(project) }}</span>
        </div>

        <div class="card-foot">
          <span class="foot-note">{{ project.isOwner ? '我的项目' : '共享给我' }}</span>
          <button class="btn btn-soft btn-xs">
            <AppIcon :name="project.type === 'frontend' ? 'globe' : 'folder'" :size="12" />
            打开项目
          </button>
        </div>
      </article>
    </div>

    <div v-if="missing" class="overlay" @click.self="missing = null">
      <div class="warn-dialog">
        <div class="warn-icon"><AppIcon name="alert" :size="20" /></div>
        <h2>本地项目目录不存在</h2>
        <p class="warn-lead">
          项目「{{ missing.name }}」指向的本地目录不存在，可能是还没有把远程仓库下载到本地。
        </p>
        <div class="warn-path">{{ missing.path }}</div>
        <p class="warn-tip">
          请先把项目 <code>git clone</code> 到本地，或重新选择一个正确的项目文件夹后再进入。
        </p>
        <div class="warn-actions">
          <button class="btn btn-ghost" @click="missing = null">取消</button>
          <button class="btn btn-soft" @click="enterAnyway">仍然进入</button>
          <button class="btn btn-primary" @click="fixMissing">
            <AppIcon name="folder" :size="14" />
            重新选择目录
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.projects-page {
  height: 100%;
  overflow-y: auto;
  padding: 22px 24px 28px;
}

.page-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
}

.page-head h1 {
  font-size: 20px;
  font-weight: 700;
  letter-spacing: 0.2px;
}

.page-head p {
  margin-top: 4px;
  font-size: 13px;
  color: var(--muted);
}

.project-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px;
}

.project-card {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 14px;
  box-shadow: var(--shadow-panel);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 10px;
  transition: border-color 0.16s ease, transform 0.16s ease, box-shadow 0.16s ease;
}

.project-card:hover {
  border-color: var(--green);
  transform: translateY(-2px);
  box-shadow: 0 2px 4px rgba(23, 32, 43, 0.05), 0 20px 40px -26px rgba(44, 157, 110, 0.5);
}

.card-head {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.card-icon {
  width: 32px;
  height: 32px;
  border-radius: 9px;
  background: var(--green-soft);
  color: var(--green-dark);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
}

.card-title {
  min-width: 0;
  flex: 1;
}

.card-title h2 {
  font-size: 14.5px;
  font-weight: 650;
  line-height: 1.4;
  word-break: break-word;
}

.title-row {
  display: flex;
  align-items: baseline;
  gap: 7px;
  min-width: 0;
}

.title-row h2 {
  min-width: 0;
}

.type-badge {
  flex: none;
  font-size: 10.5px;
  font-weight: 700;
  border-radius: 5px;
  padding: 1px 6px;
  letter-spacing: 0.2px;
}

.share-badge {
  flex: none;
  font-size: 10.5px;
  font-weight: 700;
  border-radius: 5px;
  padding: 1px 6px;
  color: #8a5b12;
  background: #fff7ea;
}

.type-badge.frontend {
  color: var(--green-dark);
  background: var(--green-soft);
}

.type-badge.backend {
  color: #3a5a86;
  background: var(--blue-soft);
}

.stat.cmd {
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.card-path {
  margin-top: 2px;
  font-size: 11.5px;
  color: var(--muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  direction: rtl;
  text-align: left;
}

.card-actions {
  display: flex;
  gap: 2px;
  flex: none;
}

.card-desc {
  font-size: 12.5px;
  color: var(--text-soft);
  line-height: 1.55;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.card-stats {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  font-size: 11.5px;
  color: var(--muted);
}

.stat {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.stat.time {
  margin-left: auto;
}

.card-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.foot-note {
  font-size: 11.5px;
  color: var(--muted);
}

.hint {
  font-size: 12px;
  color: #a8b1bf;
}

.overlay {
  position: fixed;
  inset: 0;
  background: rgba(18, 26, 36, 0.42);
  backdrop-filter: blur(3px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  z-index: 70;
}

.warn-dialog {
  width: 440px;
  max-width: 100%;
  background: #fff;
  border-radius: 16px;
  padding: 22px;
  box-shadow: 0 30px 80px -20px rgba(15, 23, 32, 0.5);
  text-align: center;
}

.warn-icon {
  width: 46px;
  height: 46px;
  margin: 0 auto 12px;
  border-radius: 13px;
  background: #fff7ea;
  color: #c07f1a;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.warn-dialog h2 {
  font-size: 16px;
  font-weight: 700;
}

.warn-lead {
  margin-top: 8px;
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--text-soft);
}

.warn-path {
  margin: 12px 0;
  padding: 9px 11px;
  border-radius: 9px;
  background: #f6f8fa;
  border: 1px solid var(--border);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  color: var(--text-soft);
  word-break: break-all;
  direction: rtl;
  text-align: left;
}

.warn-tip {
  font-size: 12px;
  line-height: 1.6;
  color: var(--muted);
}

.warn-tip code {
  background: #eef1f5;
  border-radius: 5px;
  padding: 0 5px;
  font-size: 11.5px;
}

.warn-actions {
  display: flex;
  justify-content: center;
  gap: 9px;
  margin-top: 18px;
}
</style>
