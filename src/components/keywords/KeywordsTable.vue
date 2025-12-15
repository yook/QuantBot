<template>
  <el-card shadow="never" class="table-cart">
    <el-row class="mb-4">
      <el-col :span="12">
        <el-input
          ref="searchInputRef"
          v-model="input3"
          style="width: 240px"
          size="small"
          placeholder="Введите запрос"
          :prefix-icon="Search"
          clearable
          @keyup.enter="handleSearch"
          @clear="handleClear"
        />
        <span class="mx-3">
          <el-text type="info">{{ keywordsStore.totalCount }}</el-text></span
        >
      </el-col>
      <el-col :span="12" class="text-right text-sm">
        <!-- Settings button (table columns) -->
        <el-button
          size="small"
          type="primary"
          plain
          @click="tableSettingsDialog = true"
        >
          <el-icon><Grid /></el-icon>
        </el-button>

        <!-- Export to XLS -->
        <el-button
          size="small"
          @click="handleDownloadKeywords"
          :disabled="keywordsStore.keywordCount === 0"
        >
          <el-icon><download /></el-icon>
          .xls
        </el-button>
      </el-col>
    </el-row>

    <!-- Table settings dialog -->
    <el-dialog
      width="900px"
      :title="t('keywords.tableSettingsTitle')"
      v-model="tableSettingsDialog"
    >
      <div class="text-center">
        <el-transfer
          v-model="currentTableColumns"
          :titles="[
            t('keywords.tableSettingsOff'),
            t('keywords.tableSettingsOn'),
          ]"
          :props="{ key: 'prop', label: 'name', disabled: 'disabled' }"
          :data="transferColumns"
        />
      </div>

      <template #footer>
        <span class="dialog-footer">
          <el-button type="primary" @click="tableSettingsDialog = false">{{
            t("keywords.tableSettingsConfirm")
          }}</el-button>
        </span>
      </template>
    </el-dialog>
    <DataTableFixed
      :tableColumns="tableColumns"
      :data="keywords"
      :totalCount="totalCount"
      :loading="loading"
      :loadingMore="loadingMore"
      :sort="sort"
      :loadWindow="loadWindow"
      :sortData="sortData"
      :loadData="loadData"
      :windowStart="keywordsStore.windowStart"
      :fixedColumns="2"
      dbKey="keywords"
      @delete-row="handleDeleteRow"
      @delete-all="handleDeleteAll"
      :heightOffset="257"
      @columns-reorder="onColumnsReorder"
    />
  </el-card>
</template>
<script setup>
import { useKeywordsStore } from "../../stores/keywords";
import { useProjectStore } from "../../stores/project";
// import KeywordsTable from "./KeywordsTable.vue";
import DataTableFixed from "../DataTableFixed.vue";
import { ref, computed, onMounted, watch, nextTick } from "vue";
import {
  Search,
  Operation,
  Delete,
  Download,
  Grid,
} from "@element-plus/icons-vue";
import { ElMessageBox } from "element-plus";
import { markRaw } from "vue";
import { useI18n } from "vue-i18n";
import { downloadKeywords } from "../../stores/export";
import saveColumnOrder from "../../utils/columnOrder";

const keywordsStore = useKeywordsStore();
const project = useProjectStore();
const { t } = useI18n();

// Search input model
const input3 = ref(keywordsStore.searchQuery);
const searchTimeout = ref(null);
const skipNextInputWatcher = ref(false);
const searchInputRef = ref(null);

// Диалог настроек таблицы
const tableSettingsDialog = ref(false);

// Полный список доступных колонок (с метаданными)
const allColumns = [
  // Ключевой запрос — обязательная колонка, не даём отключать
  { prop: "keyword", name: "Ключевой запрос", width: 400, disabled: true },
  { prop: "target_query", name: "Фильтр по стоп-словам", width: 240 },
  { prop: "blocking_rule", name: "Правило исключения", width: 240 },
  { prop: "created_at", name: t("table.date"), width: 180 },
  { prop: "category_info", name: "Категория", width: 240 },
  { prop: "class_info", name: "Класс", width: 240 },
  { prop: "cluster_label", name: "Кластер", width: 150 },
  { prop: "lemma", name: "Лемма", width: 200 },
  { prop: "tags", name: "Теги", width: 200 },
  { prop: "is_valid_headline", name: "Проверка согласованности", width: 140 },
  { prop: "validation_reason", name: "Правило согласованности", width: 320 },
  { prop: "_actions", name: "Actions", width: 50 },
];

// Ключи включенных колонок (правый список в Transfer)
const allColumnKeys = allColumns.map((c) => c.prop);
const currentTableColumns = ref(allColumnKeys);

const getStorageKey = () => {
  const pid = project.currentProjectId || "anon";
  return `keywords-table-columns-${pid}`;
};

const getLegacyStorageKey = () => {
  const pid = project.currentProjectId || "anon";
  return `table-columns-${pid}-keywords`;
};

