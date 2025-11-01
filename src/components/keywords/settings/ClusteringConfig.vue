<template>
  <div>
    <div class="demo-collapse mb-4">
      <el-collapse accordion>
        <el-collapse-item name="1">
          <template #title="{ isActive }">
            <div :class="['title-wrapper', { 'is-active': isActive }]">
              Алгоритмы кластеризации
              <el-icon class="header-icon">
                <InfoFilled />
              </el-icon>
            </div>
          </template>
          <div class="text-sm">
            <div class="mb-4">
              <h3 class="font-bold mb-2">
                🔗 Связные компоненты (Connected Components)
              </h3>
              <strong>Принцип:</strong> Строится граф сходства, где фразы —
              вершины, а рёбра соединяют пары с косинусным сходством ≥
              threshold. Кластеры = связные компоненты графа.<br /><br />

              <strong>Алгоритм:</strong><br />
              • Получить эмбеддинги для всех запросов через OpenAI Embeddings<br />
              • Построить граф: ребро между фразами, если сходство ≥
              threshold<br />
              • Найти связные компоненты (DFS/BFS), компоненты ≥ 2 фраз →
              кластеры<br />
              • Присвоить метки <code>cluster-1</code>, <code>cluster-2</code>,
              ...<br /><br />

              <strong>Плюсы:</strong> Простой (1 параметр), быстрый, хорош для
              чётких групп.<br />
              <strong>Минусы:</strong> Риск "эффекта цепочки" — при низком
              threshold всё может слиться в один кластер через промежуточные
              фразы.
            </div>

            <div class="mb-2">
              <h3 class="font-bold mb-2">
                🎯 DBSCAN (Density-Based Spatial Clustering)
              </h3>
              <strong>Принцип:</strong> Плотностная кластеризация. Точка
              становится ядром кластера, если в радиусе eps у неё ≥ minPts
              соседей. Кластеры растут от ядер, не сливая всё подряд.<br /><br />

              <strong>Алгоритм:</strong><br />
              • Для каждой фразы найти соседей в радиусе eps (косинусное
              расстояние = 1 - сходство)<br />
              • Если соседей ≥ minPts → фраза = ядро кластера<br />
              • Рекурсивно добавить соседей ядер в кластер<br />
              • Фразы без достаточной плотности (выбросы) игнорируются и
              остаются без метки кластера<br /><br />

              <strong>Плюсы:</strong> Защита от цепочки, учёт локальной
              плотности, фильтрация одиночных фраз.<br />
              <strong>Минусы:</strong> Сложнее настроить (2 параметра: eps и
              minPts), выбросы не кластеризуются.
            </div>

            <div class="text-xs text-gray-400 mt-2">
              💡 <strong>Совет:</strong> Для строгих кластеров начните со
              <strong>Связных компонент (threshold=0.8)</strong>. Если получаете
              гигантские кластеры — попробуйте
              <strong>DBSCAN (eps=0.2, minPts=2)</strong>.
            </div>

            <div class="text-xs text-amber-600 mt-3 p-2 bg-amber-50 rounded">
              ⚠️ <strong>Внимание:</strong> Кластеризация применяется только к
              <strong>целевым запросам</strong> (target_query = 1). Остальные
              фразы остаются без метки кластера.
            </div>
          </div>
        </el-collapse-item>
      </el-collapse>
      <!-- Settings moved below the collapse -->
      <div class="mt-4">
        <el-form :model="form" label-position="left" label-width="250px">
          <el-form-item label="Алгоритм кластеризации">
            <el-select v-model="form.algorithm" placeholder="Выберите алгоритм">
              <el-option label="Связные компоненты" value="components" />
              <el-option
                label="DBSCAN (плотностная кластеризация)"
                value="dbscan"
              />
            </el-select>
            <div class="text-xs text-gray-500 mt-1">
              <strong>Связные компоненты:</strong> простой и быстрый, но может
              слить всё в один кластер при низком пороге.<br />
              <strong>DBSCAN:</strong> учитывает локальную плотность, защищает
              от эффекта цепочки, но сложнее настроить.
            </div>
          </el-form-item>

          <el-form-item
            v-if="form.algorithm === 'components'"
            label="Порог сходства (threshold)"
          >
            <el-slider
              class="class-slider"
              v-model="value"
              :step="0.01"
              :min="0"
              :max="1"
              show-input
            />
            <div class="text-xs text-gray-500 mt-1">
              Минимальное косинусное сходство для создания связи между фразами.
              Рекомендуется 0.7–0.85 для строгих кластеров.
            </div>
          </el-form-item>

          <el-form-item
            v-if="form.algorithm === 'dbscan'"
            label="Радиус окрестности (eps)"
          >
            <el-slider
              class="class-slider"
              v-model="dbscanEps"
              :step="0.01"
              :min="0.05"
              :max="0.95"
              show-input
            />
            <div class="text-xs text-gray-500 mt-1">
              Косинусное расстояние = 1 - сходство. Для сходства 0.7 → eps=0.3.
              Меньше eps → строже кластеры.
            </div>
          </el-form-item>

          <el-form-item
            v-if="form.algorithm === 'dbscan'"
            label="Минимум точек (minPts)"
          >
            <el-input-number
              v-model="dbscanMinPts"
              :min="1"
              :max="10"
              :step="1"
            />
            <div class="text-xs text-gray-500 mt-1">
              Минимальное количество соседей для формирования плотной области.
              Обычно 2–5.
            </div>
          </el-form-item>
        </el-form>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from "vue";
