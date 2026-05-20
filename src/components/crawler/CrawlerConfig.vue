<template>
  <div class="mx-10">
    <el-row class="py-2 items-center">
      <el-col :span="8">
        {{ t("crawler.config.depth") }}
        <el-popover
          placement="top"
          title=""
          :width="300"
          trigger="hover"
          :content="t('crawler.config.depthTooltip')"
        >
          <template #reference>
            <el-icon class="crawler-help-icon"><QuestionFilled /></el-icon>
          </template>
        </el-popover>
      </el-col>
      <el-col :span="8"
        ><div class="grid-content bg-purple-light" />
        <el-input-number
          v-model="project.data.crawler.maxDepth"
          :min="0"
          :max="100"
          @change="saveData"
        />
      </el-col>
    </el-row>

    <el-row class="py-2 items-center">
      <el-col :span="8">
        {{ t("crawler.config.concurrency") }}
        <el-popover
          placement="top"
          title=""
          :width="300"
          trigger="hover"
          :content="t('crawler.config.concurrencyTooltip')"
        >
          <template #reference>
            <el-icon class="crawler-help-icon"><QuestionFilled /></el-icon>
          </template>
        </el-popover>
      </el-col>
      <el-col :span="8"
        ><div class="grid-content bg-purple-light" />
        <el-input-number
          v-model="project.data.crawler.maxConcurrency"
          :min="0"
          :max="100"
          @change="onConcurrencyChange"
        />
      </el-col>
    </el-row>

    <el-row class="py-2 items-center">
      <el-col :span="8">
        {{ t("crawler.config.maxUrls") }}
        <el-popover
          placement="top"
          title=""
          :width="300"
          trigger="hover"
          :content="t('crawler.config.maxUrlsTooltip')"
        >
          <template #reference>
            <el-icon class="crawler-help-icon"><QuestionFilled /></el-icon>
          </template>
        </el-popover>
      </el-col>
      <el-col :span="8">
        <div class="grid-content bg-purple-light" />
        <el-input-number
          v-model="project.data.crawler.maxUrls"
          :min="0"
          :max="1000000"
          @change="onMaxUrlsChange"
        />
      </el-col>
    </el-row>

    <el-row class="py-2 items-center">
      <el-col :span="8">
        {{ t("crawler.config.interval") }}
        <el-popover
          placement="top"
          title=""
          :width="300"
          trigger="hover"
          :content="t('crawler.config.intervalTooltip')"
        >
          <template #reference>
            <el-icon class="crawler-help-icon"><QuestionFilled /></el-icon>
          </template>
        </el-popover>
      </el-col>
      <el-col :span="8"
        ><div class="grid-content bg-purple-light" />
        <el-input-number
          v-model="project.data.crawler.interval"
          :min="0"
          :step="100"
          @change="onIntervalChange"
        />
      </el-col>
    </el-row>

    <el-row class="py-2 items-center">
      <el-col :span="8">
        {{ t("crawler.config.timeout") }}
        <el-popover
          placement="top"
          title=""
          :width="300"
          trigger="hover"
          :content="t('crawler.config.timeoutTooltip')"
        >
          <template #reference>
            <el-icon class="crawler-help-icon"><QuestionFilled /></el-icon>
          </template>
        </el-popover>
      </el-col>
      <el-col :span="16"
        ><div class="grid-content bg-purple-light" />
        <el-input-number
          v-model="project.data.crawler.timeout"
          :min="1000"
          :step="100"
          @change="saveData"
      /></el-col>
    </el-row>

    <el-row class="py-2 items-center">
      <el-col :span="8"> {{ t("crawler.config.userAgent") }} </el-col>
      <el-col :span="16"
        ><div class="grid-content bg-purple-light" />
        <el-input v-model="project.data.crawler.userAgent" @change="saveData" />
      </el-col>
    </el-row>

    <el-row class="py-2 items-center">
      <el-col :span="8"> {{ t("crawler.config.respectRobotsTxt") }} </el-col>
      <el-col :span="8"
        ><div class="grid-content bg-purple-light" />
        <el-switch
          v-model="project.data.crawler.respectRobotsTxt"
          @change="saveData"
        />
      </el-col>
    </el-row>
    <el-row class="py-2 items-center">
      <el-col :span="8"> {{ t("crawler.config.scanSubdomains") }} </el-col>
      <el-col :span="8"
        ><div class="grid-content bg-purple-light" />
        <el-switch
          v-model="project.data.crawler.scanSubdomains"
          @change="saveData"
        />
      </el-col>
    </el-row>

    <el-row class="py-2 items-center">
      <el-col :span="8">
        {{ t("crawler.config.stripQueryString") }}
      </el-col>
      <el-col :span="8"
        ><div class="grid-content bg-purple-light" />
        <el-switch
          v-model="project.data.crawler.stripQuerystring"
          @change="saveData"
        />
      </el-col>
    </el-row>

    <el-row class="py-2 items-center">
      <el-col :span="8">
        {{ t("crawler.config.sortQueryParameters") }}
        <!-- <el-popover
        placement="top"
        title=""
        :width="300"
        trigger="hover"
        content="Controls whether to sort query string parameters from URL's at queue item construction time."
      >
        <template #reference>
          <el-icon><question-filled /></el-icon>
        </template>
      </el-popover> -->
      </el-col>
      <el-col :span="8"
        ><div class="grid-content bg-purple-light" />
        <el-switch
          v-model="project.data.crawler.sortQueryParameters"
          @change="saveData"
        />
      </el-col>
    </el-row>

    <el-row class="py-2 items-center">
      <el-col :span="8">
        {{ t("crawler.config.parseScriptTags") }}
        <!-- <el-popover
        placement="top"
        title=""
        :width="250"
        trigger="hover"
        content="">
        <template #reference>
          <el-icon><question-filled /></el-icon>
        </template>
      </el-popover> -->
      </el-col>
      <el-col :span="8"
        ><div class="grid-content bg-purple-light" />
        <el-switch
          v-model="project.data.crawler.parseScriptTags"
          @change="saveData"
        />
      </el-col>
    </el-row>

    <el-row class="py-2 items-center">
      <el-col :span="8"> {{ t("crawler.config.scanImages") }} </el-col>
      <el-col :span="8"
        ><div class="grid-content bg-purple-light" />
        <el-switch
          v-model="project.data.crawler.parseImages"
          @change="saveData"
        />
      </el-col>
    </el-row>

    <el-row class="py-2 items-center">
      <el-col :span="8">
        {{ t("crawler.config.restrictToStartPath") }}
        <el-popover
          placement="top"
          title=""
          :width="300"
          trigger="hover"
          :content="t('crawler.config.restrictToStartPathTooltip')"
        >
          <template #reference>
            <el-icon class="crawler-help-icon"><QuestionFilled /></el-icon>
          </template>
        </el-popover>
      </el-col>
      <el-col :span="8"
        ><div class="grid-content bg-purple-light" />
        <el-switch
          v-model="project.data.crawler.restrictToStartPath"
          @change="saveData"
        />
      </el-col>
    </el-row>

  </div>
