<template>
  <div id="custom-titlebar">
    <div class="header-content">
      <el-select
        v-model="project.currentProjectId"
        class="header-select no-drag"
        :placeholder="t('header.selectProject')"
        @change="changeProject"
      >
        <el-option
          v-for="item in project.projectsList"
          :key="item.value"
          :label="item.label"
          :value="item.value"
        />
        <!-- Show message when no projects -->
        <el-option
          v-if="project.projectsList.length === 0"
          :value="null"
          :label="t('header.noProjects')"
          disabled
        />
      </el-select>

      <AddNewProject @project-created="onProjectCreated" />
    </div>

    <!-- Header action icons (theme switch, integrations) -->
    <div class="header-actions no-drag">
      <el-switch
        class="header-theme-toggle"
        size="large"
        v-model="isLight"
        :active-action-icon="Sunny"
        :inactive-action-icon="Moon"
        @change="toggleTheme"
      />
      <el-button
        class="header-action-button"
        circle
        @click="openIntegrations"
        title="Интеграции"
      >
        <el-icon><Connection /></el-icon>
      </el-button>
    </div>
  </div>
</template>

<script setup>
import { useProjectStore } from "../stores/project";
import { onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { Sunny, Moon, Connection } from "@element-plus/icons-vue";
import AddNewProject from "./AddNewProject.vue";
// import { useI18n } from "vue3-i18n";

// import { ref, onMounted } from "vue";
// import { Sunny, Moon, Connection } from "@element-plus/icons-vue";
// import NewProject from "../addProject/NewProject.vue";

const project = useProjectStore();
const { t } = useI18n();

// Theme handling and initial data load
const isLight = ref(!document.documentElement.classList.contains("dark"));
onMounted(() => {
  const savedTheme = localStorage.getItem("theme") || "light";
  const html = document.documentElement;
  if (savedTheme === "dark") {
    html.classList.add("dark");
  } else {
    html.classList.remove("dark");
  }
  isLight.value = !html.classList.contains("dark");
  // Ensure socket listeners are registered once per app session
  // Moved to App.vue to avoid multiple calls during HMR
  // project.socketOn();
  // Initial projects load happens in App.vue via project.socketOn()
});

function toggleTheme(value) {
  const desiredLight = typeof value === "boolean" ? value : !isLight.value;
  const html = document.documentElement;
  if (desiredLight) {
    html.classList.remove("dark");
  } else {
    html.classList.add("dark");
  }
  isLight.value = !html.classList.contains("dark");
  localStorage.setItem("theme", isLight.value ? "light" : "dark");
}

function changeProject(id) {
  project.changeProject(id);
}

function onProjectCreated() {
  // Close dialog and refresh projects list
  project.getProjects();
}

function openIntegrations() {
  project.activePage = "integrations";
}
</script>

<style>
#custom-titlebar {
  position: absolute;
  width: 100%;
  -webkit-app-region: drag;
  height: 55px;
  background-color: #ffffff;
  border-bottom: 1px solid #e5e7eb;
}

.header-content {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 12px;
  padding: 0 16px 0 81px; /* left padding = 65px menu + 16px gap */
  height: 100%;
}

.header-select {
  width: 300px !important; /* fixed visual width */
  flex: 0 0 300px; /* prevent flex-grow/shrink */
  max-width: 300px;
}

/* Normalize Select wrapper height and center content */
.header-select .el-select__wrapper {
  width: 100% !important; /* fill the header-select width */
  height: 32px;
  display: inline-flex;
  align-items: center;
}

/* Ensure Add button aligns vertically with select */
.add-project-btn {
  height: 32px;
  display: inline-flex;
  align-items: center;
}

.add-project-btn {
  height: 32px;
  font-size: 14px;
}

.no-drag {
  -webkit-app-region: no-drag;
}

/* Стили для темной темы */
html.dark #custom-titlebar {
  background-color: var(--el-bg-color-page) !important;
  border-bottom: 1px solid var(--el-border-color) !important;
}

html.dark .header-select .el-select__wrapper {
  background-color: #1a1f28 !important;
  border-color: #3a4555 !important;
  color: var(--el-text-color-primary) !important;
}

html.dark .header-select .el-select__wrapper:hover {
  border-color: #4a5565 !important;
  background-color: #1f2530 !important;
}

html.dark .header-select .el-select__wrapper.is-focused {
  border-color: var(--el-color-primary) !important;
  box-shadow: 0 0 0 2px var(--el-color-primary-light-8) !important;
}

html.dark .header-select .el-input__inner {
  color: var(--el-text-color-primary) !important;
  background-color: transparent !important;
}

html.dark .header-select .el-input__inner::placeholder {
  color: var(--el-text-color-placeholder) !important;
}

/* Extra dark theme adjustments for header visuals */
html.dark #custom-titlebar,
html.dark #custom-titlebar .header-content,
html.dark #custom-titlebar .header-actions {
  color: var(--el-text-color-primary) !important;
}

html.dark .header-actions .el-switch .el-switch__core {
  background-color: #1a1f28 !important;
  border-color: #3a4555 !important;
}

html.dark .header-actions .el-switch.is-checked .el-switch__core {
  background-color: var(--el-color-primary) !important;
}

html.dark .header-actions .el-switch .el-switch__action {
  background-color: #ffffff !important;
}

/* Dark theme button styles */
html.dark .add-project-btn {
  background-color: #1a1f28 !important;
  border-color: #3a4555 !important;
  color: var(--el-text-color-primary) !important;
}

html.dark .add-project-btn:hover {
  background-color: #1f2530 !important;
  border-color: #4a5565 !important;
}

html.dark .add-project-btn:active,
html.dark .add-project-btn:focus {
  background-color: #252b38 !important;
  border-color: var(--el-color-primary) !important;
}

/* Header actions container (right-aligned icons) */
.header-actions {
  position: absolute;
  right: 16px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  gap: 12px; /* spacing between icons */
}

/* Individual controls inside header-actions should not be draggable */
.header-actions.no-drag {
  -webkit-app-region: no-drag;
}

/* header-theme-toggle uses container positioning (no standalone rules) */

.header-action-button {
  /* small visual tweaks for header buttons if needed */
  padding: 6px;
}

/* Light theme: make the header theme switch gray */
html:not(.dark) .header-actions .el-switch {
  /* Set gray tones for on/off colors in light mode */
  --el-switch-on-color: #cfd3dc; /* light gray when ON (light theme active) */
  --el-switch-off-color: #e5e7eb; /* pale gray when OFF */
}

html:not(.dark) .header-actions .el-switch .el-switch__core {
  background-color: var(--el-switch-off-color) !important;
  border-color: #dcdfe6 !important;
}

html:not(.dark) .header-actions .el-switch.is-checked .el-switch__core {
  background-color: var(--el-switch-on-color) !important;
  border-color: #cfd3dc !important;
}
</style>
