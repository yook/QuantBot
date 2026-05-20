<template>
  <el-card shadow="never" class="mt-1 table-card" ref="tableCardRef">
    <el-row class="mb-4">
      <el-col :span="8">
        <TableLeftActionsBar
          :show-db-select="tableProfile !== 'parser'"
          :current-db="project.currentDb"
          :table-reports="project.tableReports"
          :active-filter-count="activeFilterTags.length"
          :rows-count="currentRowsCount"
          @db-change="handleTableChange"
          @add-filter="handleAddFilter"
        />
      </el-col>

      <el-col :span="16" class="text-right text-sm">
        <TableActionsBar
          :exporting="exporting"
          :delete-disabled="project.isAnyWorkerBusy"
          :active-filters-count="activeFiltersForRequest.length"
          :delete-dropdown-popper-options="deleteDropdownPopperOptions"
          @open-settings="tableSettingsDialog = true"
          @export-command="handleExportCommand"
          @delete-command="handleDeleteCommand"
        />
      </el-col>
    </el-row>

    <DataTableFixed
      :tableColumns="visibleTableColumns"
      :data="project.tableData"
      :totalCount="project.tableTotalCount"
      :windowStart="project.tableWindowStart"
      :loading="project.tableLoading"
      :loadingMore="false"
      :sort="project.sort"
      :loadWindow="loadWindow"
      :sortData="sortData"
      :loadData="loadData"
      :fixedColumns="2"
      :fixedHeight="tableFixedHeight"
      :heightOffset="380"
      :dbKey="tableProfile"
      :revision="project.tableRevision"
      @columns-reorder="onColumnsReorder"
    />

    <el-dialog
      width="820px"
      :title="t('crawler.tableSettingsTitle')"
      v-model="tableSettingsDialog"
    >
      <div class="table-settings-transfer-wrap">
        <el-transfer
          v-model="currentTableColumns"
          class="table-settings-transfer"
          filterable
          :filter-method="filterTransferColumns"
          :filter-placeholder="t('crawler.tableSettingsFilterPlaceholder')"
          :titles="[
            t('crawler.tableSettingsOff'),
            t('crawler.tableSettingsOn'),
          ]"
          :props="{
            key: 'prop',
            label: 'name',
            disabled: 'disabled',
          }"
          :data="transferData"
        />
      </div>

      <template #footer>
        <span class="dialog-footer">
          <el-button type="primary" @click="tableSettingsDialog = false">
            {{ t('crawler.tableSettingsConfirm') }}
          </el-button>
        </span>
      </template>
    </el-dialog>

    <TableFilterDialog
      v-model:visible="filterDialogVisible"
      :active-filter-tags="activeFilterTags"
      :filter-draft="filterDraft"
      :filterable-columns="filterableColumns"
      :filter-operators="filterOperators"
      :current-field-meta="currentFieldMeta"
      :enum-filter-values="enumFilterValues"
      @remove-tag="removeFilterTag"
      @apply="applyFilterDraft"
    />
  </el-card>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { useI18n } from "vue-i18n";

import DataTableFixed from "../DataTableFixed.vue";
import TableActionsBar from "./TableActionsBar.vue";
import TableFilterDialog from "./TableFilterDialog.vue";
import TableLeftActionsBar from "./TableLeftActionsBar.vue";

import { useFilterPersistence } from "../../composables/useFilterPersistence";
import { useTableFilters } from "../../composables/useTableFilters";
import { useTableRowsCount } from "../../composables/useTableRowsCount";
import { exportCrawlerData } from "../../stores/export";
import { useProjectStore } from "../../stores/project";
import activeColumnsJson from "../../stores/schema/table-active-colums.json";
import { ipcClient } from "../../stores/socket-client";
import { loadTableCount, loadTablePage } from "../../stores/table-data-service";
import {
  buildFilterTagLabel,
  getFieldMeta,
  getOperatorsForFieldMeta,
} from "../../stores/table-filters-service";
import saveColumnOrder from "../../utils/columnOrder";

