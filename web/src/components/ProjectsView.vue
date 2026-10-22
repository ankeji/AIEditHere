<script setup>
import { computed } from 'vue'
import AppIcon from './AppIcon.vue'
import { fromNow, ltr } from '../lib/format.js'
import {
  store,
  openProject,
  openProjectDialog,
  removeProject,
} from '../lib/store.js'

const projects = computed(() => store.projects)

function statsOf(project) {
  const items = store.requirements.filter((item) => item.projectId === project.id)
  const done = items.filter((item) => item.status === 'done').length
  const total = items.length
  return {
    total,
    done,
    percent: total ? Math.round((done / total) * 100) : 0,
  }
}

function open(project) {
  openProject(project.id)
}

function edit(project) {
  openProjectDialog(project)
}

function remove(project) {
  if (!window.confirm(`删除项目「${project.name}」？该项目下的需求也会一并删除。`)) return
  removeProject(project.id)
}
</script>

<template>
  <div class="projects-page">
    <div class="page-head">
      <div>
        <h1>项目</h1>
        <p>每个项目对应一个本地文件夹，需求产生的代码都会写进这个文件夹里</p>
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
            <h2>{{ project.name }}</h2>
            <p class="card-path" :title="project.path">{{ ltr(project.path) }}</p>
          </div>
          <div class="card-actions" @click.stop>
            <button class="icon-btn" title="编辑项目" @click="edit(project)">
              <AppIcon name="gear" :size="14" />
            </button>
            <button class="icon-btn danger" title="删除项目" @click="remove(project)">
              <AppIcon name="trash" :size="14" />
            </button>
          </div>
        </div>

        <p v-if="project.description" class="card-desc">{{ project.description }}</p>

        <div class="card-stats">
          <span class="stat">
            <AppIcon name="list" :size="12" />
            {{ statsOf(project).total }} 个需求
          </span>
          <span class="stat">
            <AppIcon name="check" :size="12" />
            {{ statsOf(project).done }} 个已完成
          </span>
          <span class="stat time">创建于 {{ fromNow(project.createdAt) }}</span>
        </div>

        <div class="progress">
          <div class="progress-bar" :style="{ width: `${statsOf(project).percent}%` }" />
        </div>

        <div class="card-foot">
          <span class="percent">{{ statsOf(project).percent }}%</span>
          <button class="btn btn-soft btn-xs">
            <AppIcon name="play" :size="12" />
            进入项目
          </button>
        </div>
      </article>
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

.progress {
  height: 5px;
  border-radius: 99px;
  background: #eef1f5;
  overflow: hidden;
}

.progress-bar {
  height: 100%;
  border-radius: 99px;
  background: linear-gradient(90deg, #4cc693, var(--green));
  transition: width 0.35s ease;
}

.card-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.percent {
  font-size: 12px;
  color: var(--green-dark);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.hint {
  font-size: 12px;
  color: #a8b1bf;
}
</style>
