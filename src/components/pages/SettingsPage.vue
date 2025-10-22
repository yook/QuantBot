<template>
  <el-container class="m-5">
    <el-main>
      <el-card shadow="never">
        <template #header>
          <div class="card-header">
            <h1>{{ t("settings.title") }}</h1>
          </div>
        </template>
        <div class="settings-content">
          <el-row :gutter="20">
            <el-col :span="12">
              <el-card shadow="never" class="mb-4">
                <template #header>
                  <h2>{{ t("settings.general") }}</h2>
                </template>
                <el-form label-width="150px">
                  <el-form-item
                    :label="t('settings.projectName')"
                    v-if="
                      project.projects.length > 0 && project.currentProjectId
                    "
                  >
                    <el-input v-model="localProjectName" @change="saveData" />
                  </el-form-item>

                  <el-form-item label="" v-if="project.projects.length > 0">
                    <el-button
                      @click="deleteProject"
                      :icon="Delete"
                      type="danger"
                      plain
                    >
                      {{ t("settings.deleteProject") }}
                    </el-button>
                  </el-form-item>
                </el-form>
              </el-card>
            </el-col>
            <el-col :span="12">
              <el-card shadow="never" class="mb-4">
                <template #header>
                  <h2>{{ t("settings.additional") }}</h2>
                </template>
                <div class="additional-settings">
                  <el-empty :description="t('settings.inDevelopment')" />
                </div>
              </el-card>
            </el-col>
          </el-row>
        </div>
      </el-card>
    </el-main>
  </el-container>
</template>

<script setup>
import { ref, markRaw, onMounted, watch, computed } from "vue";
import { Delete } from "@element-plus/icons-vue";
import { ElMessageBox } from "element-plus";
import { useI18n } from "vue-i18n";
import { useProjectStore } from "../../stores/project";

const { t } = useI18n();
const project = useProjectStore();

// Локальное состояние для v-model
const localProjectName = computed({
  get: () => project.currentProjectName,
  set: (value) => {
    // Обновляем имя в списке проектов
    if (project.currentProjectId) {
      const projectIndex = project.projects.findIndex(
        (p) => String(p.id) === project.currentProjectId
      );
      if (projectIndex !== -1) {
        project.projects[projectIndex].name = value;
      }
    }
  },
});

// Следим за изменением текущего проекта
watch(
  () => project.currentProjectId,
  (newId) => {
    if (newId) {
      console.log("Current project changed to:", newId);
      console.log("Project name:", project.currentProjectName);
    }
  },
  { immediate: true }
);

const saveData = () => {
  // Обновляем имя проекта в данных
  if (project.data) {
    project.data.name = localProjectName.value;
  }
  project.updateProject();
  project.refreshProjectsList(); // Обновляем только список, не меняя текущий проект
};

const deleteProject = () => {
  ElMessageBox.confirm(
    t("settings.confirmDelete"),
    t("settings.confirmDeleteTitle"),
    {
      confirmButtonText: t("settings.confirmButton"),
      cancelButtonText: t("settings.cancel"),
      type: "error",
      icon: markRaw(Delete),
      customClass: "delete-msgbox-class",
    }
  )
    .then(() => {
      project.deleteProject();
    })
    .catch(() => {
      // Пользователь отменил удаление
    });
};
</script>

<style scoped>
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.settings-content {
  min-height: 400px;
}

.mb-4 {
  margin-bottom: 1rem;
}

.additional-settings {
  min-height: 200px;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>

<style>
/* Кастомные стили для MessageBox удаления проекта */
.delete-msgbox-class {
  /* --el-messagebox-width: 400px; */
  min-width: 50%;
  padding: 30px;
}

/* Темная тема */
/* Не переопределяем --el-bg-color и --el-bg-color-page, чтобы использовать значения из style.css (#262c36) */
html.dark .settings-page {
  --el-bg-color-overlay: #1d1e1f;
  --el-text-color-primary: #e5eaf3;
  --el-text-color-regular: #cfd3dc;
  --el-text-color-secondary: #a3a6ad;
  --el-text-color-placeholder: #8d9095;
  --el-text-color-disabled: #6c6e72;
  --el-border-color: #4c4d4f;
  --el-border-color-light: #414243;
  --el-border-color-lighter: #363637;
  --el-border-color-extra-light: #2b2b2c;
  --el-border-color-dark: #58585b;
  --el-border-color-darker: #636466;
  --el-fill-color: #303133;
  --el-fill-color-light: #262727;
  --el-fill-color-lighter: #1d1d1d;
  --el-fill-color-extra-light: #191919;
  --el-fill-color-dark: #39393a;
  --el-fill-color-darker: #424243;
  --el-fill-color-blank: transparent;
  --el-box-shadow: 0px 12px 32px 4px rgba(0, 0, 0, 0.36),
    0px 8px 20px rgba(0, 0, 0, 0.72);
  --el-box-shadow-light: 0px 0px 12px rgba(0, 0, 0, 0.72);
  --el-box-shadow-lighter: 0px 0px 6px rgba(0, 0, 0, 0.72);
  --el-box-shadow-dark: 0px 16px 48px 16px rgba(0, 0, 0, 0.72),
    0px 12px 32px rgba(0, 0, 0, 0.72), 0px 8px 16px -8px rgba(0, 0, 0, 0.72);

  background-color: var(--el-bg-color-page);
  color: var(--el-text-color-primary);
}

html.dark body {
  background-color: var(--el-bg-color-page);
  color: var(--el-text-color-primary);
}

html.dark #app {
  background-color: var(--el-bg-color-page);
  color: var(--el-text-color-primary);
}