const { t } = useI18n();
const project = useProjectStore();
const tableCardRef = ref(null);
const tableSettingsDialog = ref(false);
const filterDialogVisible = ref(false);
const exporting = ref(false);
const windowHeight = ref(window.innerHeight);
const FILTERS_STORAGE_KEY = "crawler.activeFilters";
const deleteDropdownPopperOptions = {
  modifiers: [
    {
      name: "preventOverflow",
      options: {
        boundary: "viewport",
        padding: 8,
      },
    },
    {
      name: "flip",
      options: {
        fallbackPlacements: ["top-end", "bottom-start", "top-start"],
      },
    },
  ],
};

const tableProfile = computed(() => project.currentTableProfile || project.currentDb);
const effectiveDb = computed(() =>
  tableProfile.value === "parser" ? "parser" : project.currentDb,
);
const currentRowsCount = computed(() => {
  if (typeof liveRowsCount.value === "number" && liveRowsCount.value >= 0) {
    return String(liveRowsCount.value);
  }
  if (typeof project.tableTotalCount === "number" && project.tableTotalCount >= 0) {
    return String(project.tableTotalCount);
  }
  if (typeof project.tableDataLength === "number" && project.tableDataLength >= 0) {
    return String(project.tableDataLength);
  }
  return "0";
});

const {
  activeFilterTags,
  filterDraft,
  filtersStorageScope,
  activeFiltersForRequest,
  resetFilterDraft,
  syncActiveFiltersToStore,
  getActiveFiltersSignature,
  pushFilterTag,
  removeFilterTag: removeFilterTagFromStore,
  restoreFilterTagsFromStorage,
  persistFilterTagsToStorage,
} = useTableFilters({
  project,
  tableProfile,
  storageKey: FILTERS_STORAGE_KEY,
});

const isSelectedProjectDataReady = computed(() => {
  if (!project.currentProjectId || !project.data?.id) return false;
  return String(project.data.id) === String(project.currentProjectId);
});

const handleExportCommand = async (command) => {
  if (exporting.value) return;
  const format = String(command || "xlsx");
  exporting.value = true;
  try {
    const result = await exportCrawlerData({
      projectId: project.data.id,
      projectName: project.currentProjectName || project.data.name,
      db: effectiveDb.value,
      sort: project.sort,
      filters: activeFiltersForRequest.value,
      columns: visibleTableColumns.value
        .filter((column) => column && column.prop && column.prop !== "_rowNumber")
        .map((column) => ({
          prop: String(column.prop),
          name: String(column.name || column.prop),
        })),
      format,
      scope: "filtered",
    });
    if (!result) {
      ElMessage({
        message:
          "В таблице нет данных для экспорта. Проверьте выбранный отчет, фильтры и повторите попытку.",
        type: "warning",
      });
      return;
    }
    if (result.canceled) return;
    if (result.exportTruncated) {
      ElMessage.warning(t("crawler.config.freeExportLimitWarn"));
    }
    ElMessage.success(`Экспорт сохранен: ${result.path || result.filePath || ""}`);
  } catch (err) {
    console.error("Error during export:", err);
    ElMessage({
      message: "Ошибка при экспорте.",
      type: "error",
    });
  } finally {
    exporting.value = false;
  }
};

const handleDeleteFiltered = async () => {
  if (!project.data?.id) return;
  if (!activeFiltersForRequest.value.length) {
    ElMessage.warning("Сначала добавьте фильтр");
    return;
  }
  try {
    await ElMessageBox.confirm(
      "Удалить только записи, которые подходят под выбранные фильтры?",
      "Удаление отфильтрованных записей",
      {
        confirmButtonText: "Удалить",
        cancelButtonText: "Отмена",
        type: "warning",
      },
    );
  } catch (_) {
    return;
  }

  try {
    const result = await ipcClient.deleteFilteredUrls(
      Number(project.data.id),
      String(effectiveDb.value || "urls"),
      activeFiltersForRequest.value,
    );
    const deleted = Number(result?.deleted || 0);
    if (deleted > 0) {
      ElMessage.success(`Удалено записей: ${deleted}`);
    } else {
      ElMessage.info("Нет записей для удаления по текущим фильтрам");
    }
    reloadTableWithFilters();
  } catch (error) {
    ElMessage.error(`Ошибка удаления: ${String(error?.message || error)}`);
  }
};

