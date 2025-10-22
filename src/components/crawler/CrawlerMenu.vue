<template>
  <el-card class="progress-menu" shadow="never">
    <!-- <el-progress
      :text-inside="true"
      :stroke-width="39"
      :percentage="project.percentage"
      class="mr-3 left"
    /> -->
    <!-- <div class="" v-if="project.running">
      <el-row>
        <el-col :span="12">
          <el-statistic title="Проверено" :value="project.data.fetched" />
        </el-col>
        <el-col :span="12">
          <el-statistic
            title="Всего"
            :value="project.data.queue + project.data.fetched"
          />
        </el-col>
      </el-row>
    </div> -->
    <div>
      <el-button
        @click="project.crawlerConfigDialog = true"
        :icon="Operation"
        :disabled="project.running"
        size="large"
      >
        {{ t("menu.settings") }}
      </el-button>
      <el-button
        size="large"
        type="danger"
        :icon="Delete"
        :disabled="project.running"
        plain
        @click="deleteData"
      >
        {{ t("crawler.clear") }}
      </el-button>
    </div>
  </el-card>
  <el-dialog
    width="900px"
    top="5vh"
    :title="t('crawler.configuration')"
    v-model="project.crawlerConfigDialog"
  >
    <el-tabs stretch v-model="activeTab" class="demo-tabs">
      <el-tab-pane :label="t('menu.crawling')" name="crawler">
        <CrawlerConfig />
      </el-tab-pane>
      <el-tab-pane :label="t('crawler.parser')" name="parser">
        <ParserConfig />
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
import CrawlerConfig from "./CrawlerConfig.vue";
import ParserConfig from "./ParserConfig.vue";

const { t } = useI18n();
const project = useProjectStore();

// const crawlerConfigDialog = ref(false);
const activeTab = ref("crawler");

function deleteData() {
  ElMessageBox.confirm(
    t("crawler.deleteConfirmMessage"),
    t("crawler.deleteConfirmTitle"),
    {
      confirmButtonText: t("crawler.deleteButton"),
      cancelButtonText: t("crawler.cancelButton"),
      type: "error",
      icon: markRaw(Delete),
      customClass: "delete-msgbox-class",
    }
  )
    .then(() => {
      project.deleteData();
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
