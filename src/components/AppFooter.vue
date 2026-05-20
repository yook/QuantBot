<template>
  <el-footer class="app-footer" :style="footerStyle"> </el-footer>
</template>

<script setup>
import { computed } from "vue";
import { useProjectStore } from "../stores/project";
import { useI18n } from "vue-i18n";

const props = defineProps({
  sidebarWidth: {
    type: Number,
    default: 220,
  },
});

const project = useProjectStore();
const { t } = useI18n();

const footerStyle = computed(() => ({
  left: `${props.sidebarWidth}px`,
}));

function clearCache() {
  try {
    project.clearEmbeddingsCache();
  } catch (e) {
    console.warn("Failed to clear cache", e);
  }
}
</script>

<style>
.el-footer {
  background-color: var(--el-bg-color);
  color: var(--el-text-color-primary);
  border-top: 1px solid var(--el-border-color);
}

.app-footer {
  padding: 0 12px;
  height: 25px !important; /* enforce height over component defaults */
  min-height: 20px;
  line-height: 20px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  position: fixed;
  right: 0;
  bottom: 0;
  z-index: 2000; /* above aside/menu */
  transition: left 0.28s ease;
  background-color: var(--el-bg-color);
  color: var(--el-text-color-primary);
  border-top: 1px solid var(--el-border-color);
}

/* Стили для кликабельного поля "Очистить кэш" */
.clear-cache-link {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: var(--el-text-color-regular);
  transition: background-color 0.2s;
  font-size: 12px;
}

.clear-cache-link:hover {
  background-color: var(--el-fill-color-light);
}
</style>