const handleDeleteAll = async () => {
  if (project.isAnyWorkerBusy) return;
  try {
    await ElMessageBox.confirm(
      "Очистить все данные текущего раздела?",
      "Полная очистка",
      {
        confirmButtonText: "Очистить",
        cancelButtonText: "Отмена",
        type: "warning",
      },
    );
  } catch (_) {
    return;
  }
  await project.deleteData();
  reloadTableWithFilters();
};

const handleDeleteCommand = async (command) => {
  if (command === "filtered") {
    await handleDeleteFiltered();
    return;
  }
  if (command === "all") {
    await handleDeleteAll();
  }
};

async function requestTablePage({ skip = 0, limit = 300, db = effectiveDb.value } = {}) {
  await loadTablePage({
    projectStore: project,
    projectId: project.data.id,
    sort: project.sort,
    skip,
    limit,
    db,
    filters: activeFiltersForRequest.value,
  });
}

const loadWindow = async (newWindowStart) => {
  await requestTablePage({ skip: newWindowStart, limit: 300 });
};

const sortData = async (options) => {
  project.sort = options;
  await requestTablePage({ skip: 0, limit: 300 });
};

const loadData = async (projectId, options = {}) => {
  await loadTablePage({
    projectStore: project,
    projectId: projectId || project.data.id,
    sort: project.sort,
    skip: options.skip || 0,
    limit: options.limit || 300,
    db: effectiveDb.value,
    filters: activeFiltersForRequest.value,
  });
};

watch(
  () => effectiveDb.value,
  (nextDb, prevDb) => {
    if (!project.data?.id || nextDb === prevDb) return;
    project.tableWindowStart = 0;
    requestTablePage({ skip: 0, limit: 300, db: nextDb });
  },
);

function onColumnsReorder(newOrder) {
  if (!Array.isArray(newOrder)) return;
  saveColumnOrder(project, tableProfile.value, newOrder);
}

const currentTableColumns = computed({
  get() {
    const ensureParserUrlFirst = (input) => {
      const cols = Array.isArray(input) ? [...input] : [];
      const withoutUrl = cols.filter((prop) => String(prop) !== "url");
      return ["url", ...withoutUrl];
    };

    if (project.data?.columns && project.data.columns[tableProfile.value]) {
      const configured = Array.isArray(project.data.columns[tableProfile.value])
        ? [...project.data.columns[tableProfile.value]]
        : [];
      if (tableProfile.value === "urls") {
        const parserProps = Array.isArray(project.data?.parser)
          ? project.data.parser
              .map((column) => column?.prop)
              .filter((prop) => typeof prop === "string" && prop.length > 0)
          : [];
        for (const prop of parserProps) {
          if (!configured.includes(prop)) configured.push(prop);
        }
      }
      return tableProfile.value === "parser"
        ? ensureParserUrlFirst(configured)
        : configured;
    }

    if (tableProfile.value === "parser") {
      const parserCols = Array.isArray(project.data?.parser)
        ? project.data.parser
            .map((column) => column?.prop)
            .filter((prop) => typeof prop === "string" && prop.length > 0)
        : [];
      return ensureParserUrlFirst(parserCols);
    }

    const dbKey = tableProfile.value;
    if (
      activeColumnsJson &&
      typeof activeColumnsJson === "object" &&
      activeColumnsJson[dbKey] &&
      Array.isArray(activeColumnsJson[dbKey])
    ) {
      return activeColumnsJson[dbKey];
    }

    const sensibleDefault = ["url", "created_at", "date"];
    const availableProps = (project.allColumns || []).map((c) => c.prop);
    const filtered = sensibleDefault.filter((p) => availableProps.includes(p));
    if (filtered.length > 0) return filtered;

    return (project.allColumns || []).map((col) => col.prop);
  },
  set(value) {
    if (!project.data.columns) {
      project.data.columns = {};
    }
    let normalized = Array.isArray(value) ? [...value] : [];
    if (tableProfile.value === "parser") {
      normalized = ["url", ...normalized.filter((prop) => String(prop) !== "url")];
    }
    project.data.columns[tableProfile.value] = normalized;
    project.updateProject();
  },
});