function applyColumns(source) {
  if (!Array.isArray(source)) return;
  let next = source.filter((k) => allColumnKeys.includes(k));
  if (!next.includes("keyword")) next.unshift("keyword");
  currentTableColumns.value = Array.from(new Set(next));
}

function hydrateColumns() {
  // Приоритет: данные проекта (БД) -> localStorage (на проект) -> дефолт
  const fromProject = project.data?.columns?.keywords;
  if (Array.isArray(fromProject) && fromProject.length) {
    applyColumns(fromProject);
    return;
  }

  try {
    const saved = localStorage.getItem(getStorageKey());
    if (saved) {
      const arr = JSON.parse(saved);
      applyColumns(arr);
      return;
    }
    const legacy = localStorage.getItem(getLegacyStorageKey());
    if (legacy) {
      const arr = JSON.parse(legacy);
      applyColumns(arr);
      return;
    }
  } catch (e) {
    // ignore
  }

  applyColumns(allColumnKeys);
}

hydrateColumns();

// Сохраняем настройки при изменении
watch(
  () => currentTableColumns.value.slice(),
  (val) => {
    try {
      // Avoid recursive save: if project already has same columns, skip persisting
      const projCols =
        project.data && project.data.columns && project.data.columns.keywords;
      try {
        if (
          Array.isArray(projCols) &&
          JSON.stringify(projCols) === JSON.stringify(val)
        ) {
          // still update localStorage for UI consistency, but don't call saveColumnOrder
          try {
            localStorage.setItem(getStorageKey(), JSON.stringify(val));
            localStorage.setItem(getLegacyStorageKey(), JSON.stringify(val));
          } catch (_) {}
          return;
        }
      } catch (_) {}

      localStorage.setItem(getStorageKey(), JSON.stringify(val));
      // Persist to project and legacy key to keep backward compatibility
      saveColumnOrder(project, "keywords", val);
      try {
        localStorage.setItem(getLegacyStorageKey(), JSON.stringify(val));
      } catch (_) {}
    } catch (e) {
      // ignore
    }
  },
  { deep: false }
);

// При смене проекта поднимаем порядок колонок из БД/хранилища проекта
watch(
  () => project.currentProjectId,
  () => {
    hydrateColumns();
  }
);

// Когда из БД приезжают настройки колонок нового проекта (project.data.columns),
// повторно применяем порядок/видимость, чтобы не брать кеш от предыдущего проекта.
watch(
  () => project.data && project.data.columns && project.data.columns.keywords,
  () => {
    hydrateColumns();
  },
  { deep: false }
);

// Transfer data ordered to match currentTableColumns (so settings dialog shows same order)
const transferColumns = computed(() => {
  try {
    const orderMap = new Map();
    currentTableColumns.value.forEach((p, i) => orderMap.set(p, i));

    return allColumns.slice().sort((a, b) => {
      const aIdx = orderMap.has(a.prop)
        ? orderMap.get(a.prop)
        : 1000 + allColumns.findIndex((c) => c.prop === a.prop);
      const bIdx = orderMap.has(b.prop)
        ? orderMap.get(b.prop)
        : 1000 + allColumns.findIndex((c) => c.prop === b.prop);
      return aIdx - bIdx;
    });
  } catch (e) {
    return allColumns;
  }
});

// Вычисляемый список колонок для таблицы в соответствии с настройками
// Preserve explicit user order from `currentTableColumns`
const tableColumns = computed(() =>
  currentTableColumns.value
    .map((prop) => allColumns.find((c) => c.prop === prop))
    .filter(Boolean)
);

// Данные для передачи в таблицу
const keywords = computed(() => keywordsStore.keywords);
const totalCount = computed(() => keywordsStore.totalCount);
const loading = computed(() => keywordsStore.loading);
const loadingMore = computed(() => keywordsStore.loadingMore);
const sort = computed(() => keywordsStore.sort);

const loadWindow = (newWindowStart) => keywordsStore.loadWindow(newWindowStart);
const sortData = (options) => keywordsStore.sortKeywords(options);
const loadData = (projectId, options) =>
  keywordsStore.loadKeywords(projectId, options);

// Обработчики для действий с таблицей
const handleDeleteRow = (row) => {
  if (!row || !row.id) return;

  ElMessageBox.confirm(
    `Удалить ключевой запрос "${row.keyword || row.id}"?`,
    "Подтверждение удаления",
    {
      confirmButtonText: "Удалить",
      cancelButtonText: "Отмена",
      type: "error",
      icon: markRaw(Delete),
      customClass: "delete-msgbox-class",
    }
  )
    .then(() => {
      console.log("Delete keyword:", row.id);
      // Делегируем удаление в стор (он вызовет socket.emit и проверит соединение)
      keywordsStore.deleteKeyword(row.id);
    })
    .catch(() => {
      // Пользователь отменил удаление
    });
};

const handleDeleteAll = () => {
  // Логика удаления всех строк
  console.log("Delete all rows");
};

