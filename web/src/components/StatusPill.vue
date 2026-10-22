<script setup>
const props = defineProps({
  status: { type: String, default: 'pending' },
})

const LABELS = {
  pending: '待拆解',
  splitting: '拆解中',
  split: '待执行',
  running: '执行中',
  done: '已完成',
  failed: '失败',
}
</script>

<template>
  <span class="pill" :class="`pill-${props.status}`">
    <span class="dot" />
    {{ LABELS[props.status] || props.status }}
  </span>
</template>