import { watch } from "vue";
import { ipcClient } from "../../../stores/socket-client";
import { useProjectStore } from "../../../stores/project";
import { InfoFilled } from "@element-plus/icons-vue";
import {
  ElForm,
  ElFormItem,
  ElInputNumber,
  ElSlider,
  ElSelect,
  ElOption,
  ElButton,
  ElCollapse,
  ElCollapseItem,
  ElIcon,
} from "element-plus";

const project = useProjectStore();

const form = ref({
  eps: 0.5,
  algorithm: "components", // 'components' or 'dbscan'
});

// Local slider value bound to UI
const value = ref(form.value.eps);

// DBSCAN-specific parameters
const dbscanEps = ref(0.3); // косинусное расстояние (1 - similarity)
const dbscanMinPts = ref(2);

// Keep form.eps in sync with slider value
watch(
  () => value.value,
  (v) => {
    form.value.eps = Number(v);
  }
);

// Persist settings changes
watch(
  () => [
    form.value.algorithm,
    form.value.eps,
    dbscanEps.value,
    dbscanMinPts.value,
  ],
  () => {
    persistToProject();
  },
  { deep: true }
);

const diagnostics = ref({
  sample: 0,
  medianNNsim: 0,
  p75: 0,
  suggestedThreshold: 0,
  hist: [],
});

// listen for clustering diagnostics emitted by server when worker runs
socket.on("keywords:clustering-diagnostics", (payload) => {
  try {
    if (!payload || !payload.projectId) return;
    const d = payload.diagnostics || payload;
    diagnostics.value = {
      sample: d.sample || 0,
      medianNNsim: d.medianNNsim || 0,
      p75: d.p75 || 0,
      suggestedThreshold: d.suggestedThreshold || 0,
      hist: Array.isArray(d.hist) ? d.hist : [],
    };
  } catch (e) {}
});

// debounce timer for saving settings
let saveTimer = null;

function persistToProject() {
  const projectId =
    project.currentProjectId || (project.data && project.data.id);
  if (!projectId) return;
  try {
    if (!project.data) project.data = {};
    project.data.clustering_eps = Number(form.value.eps);
    project.data.clustering_algorithm = form.value.algorithm;
    project.data.clustering_dbscan_eps = Number(dbscanEps.value);
    project.data.clustering_dbscan_minPts = Number(dbscanMinPts.value);
    project.updateProject();
  } catch (e) {
    console.warn("Failed to persist clustering params to project", e);
  }
}

