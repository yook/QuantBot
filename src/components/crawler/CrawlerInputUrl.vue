<template>
  <RunToolbar
    :is-running="isCrawlerRunning"
    :loading="isCrawlerRunning"
    :start-disabled="isCrawlerStartDisabled"
    :start-tooltip="t('crawler.start')"
    :stop-tooltip="t('crawler.stop')"
    start-label="Краулинг"
    :percentage="displayPercentage"
    :completion-text="completionText"
    :format-progress-text="formatProgressText"
    @start="submitSite"
    @stop="freezeQueue"
  >
    <template #left>
      <el-input
        size="large"
        :disabled="isCrawlerRunning || project.isParserBusy"
        v-model="project.data.url"
        class="site-input"
        placeholder="https://www.site.com"
        @keyup.enter.native="submitSite"
      />
    </template>
  </RunToolbar>
</template>

<script setup>
import { computed } from "vue";
import { ElMessage } from "element-plus";
import { useI18n } from "vue-i18n";
import { useProjectStore } from "../../stores/project";
import { useProgressState } from "../../composables/useProgressState";
import RunToolbar from "../common/RunToolbar.vue";
import { normalizeUrlCandidate, isValidUrl } from "../../utils/url";

const project = useProjectStore();
const { t } = useI18n();
const isCrawlerRunning = computed(() => !!project.isCrawlerRunning);
const isCrawlerStartDisabled = computed(
  () => !!project.isCrawlerRunning || !!project.isParserBusy,
);

const { displayPercentage, completionText, formatProgressText } = useProgressState({
  isRunning: isCrawlerRunning,
  percentageSource: () => project.crawlerPercentage,
  currentProjectIdSource: () => project.currentProjectId,
  getFinishedAt: (pid) =>
    (project.lastCrawlerFinishedAt && project.lastCrawlerFinishedAt[pid]) ||
    (project.lastFinishedAt && project.lastFinishedAt[pid]) ||
    (project.data && project.data.stats && project.data.stats.finishedAt),
});

async function submitSite() {
  if (isCrawlerStartDisabled.value) return;
  if (!project.currentProjectId) {
    ElMessage.error("Сначала выберите проект");
    return;
  }
  if (!project.data.id) {
    ElMessage.error("Данные проекта не загружены");
    return;
  }
  const url = normalizeUrlCandidate(project.data.url);
  if (!isValidUrl(url)) {
    ElMessage.error(t("crawler.isNotURL"));
    return;
  }
  const result = await project.startCrawlerIPC(url);
  if (result && result.success === false && result.error) {
    ElMessage.warning(result.error);
  }
}

function freezeQueue() {
  project.stopCrawlerIPC();
}
</script>

<style scoped>
.site-input {
  flex: 1 1 auto;
  min-width: 0;
}

.site-input .el-input__wrapper .el-input__inner,
.site-input input,
.site-input textarea,
.site-input .el-textarea__inner {
  border: none !important;
  box-shadow: none !important;
  outline: none !important;
  background: transparent !important;
}
</style>
