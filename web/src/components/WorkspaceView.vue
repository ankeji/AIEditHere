<script setup>
import RequirementColumn from './RequirementColumn.vue'
import TaskColumn from './TaskColumn.vue'
import DoneColumn from './DoneColumn.vue'
</script>

<template>
  <main class="columns">
    <RequirementColumn />
    <TaskColumn />
    <DoneColumn />
  </main>
</template>

<style scoped>
.columns {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(300px, 360px) minmax(0, 1.15fr) minmax(0, 1fr);
  gap: 16px;
  padding: 16px 20px 20px;
}

@media (max-width: 1000px) {
  .columns {
    grid-template-columns: 1fr;
    overflow-y: auto;
  }

  .columns > :deep(.panel) {
    min-height: 380px;
  }
}
</style>
