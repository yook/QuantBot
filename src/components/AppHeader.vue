<template>
  <div id="custom-titlebar" :style="titlebarStyle">
    <div class="head-content">
      <ProjectSelectorDropdown @create-project="openCreateProjectDialog" />
      <AddNewProject
        ref="addProjectRef"
        :show-trigger="false"
        @project-created="onProjectCreated"
      />
    </div>

    <!-- Header action icons (theme switch) -->
    <div class="header-actions no-drag">
      <el-button class="theme-toggle-btn" circle @click="toggleTheme()">
        <i-tabler-sun v-if="isLight" />
        <i-tabler-moon v-else />
      </el-button>
      <el-button
        class="plan-badge"
        type="primary"
        plain
        round
        size="small"
        @click="onPlanBadgeClick"
      >
        {{ planLabel }}
      </el-button>
    </div>

    <el-dialog
      v-model="proDialogVisible"
      width="820px"
      align-center
      :show-close="true"
      class="pro-offer-dialog"
    >
      <div class="plans-grid">
        <div class="free-offer-wrap plan-card">
          <h1 class="free-offer-title">Free</h1>
          <p class="free-offer-subtitle">
            Подходит для знакомства с продуктом и работы с небольшими проектами.
          </p>

          <h1 class="free-offer-price">
            <span class="free-offer-price-value">0</span>
            <span class="free-offer-price-unit">руб</span>
          </h1>

          <ul class="free-offer-list">
            <li><span class="check-icon" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m5 12l5 5L20 7"/></svg></span>До 3 проектов</li>
            <li><span class="check-icon" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m5 12l5 5L20 7"/></svg></span>До 1 000 URL на проект</li>
            <li><span class="check-icon" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m5 12l5 5L20 7"/></svg></span>Экспорт XLS до 1 000 строк</li>
            <li><span class="check-icon" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m5 12l5 5L20 7"/></svg></span>Параллельность: 1 поток</li>
            <li><span class="check-icon" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m5 12l5 5L20 7"/></svg></span>Интервал между запросами от 1000 мс</li>
          </ul>

        </div>

        <div class="pro-offer-wrap plan-card">
          <h1 class="pro-offer-title">Pro</h1>
          <p class="pro-offer-subtitle">
            Для регулярной работы с крупными сайтами и расширенными возможностями приложения.
          </p>

          <h1 class="pro-offer-price">
            <span class="pro-offer-price-value">1800</span>
            <span class="pro-offer-price-unit">руб / год</span>
          </h1>

          <ul class="pro-offer-list">
            <li><span class="check-icon" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m5 12l5 5L20 7"/></svg></span>Нет ограничений по количеству проектов</li>
            <li><span class="check-icon" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m5 12l5 5L20 7"/></svg></span>Нет ограничений по URL на проект</li>
            <li><span class="check-icon" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m5 12l5 5L20 7"/></svg></span>Полный экспорт XLS</li>
            <li><span class="check-icon" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m5 12l5 5L20 7"/></svg></span>Параллельность больше 1 потока</li>
            <li><span class="check-icon" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m5 12l5 5L20 7"/></svg></span>Нет ограничений по интервалу между запросами</li>
            <li><span class="check-icon" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m5 12l5 5L20 7"/></svg></span>Рендеринг страниц через Chromium</li>
          </ul>

          <a
            class="pro-offer-cta"
            :href="proUrl"
            target="_blank"
            rel="noopener noreferrer"
          >
            Перейти на Pro
          </a>
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup>
import { useProjectStore } from "../stores/project";
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import ProjectSelectorDropdown from "./ProjectSelectorDropdown.vue";
import AddNewProject from "./AddNewProject.vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { ACTIVE_PLAN } from "../config/plan-limits";
// import { useI18n } from "vue3-i18n";

// import { ref, onMounted } from "vue";
// import { Sunny, Moon, Connection } from "@element-plus/icons-vue";
// import NewProject from "../addProject/NewProject.vue";