const transferColumns = computed(() => {
  try {
    const source = project.allColumns || [];
    const mapped = source
      .map((c, idx) => ({
        prop: c.prop,
        name: c.name && String(c.name).trim() ? c.name : c.prop,
        originalIndex: idx,
        ...c,
      }))
      .filter((c) => c && c.prop);

    mapped.sort((a, b) => {
      const byName = String(a.name || "").localeCompare(String(b.name || ""), "ru", {
        sensitivity: "base",
      });
      if (byName !== 0) return byName;
      const byProp = String(a.prop || "").localeCompare(String(b.prop || ""), "ru", {
        sensitivity: "base",
      });
      if (byProp !== 0) return byProp;
      return a.originalIndex - b.originalIndex;
    });

    const seen = new Set();
    return mapped.filter((c) => {
      if (!c || !c.prop || seen.has(c.prop)) return false;
      seen.add(c.prop);
      return true;
    });
  } catch (_e) {
    return project.allColumns || [];
  }
});

const transferData = computed(() => (Array.isArray(transferColumns.value) ? transferColumns.value : []));

function filterTransferColumns(query, item) {
  const normalizedQuery = String(query || "").trim().toLowerCase();
  if (!normalizedQuery) return true;
  const name = String(item?.name || "").toLowerCase();
  const prop = String(item?.prop || "").toLowerCase();
  return name.includes(normalizedQuery) || prop.includes(normalizedQuery);
}

const visibleTableColumns = computed(() => {
  try {
    const cols = project.tableColumns || [];
    return cols.filter((c) => c && c.prop !== "_rowNumber");
  } catch (_e) {
    return project.tableColumns || [];
  }
});

const filterableColumns = computed(() => {
  const cols = visibleTableColumns.value || [];
  return cols.filter((c) => c && c.prop && c.prop !== "_rowNumber");
});

const currentFieldMeta = computed(() => {
  const field = String(filterDraft.value.field || "");
  return getFieldMeta(field);
});

const filterOperators = computed(() => {
  return getOperatorsForFieldMeta(currentFieldMeta.value);
});

watch(
  () => filterDraft.value.field,
  (nextField, prevField) => {
    if (String(nextField || "") === String(prevField || "")) return;
    const allowedOperators = new Set(filterOperators.value.map((operator) => operator.value));
    if (!allowedOperators.has(filterDraft.value.operator)) {
      filterDraft.value.operator = "";
    }
    filterDraft.value.value = "";
    filterDraft.value.secondValue = "";
  },
);

const enumFilterValues = computed(() => {
  const field = String(filterDraft.value.field || "");
  if (!field) return [];
  const values = new Set();
  for (const row of project.tableData || []) {
    const raw = row?.[field];
    if (raw === null || raw === undefined || raw === "") continue;
    values.add(String(raw));
  }
  return Array.from(values).sort((a, b) =>
    String(a).localeCompare(String(b), "ru", { sensitivity: "base" }),
  );
});

const tableHeight = computed(() => {
  const minHeight = 220;
  const footerReserve = 7;
  const bottomGap = 4;

  if (!tableCardRef.value) {
    return `${Math.max(minHeight, Math.floor(windowHeight.value * 0.6))}px`;
  }

  const card = tableCardRef.value.$el || tableCardRef.value;
  const rect = card.getBoundingClientRect();
  const cardBody = card.querySelector(".el-card__body");
  const topControls = card.querySelector(".mb-4");

  let bodyPaddingTop = 0;
  let bodyPaddingBottom = 0;
  if (cardBody) {
    const bodyStyles = window.getComputedStyle(cardBody);
    bodyPaddingTop = Number.parseFloat(bodyStyles.paddingTop || "0") || 0;
    bodyPaddingBottom = Number.parseFloat(bodyStyles.paddingBottom || "0") || 0;
  }

  const controlsHeight = topControls ? topControls.getBoundingClientRect().height : 0;
  const controlsMarginBottom = topControls
    ? Number.parseFloat(window.getComputedStyle(topControls).marginBottom || "0") || 0
    : 0;

  const available =
    windowHeight.value -
    rect.top -
    bodyPaddingTop -
    bodyPaddingBottom -
    controlsHeight -
    controlsMarginBottom -
    footerReserve -
    bottomGap;

  return `${Math.max(minHeight, Math.floor(available))}px`;
});

