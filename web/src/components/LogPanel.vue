<script setup>
import { nextTick, ref, watch } from 'vue'

const props = defineProps({
  logs: { type: Array, default: () => [] },
  version: { type: Number, default: 0 },
  live: { type: Boolean, default: false },
  maxHeight: { type: Number, default: 170 },
  minHeight: { type: Number, default: 0 },
})

const box = ref(null)

async function scrollToBottom() {
  await nextTick()
  if (box.value) box.value.scrollTop = box.value.scrollHeight
}

watch(
  () => [props.version, props.logs.length, props.logs[props.logs.length - 1]?.text?.length],
  () => {
    if (props.live) scrollToBottom()
  },
)

watch(
  () => props.logs.length,
  () => scrollToBottom(),
  { immediate: true },
)
</script>

<template>
  <div
    ref="box"
    class="log-box"
    :style="{
      maxHeight: `${props.maxHeight}px`,
      minHeight: props.minHeight ? `${props.minHeight}px` : 'auto',
    }"
  >
    <template v-if="props.logs.length">
      <div
        v-for="(entry, index) in props.logs"
        :key="index"
        class="log-entry"
        :class="`log-${entry.level}`"
      >{{ entry.text }}</div>
    </template>
    <div v-else class="log-placeholder">等待输出…</div>
  </div>
</template>

<style scoped>
.log-box {
  background: #10161f;
  border-radius: 9px;
  padding: 9px 11px;
  overflow-y: auto;
  font-family: 'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace;
  font-size: 11.5px;
  line-height: 1.65;
  color: #c6d2e1;
  white-space: pre-wrap;
  word-break: break-word;
}

.log-entry {
  white-space: pre-wrap;
  word-break: break-word;
}

.log-out {
  color: #c6d2e1;
}

.log-tool {
  color: #7dd3fc;
}

.log-sys {
  color: #86efac;
}

.log-ok {
  color: #4ade80;
  font-weight: 600;
}

.log-err {
  color: #fca5a5;
}

.log-placeholder {
  color: #5b6878;
}
</style>