const project = useProjectStore();
const props = defineProps({
  sidebarWidth: {
    type: Number,
    default: 220,
  },
});
const { t } = useI18n();
const updateReady = ref(false);
const updateDownloading = ref(false);
const updateInfo = ref(null);
let autoUpdaterHandler = null;
let updatePromptShown = false;
let installPromptShown = false;
const addProjectRef = ref(null);
const planLabel = computed(() => (String(ACTIVE_PLAN).toLowerCase() === "pro" ? "Pro" : "Free"));
const proDialogVisible = ref(false);
const proUrl = (import.meta.env && import.meta.env.VITE_PRO_URL) || "https://example.com/pro";

const titlebarStyle = computed(() => ({
  left: `${props.sidebarWidth}px`,
  width: `calc(100% - ${props.sidebarWidth}px)`,
}));

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
  try {
    const ipc = window.ipcRenderer;
    if (ipc && typeof ipc.on === "function") {
      if (typeof ipc.invoke === "function") {
        ipc.invoke("auto-updater-status").then((status) => {
          if (status && status.info) {
            updateInfo.value = status.info;
          }
          if (status && status.downloaded) {
            updateReady.value = true;
            showInstallUpdateDialog(status.info);
          } else if (status && status.available) {
            showDownloadUpdateDialog(status.info);
          }
        }).catch(() => {});
      }
      autoUpdaterHandler = (_event, payload) => {
        if (!payload) return;
        if (payload.event === "update-available") {
          updateInfo.value = payload.info || null;
          showDownloadUpdateDialog(payload.info);
        }
        if (payload.event === "update-not-available") {
          updateReady.value = false;
          updateDownloading.value = false;
          updateInfo.value = null;
        }
        if (payload.event === "download-progress") {
          updateDownloading.value = true;
        }
        if (payload.event === "update-downloaded") {
          updateReady.value = true;
          updateDownloading.value = false;
          updateInfo.value = payload.info || updateInfo.value;
          showInstallUpdateDialog(payload.info);
        }
        if (payload.event === "error") {
          updateDownloading.value = false;
          updatePromptShown = false;
        }
        if (payload.event === "dev-relaunch-skipped") {
          try {
            // Avoid blank window in dev; inform user instead
            ElMessage.info("В dev-режиме перезапуск отключен, чтобы не открывалось пустое окно.");
          } catch (_) {}
        }
      };
      ipc.on("auto-updater", autoUpdaterHandler);
    }
  } catch (_) {}
});

onUnmounted(() => {
  try {
    const ipc = window.ipcRenderer;
    if (ipc && autoUpdaterHandler && typeof ipc.off === "function") {
      ipc.off("auto-updater", autoUpdaterHandler);
    }
  } catch (_) {}
});

function onProjectCreated() {
  project.getProjects();
}

function openCreateProjectDialog() {
  addProjectRef.value?.openNewProjectDialog?.();
}

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

function onPlanBadgeClick() {
  if (planLabel.value !== "Free") return;
  proDialogVisible.value = true;
}

function applyUpdate() {
  try {
    const ipc = window.ipcRenderer;
    if (ipc && typeof ipc.send === "function") {
      ipc.send("auto-updater-quit-and-install");
    }
  } catch (_) {}
}

function getUpdateVersion(info) {
  return info && info.version ? info.version : "новой версии";
}

function sendUpdaterCommand(channel) {
  try {
    const ipc = window.ipcRenderer;
    if (ipc && typeof ipc.send === "function") {
      ipc.send(channel);
    }
  } catch (_) {}
}

function showDownloadUpdateDialog(info) {
  if (updatePromptShown || updateReady.value || updateDownloading.value) return;
  updatePromptShown = true;
  const version = getUpdateVersion(info);
  ElMessageBox.confirm(
    `Доступно обновление до версии ${version}. Скачать его сейчас?`,
    "Доступно обновление",
    {
      confirmButtonText: "Скачать обновление",
      cancelButtonText: "Позже",
      type: "info",
      distinguishCancelAndClose: true,
    },
  )
    .then(() => {
      updateDownloading.value = true;
      ElMessage.info("Скачиваем обновление в фоне.");
      sendUpdaterCommand("auto-updater-download");
    })
    .catch(() => {
      updatePromptShown = false;
    });
}

function showInstallUpdateDialog(info) {
  if (installPromptShown) return;
  installPromptShown = true;
  const version = getUpdateVersion(info || updateInfo.value);
  ElMessageBox.confirm(
    `Обновление до версии ${version} скачано. Перезапустить приложение и установить его сейчас?`,
    "Обновление готово",
    {
      confirmButtonText: "Перезапустить и установить",
      cancelButtonText: "Позже",
      type: "success",
      distinguishCancelAndClose: true,
    },
  )
    .then(() => {
      applyUpdate();
    })
    .catch(() => {
      installPromptShown = false;
    });
}

