<template>
  <el-card class="progress-menu" shadow="never">
    <div>
      <el-button
        @click="project.crawlerConfigDialog = true"
        :icon="Operation"
        :disabled="keywordsStore.running"
        size="large"
      >
        {{ t("menu.settings") }}
      </el-button>
      <el-button
        size="large"
        type="danger"
        :icon="Delete"
        :disabled="keywordsStore.running"
        plain
        @click="deleteData"
      >
        {{ t("keywords.clear") }}
      </el-button>
    </div>
  </el-card>
  <el-dialog
    width="900px"
    top="5vh"
    :title="t('keywords.configuration')"
    v-model="project.crawlerConfigDialog"
  >
    <el-tabs stretch v-model="activeTab" class="demo-tabs">
      <el-tab-pane :label="t('keywords.stopwords')" name="stopwords">
        <StopWords />
      </el-tab-pane>
      <el-tab-pane name="typing">
        <template #label>
          <span class="tab-label-ai">
            <span>{{ t("keywords.classification") }}</span>
            <span class="ai-icon" aria-hidden="true">
              <img
                src="/icons8-sparkling-24.png"
                width="16"
                height="16"
                alt="AI"
              />
            </span>
          </span>
        </template>
        <TypingConfig />
      </el-tab-pane>
      <el-tab-pane name="clustering">
        <template #label>
          <span class="tab-label-ai">
            <span>{{ t("keywords.clustering") }}</span>
            <span class="ai-icon" aria-hidden="true">
              <img
                src="/icons8-sparkling-24.png"
                width="16"
                height="16"
                alt="AI"
              />
            </span>
          </span>
        </template>
        <ClusteringConfig />
      </el-tab-pane>
      <el-tab-pane name="categorization">
        <template #label>
          <span class="tab-label-ai">
            <span>{{ t("keywords.categorization") }}</span>
            <span class="ai-icon" aria-hidden="true">
              <img
                src="/icons8-sparkling-24.png"
                width="16"
                height="16"
                alt="AI"
              />
            </span>
          </span>
        </template>
        <CategorizationConfig />
      </el-tab-pane>
    </el-tabs>
  </el-dialog>
</template>

<script setup>
import { ref, markRaw } from "vue";
import { useI18n } from "vue-i18n";
import { Delete, Operation } from "@element-plus/icons-vue";
import { ElMessageBox } from "element-plus";
import { useProjectStore } from "../../stores/project";
import { useKeywordsStore } from "../../stores/keywords";
import StopWords from "./settings/StopWords.vue";
import CategorizationConfig from "./settings/CategorizationConfig.vue";
import ClusteringConfig from "./settings/ClusteringConfig.vue";
import TypingConfig from "./settings/TypingConfig.vue";

const { t } = useI18n();
const project = useProjectStore();
const keywordsStore = useKeywordsStore();

// const crawlerConfigDialog = ref(false);
const activeTab = ref("stopwords");

function deleteData() {
  ElMessageBox.confirm(
    t("keywords.deleteConfirmMessage"),
    t("keywords.deleteConfirmTitle"),
    {
      confirmButtonText: t("keywords.deleteButton"),
      cancelButtonText: t("keywords.cancelButton"),
      type: "error",
      icon: markRaw(Delete),
      customClass: "delete-msgbox-class",
    }
  )
    .then(() => {
      // Используем keywordsStore для очистки только ключевых слов
      keywordsStore.clearKeywords();
    })
    .catch(() => {
      // Пользователь отменил удаление
    });
}
</script>

<style>
.el-progress--line {
  /* margin-top: 1px; */
  width: 200px;
  display: inline-block;
}
.el-progress--line .el-progress-bar__outer,
.el-progress-bar__inner {
  border-radius: 4px;
}
.progress-menu {
  width: 320px;
  height: 82px;
}
.el-statistic__head {
  margin-bottom: 0;
}
.el-statistic {
  margin-top: -4px;
  text-align: center;
}

/* Кастомные стили для MessageBox удаления */
.delete-msgbox-class {
  min-width: 50%;
  padding: 30px;
}

/* Keep the "Классификация + icon" label on a single line */
.el-tabs__item .tab-label-ai {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}
.el-tabs__item .tab-label-ai .ai-icon {
  display: inline-flex;
  line-height: 0;
}
/* Avoid wrapping of tab labels in general (within this component) */
.el-tabs__item {
  white-space: nowrap;
}

/* Стили для табов в темной теме */
html.dark .el-tabs__header {
  border-bottom-color: #374151 !important;
}

html.dark .el-tabs__nav-wrap::after {
  background-color: #374151 !important;
}

html.dark .el-tabs__item {
  color: #6b7280 !important;
  border-bottom: 2px solid transparent !important;
}

html.dark .el-tabs__item:hover {
  color: #9ca3af !important;
}

html.dark .el-tabs__item.is-active {
  color: #e5e7eb !important;
  border-bottom-color: #e5e7eb !important;
}

html.dark .el-tabs__active-bar {
  background-color: #e5e7eb !important;
}

html.dark .el-tabs__content {
  background-color: transparent !important;
}

html.dark .el-tab-pane {
  color: #d1d5db !important;
}

/* Стили для кнопки "Очистить" в темной теме - менее контрастная */
html.dark .el-button--danger.is-plain {
  background-color: #374151 !important;
  border-color: #d4a5a5 !important; /* Цвет #d4a5a5 для обводки */
  color: #d4a5a5 !important; /* Цвет #d4a5a5 для текста */
}

html.dark .el-button--danger.is-plain:hover {
  background-color: #4b5563 !important;
  border-color: #d4a5a5 !important; /* Тот же цвет при наведении */
  color: #d4a5a5 !important; /* Тот же цвет при наведении */
}

html.dark .el-button--danger.is-plain:active {
  background-color: #374151 !important;
  border-color: #d4a5a5 !important;
  color: #d4a5a5 !important;
}

/* Цвет иконки в кнопке "Очистить" в темной теме */
html.dark .el-button--danger.is-plain .el-icon {
  color: #d4a5a5 !important;
}

html.dark .el-button--danger.is-plain:hover .el-icon {
  color: #d4a5a5 !important;
}

html.dark .el-button--danger.is-plain:active .el-icon {
  color: #d4a5a5 !important;
}
</style>
