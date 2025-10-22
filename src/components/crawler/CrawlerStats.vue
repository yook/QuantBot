<template>
  <div class="flex">
    <el-card class="flex-1 mr-1" shadow="never">
      <h3 class="mb-4">{{ t("stats.status") }}</h3>
      <el-row>
        <el-col
          :span="8"
          :class="(project.data.stats?.queue || 0) < 1 ? 'is-opacity ' : ''"
        >
          <el-statistic
            :title="t('stats.queue')"
            group-separator=" "
            :value="project.data.stats?.queue || 0"
          >
            <template #prefix>
              <el-icon color="#67C23A" style="vertical-align: -0.125em">
                <CirclePlus />
              </el-icon>
            </template>
          </el-statistic>
        </el-col>
        <el-col
          :span="8"
          :class="(project.data.stats?.fetched || 0) < 1 ? 'is-opacity ' : ''"
        >
          <el-statistic
            :title="t('stats.checked')"
            group-separator=" "
            :value="project.data.stats?.fetched || 0"
          >
            <template #prefix>
              <el-icon color="#67C23A" style="vertical-align: -0.125em">
                <CirclePlusFilled />
              </el-icon>
            </template>
          </el-statistic>
        </el-col>
        <el-col
          :span="8"
          :class="(project.data.stats?.disallow || 0) < 1 ? 'is-opacity' : ''"
        >
          <el-statistic
            :title="t('stats.ban')"
            group-separator=" "
            :value="project.data.stats?.disallow || 0"
          >
            <template #prefix>
              <el-icon color="#F56C6C" style="vertical-align: -0.125em">
                <RemoveFilled />
              </el-icon>
            </template>
          </el-statistic>
        </el-col>
      </el-row>
    </el-card>

    <el-card class="flex-1 mr-1" shadow="never">
      <h3 class="mb-4">{{ t("stats.contentType") }}</h3>
      <el-row>
        <el-col
          :span="8"
          :class="(project.data.stats?.html || 0) < 1 ? 'is-opacity' : ''"
        >
          <el-statistic
            title="HTML"
            group-separator=" "
            :value="project.data.stats?.html || 0"
          >
            <template #prefix>
              <el-icon color="#909399" style="vertical-align: -0.125em">
                <Postcard />
              </el-icon>
            </template>
          </el-statistic>
        </el-col>
        <el-col
          :span="8"
          :class="(project.data.stats?.jscss || 0) < 1 ? 'is-opacity' : ''"
        >
          <el-statistic
            title="Javascript, css"
            group-separator=" "
            :value="project.data.stats?.jscss || 0"
          >
            <template #prefix>
              <el-icon color="#909399" style="vertical-align: -0.125em">
                <Tickets />
              </el-icon>
            </template>
          </el-statistic>
        </el-col>
        <el-col
          :span="8"
          :class="(project.data.stats?.image || 0) < 1 ? 'is-opacity' : ''"
        >
          <el-statistic
            title="Image"
            group-separator=" "
            :value="project.data.stats?.image || 0"
          >
            <template #prefix>
              <el-icon color="#909399" style="vertical-align: -0.125em">
                <Picture />
              </el-icon>
            </template>
          </el-statistic>
        </el-col>
      </el-row>

      <!-- <el-divider /> -->
    </el-card>

    <el-card class="flex-1 mr-1" shadow="never">
      <h3 class="mb-4">{{ t("stats.code") }}</h3>
      <el-row>
        <el-col :span="8" :class="project.success < 1 ? 'is-opacity' : ''">
          <el-statistic
            :title="t('stats.200')"
            group-separator=" "
            :value="project.success"
          >
            <template #prefix>
              <el-icon color="#67C23A" style="vertical-align: -0.125em">
                <SuccessFilled />
              </el-icon>
            </template>
          </el-statistic>
        </el-col>
        <el-col
          :span="8"
          :class="(project.data.stats?.redirect || 0) < 1 ? 'is-opacity' : ''"
        >
          <el-statistic
            :title="t('stats.301')"
            group-separator=" "
            :value="project.data.stats?.redirect || 0"
          >
            <template #prefix>
              <el-icon color="#E6A23C" style="vertical-align: -0.125em">
                <WarningFilled />
              </el-icon>
            </template>
          </el-statistic>
        </el-col>
        <el-col
          :span="8"
          :class="(project.data.stats?.error || 0) < 1 ? 'is-opacity' : ''"
        >
          <el-statistic
            :title="t('stats.error')"
            group-separator=" "
            :value="project.data.stats?.error || 0"
          >
            <template #prefix>
              <el-icon color="#F56C6C" style="vertical-align: -0.125em">
                <CircleCloseFilled />
              </el-icon>
            </template>
          </el-statistic>
        </el-col>
      </el-row>
    </el-card>

    <el-card class="flex-1" shadow="never">
      <h3 class="mb-4">{{ t("stats.depth") }}</h3>
      <el-row>
        <el-col
          :span="8"
          :class="(project.data.stats?.depth3 || 0) < 1 ? 'is-opacity' : ''"
        >
          <el-statistic
            title="1-3"
            group-separator=" "
            :value="project.data.stats?.depth3 || 0"
          >
            <template #prefix>
              <el-icon color="#67C23A" style="vertical-align: -0.125em">
                <Flag />
              </el-icon>
            </template>
          </el-statistic>
        </el-col>
        <el-col
          :span="8"
          :class="(project.data.stats?.depth5 || 0) < 1 ? 'is-opacity' : ''"
        >
          <el-statistic
            title="4-5"
            group-separator=" "
            :value="project.data.stats?.depth5 || 0"
          >
            <template #prefix>
              <el-icon color="#E6A23C" style="vertical-align: -0.125em">
                <Flag />
              </el-icon>
            </template>
          </el-statistic>
        </el-col>
        <el-col
          :span="8"
          :class="(project.data.stats?.depth6 || 0) < 1 ? 'is-opacity' : ''"
        >
          <el-statistic
            :title="t('stats.6more')"
            group-separator=" "
            :value="project.data.stats?.depth6 || 0"
          >
            <template #prefix>
              <el-icon color="#F56C6C" style="vertical-align: -0.125em">
                <Flag />
              </el-icon>
            </template>
          </el-statistic>
        </el-col>
      </el-row>
    </el-card>
  </div>

  <!-- <el-card class="ml-1" shadow="never">
    <template #header>
      <div class="card-header">
        <div class="text-12 mb-2">
          Проверено {{ fetched }}
          <span v-if="queue">из {{ fetchedqueue }}</span>
        </div>
        <el-progress
          :text-inside="true"
          :stroke-width="15"
          :percentage="Math.round((fetched / fetchedqueue) * 100) || 0"
        />
      </div>
    </template>
    <div>
     
      <el-divider />
     
      <el-divider />
      
      <el-divider>
        <el-icon><Plus /></el-icon>
      </el-divider>
    </div>
  </el-card> -->
