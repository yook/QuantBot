<template>
  <div class="mx-10">
    <el-row class="py-2 items-center">
      <el-col :span="8">
        {{ t("crawler.config.renderingEnable") }}
        <el-popover
          placement="top"
          title=""
          :width="300"
          trigger="hover"
          :content="t('crawler.config.renderingTooltip')"
        >
          <template #reference>
            <el-icon class="crawler-help-icon"><QuestionFilled /></el-icon>
          </template>
        </el-popover>
      </el-col>
      <el-col :span="16">
        <div class="grid-content bg-purple-light" />
        <div class="crawler-render-controls">
          <el-switch
            v-model="project.data.crawler.renderEnabled"
            @change="saveData"
          />
        </div>
      </el-col>
    </el-row>

    <el-row class="py-2 items-center">
      <el-col :span="8">
        {{ t("crawler.config.renderTimeout") }}
        <el-popover
          placement="top"
          title=""
          :width="300"
          trigger="hover"
          :content="t('crawler.config.renderTimeoutTooltip')"
        >
          <template #reference>
            <el-icon class="crawler-help-icon"><QuestionFilled /></el-icon>
          </template>
        </el-popover>
      </el-col>
      <el-col :span="8">
        <div class="grid-content bg-purple-light" />
        <el-input-number
          v-model="project.data.crawler.renderTimeoutMs"
          :min="500"
          :step="500"
          :disabled="isFree || !project.data.crawler.renderEnabled"
          @change="saveData"
        />
      </el-col>
    </el-row>

    <el-row class="py-2 items-center">
      <el-col :span="8">
        {{ t("crawler.config.renderConcurrency") }}
      </el-col>
      <el-col :span="8">
        <div class="grid-content bg-purple-light" />
        <el-input-number
          v-model="project.data.crawler.renderMaxConcurrency"
          :min="1"
          :max="4"
          :disabled="isFree || !project.data.crawler.renderEnabled"
          @change="saveData"
        />
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { watch } from "vue";
import { useProjectStore } from "../../stores/project";
import { QuestionFilled } from "@element-plus/icons-vue";
import { useI18n } from "vue-i18n";
import { ElMessageBox } from "element-plus";
import { isFreePlan } from "../../config/plan-limits";

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

if (isFree && project.data?.crawler?.renderEnabled) {
  project.data.crawler.renderEnabled = false;
}

function ensureChromiumMode(shouldPersist = false) {
  if (!project.data?.crawler) return;
  if (project.data.crawler.renderMode === "chromium") return;
  project.data.crawler.renderMode = "chromium";
  if (shouldPersist) {
    project.updateProject();
  }
}

ensureChromiumMode(false);

watch(
  () => project.data.crawler.renderEnabled,
  (enabled) => {
    if (isFree && enabled) {
      project.data.crawler.renderEnabled = false;
      showFreeLimitPopup(t("crawler.config.freeRenderingWarn"));
      return;
    }
    ensureChromiumMode(true);
  },
);

const saveData = (currentValue) => {
  ensureChromiumMode(false);
  console.log("[RenderingConfig] save trigger", currentValue);
  project.updateProject();
};
</script>

<style scoped>
.crawler-help-icon {
  color: #000 !important;
}

.crawler-render-controls {
  display: flex;
  align-items: center;
  gap: 10px;
}
</style>
