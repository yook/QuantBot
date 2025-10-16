<template>
  <el-footer class="app-footer"> </el-footer>
</template>

<script setup>
import { useProjectStore } from "../stores/project";
import { useI18n } from "vue-i18n";

const project = useProjectStore();
const { t } = useI18n();

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
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 1200; /* above aside/menu */
}

/* Стили для progress bar в темной теме */
html.dark .el-progress {
  --el-progress-text-color: var(--el-text-color-primary);
}

html.dark .el-progress-bar__outer {
  background-color: var(--el-fill-color-darker) !important;
  border: 1px solid var(--el-border-color) !important;
}

html.dark .el-progress-bar__inner {
  background-color: var(--el-color-primary) !important;
  background-image: none !important;
}

html.dark .el-progress__text {
  color: var(--el-text-color-primary) !important;
}

html.dark .el-footer {
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
  color: #606266;
  transition: background-color 0.2s;
  font-size: 12px;
}

.clear-cache-link:hover {
  background-color: #f0f2f5;
}

/* Темная тема для поля */
html.dark .clear-cache-link {
  color: #d1d5db;
}

html.dark .clear-cache-link:hover {
  background-color: #374151;
}
</style>
