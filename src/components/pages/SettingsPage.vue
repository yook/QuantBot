<template>
  <el-container class="settings-page m-5">
    <el-main class="settings-main">
      <el-card shadow="never" class="settings-root-card">
        <el-tabs
          v-model="activeSection"
          tab-position="left"
          class="settings-tabs"
        >
          <el-tab-pane name="general">
            <template #label>
              <span class="settings-tab-label">
                <i-tabler-adjustments class="settings-icon" />
                <span>{{ t("settings.generalTab") }}</span>
              </span>
            </template>

            <el-card shadow="never" class="mb-4">
              <template #header>
                <h2>{{ t("settings.general") }}</h2>
              </template>
              <el-form label-position="top" class="settings-general-form form-dialog">
                <el-form-item
                  :label="t('settings.projectName')"
                  v-if="project.projects.length > 0 && project.currentProjectId"
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
          </el-tab-pane>

          <el-tab-pane name="crawler">
            <template #label>
              <span class="settings-tab-label">
                <i-tabler-scan class="settings-icon" />
                <span>{{ t("menu.crawlingSettings") }}</span>
              </span>
            </template>

            <el-card shadow="never" class="mb-4">
              <template #header>
                <h2>{{ t("menu.crawlingSettings") }}</h2>
              </template>
              <CrawlerConfig />
            </el-card>
          </el-tab-pane>

          <el-tab-pane name="rendering">
            <template #label>
              <span class="settings-tab-label">
                <i-tabler-browser class="settings-icon" />
                <span>{{ t("crawler.rendering") }}</span>
              </span>
            </template>

            <el-card shadow="never" class="mb-4">
              <template #header>
                <h2>{{ t("crawler.rendering") }}</h2>
              </template>
              <RenderingConfig />
            </el-card>
          </el-tab-pane>

          <el-tab-pane name="parser">
            <template #label>
              <span class="settings-tab-label">
                <i-tabler-brackets class="settings-icon" />
                <span>{{ t("menu.parsingSettings") }}</span>
              </span>
            </template>

            <el-card shadow="never" class="mb-4">
              <template #header>
                <div class="card-header card-header-inline-help">
                  <div class="parser-header-left">
                    <h2>{{ t("menu.parsingSettings") }}</h2>
                    <el-icon
                      class="crawler-help-icon parser-help-icon"
                      @click="openParserHelpDrawer"
                    >
                      <QuestionFilled />
                    </el-icon>
                  </div>
                  <el-button
                    class="parser-new-selector-btn"
                    type="primary"
                    plain
                    @click="createParserSelector"
                  >
                    <i-tabler-plus class="parser-new-selector-icon" />
                    {{ t("parser.newSelector") }}
                  </el-button>
                </div>
              </template>
              <ParserConfig ref="parserConfigRef" />
            </el-card>
          </el-tab-pane>
        </el-tabs>
      </el-card>
    </el-main>
  </el-container>
</template>

<script setup>
import { ref, markRaw, onMounted, onUnmounted, watch, computed } from "vue";
import { Delete, QuestionFilled } from "@element-plus/icons-vue";
import { ElMessageBox, ElMessage } from "element-plus";
import { useI18n } from "vue-i18n";
import { useProjectStore } from "../../stores/project";
import { socket } from "../../stores/socket-client";
import CrawlerConfig from "../crawler/CrawlerConfig.vue";
import RenderingConfig from "../crawler/RenderingConfig.vue";
import ParserConfig from "../crawler/ParserConfig.vue";

const { t } = useI18n();
const project = useProjectStore();
const parserConfigRef = ref(null);
const allowedSettingsTabs = new Set([
  "general",
  "crawler",
  "rendering",
  "parser",
]);
const activeSection = computed({
  get: () => {
    const tab = project.settingsTab || "general";
    return allowedSettingsTabs.has(tab) ? tab : "general";
  },
  set: (value) => {
    project.settingsTab = allowedSettingsTabs.has(value) ? value : "general";
  },
});

// Локальное состояние для v-model
const localProjectName = computed({
  get: () => project.currentProjectName,
  set: (value) => {
    // Обновляем имя в списке проектов
    if (project.currentProjectId) {
      const projectIndex = project.projects.findIndex(
        (p) => String(p.id) === project.currentProjectId,
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
  { immediate: true },
);

const saveData = () => {
  // Обновляем имя проекта в данных
  if (project.data) {
    project.data.name = localProjectName.value;
  }
  project.updateProject();
  project.refreshProjectsList(); // Обновляем только список, не меняя текущий проект
};

const openParserHelpDrawer = () => {
  parserConfigRef.value?.openHelpDrawer?.();
};

const createParserSelector = () => {
  parserConfigRef.value?.createNewSelector?.();
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
    },
  )
    .then(() => {
      project.deleteProject();
    })
    .catch(() => {
      // Пользователь отменил удаление
    });
};

// Обработчик успешного удаления проекта
const handleProjectDeleted = (deletedProjectId) => {
  ElMessage.success({
    message: t("settings.projectDeletedSuccess"),
    duration: 3000,
  });
};

// Обработчик ошибки удаления проекта
const handleProjectDeleteError = (errorMessage) => {
  ElMessage.error({
    message: t("settings.projectDeletedError") + ": " + errorMessage,
    duration: 5000,
  });
};

// Подписываемся на события сокета
onMounted(() => {
  if (!allowedSettingsTabs.has(project.settingsTab)) {
    project.settingsTab = "general";
  }
  socket.on("projectDeleted", handleProjectDeleted);
  socket.on("projectDeleteError", handleProjectDeleteError);
});

// Отписываемся при размонтировании
onUnmounted(() => {
  socket.off("projectDeleted", handleProjectDeleted);
  socket.off("projectDeleteError", handleProjectDeleteError);
});
</script>

<style src="./SettingsPage.css"></style>
