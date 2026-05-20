<template>
  <el-card class="run-toolbar-card" shadow="never">
    <div class="run-toolbar">
      <div class="run-toolbar-left">
        <slot name="left" />
      </div>

      <div class="ml-3 progress-bar-wrap">
        <el-progress
          :text-inside="true"
          :stroke-width="40"
          :percentage="completionText ? 0 : normalizedPercentage"
          :format="formatProgressText"
          :class="['progress-bar', { 'is-complete': !!completionText }]"
          :striped="!completionText"
          :striped-flow="isRunning && !completionText"
          :duration="7"
        />
        <div v-if="completionText" class="progress-overlay-text">
          {{ completionText }}
        </div>
      </div>

      <el-tooltip v-if="!isRunning" :content="startTooltip" placement="top">
        <el-button
          class="add-start ml-3"
          type="primary"
          size="large"
          :loading="loading"
          :disabled="startDisabled"
          @click="$emit('start')"
        >
          <span class="run-action-content">
            <span class="run-action-label">{{ startLabel }}</span>
            <i-tabler-play class="control-icon" />
          </span>
        </el-button>
      </el-tooltip>

      <el-tooltip v-else :content="stopTooltip" placement="top">
        <el-button class="ml-3" size="large" type="primary" @click="$emit('stop')">
          <span class="run-action-content">
            <span class="run-action-label">Стоп</span>
            <i-tabler-loader-2 class="control-icon spin-icon" />
          </span>
        </el-button>
      </el-tooltip>
    </div>
  </el-card>
</template>

<script setup>
import { computed } from "vue";

const props = defineProps({
  isRunning: { type: Boolean, default: false },
  startDisabled: { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
  startLabel: { type: String, default: "Запустить" },
  startTooltip: { type: String, default: "" },
  stopTooltip: { type: String, default: "" },
  percentage: { type: Number, default: 0 },
  completionText: { type: String, default: "" },
  formatProgressText: {
    type: Function,
    default: (v) => `${Number(v || 0)}%`,
  },
});

defineEmits(["start", "stop"]);

const normalizedPercentage = computed(() =>
  Math.max(0, Math.min(100, Number(props.percentage || 0))),
);
</script>

<style scoped>
.run-toolbar {
  display: flex;
  flex-direction: row;
  flex-wrap: nowrap;
  align-items: center;
  width: 100%;
  min-width: 0;
}

.run-toolbar-left {
  flex: 1 1 auto;
  min-width: 0;
}

.run-toolbar-card {
  width: 100%;
  min-width: 0;
}

.run-toolbar-card,
.run-toolbar-card:focus,
.run-toolbar-card:focus-within {
  outline: none !important;
  box-shadow: none !important;
}

.run-toolbar-card :deep(.el-card__body) {
  width: 100%;
  padding: 16px;
  box-sizing: border-box;
}

.run-toolbar-card :deep(.el-button),
.run-toolbar-card :deep(.el-button:focus),
.run-toolbar-card :deep(.el-button:focus-visible),
.run-toolbar-card :deep(.el-button:active) {
  outline: none !important;
  box-shadow: none !important;
}

.progress-bar-wrap {
  position: relative;
  width: 200px;
  min-width: 200px;
  max-width: 200px;
  flex-shrink: 0;
}

.progress-bar {
  width: 100% !important;
  --el-progress-text-color: #fff;
}

@media (max-width: 1200px) {
  .progress-bar-wrap {
    width: 160px;
    min-width: 160px;
    max-width: 160px;
  }
}

.progress-overlay-text {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  white-space: nowrap;
  text-align: center;
  font-size: 12px;
  color: var(--el-text-color-regular);
  font-weight: 400;
  pointer-events: none;
  z-index: 2;
}

.progress-bar .el-progress-bar__inner {
  opacity: 1 !important;
  display: flex;
  align-items: center;
  justify-content: center;
}

.progress-bar :deep(.el-progress__text),
.progress-bar :deep(.el-progress-bar__innerText) {
  position: absolute;
  inset: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  margin: 0;
  white-space: nowrap;
  text-align: center;
  color: #fff !important;
  font-weight: 400;
}

.progress-bar .el-progress-bar__outer {
  background-color: var(--el-bg-color-page) !important;
  opacity: 1 !important;
}

.el-progress-bar__outer {
  border-radius: 6px !important;
}

.el-progress-bar__inner {
  border-radius: 5px !important;
}

.control-icon {
  font-size: 20px;
  width: 1em !important;
  height: 1em !important;
  display: flex;
  align-items: center;
  justify-content: center;
}

.spin-icon {
  animation: rotating 1s linear infinite;
}

.run-action-content {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.run-action-label {
  font-weight: 500;
}

@keyframes rotating {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
</style>
