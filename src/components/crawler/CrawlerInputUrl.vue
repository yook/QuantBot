<template>
  <el-card shadow="never">
    <div class="flex">
      <el-input
        size="large"
        :disabled="project.running"
        v-model="project.data.url"
        class="site-input"
        placeholder="https://www.site.com"
        @keyup.enter.native="submitSite"
      ></el-input>
      <el-progress
        :text-inside="true"
        :stroke-width="40"
        :percentage="project.percentage"
        class="ml-3 progress-bar"
        striped
        :striped-flow="project.running"
        :duration="7"
      />
      <el-button
        v-if="!project.running"
        class="add-start ml-3"
        type="primary"
        size="large"
        :loading="project.running"
        @click="submitSite"
      >
        <el-icon class="text-2xl"><VideoPlay /></el-icon>
        <!-- {{ project.data.queue ? $t("continue") : $t("start") }} -->
        <!-- {{ $t("start") }} -->
      </el-button>

      <el-button
        v-if="project.running"
        class="ml-3"
        size="large"
        type="primary"
        @click="freezeQueue"
      >
        <el-icon class="text-2xl"><VideoPause /></el-icon>
        <!-- {{ $t("stop") }} -->
      </el-button>
    </div>
  </el-card>
</template>

<script setup>
import { ref, reactive, inject, onMounted, onUnmounted } from "vue";
import validator from "validator";
import { ElMessage } from "element-plus";
import { useI18n } from "vue-i18n";
import { CaretRight, VideoPlay, VideoPause } from "@element-plus/icons-vue";
import { useProjectStore } from "../../stores/project";

const project = useProjectStore();
const { t } = useI18n();

const dirname = ref("");

function submitSite() {
  // Проверяем, выбран ли проект
  if (!project.currentProjectId) {
    ElMessage.error("Сначала выберите проект");
    return;
  }

  // Проверяем, есть ли ID в данных проекта
  if (!project.data.id) {
    ElMessage.error("Данные проекта не загружены");
    return;
  }

  let url = project.data.url.trim();

  if (!validator.isURL(url, { require_protocol: true })) {
    url = "https://" + url;
  }

  if (!validator.isURL(url)) {
    ElMessage.error(t("crawler.isNotURL"));
  } else {
    project.startCrawlerIPC(url);
  }
}

function freezeQueue() {
  project.stopCrawlerIPC();
}
</script>

<style>
.flex {
  display: flex;
  flex-direction: row;
  flex-wrap: nowrap;
  align-items: center;
}
.el-input--large .el-input__wrapper {
  padding: 1px;
  border-color: #fafcff;
  /* border-radius: 0; */
}
.w-500 {
  width: 500px;
}

.progress-bar {
  width: 200px !important;
}

.progress-bar.el-progress {
  width: 200px !important;
  min-width: 200px !important;
  max-width: 200px !important;
}

/* Стили для темной темы */
html.dark .el-input--large .el-input__wrapper {
  border-color: var(--el-border-color);
  background-color: var(--el-bg-color);
}

/* Apply background and border color to the wrapper only - Element Plus already has border structure */
html.dark .site-input.el-input--large .el-input__wrapper {
  background-color: var(--el-bg-color) !important;
  color: var(--el-text-color-primary);
  border-color: var(--el-border-color);
}

html.dark .site-input input,
html.dark .site-input textarea {
  background-color: transparent;
  color: var(--el-text-color-primary);
  border: none;
}

html.dark .site-input .el-textarea__inner {
  background-color: var(--el-bg-color);
  color: var(--el-text-color-primary);
  border-color: var(--el-border-color);
}

/* Focus and placeholder styles should target the visible element (wrapper or textarea inner) */
html.dark .site-input.el-input--large .el-input__wrapper:focus-within {
  border-color: var(--el-color-primary);
  background-color: var(--el-bg-color) !important;
}

html.dark .site-input .el-textarea__inner::placeholder,
html.dark .site-input input::placeholder,
html.dark .site-input textarea::placeholder {
  color: var(--el-text-color-placeholder);
}

/* Ensure inner input elements don't draw their own border or shadow -- keep only wrapper border */
.site-input .el-input__wrapper .el-input__inner {
  border: none !important;
  box-shadow: none !important;
  outline: none !important;
  background: transparent !important;
}

.site-input input,
.site-input textarea {
  border: none !important;
  box-shadow: none !important;
  outline: none !important;
}

.site-input .el-textarea__inner {
  border: none !important;
  box-shadow: none !important;
  outline: none !important;
  background: transparent !important;
}

html.dark .el-card {
  background-color: var(--el-bg-color);
  border-color: var(--el-border-color);
}

/* Стили для progress bar в темной теме */
html.dark .el-progress {
  --el-progress-text-color: var(--el-text-color-primary);
}

html.dark .el-progress-bar__outer {
  background-color: var(--el-bg-color) !important;
  border: 1px solid var(--el-border-color) !important;
}

html.dark .progress-bar .el-progress-bar__outer {
  background-color: var(--el-bg-color) !important;
  border: 1px solid var(--el-border-color) !important;
}

html.dark .el-progress-bar__inner {
  background-color: #2d3748 !important;
  background-image: none !important;
}

html.dark .progress-bar .el-progress-bar__inner {
  background-color: #2d3748 !important;
  background-image: none !important;
}

html.dark .el-progress__text {
  color: var(--el-text-color-primary) !important;
}

html.dark .el-progress--line.el-progress--striped .el-progress-bar__inner {
  background-image: none !important;
  background-size: auto !important;
}

/* Исправляем скругления прогресс-бара для соответствия контуру */
.el-progress-bar__outer {
  border-radius: 6px !important;
}

.el-progress-bar__inner {
  border-radius: 5px !important;
}

/* Для темной темы тоже применяем те же скругления */
html.dark .el-progress-bar__outer {
  border-radius: 6px !important;
}

html.dark .el-progress-bar__inner {
  border-radius: 5px !important;
}
</style>
