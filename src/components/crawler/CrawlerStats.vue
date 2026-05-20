<template>
  <div class="stats-container">
    <el-card class="stats-card" shadow="never">
      <h3 class="mb-4">{{ t("stats.status") }}</h3>
      <el-row>
        <el-col :span="8" :class="(stats.queue || 0) < 1 ? 'is-opacity ' : ''">
          <el-statistic
            class="status-stat"
            :title="t('stats.queue')"
            group-separator=" "
            :value="stats.queue || 0"
            :formatter="formatCompactStat"
          >
            <template #prefix>
              <i-tabler-circle-plus
                color="#67C23A"
                style="vertical-align: -0.125em"
              />
            </template>
          </el-statistic>
        </el-col>
        <el-col
          :span="8"
          :class="(stats.fetched || 0) < 1 ? 'is-opacity ' : ''"
        >
          <el-statistic
            class="status-stat"
            :title="t('stats.checked')"
            group-separator=" "
            :value="stats.fetched || 0"
            :formatter="formatCompactStat"
          >
            <template #prefix>
              <i-tabler-circle-plus-filled
                color="#67C23A"
                style="vertical-align: -0.125em"
              />
            </template>
          </el-statistic>
        </el-col>
        <el-col
          :span="8"
          :class="(stats.disallow || 0) < 1 ? 'is-opacity' : ''"
        >
          <el-statistic
            class="status-stat"
            :title="t('stats.ban')"
            group-separator=" "
            :value="stats.disallow || 0"
            :formatter="formatCompactStat"
          >
            <template #prefix>
              <i-tabler-circle-x-filled
                color="#F56C6C"
                style="vertical-align: -0.125em"
              />
            </template>
          </el-statistic>
        </el-col>
      </el-row>
    </el-card>

    <el-card class="stats-card" shadow="never">
      <h3 class="mb-4">{{ t("stats.contentType") }}</h3>
      <el-row>
        <el-col :span="8" :class="(stats.html || 0) < 1 ? 'is-opacity' : ''">
          <el-statistic
            title="HTML"
            group-separator=" "
            :value="stats.html || 0"
          >
            <template #prefix>
              <i-tabler-file-text
                color="#909399"
                style="vertical-align: -0.125em"
              />
            </template>
          </el-statistic>
        </el-col>
        <el-col :span="8" :class="(stats.jscss || 0) < 1 ? 'is-opacity' : ''">
          <el-statistic
            title="Javascript, css"
            group-separator=" "
            :value="stats.jscss || 0"
          >
            <template #prefix>
              <i-tabler-ticket
                color="#909399"
                style="vertical-align: -0.125em"
              />
            </template>
          </el-statistic>
        </el-col>
        <el-col :span="8" :class="(stats.image || 0) < 1 ? 'is-opacity' : ''">
          <el-statistic
            title="Image"
            group-separator=" "
            :value="stats.image || 0"
          >
            <template #prefix>
              <i-tabler-photo
                color="#909399"
                style="vertical-align: -0.125em"
              />
            </template>
          </el-statistic>
        </el-col>
      </el-row>

      <!-- <el-divider /> -->
    </el-card>

    <el-card class="stats-card" shadow="never">
      <h3 class="mb-4">{{ t("stats.code") }}</h3>
      <el-row>
        <el-col :span="8" :class="success < 1 ? 'is-opacity' : ''">
          <el-statistic
            :title="t('stats.200')"
            group-separator=" "
            :value="success"
          >
            <template #prefix>
              <i-tabler-circle-check-filled
                color="#67C23A"
                style="vertical-align: -0.125em"
              />
            </template>
          </el-statistic>
        </el-col>
        <el-col
          :span="8"
          :class="(stats.redirect || 0) < 1 ? 'is-opacity' : ''"
        >
          <el-statistic
            :title="t('stats.301')"
            group-separator=" "
            :value="stats.redirect || 0"
          >
            <template #prefix>
              <i-tabler-alert-circle-filled
                color="#E6A23C"
                style="vertical-align: -0.125em"
              />
            </template>
          </el-statistic>
        </el-col>
        <el-col :span="8" :class="(stats.error || 0) < 1 ? 'is-opacity' : ''">
          <el-statistic
            :title="t('stats.error')"
            group-separator=" "
            :value="stats.error || 0"
          >
            <template #prefix>
              <i-tabler-circle-x-filled
                color="#F56C6C"
                style="vertical-align: -0.125em"
              />
            </template>
          </el-statistic>
        </el-col>
      </el-row>
    </el-card>

    <el-card class="stats-card" shadow="never">
      <h3 class="mb-4">{{ t("stats.depth") }}</h3>
      <el-row>
        <el-col :span="8" :class="(stats.depth3 || 0) < 1 ? 'is-opacity' : ''">
          <el-statistic
            title="1-3"
            group-separator=" "
            :value="stats.depth3 || 0"
          >
            <template #prefix>
              <i-tabler-flag color="#67C23A" style="vertical-align: -0.125em" />
            </template>
          </el-statistic>
        </el-col>
        <el-col :span="8" :class="(stats.depth5 || 0) < 1 ? 'is-opacity' : ''">
          <el-statistic
            title="4-5"
            group-separator=" "
            :value="stats.depth5 || 0"
          >
            <template #prefix>
              <i-tabler-flag color="#E6A23C" style="vertical-align: -0.125em" />
            </template>
          </el-statistic>
        </el-col>
        <el-col :span="8" :class="(stats.depth6 || 0) < 1 ? 'is-opacity' : ''">
          <el-statistic
            :title="t('stats.6more')"
            group-separator=" "
            :value="stats.depth6 || 0"
          >
            <template #prefix>
              <i-tabler-flag color="#F56C6C" style="vertical-align: -0.125em" />
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
import { computed, reactive, watch } from "vue";
import { useProjectStore } from "../../stores/project";
import { useI18n } from "vue-i18n";

