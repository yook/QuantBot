<template>
  <div class="m-10">
    <el-row class="py-2 items-center">
      <el-col :span="6">
        {{ t("crawler.config.depth") }}
        <el-popover
          placement="top"
          title=""
          :width="300"
          trigger="hover"
          :content="t('crawler.config.depthTooltip')"
        >
          <template #reference>
            <el-icon><QuestionFilled /></el-icon>
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
      <el-col :span="6">
        {{ t("crawler.config.concurrency") }}
        <el-popover
          placement="top"
          title=""
          :width="300"
          trigger="hover"
          :content="t('crawler.config.concurrencyTooltip')"
        >
          <template #reference>
            <el-icon><QuestionFilled /></el-icon>
          </template>
        </el-popover>
      </el-col>
      <el-col :span="8"
        ><div class="grid-content bg-purple-light" />
        <el-input-number
          v-model="project.data.crawler.maxConcurrency"
          :min="1"
          :max="100"
          @change="saveData"
      /></el-col>
    </el-row>

    <el-row class="py-2 items-center">
      <el-col :span="6">
        {{ t("crawler.config.interval") }}
        <el-popover
          placement="top"
          title=""
          :width="300"
          trigger="hover"
          :content="t('crawler.config.intervalTooltip')"
        >
          <template #reference>
            <el-icon><QuestionFilled /></el-icon>
          </template>
        </el-popover>
      </el-col>
      <el-col :span="8"
        ><div class="grid-content bg-purple-light" />
        <el-input-number
          v-model="project.data.crawler.interval"
          :min="1000"
          :step="100"
          @change="saveData"
      /></el-col>
    </el-row>

    <el-row class="py-2 items-center">
      <el-col :span="6">
        {{ t("crawler.config.timeout") }}
        <el-popover
          placement="top"
          title=""
          :width="300"
          trigger="hover"
          :content="t('crawler.config.timeoutTooltip')"
        >
          <template #reference>
            <el-icon><QuestionFilled /></el-icon>
          </template>
        </el-popover>
      </el-col>
      <el-col :span="8"
        ><div class="grid-content bg-purple-light" />
        <el-input-number
          v-model="project.data.crawler.timeout"
          :min="1000"
          :step="100"
          @change="saveData"
      /></el-col>
    </el-row>

    <el-row class="py-2 items-center">
      <el-col :span="6"> {{ t("crawler.config.userAgent") }} </el-col>
      <el-col :span="18"
        ><div class="grid-content bg-purple-light" />
        <el-input v-model="project.data.crawler.userAgent" @change="saveData" />
      </el-col>
    </el-row>

    <el-row class="py-2 items-center">
      <el-col :span="6"> {{ t("crawler.config.respectRobotsTxt") }} </el-col>
      <el-col :span="8"
        ><div class="grid-content bg-purple-light" />
        <el-switch
          v-model="project.data.crawler.respectRobotsTxt"
          @change="saveData"
        />
      </el-col>
    </el-row>
    <el-row class="py-2 items-center">
      <el-col :span="6"> {{ t("crawler.config.scanSubdomains") }} </el-col>
      <el-col :span="8"
        ><div class="grid-content bg-purple-light" />
        <el-switch
          v-model="project.data.crawler.scanSubdomains"
          @change="saveData"
        />
      </el-col>
    </el-row>

    <el-row class="py-2 items-center">
      <el-col :span="6">
        {{ t("crawler.config.stripQueryString") }}
        <el-popover
          placement="top"
          title=""
          :width="300"
          trigger="hover"
          :content="t('crawler.config.stripQueryStringTooltip')"
        >
          <template #reference>
            <el-icon><QuestionFilled /></el-icon>
          </template>
        </el-popover>
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
      <el-col :span="6">
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
      <el-col :span="6">
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
      <el-col :span="6"> {{ t("crawler.config.scanImages") }} </el-col>
      <el-col :span="8"
        ><div class="grid-content bg-purple-light" />
        <el-switch
          v-model="project.data.crawler.parseImages"
          @change="saveData"
        />
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { ref, watch, onUnmounted } from "vue";
import { useProjectStore } from "../../stores/project";
import { QuestionFilled } from "@element-plus/icons-vue";
import { useI18n } from "vue-i18n";

const { t } = useI18n();
const project = useProjectStore();
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
  { deep: true }
);

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

<style>
/* Стили для switch в темной теме - монохромные тона */
html.dark .el-switch {
  --el-switch-on-color: #1f2937 !important;
  --el-switch-off-color: #6b7280 !important;
  --el-switch-border-color: #4b5563 !important;
}

html.dark .el-switch__core {
  background-color: #6b7280 !important;
  border-color: #9ca3af !important;
}

html.dark .el-switch.is-checked .el-switch__core {
  background-color: #1f2937 !important;
  border-color: #4b5563 !important;
}

html.dark .el-switch__action {
  background-color: #f9fafb !important;
  border-color: #d1d5db !important;
}

html.dark .el-switch.is-checked .el-switch__action {
  background-color: #e5e7eb !important;
}
</style>