</template>

<script setup>
import { watch, onUnmounted } from "vue";
import { useProjectStore } from "../../stores/project";
import { QuestionFilled } from "@element-plus/icons-vue";
import { useI18n } from "vue-i18n";
import { ElMessageBox } from "element-plus";
import { isFreePlan } from "../../config/plan-limits";
import { FREE_PLAN_LIMITS } from "../../config/plan-limits";

const { t } = useI18n();
const project = useProjectStore();
const isFree = isFreePlan();
const proUrl = (import.meta.env && import.meta.env.VITE_PRO_URL) || "https://example.com/pro";

function showFreeLimitPopup(message) {
  ElMessageBox({
    title: "Ограничение Free",
    message: `
      <div style="text-align:left;">${message}</div>
      <div style="margin-top:14px; display:flex; justify-content:center;">
        <a href="${proUrl}" target="_blank" rel="noopener noreferrer"
           style="display:inline-flex;align-items:center;justify-content:center;height:32px;padding:0 16px;border-radius:8px;background:var(--el-color-primary);color:#fff;text-decoration:none;font-weight:500;">
          ${t("crawler.config.freeUpgradeCta")}
        </a>
      </div>
    `,
    dangerouslyUseHTMLString: true,
    showConfirmButton: false,
    showClose: true,
    closeOnClickModal: true,
    closeOnPressEscape: true,
  }).catch(() => {});
}
// const crawler = project.data.crawler;

// watch(
//   () => project.data.crawler,
//   (crawler) => {
//     console.log(`x is ${crawler}`);
//   }
// );.

// Автосохранение настроек краулера при любых изменениях (debounce)
let saveTimer = null;
watch(
  () => project.data.crawler,
  () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      project.updateProject();
    }, 300);
  },
  { deep: true },
);

function onMaxUrlsChange(value) {
  if (!project.data?.crawler) return;
  if (!isFree) return saveData(value);
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) {
    project.data.crawler.maxUrls = FREE_PLAN_LIMITS.defaultMaxUrls;
    showFreeLimitPopup(t("crawler.config.freeMaxUrlsZeroWarn"));
    return saveData(value);
  }
  if (n > FREE_PLAN_LIMITS.urlsPerProject) {
    project.data.crawler.maxUrls = FREE_PLAN_LIMITS.defaultMaxUrls;
    showFreeLimitPopup(t("crawler.config.freeMaxUrlsHighWarn"));
    return saveData(value);
  }
  if (n < 1) {
    project.data.crawler.maxUrls = FREE_PLAN_LIMITS.defaultMaxUrls;
  }
  return saveData(value);
}

function onConcurrencyChange(value) {
  if (!project.data?.crawler) return;
  if (!isFree) return saveData(value);
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) {
    project.data.crawler.maxConcurrency = FREE_PLAN_LIMITS.defaultCrawlerConcurrency;
    showFreeLimitPopup(t("crawler.config.freeConcurrencyLowWarn"));
    return saveData(value);
  }
  if (n > FREE_PLAN_LIMITS.crawlerConcurrency) {
    project.data.crawler.maxConcurrency = FREE_PLAN_LIMITS.defaultCrawlerConcurrency;
    showFreeLimitPopup(t("crawler.config.freeConcurrencyHighWarn"));
    return saveData(value);
  }
  return saveData(value);
}

function onIntervalChange(value) {
  if (!project.data?.crawler) return;
  if (!isFree) return saveData(value);
  const n = Number(value);
  if (!Number.isFinite(n) || n < FREE_PLAN_LIMITS.minCrawlerIntervalMs) {
    project.data.crawler.interval = FREE_PLAN_LIMITS.defaultCrawlerIntervalMs;
    showFreeLimitPopup(t("crawler.config.freeIntervalLowWarn"));
    return saveData(value);
  }
  return saveData(value);
}


// Гарантируем сохранение при закрытии диалога/размонтировании компонента
onUnmounted(() => {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  project.updateProject();
});

// const props = defineProps({
//   crawler: Object,
// });

const saveData = (currentValue) => {
  console.log("[CrawlerConfig] save trigger", currentValue);
  project.updateProject();
};
</script>

<style scoped>
.crawler-help-icon {
  color: #000 !important;
}
</style>