const { t } = useI18n();
const project = useProjectStore();

const stats = reactive({
  fetched: 0,
  queue: 0,
  disallow: 0,
  html: 0,
  jscss: 0,
  image: 0,
  redirect: 0,
  error: 0,
  depth3: 0,
  depth5: 0,
  depth6: 0,
});

const success = computed(() => {
  const fetched = Number(stats.fetched || 0);
  const redirect = Number(stats.redirect || 0);
  const error = Number(stats.error || 0);
  return Math.max(0, fetched - redirect - error);
});

function formatCompactStat(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return "0";

  const abs = Math.abs(num);
  const toShort = (divider, suffix) => {
    const short = (num / divider).toFixed(1).replace(/\.0$/, "");
    return `${short}${suffix}`;
  };

  if (abs >= 1_000_000_000) return toShort(1_000_000_000, "B");
  if (abs >= 1_000_000) return toShort(1_000_000, "M");
  if (abs >= 1_000) return toShort(1_000, "K");

  return new Intl.NumberFormat("ru-RU").format(num);
}

function syncFromStore() {
  const s = project.data?.stats || {};
  stats.fetched = s.fetched || 0;
  stats.queue = s.queue || 0;
  stats.disallow = s.disallow || 0;
  stats.html = s.html || 0;
  stats.jscss = s.jscss || 0;
  stats.image = s.image || 0;
  stats.redirect = s.redirect || 0;
  stats.error = s.error || 0;
  stats.depth3 = s.depth3 || 0;
  stats.depth5 = s.depth5 || 0;
  stats.depth6 = s.depth6 || 0;
}

watch(
  () => project.data?.stats,
  () => syncFromStore(),
  { deep: true, immediate: true },
);

watch(
  () => project.currentProjectId,
  () => syncFromStore(),
);
</script>

<style scoped>
.stats-container {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0.25rem;
  width: 100%;
}

.stats-card {
  min-width: 0;
}

/* Плавное уменьшение размера текста на узких экранах */
.stats-card h3 {
  font-size: clamp(0.75rem, 1.5vw, 1rem);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.stats-card :deep(.el-statistic__head) {
  font-size: clamp(0.65rem, 1.2vw, 0.875rem);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: center;
}

.stats-card :deep(.el-statistic__content-value) {
  font-size: clamp(1.5rem, 3vw, 2.875rem) !important;
  white-space: nowrap;
}

.stats-card :deep(.el-statistic__content .el-icon) {
  font-size: clamp(16px, 2vw, 24px) !important;
  flex-shrink: 0;
}

/* Только для совсем узких экранов делаем дополнительное уменьшение */
@media (max-width: 600px) {
  .stats-card h3 {
    font-size: 0.7rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .stats-card :deep(.el-statistic__head) {
    font-size: 0.6rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    text-align: center;
  }

  .stats-card :deep(.el-statistic__content-value) {
    font-size: 1.25rem !important;
    white-space: nowrap;
  }

  .stats-card :deep(.el-statistic__content .el-icon) {
    font-size: 14px !important;
  }
}

.is-opacity {
  opacity: 0.5;
}

/* Tweak typography only for rows inside those cards */
.stats-card .el-row {
  letter-spacing: -0.04em;
  width: 100%;
  display: flex;
  justify-content: space-between;
  flex-wrap: nowrap;
}

.stats-card :deep(.el-col) {
  display: flex;
  justify-content: center;
  align-items: center;
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.stats-card :deep(.el-statistic) {
  text-align: center;
  width: 100%;
  overflow: hidden;
}

.stats-card h3 {
  color: var(--el-text-color-regular);
}

:deep(.el-statistic__head) {
  color: var(--el-text-color-regular);
  text-align: center;
}

:deep(.el-statistic__content) {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: nowrap;
  gap: 2px;
  overflow: hidden;
}

:deep(.status-stat .el-statistic__content) {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: nowrap;
  gap: 2px;
  overflow: hidden;
}

:deep(.status-stat .el-statistic__content-value) {
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  line-height: 1;
  font-size: clamp(32px, 2.6vw, 46px);
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>

<style></style>