</script>

<style>
#custom-titlebar {
  position: absolute;
  -webkit-app-region: drag;
  height: 48px;
  z-index: 2000;
  transition:
    left 0.28s ease,
    width 0.28s ease;
  background-color: var(--el-bg-color-page);
  border-bottom: 1px solid var(--el-border-color);
}

html:not(.dark) #custom-titlebar {
  background-color: #ffffff;
}

html.dark #custom-titlebar {
  background-color: var(--el-bg-color);
}

.head-content {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 12px;
  padding: 0 88px 0 16px;
  height: 100%;
}

/* Ensure Add button aligns vertically with select */
.add-project-btn {
  height: 24px;
  display: inline-flex;
  align-items: center;
}

.add-project-btn {
  height: 24px;
  font-size: 12px;
}

.no-drag {
  -webkit-app-region: no-drag;
}

/* Header actions container (right-aligned icons) */
.header-actions {
  position: absolute;
  right: 16px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  gap: 6px;
}

.plan-badge {
  min-width: 52px;
  height: 24px;
  padding: 0 10px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.2px;
  pointer-events: auto;
  cursor: pointer;
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

.header-update-btn {
  height: 32px;
  font-size: 12px;
  padding: 0 10px;
}

.theme-toggle-btn {
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid var(--el-border-color);
  background: var(--el-fill-color-light);
  color: var(--el-text-color-regular);
}

.theme-toggle-btn:hover {
  border-color: var(--el-border-color-hover);
  background: var(--el-fill-color);
}

:deep(.pro-offer-dialog .el-dialog) {
  border-radius: 14px;
  background: #f3f4f6;
}

:deep(.pro-offer-dialog .el-dialog__body) {
  padding: 18px;
}

.plans-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 18px;
}

.plan-card {
  border: 1px solid var(--el-border-color);
  border-radius: 14px;
  padding: 24px;
  background: #ffffff;
  --plan-gap-title-subtitle: 14px;
  --plan-gap-subtitle-price: 18px;
  --plan-gap-price-list: 20px;
  --plan-list-item-gap: 10px;
}

.pro-offer-wrap {
  text-align: center;
}

.pro-offer-title,
.free-offer-title {
  margin: 0;
}

.pro-offer-subtitle,
.free-offer-subtitle {
  margin: var(--plan-gap-title-subtitle) auto 0;
  max-width: 620px;
}

.pro-offer-price {
  display: flex;
  justify-content: center;
  align-items: baseline;
  gap: 10px;
  margin: var(--plan-gap-subtitle-price) 0 0;
}

.pro-offer-price-value {
}

.pro-offer-price-unit {
}

.pro-offer-list {
  margin: var(--plan-gap-price-list) 0 22px;
  padding: 0 0 0 26px;
  text-align: left;
  list-style: none;
}

.pro-offer-list li {
  margin: var(--plan-list-item-gap) 0;
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.free-offer-wrap {
  text-align: center;
}

.free-offer-price {
  display: flex;
  justify-content: center;
  align-items: baseline;
  gap: 8px;
  margin: var(--plan-gap-subtitle-price) 0 0;
}

.free-offer-list {
  margin: var(--plan-gap-price-list) auto 20px;
  padding: 0;
  text-align: left;
  max-width: 560px;
  list-style: none;
}

.free-offer-list li {
  margin: var(--plan-list-item-gap) 0;
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.check-icon {
  color: #1ea7ff;
  flex: 0 0 auto;
  width: 18px;
  height: 18px;
  margin-top: 2px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.check-icon svg {
  display: block;
  width: 18px;
  height: 18px;
}

@media (max-width: 1100px) {
  .plans-grid {
    grid-template-columns: 1fr;
  }
}

.pro-offer-cta {
  display: inline-flex;
  min-width: 220px;
  justify-content: center;
  align-items: center;
  height: 40px;
  padding: 0 18px;
  border-radius: 8px;
  background: #1ea7ff;
  color: #fff;
  text-decoration: none;
}
</style>