</template>

<script setup>
import { useProjectStore } from "../../stores/project";
import { useI18n } from "vue-i18n";
import {
  CirclePlus,
  CirclePlusFilled,
  RemoveFilled,
  Postcard,
  Tickets,
  Picture,
  SuccessFilled,
  WarningFilled,
  CircleCloseFilled,
  Flag,
} from "@element-plus/icons-vue";

const { t } = useI18n();
const project = useProjectStore();
</script>

<style scoped>
.is-opacity {
  opacity: 0.5;
}

/* Tweak typography only for rows inside those cards */
.el-card.flex-1.mr-1 .el-row {
  letter-spacing: -0.04em;
}
</style>

<style>
/* Стили для progress bar в темной теме */
html.dark .el-progress {
  --el-progress-text-color: var(--el-text-color-primary);
}

html.dark .el-progress-bar__outer {
  background-color: var(--el-fill-color-darker) !important;
  border: 1px solid var(--el-border-color) !important;
}

html.dark .el-progress__text {
  color: var(--el-text-color-primary) !important;
}

/* Цветовая схема иконок в темной теме - селекторы для CSS переменных */
html.dark .el-statistic .el-icon[style*="--color: #67C23A"] {
  color: #8fb78f !important; /* Более приглушенный зеленый для темной темы */
}

html.dark .el-statistic .el-icon[style*="--color: #F56C6C"] {
  color: #d4a5a5 !important; /* Более приглушенный красный для темной темы */
}

html.dark .el-statistic .el-icon[style*="--color: #E6A23C"] {
  color: #c4a676 !important; /* Более приглушенный желтый для темной темы */
}

html.dark .el-statistic .el-icon[style*="--color: #909399"] {
  color: #9ca3af !important; /* Приглушенный серый для темной темы */
}

/* Дополнительные стили для карточек статистики в темной теме */
html.dark .el-statistic__content {
  color: var(--el-text-color-primary) !important;
}

html.dark .el-statistic__head {
  color: var(--el-text-color-regular) !important;
}

html.dark .el-statistic__number {
  color: var(--el-text-color-primary) !important;
}
</style>