// Экспорт ключевых слов в XLSX
const handleDownloadKeywords = () => {
  // Используем текущие столбцы как экспортные колонки
  downloadKeywords(tableColumns.value);
};

onMounted(() => {
  if (project.currentProjectId) {
    keywordsStore.loadKeywords(project.currentProjectId, { resetSearch: true });
  }
});

// Handle column reorder from DataTableFixed: update local selection and persist to project
function onColumnsReorder(newOrder) {
  try {
    if (!Array.isArray(newOrder)) return;
    // Filter to valid columns and ensure 'keyword' exists
    const valid = newOrder.filter((p) => allColumnKeys.includes(p));
    if (!valid.includes("keyword")) valid.unshift("keyword");
    currentTableColumns.value = Array.from(new Set(valid));

    // Persist using shared util (saves to project and to localStorage)
    try {
      saveColumnOrder(project, "keywords", currentTableColumns.value);
    } catch (e) {
      console.error("saveColumnOrder failed", e);
    }
  } catch (e) {
    console.error("onColumnsReorder (keywords) error", e);
  }
}

// Слушаем изменения currentProjectId и загружаем ключевые запросы для нового проекта
watch(
  () => project.currentProjectId,
  (newProjectId) => {
    if (newProjectId) {
      keywordsStore.loadKeywords(newProjectId, { resetSearch: true });
      // Очищаем поиск при переключении проекта
      input3.value = "";
    }
  }
);

// Debounce search
watch(
  () => input3.value,
  (newQuery) => {
    // If previous handler indicated we should skip the next watcher run (e.g. manual clear), skip scheduling
    if (skipNextInputWatcher.value) {
      skipNextInputWatcher.value = false;
      // ensure any existing timeout is cleared
      if (searchTimeout.value) {
        clearTimeout(searchTimeout.value);
        searchTimeout.value = null;
      }
      return;
    }

    if (searchTimeout.value) {
      clearTimeout(searchTimeout.value);
    }
    searchTimeout.value = setTimeout(() => {
      if (newQuery.trim()) {
        keywordsStore.searchKeywords(newQuery.trim());
      } else {
        // Если пустой запрос, загружаем все
        keywordsStore.loadKeywords(project.currentProjectId, {
          resetSearch: true,
        });
      }
    }, 2000);
  }
);

// Синхронизируем input с searchQuery из store
watch(
  () => keywordsStore.searchQuery,
  (newSearchQuery) => {
    if (newSearchQuery !== input3.value) {
      input3.value = newSearchQuery;
    }
  }
);

// Убираем фокус после обновления данных поиска
watch(
  () => keywordsStore.keywords,
  () => {
    // Убираем фокус только если есть поисковый запрос
    if (input3.value.trim()) {
      nextTick(() => {
        if (searchInputRef.value) {
          searchInputRef.value.blur();
        }
      });
    }
  }
);

// Обработчик поиска при нажатии Enter
const handleSearch = () => {
  // Отменяем debounce таймер
  if (searchTimeout.value) {
    clearTimeout(searchTimeout.value);
    searchTimeout.value = null;
  }

  const query = input3.value.trim();
  if (query) {
    keywordsStore.searchKeywords(query);
  } else {
    // Если пустой запрос, загружаем все
    keywordsStore.loadKeywords(project.currentProjectId);
  }

  // Убираем фокус из поля ввода
  nextTick(() => {
    if (searchInputRef.value) {
      searchInputRef.value.blur();
    }
  });
};

// Обработчик очистки поля поиска
const handleClear = () => {
  // Отменяем debounce таймер
  if (searchTimeout.value) {
    clearTimeout(searchTimeout.value);
    searchTimeout.value = null;
  }

  // Загружаем все ключевые слова сразу
  // Prevent the input watcher debounce from triggering another load
  skipNextInputWatcher.value = true;
  keywordsStore.loadKeywords(project.currentProjectId, { resetSearch: true });
};
</script>

<style scoped>
.table-cart {
  height: 100%;
  min-height: 200px;
  display: flex;
  flex-direction: column;
}
</style>

<style>
/* Стили для поля поиска в темной теме */
html.dark .el-input--small .el-input__wrapper {
  background-color: var(--el-bg-color) !important;
  border-color: var(--el-border-color) !important;
  color: var(--el-text-color-primary) !important;
}

html.dark .el-input--small .el-input__inner {
  background-color: transparent !important;
  color: var(--el-text-color-primary) !important;
}

html.dark .el-input--small .el-input__wrapper:hover {
  border-color: var(--el-border-color-light) !important;
}

html.dark .el-input--small .el-input__wrapper.is-focus {
  border-color: var(--el-color-primary) !important;
  box-shadow: 0 0 0 2px var(--el-color-primary-light-8) !important;
}

html.dark .el-input--small .el-input__inner::placeholder {
  color: var(--el-text-color-placeholder) !important;
}
</style>
