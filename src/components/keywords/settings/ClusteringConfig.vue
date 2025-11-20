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
                Связные компоненты (Connected Components)
              </h3>
              <p>
                Простой и быстрый, но может слить всё в один кластер при низком
                пороге.
              </p>
              <p>
                <strong>Описание</strong><br />
                Строится граф, где каждый запрос — вершина, а ребро между двумя
                вершинами появляется, если их эмбеддинги имеют косинусное
                сходство выше порога (threshold). Кластерами считаются связанные
                компоненты графа, содержащие как минимум две вершины.
              </p>
              <p>
                <strong>Когда использовать</strong><br />
                Быстрый и понятный метод для ситуаций с явными семантическими
                группами. Контролируется одним параметром — порогом сходства.
              </p>
              <p>
                <strong>Плюсы:</strong>
                простота и скорость.
              </p>
              <p>
                <strong>Минусы:</strong>
                при низком пороге возможен эффект «цепочки», когда несколько
                промежуточных фраз связывают большие группы в один кластер.
              </p>
            </div>

            <div class="mb-2">
              <h3 class="font-bold mb-2">
                DBSCAN (Density-Based Spatial Clustering)
              </h3>

              <p>
                Учитывает локальную плотность, защищает от эффекта цепочки, но
                сложнее настроить.
              </p>
              <p>
                <strong>Описание</strong><br />
                Кластеры формируются вокруг плотных областей в пространстве
                эмбеддингов. Точка становится ядром, если в окружности радиуса
                eps находится не менее minPts соседей по мере косинусного
                расстояния (1 - сходство). Кластеры растут от таких ядер, а
                редкие точки считаются выбросами.
              </p>
              <p>
                <strong>Когда использовать</strong><br />
                Подходит, если нужно избежать эффекта цепочки и фильтровать
                одиночные, нерелевантные запросы. Требует настройки двух
                параметров (eps, minPts).
              </p>
              <p>
                <strong>Плюсы:</strong>
                устойчивость к эффекту цепочки и фильтрация шумовых точек.
              </p>
              <p>
                <strong>Минусы:</strong>
                требует подбора параметров, некоторые релевантные одиночные
                точки могут остаться не кластеризованными.
              </p>
            </div>

            <div class="text-xs text-gray-400 mt-2">
              <strong>Совет:</strong> для строгих кластеров попробуйте связные
              компоненты с threshold ≈ 0.8. Если кластеры получаются слишком
              большими — протестируйте DBSCAN с eps ≈ 0.2 и minPts = 2.
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
            <!-- Short descriptions moved into the method descriptions above -->
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
              class=""
              v-model="dbscanEps"
              :step="0.01"
              :min="0.05"
              :max="0.95"
              show-input
            />
            <div class="text-xs text-gray-500 mt-1">
              Чем больше eps → тем больше точек будут объединяться в один
              кластер.
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
            <div class="form-helper text-xs text-gray-500 mt-1">
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

// Locale-safe number coercion [0,1]
function toNumber01(x) {
  const n =
    typeof x === "number" ? x : Number(String(x ?? "").replace(",", "."));
  if (!isFinite(n) || isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

// Keep form.eps in sync with slider value
watch(
  () => value.value,
  (v) => {
    const n = toNumber01(v);
    if (n !== value.value) value.value = n;
    form.value.eps = n;
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

// IPC-based architecture: clustering diagnostics are handled differently
// No socket listeners needed - data flows through IPC handlers

// debounce timer for saving settings
let saveTimer = null;

function persistToProject() {
  const projectId =
    project.currentProjectId || (project.data && project.data.id);
  if (!projectId) return;
  try {
    if (!project.data) project.data = {};
    project.data.clustering_eps = toNumber01(form.value.eps);
    project.data.clustering_algorithm = form.value.algorithm;
    project.data.clustering_dbscan_eps = toNumber01(dbscanEps.value);
    project.data.clustering_dbscan_minPts = Number(dbscanMinPts.value);
    project.updateProject();
  } catch (e) {
    console.warn("Failed to persist clustering params to project", e);
  }
}

// Initialize form from current project settings if available
if (project && project.data) {
  try {
    const eps = toNumber01(project.data.clustering_eps);
    const algorithm = project.data.clustering_algorithm;
    const dbscan_eps = project.data.clustering_dbscan_eps;
    const dbscan_minPts = project.data.clustering_dbscan_minPts;

    if (typeof eps !== "undefined" && eps !== null) {
      form.value.eps = eps;
      value.value = eps; // Sync slider
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
      const eps = toNumber01(project.data && project.data.clustering_eps);
      const algorithm = project.data && project.data.clustering_algorithm;
      const dbscan_eps = project.data && project.data.clustering_dbscan_eps;
      const dbscan_minPts =
        project.data && project.data.clustering_dbscan_minPts;

      if (typeof eps !== "undefined" && eps !== null) {
        form.value.eps = eps;
        value.value = eps; // Sync slider
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
  const eps = toNumber01(form.value.eps);
  const minPts = Number(dbscanMinPts.value);
  ipcClient
    .startClustering(
      Number(projectId),
      algorithm,
      algorithm === "components" ? eps : toNumber01(dbscanEps.value),
      algorithm === "dbscan" ? minPts : undefined
    )
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

.form-helper {
  width: 100%;
}
</style>
