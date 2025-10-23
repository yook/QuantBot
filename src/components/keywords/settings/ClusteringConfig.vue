<template>
  <div>
    <div class="demo-collapse mb-4">
      <el-collapse accordion>
        <el-collapse-item name="1">
          <template #title="{ isActive }">
            <div :class="['title-wrapper', { 'is-active': isActive }]">
              Кластеризация по порогу сходства (компоненты связности)
              <el-icon class="header-icon">
                <InfoFilled />
              </el-icon>
            </div>
          </template>
          <div class="text-sm">
            <div class="mb-2">
              <h3></h3>
              <strong>Цель:</strong><br />
              Разделение множества запросов на группы (кластеры) так, чтобы
              запросы внутри одного кластера были максимально похожи друг на
              друга.
              <br /><br />
              <strong>Описание:</strong><br />
              Для каждого запроса вычисляется embedding (векторное
              представление) с помощью OpenAI Embeddings. Затем строится граф
              сходства: мы соединяем пары запросов, у которых косинусное
              сходство не ниже заданного порога eps. Кластеры определяются как
              связные компоненты этого графа (группы точек, соединённых через
              цепочки похожих пар). Одиночные точки (без связей) не формируют
              кластер. Метод не требует заранее задавать число кластеров, а
              результат контролируется одним параметром eps: чем выше порог —
              тем меньше и плотнее кластеры.
            </div>
            <div>
              <strong>Алгоритм:</strong><br />
              • Получить эмбеддинги для всех запросов через OpenAI
              Embeddings.<br />
              • Построить граф: вершины — запросы; ребро между двумя вершинами,
              если косинусное сходство их эмбеддингов ≥ eps.<br />
              • Найти связные компоненты графа (DFS/BFS); компоненты размером ≥
              2 считаются кластерами.<br />
              • Для каждого кластера вычисляется центроид (усреднение
              нормированных векторов) — для анализа и возможного расширения.<br />
              • Каждому запросу из компоненты присваивается метка кластера вида
              <code>cluster-1</code>, <code>cluster-2</code>, … Одиночные точки
              остаются без метки кластера.
            </div>
          </div>
        </el-collapse-item>
      </el-collapse>
      <!-- Settings moved below the collapse -->
      <div class="mt-4">
        <el-form :model="form" label-position="left" label-width="250px">
          <el-form-item label="Порог чувствительности (eps)">
            <el-slider
              class="class-slider"
              v-model="value"
              :step="0.01"
              :min="0"
              :max="1"
              show-input
            />
            <div class="text-xs text-gray-500 mt-1">
              Порог чувствительности (eps) — это значение, выше которого фразы
              считаются похожими.
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
import socket from "../../../stores/socket-client";
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
  method: "components",
});

// Local slider value bound to UI
const value = ref(form.value.eps);

// Keep form.eps in sync with slider value
watch(
  () => value.value,
  (v) => {
    form.value.eps = Number(v);
  }
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
    project.data.clustering_method = String("components");
    project.updateProject();
  } catch (e) {
    console.warn("Failed to persist clustering params to project", e);
  }
}

// Initialize form from current project settings if available
if (project && project.data) {
  try {
    const eps = project.data.clustering_eps;
    const method = project.data.clustering_method;
    if (typeof eps !== "undefined" && eps !== null)
      form.value.eps = Number(eps);
    if (typeof method !== "undefined" && method !== null)
      form.value.method = String(method);
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
      const method = project.data && project.data.clustering_method;
      if (typeof eps !== "undefined" && eps !== null)
        form.value.eps = Number(eps);
      if (typeof method !== "undefined" && method !== null)
        form.value.method = String(method);
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

  socket.emit("keywords:start-clustering", {
    projectId,
    eps: Number(form.value.eps),
    method: String("components"),
  });
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
