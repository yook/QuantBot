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
        :disabled="project.isAnyWorkerBusy"
        size="large"
      >
        <i-tabler-settings class="action-btn-icon" />
        {{ t("menu.settings") }}
      </el-button>
      <el-button
        size="large"
        type="danger"
        plain
        :disabled="project.isAnyWorkerBusy"
        @click="deleteData"
      >
        <i-tabler-trash class="action-btn-icon" />
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
      <el-tab-pane :label="t('menu.crawlingSettings')" name="crawler">
        <CrawlerConfig />
      </el-tab-pane>
      <el-tab-pane :label="t('crawler.rendering')" name="rendering">
        <RenderingConfig />
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
import { ElMessageBox } from "element-plus";
import { useProjectStore } from "../../stores/project";
import CrawlerConfig from "./CrawlerConfig.vue";
import RenderingConfig from "./RenderingConfig.vue";
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
    },
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

.action-btn-icon {
  font-size: 20px;
  width: 1em !important;
  height: 1em !important;
  margin-right: 8px;
  flex-shrink: 0;
  vertical-align: text-bottom;
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
</style>
