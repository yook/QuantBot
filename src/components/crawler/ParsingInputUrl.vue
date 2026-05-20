<template>
  <div class="parsing-input-root">
    <RunToolbar
      :is-running="isParserRunning"
      :loading="isParserRunning"
      :start-disabled="isParserStartDisabled"
      :start-tooltip="t('crawler.start')"
      :stop-tooltip="t('crawler.stop')"
      start-label="Парсинг"
      :percentage="displayPercentage"
      :completion-text="completionText"
      :format-progress-text="formatProgressText"
      @start="submitSite"
      @stop="freezeQueue"
    >
      <template #left>
        <div class="upload-url-wrap">
          <el-button
            size="large"
            type="primary"
            plain
            class="upload-url-btn"
            :disabled="isParserUiLocked"
            @click="handleUploadClick"
          >
            <i-tabler-upload class="control-icon upload-url-icon" />
            <span>{{ t("parser.uploadUrl") }}</span>
          </el-button>
        </div>
      </template>
    </RunToolbar>

    <el-dialog
      v-model="dialogVisible"
      :title="t('parser.uploadUrl')"
      width="520px"
    >
      <el-form label-position="top" class="form-dialog">
        <el-form-item :label="t('parser.uploadUrl')">
          <el-input
            v-model="uploadedUrlsText"
            type="textarea"
            :rows="10"
            :placeholder="t('parser.uploadUrlInputPlaceholder')"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">
          {{ t("crawler.cancelButton") }}
        </el-button>
        <el-button
          type="primary"
          :loading="savingUrls"
          :disabled="isParserUiLocked"
          @click="saveUploadedUrls"
        >
          {{ t("common.save") }}
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="parserRunModeDialogVisible"
      title="Запуск парсинга"
      width="520px"
    >
      <div class="parser-run-mode-note">
        В таблице есть активные фильтры. Что парсить?
      </div>
      <el-form label-position="top" class="form-dialog">
        <el-form-item>
          <el-radio-group v-model="parserRunMode">
            <el-radio label="all">Парсить все</el-radio>
            <el-radio label="filtered">Парсить только отфильтрованные</el-radio>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="parserRunModeDialogVisible = false">
          {{ t("crawler.cancelButton") }}
        </el-button>
        <el-button type="primary" @click="startParserWithSelectedMode">
          Запустить
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, ref } from "vue";
import { ElMessage } from "element-plus";
import { useI18n } from "vue-i18n";
import { useProjectStore } from "../../stores/project";
import { ipcClient } from "../../stores/socket-client";
import { useProgressState } from "../../composables/useProgressState";
import { loadTablePageAndCount } from "../../stores/table-data-service";
import RunToolbar from "../common/RunToolbar.vue";
import { normalizeUrlCandidate } from "../../utils/url";

const project = useProjectStore();
const { t } = useI18n();
const dialogVisible = ref(false);
const savingUrls = ref(false);
const uploadedUrlsText = ref("");
const parserRunModeDialogVisible = ref(false);
const parserRunMode = ref("filtered");
const isParserRunning = computed(() => !!project.isParserRunning);
const isParserStartDisabled = computed(
  () => !!project.isParserRunning || !!project.isCrawlerBusy,
);
const isParserUiLocked = computed(
  () => !!project.isParserRunning || !!project.isCrawlerBusy,
);

const { displayPercentage, completionText, formatProgressText } = useProgressState({
  isRunning: isParserRunning,
  percentageSource: () => project.parserPercentage,
  currentProjectIdSource: () => project.currentProjectId,
  getFinishedAt: (pid) =>
    (project.lastParserFinishedAt && project.lastParserFinishedAt[pid]) ||
    (project.lastFinishedAt && project.lastFinishedAt[pid]) ||
    (project.data && project.data.stats && project.data.stats.finishedAt),
});

function handleUploadClick() {
  if (isParserUiLocked.value) return;
  dialogVisible.value = true;
}

