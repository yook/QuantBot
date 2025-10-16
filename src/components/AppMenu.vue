<template>
  <div class="menu-container">
    <el-menu
      :active-text-color="isDark ? '#ffd04b' : '#ffd04b'"
      :background-color="isDark ? 'var(--el-bg-color)' : '#545c64'"
      :text-color="isDark ? '#64748b' : '#fff'"
      :default-active="project.activePage"
      collapse
      class="el-menu"
      @select="handleMenuSelect"
    >
      <el-menu-item index="1">
        <!-- <el-icon><Cpu /></el-icon> -->
        <el-icon><MagicStick /></el-icon>
        <template #title>{{ $t("menu.crawling") }}</template>
      </el-menu-item>

      <el-menu-item index="2">
        <el-icon><PriceTag /></el-icon>
        <template #title>{{ $t("menu.keywords") }}</template>
      </el-menu-item>
      <!-- <el-menu-item index="3">
        <el-icon><Grid /></el-icon>
        <template #title>{{ $t("menu.virtualTable") }}</template>
      </el-menu-item>
      <el-menu-item index="4" disabled>
        <el-icon><Document /></el-icon>
        <template #title>Navigator Four</template>
      </el-menu-item> -->
      <el-menu-item index="5">
        <el-icon><Setting /></el-icon>
        <template #title>{{ $t("menu.settings") }}</template>
      </el-menu-item>
    </el-menu>

    <!-- theme toggle moved to header -->
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from "vue";
import {
  Document,
  Menu as IconMenu,
  Location,
  Cpu,
  Setting,
  MagicStick,
  PriceTag,
  Sunny,
  Moon,
  Grid,
} from "@element-plus/icons-vue";
import { useProjectStore } from "../stores/project";

const project = useProjectStore();

// Определение темной темы с реактивностью
const isDark = ref(document.documentElement.classList.contains("dark"));

// Отслеживание изменений темы
const observer = new MutationObserver(() => {
  isDark.value = document.documentElement.classList.contains("dark");
});

onMounted(() => {
  // Инициализация темы из localStorage при загрузке
  const savedTheme = localStorage.getItem("theme") || "light";
  if (
    savedTheme === "dark" &&
    !document.documentElement.classList.contains("dark")
  ) {
    document.documentElement.classList.add("dark");
  } else if (
    savedTheme === "light" &&
    document.documentElement.classList.contains("dark")
  ) {
    document.documentElement.classList.remove("dark");
  }

  // Обновляем реактивную переменную
  isDark.value = document.documentElement.classList.contains("dark");

  // Восстанавливаем активный элемент меню из localStorage
  const savedMenuItem = localStorage.getItem("activeMenuItem");
  if (savedMenuItem) {
    project.activePage = savedMenuItem;
  }

  // Настраиваем наблюдатель за изменениями темы
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
});

onUnmounted(() => {
  observer.disconnect();
});

const handleMenuSelect = (index) => {
  project.activePage = index;
  // Сохраняем выбранный элемент меню в localStorage
  localStorage.setItem("activeMenuItem", index);
};

// theme toggling is handled in header component
</script>

<style>
.menu-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.el-menu {
  border-right: 1px solid var(--el-border-color);
  min-width: 65px;
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* Стили для темной темы */
html.dark .el-menu {
  border-right: 1px solid var(--el-border-color) !important;
}

html.dark .el-menu-item {
  color: #64748b !important;
}

html.dark .el-menu-item:hover {
  background-color: rgba(30, 41, 59, 0.3) !important;
  color: #94a3b8 !important;
}

html.dark .el-menu-item.is-active {
  background-color: transparent !important;
  color: #ffd04b !important;
  border-left: none !important;
  box-shadow: none !important;
}

html.dark .el-menu-item .el-icon {
  color: #475569 !important;
}

html.dark .el-menu-item:hover .el-icon {
  color: #94a3b8 !important;
}

html.dark .el-menu-item.is-active .el-icon {
  color: #ffd04b !important;
}

html.dark .el-menu-item.is-disabled {
  color: var(--el-text-color-disabled) !important;
}

html.dark .el-menu-item.is-disabled .el-icon {
  color: var(--el-text-color-disabled) !important;
}

/* Стили для подсказок (tooltips) меню в темной теме */
html.dark .el-tooltip__popper {
  background-color: #1f2937 !important;
  border: 1px solid #374151 !important;
}

html.dark .el-tooltip__popper .el-tooltip__arrow::before {
  background-color: #1f2937 !important;
  border: 1px solid #374151 !important;
}

html.dark
  .el-tooltip__popper[data-popper-placement^="right"]
  .el-tooltip__arrow::before {
  border-left-color: transparent !important;
  border-top-color: transparent !important;
}

html.dark .el-tooltip__popper .el-popper__arrow {
  border-right-color: #1f2937 !important;
}

html.dark .el-tooltip__popper {
  color: #e5e7eb !important;
}

/* Оставляем черные подсказки для .el-popper.is-dark в темной теме */
html.dark .el-popper.is-dark {
  background-color: #303133 !important;
  color: #e4e7ed !important;
  border-color: #303133 !important;
}

html.dark .el-popper.is-dark .el-popper__arrow::before {
  background-color: #303133 !important;
  border-color: #303133 !important;
}

/* Стили для переключателя темы вне меню */
.theme-toggle-standalone {
  width: 65px;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: #fff;
  border-right: 1px solid #545c64;
  background-color: #545c64;
  margin-top: auto;
  user-select: none;
}

.theme-toggle-standalone .el-icon {
  color: #fff;
  font-size: 18px;
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 0.3s ease;
}

.theme-toggle-standalone:hover .el-icon {
  color: #ffd04b;
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

/* Стили для темной темы */
html.dark .theme-toggle-standalone {
  color: #64748b;
  border-right: 1px solid var(--el-border-color);
  background-color: var(--el-bg-color);
}

html.dark .theme-toggle-standalone .el-icon {
  color: #64748b;
  font-size: 18px;
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 0.3s ease;
}

html.dark .theme-toggle-standalone:hover .el-icon {
  color: #ffd04b;
}
</style>
