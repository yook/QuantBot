<template>
  <div class="menu-container">
    <div class="menu-top-actions" :class="{ 'is-collapsed': props.isCollapse }">
      <el-button
        class="sidebar-toggle-btn"
        text
        @click="emit('toggle-collapse')"
      >
        <i-tabler-layout-sidebar class="sidebar-toggle-icon" />
      </el-button>
    </div>

    <el-menu
      :collapse="props.isCollapse"
      :collapse-transition="true"
      :default-active="project.activePage"
      class="el-menu"
      @open="handleOpen"
      @close="handleClose"
      @select="handleMenuSelect"
    >
      <el-menu-item index="1">
        <span class="menu-item-icon" aria-hidden="true">
          <i-tabler-scan class="menu-icon" />
        </span>
        <template #title>
          <span>{{ $t("menu.crawling") }}</span>
        </template>
      </el-menu-item>
      <el-menu-item index="3">
        <span class="menu-item-icon" aria-hidden="true">
          <i-tabler-brackets class="menu-icon" />
        </span>
        <template #title>
          <span>{{ $t("menu.parsing") }}</span>
        </template>
      </el-menu-item>
      <el-menu-item index="2">
        <span class="menu-item-icon" aria-hidden="true">
          <i-tabler-settings class="menu-icon" />
        </span>
        <template #title>
          <span>{{ $t("menu.settings") }}</span>
        </template>
      </el-menu-item>
    </el-menu>

    <div class="menu-version" :class="{ 'is-collapsed': props.isCollapse }">
      <span class="menu-version-label">v{{ appVersion }}</span>
      <el-button
        v-if="updateReady"
        class="menu-update-btn"
        size="small"
        type="primary"
        @click="applyUpdate"
      >
        <i-tabler-refresh class="menu-update-icon" />
        <span class="menu-update-text">Обновить</span>
      </el-button>
    </div>
    <!-- theme toggle moved to header -->
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { useProjectStore } from "../stores/project";
import pkg from "../../package.json";

const props = defineProps<{ isCollapse: boolean }>();
const emit = defineEmits<{ (e: "toggle-collapse"): void }>();

const project = useProjectStore();
const appVersion = pkg && (pkg as any).version ? (pkg as any).version : "0.0.0";
const updateReady = ref(false);
let autoUpdaterHandler: any = null;

const handleMenuSelect = (index: string) => {
  project.activePage = index;
  localStorage.setItem("activeMenuItem", index);
};

const handleOpen = (key: string, keyPath: string[]) => {
  console.log(key, keyPath);
};

const handleClose = (key: string, keyPath: string[]) => {
  console.log(key, keyPath);
};

function applyUpdate() {
  try {
    const ipc = (window as any).ipcRenderer;
    if (ipc && typeof ipc.send === "function") {
      console.log("[Updater] click: quit-and-install");
      ipc.send("auto-updater-quit-and-install");
    }
  } catch (_) {}
}

onMounted(() => {
  // Восстанавливаем активный элемент меню из localStorage
  const savedMenuItem = localStorage.getItem("activeMenuItem");
  if (savedMenuItem === "1" || savedMenuItem === "2" || savedMenuItem === "3") {
    project.activePage = savedMenuItem;
  } else {
    project.activePage = "1";
    localStorage.setItem("activeMenuItem", "1");
  }

  try {
    const ipc = (window as any).ipcRenderer;
    if (ipc && typeof ipc.on === "function") {
      if (typeof ipc.invoke === "function") {
        ipc
          .invoke("auto-updater-status")
          .then((status: any) => {
            console.log("[Updater] status", status);
            if (status && status.downloaded) {
              updateReady.value = true;
            }
          })
          .catch(() => {});
      }
      autoUpdaterHandler = (_event: any, payload: any) => {
        if (!payload) return;
        console.log("[Updater] event", payload);
        if (payload.event === "update-not-available") {
          updateReady.value = false;
        }
        if (payload.event === "update-downloaded") {
          updateReady.value = true;
        }
      };
      ipc.on("auto-updater", autoUpdaterHandler);
    }
  } catch (_) {}
});