async function saveUploadedUrls() {
  if (isParserUiLocked.value) {
    ElMessage.warning("Кнопки парсинга недоступны во время выполнения другого процесса");
    return;
  }

  if (!project.currentProjectId) {
    ElMessage.error("Сначала выберите проект");
    return;
  }

  const lines = uploadedUrlsText.value
    .split(/\r?\n|,|;/)
    .map((item) => item.trim())
    .filter(Boolean);

  if (!lines.length) {
    ElMessage.warning(t("parser.uploadUrlEmpty"));
    return;
  }

  const uniqueUrls = Array.from(
    new Set(lines.map((item) => normalizeUrlCandidate(item)).filter(Boolean)),
  );
  const invalidCount = lines.length - uniqueUrls.length;

  if (!uniqueUrls.length) {
    ElMessage.error(t("parser.uploadUrlInvalid"));
    return;
  }

  savingUrls.value = true;
  try {
    const result = await ipcClient.bulkInsertUrls(
      Number(project.currentProjectId),
      uniqueUrls,
    );

    if (!result || !result.success) {
      if (result?.code === "FREE_URLS_LIMIT") {
        ElMessage.warning(t("crawler.config.freeUrlsLimitReachedWarn"));
      } else {
        ElMessage.error(result?.error || t("parser.uploadUrlSaveError"));
      }
      return;
    }

    dialogVisible.value = false;
    uploadedUrlsText.value = "";
    project.tableDataLength = await loadTablePageAndCount({
      projectStore: project,
      ipcClient,
      projectId: Number(project.currentProjectId),
      sort: project.sort,
      skip: 0,
      limit: 50,
      db: "parser",
      filters: [],
    });

    const inserted = Number(result.data?.inserted || 0);
    const ignored = Number(result.data?.ignored || 0);
    const skippedByLimit = Number(result.data?.skippedByLimit || 0);
    const parts = [`${t("parser.uploadUrlSaved")}: ${inserted}`];
    if (ignored > 0) parts.push(`${t("parser.uploadUrlIgnored")}: ${ignored}`);
    if (skippedByLimit > 0) {
      parts.push(
        t("crawler.config.freeUrlsImportResult", {
          saved: inserted,
          skipped: skippedByLimit,
        }),
      );
    }
    if (invalidCount > 0) {
      parts.push(`${t("parser.uploadUrlInvalidShort")}: ${invalidCount}`);
    }
    ElMessage.success(parts.join(" | "));
  } catch (error) {
    ElMessage.error(
      `${t("parser.uploadUrlSaveError")}: ${String((error && error.message) || error)}`,
    );
  } finally {
    savingUrls.value = false;
  }
}

async function submitSite() {
  if (isParserStartDisabled.value) {
    return;
  }
  if (!project.currentProjectId) {
    ElMessage.error("Сначала выберите проект");
    return;
  }
  if (!project.tableDataLength || project.tableDataLength <= 0) {
    ElMessage.warning(t("parser.uploadUrlEmpty"));
    return;
  }
  const activeFilters = Array.isArray(project.currentTableFilters)
    ? project.currentTableFilters
    : [];
  if (activeFilters.length > 0) {
    parserRunMode.value = "filtered";
    parserRunModeDialogVisible.value = true;
    return;
  }

  const result = await project.startParserIPC({ mode: "all", filters: [] });
  if (result && result.success === false && result.error) {
    ElMessage.warning(result.error);
  }
}

async function startParserWithSelectedMode() {
  const activeFilters = Array.isArray(project.currentTableFilters)
    ? project.currentTableFilters
    : [];
  const mode = parserRunMode.value === "filtered" ? "filtered" : "all";
  const result = await project.startParserIPC({
    mode,
    filters: mode === "filtered" ? activeFilters : [],
  });
  if (result && result.success === false && result.error) {
    ElMessage.warning(result.error);
    return;
  }
  parserRunModeDialogVisible.value = false;
}

function freezeQueue() {
  project.stopParserIPC();
}

</script>

<style scoped>
.form-dialog :deep(.el-form-item) {
  margin-bottom: 0;
}

.parser-run-mode-note {
  margin-bottom: 12px;
  color: var(--el-text-color-regular);
}
</style>

<style scoped>
.parsing-input-root {
  width: 100%;
  min-width: 0;
}

.upload-url-btn {
  flex: 0 0 auto;
  justify-content: center;
}

.upload-url-wrap {
  flex: 1 1 auto;
  min-width: 0;
}

.upload-url-icon {
  margin-right: 8px;
}

</style>