// Initialize form from current project settings if available
if (project && project.data) {
  try {
    const eps = project.data.clustering_eps;
    const algorithm = project.data.clustering_algorithm;
    const dbscan_eps = project.data.clustering_dbscan_eps;
    const dbscan_minPts = project.data.clustering_dbscan_minPts;

    if (typeof eps !== "undefined" && eps !== null) {
      form.value.eps = Number(eps);
      value.value = Number(eps); // Sync slider
    }
    if (typeof algorithm !== "undefined" && algorithm !== null)
      form.value.algorithm = String(algorithm);
    if (typeof dbscan_eps !== "undefined" && dbscan_eps !== null)
      dbscanEps.value = Number(dbscan_eps);
    if (typeof dbscan_minPts !== "undefined" && dbscan_minPts !== null)
      dbscanMinPts.value = Number(dbscan_minPts);
  } catch (e) {
    // ignore
  }
}

// Update form when current project changes
watch(
  () => project.currentProjectId,
  (newId) => {
    if (!newId) return;
    try {
      const eps = project.data && project.data.clustering_eps;
      const algorithm = project.data && project.data.clustering_algorithm;
      const dbscan_eps = project.data && project.data.clustering_dbscan_eps;
      const dbscan_minPts =
        project.data && project.data.clustering_dbscan_minPts;

      if (typeof eps !== "undefined" && eps !== null) {
        form.value.eps = Number(eps);
        value.value = Number(eps); // Sync slider
      }
      if (typeof algorithm !== "undefined" && algorithm !== null)
        form.value.algorithm = String(algorithm);
      if (typeof dbscan_eps !== "undefined" && dbscan_eps !== null)
        dbscanEps.value = Number(dbscan_eps);
      if (typeof dbscan_minPts !== "undefined" && dbscan_minPts !== null)
        dbscanMinPts.value = Number(dbscan_minPts);
    } catch (e) {}
  }
);

// watch the form and persist changes (debounced)
watch(
  form,
  () => {
    // if no project, don't attempt to persist
    if (!project || !project.currentProjectId) return;
    // debounce writes to avoid excessive socket calls
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      persistToProject();
    }, 500);
  },
  { deep: true }
);

const components = {
  ElForm,
  ElFormItem,
  ElInputNumber,
  ElSlider,
  ElSelect,
  ElOption,
  ElButton,
  ElCollapse,
  ElCollapseItem,
  ElIcon,
  InfoFilled,
};

function resetDefaults() {
  form.value.eps = 0.5;
  form.value.method = "components";
}

function applySuggested() {
  if (!diagnostics.value || !diagnostics.value.suggestedThreshold) return;
  form.value.eps = Number(diagnostics.value.suggestedThreshold);
  // persist immediately
  persistToProject();
}

function startClustering() {
  const projectId = project.currentProjectId || project.id || null;
  if (!projectId) {
    console.error("Project not selected");
    return;
  }

  // persist clustering params to project and save
  try {
    if (!project.data) project.data = {};
    project.data.clustering_eps = Number(form.value.eps);
    project.data.clustering_method = String("components");
    project.updateProject();
  } catch (e) {
    console.warn("Failed to persist clustering params to project", e);
  }

  const algorithm = String(form.value.algorithm || "components");
  const eps = Number(form.value.eps);
  const minPts = Number(dbscanMinPts.value);
  ipcClient
    .startClustering(Number(projectId), algorithm, algorithm === 'components' ? eps : Number(dbscanEps.value), algorithm === 'dbscan' ? minPts : undefined)
    .then(() => {
      // optionally show feedback
    })
    .catch((e) => console.error("Failed to start clustering via IPC", e));
}
</script>

<style scoped>
.class-slider :deep(.el-slider__runway) {
  background-color: var(--el-slider-main-bg-color) !important;
}

/* Set filled portion (before value) to theme runway color as requested */
.class-slider :deep(.el-slider__bar) {
  background-color: var(--el-slider-runway-bg-color) !important;
}
</style>