/* Карточки в темной теме */
html.dark .el-card {
  background-color: var(--el-bg-color);
  border-color: var(--el-border-color);
}

html.dark .el-card__header {
  background-color: var(--el-bg-color) !important;
  border-color: var(--el-border-color);
  color: var(--el-text-color-primary);
}

html.dark .el-card__body {
  background-color: var(--el-bg-color);
  color: var(--el-text-color-primary);
}

/* Иконки в темной теме - только для форм, кнопок и настроек */
html.dark .el-form .el-icon,
html.dark .el-button .el-icon,
html.dark .el-select .el-icon,
html.dark .el-input .el-icon,
html.dark .el-card__header .el-icon,
html.dark .el-empty .el-icon {
  color: var(--el-text-color-regular);
}

html.dark .el-button .el-icon {
  color: inherit;
}

html.dark .el-button--danger .el-icon {
  color: #f56c6c !important;
}

html.dark .el-select .el-select__caret {
  color: var(--el-text-color-secondary);
}

html.dark .el-input .el-input__icon {
  color: var(--el-text-color-secondary);
}

/* Сохраняем оригинальные цвета для иконок действий */
html.dark .el-icon.el-icon-delete,
html.dark .el-icon[class*="delete"] {
  color: #f56c6c !important;
}

html.dark .el-icon.el-icon-setting,
html.dark .el-icon[class*="setting"] {
  color: #909399 !important;
}

/* Кнопки в темной теме */
html.dark .el-button {
  background-color: var(--el-fill-color);
  border-color: var(--el-border-color);
  color: var(--el-text-color-primary);
}

html.dark .el-button:hover {
  background-color: var(--el-fill-color-dark);
  border-color: var(--el-border-color-darker);
  color: var(--el-text-color-primary);
}

html.dark .el-button--primary {
  background-color: #2d3748 !important;
  border-color: #4a5568 !important;
  color: #e2e8f0 !important;
}

html.dark .el-button--primary:hover {
  background-color: #4a5568 !important;
  border-color: #718096 !important;
  color: #f7fafc !important;
}

html.dark .el-button--primary:focus {
  background-color: #2d3748 !important;
  border-color: #718096 !important;
  color: #e2e8f0 !important;
}

html.dark .el-button--primary:active {
  background-color: #1a202c !important;
  border-color: #2d3748 !important;
  color: #e2e8f0 !important;
}

html.dark .el-button--primary .el-icon {
  color: #e2e8f0 !important;
}

html.dark .el-button--danger {
  background-color: transparent;
  border-color: #f56c6c;
  color: #f56c6c;
}

html.dark .el-button--danger:hover {
  background-color: rgba(245, 108, 108, 0.1);
  border-color: #f78989;
  color: #f78989;
}

html.dark .el-button--danger.is-plain {
  background-color: transparent;
  border-color: #f56c6c;
  color: #f56c6c;
}

html.dark .el-button--danger.is-plain:hover {
  background-color: rgba(245, 108, 108, 0.1);
  border-color: #f78989;
  color: #f78989;
}

/* Стили для поля названия проекта в темной теме */
html.dark .el-input .el-input__wrapper {
  background-color: var(--el-bg-color) !important;
  border-color: var(--el-border-color) !important;
}

html.dark .el-input .el-input__inner {
  background-color: transparent !important;
  color: var(--el-text-color-primary) !important;
}

html.dark .el-input .el-input__wrapper:hover {
  border-color: var(--el-color-primary) !important;
}

html.dark .el-input .el-input__wrapper.is-focus {
  border-color: var(--el-color-primary) !important;
  box-shadow: 0 0 0 2px var(--el-color-primary-light-8) !important;
}

html.dark .el-input .el-input__inner::placeholder {
  color: var(--el-text-color-placeholder) !important;
}

/* Стили для поля ввода в обеих темах */
/* .el-input .el-input__wrapper {
  padding: 1px !important;
} */
</style>