onUnmounted(() => {
  try {
    const ipc = (window as any).ipcRenderer;
    if (ipc && autoUpdaterHandler && typeof ipc.off === "function") {
      ipc.off("auto-updater", autoUpdaterHandler);
    }
  } catch (_) {}
});

// theme toggling is handled in header component
</script>

<style>
.menu-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.menu-top-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  height: 48px;
  padding: 0;
  background-color: var(--el-bg-color);
  box-sizing: border-box;
}

.menu-top-actions.is-collapsed {
  justify-content: center;
}

.sidebar-toggle-btn {
  color: var(--el-text-color-disabled) !important;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  margin: 0;
  margin-right: 6px;
  padding: 0 !important;
}

.menu-top-actions.is-collapsed .sidebar-toggle-btn {
  margin-right: 0;
}

.sidebar-toggle-icon {
  font-size: 20px;
  width: 1em !important;
  height: 1em !important;
  display: block;
  color: inherit;
  fill: currentColor;
}

.menu-icon {
  font-size: 20px;
  width: 1em !important;
  height: 1em !important;
  flex-shrink: 0;
}

.menu-item-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-right: 12px;
  flex-shrink: 0;
}

.el-menu--collapse .el-menu-item {
  display: flex;
  align-items: center;
  justify-content: center;
}

.el-menu--collapse .el-menu-item .menu-item-icon {
  margin-right: 0;
}

.el-menu--collapse .el-menu-item .menu-icon {
  margin-right: 0;
  margin-left: 0;
}

.el-menu {
  border-right: none !important;
  width: 100%;
  min-width: 100%;
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.menu-version {
  margin-top: auto;
  padding: 8px 12px;
  background-color: var(--el-bg-color);
  color: var(--el-text-color-secondary);
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
}

.menu-version.is-collapsed {
  justify-content: flex-start;
  padding-left: 12px;
  padding-right: 12px;
  flex-direction: row;
  gap: 8px;
}

.menu-version:not(.is-collapsed) .menu-update-btn {
  margin-left: auto;
}

.menu-version-label {
  white-space: nowrap;
  font-size: 11px;
  line-height: 1;
}

.menu-update-btn.el-button {
  height: 20px;
  padding: 0 10px;
  font-size: 12px;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.menu-update-icon {
  font-size: 14px;
}

.menu-version.is-collapsed .menu-update-btn {
  width: 26px;
  height: 26px;
  padding: 0;
  border-radius: 8px;
  justify-content: center;
}

.menu-version.is-collapsed .menu-update-text {
  display: none;
}

/* Стили для переключателя темы вне меню */
.theme-toggle-standalone {
  width: 65px;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: var(--el-text-color-regular);
  border-right: 1px solid var(--el-border-color);
  background-color: var(--el-bg-color);
  margin-top: auto;
  user-select: none;
}

.theme-toggle-standalone .el-icon {
  color: inherit;
  font-size: 18px;
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 0.3s ease;
}

.theme-toggle-standalone:hover .el-icon {
  color: var(--el-color-primary);
}

.theme-toggle-title {
  font-size: 14px;
  opacity: 0;
  width: 0;
  overflow: hidden;
  white-space: nowrap;
}

/* Показываем текст при развертывании меню */
.menu-container:has(.el-menu:not(.el-menu--collapse)) .theme-toggle-standalone {
  width: auto;
  padding: 0 20px;
  justify-content: flex-start;
  gap: 8px;
}

.menu-container:has(.el-menu:not(.el-menu--collapse))
  .theme-toggle-standalone
  .el-icon {
  margin-right: 0;
}

.menu-container:has(.el-menu:not(.el-menu--collapse))
  .theme-toggle-standalone
  .theme-toggle-title {
  opacity: 1;
  width: auto;
  margin-left: 0;
}
</style>