const tableFixedHeight = computed(() => {
  const raw = tableHeight.value;
  if (typeof raw === "string") {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 500;
});

function handleTableChange(selectedDb) {
  project.tableWindowStart = 0;
  requestTablePage({ skip: 0, limit: 300, db: selectedDb });
}

function handleAddFilter() {
  resetFilterDraft();
  filterDialogVisible.value = true;
}

function applyFilterDraft() {
  filterDialogVisible.value = false;
  const noSelection =
    !String(filterDraft.value.field || "").trim() &&
    !String(filterDraft.value.operator || "").trim() &&
    !String(filterDraft.value.value || "").trim() &&
    !String(filterDraft.value.secondValue || "").trim();

  if (noSelection) {
    resetFilterDraft();
    return;
  }

  const hasField = !!String(filterDraft.value.field || "").trim();
  const hasOperator = !!String(filterDraft.value.operator || "").trim();
  const hasValue = !!String(filterDraft.value.value || "").trim();
  const hasSecondValue = !!String(filterDraft.value.secondValue || "").trim();
  const validSelection =
    hasField &&
    hasOperator &&
    (filterDraft.value.operator === "between"
      ? hasValue && hasSecondValue
      : hasValue);

  if (!validSelection) {
    resetFilterDraft();
    return;
  }

  const label = buildFilterTagLabel(
    filterDraft.value,
    getFieldNameByProp,
    getOperatorLabel,
  );
  pushFilterTag({ ...filterDraft.value, label });
  project.tableWindowStart = 0;
  requestTablePage({ skip: 0, limit: 300 });
  resetFilterDraft();
  ElMessage.success("Фильтр добавлен");
}

function getFieldNameByProp(prop) {
  const found = filterableColumns.value.find((item) => String(item.prop) === String(prop));
  return found?.name || String(prop || "");
}

function getOperatorLabel(operator) {
  const found = filterOperators.value.find((item) => String(item.value) === String(operator));
  return found?.label || String(operator || "");
}

function removeFilterTag(tagId) {
  if (removeFilterTagFromStore(tagId)) {
    reloadTableWithFilters();
  }
}

function reloadTableWithFilters() {
  if (!isSelectedProjectDataReady.value) return;
  syncActiveFiltersToStore();
  project.tableWindowStart = 0;
  requestTablePage({ skip: 0, limit: 300 });
}

const rowsCountState = useTableRowsCount({
  project,
  effectiveDb,
  activeFiltersForRequest,
  loadCount: ({ projectId, db, filters }) =>
    loadTableCount({
      ipcClient,
      projectId,
      db,
      filters,
    }),
});

const liveRowsCount = rowsCountState.liveRowsCount;

onMounted(() => {
  const updateWindowHeight = () => {
    windowHeight.value = window.innerHeight;
  };
  window.addEventListener("resize", updateWindowHeight);
  window.updateWindowHeight = updateWindowHeight;
});

useFilterPersistence({
  project,
  filtersStorageScope,
  isSelectedProjectDataReady,
  activeFilterTags,
  tableLoading: computed(() => !!project.tableLoading),
  restoreFilterTagsFromStorage,
  persistFilterTagsToStorage,
  syncActiveFiltersToStore,
  getActiveFiltersSignature,
  applyRestoredFilters: reloadTableWithFilters,
  onAfterApply: rowsCountState.scheduleRowsCountRefresh,
});

onUnmounted(() => {
  if (window.updateWindowHeight) {
    window.removeEventListener("resize", window.updateWindowHeight);
  }
});
</script>

<style scoped>
.table-card {
  min-height: 200px;
  display: flex;
  flex-direction: column;
}

.table-settings-transfer-wrap {
  width: 100%;
}

.table-settings-transfer {
  display: flex;
  justify-content: center;
}

</style>
