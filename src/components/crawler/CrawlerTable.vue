<template>
  <el-card
    shadow="never"
    class="mt-1 table-cart"
    ref="tableCardRef"
    :style="{
      '--table-height': tableHeight,
      '--second-column-left': secondColumnLeft,
    }"
  >
    <el-row class="mb-4">
      <el-col :span="4">
        <el-select
          size="small"
          v-model="project.currentDb"
          placeholder="Select"
          @change="handleTableChange"
        >
          <el-option-group
            v-for="group in project.tableReports"
            :key="group.label"
            :label="group.label"
          >
            <el-option
              v-for="item in group.options"
              :key="item.value"
              :label="item.label"
              :value="item.value"
              :disabled="item.disabled"
            >
              <span style="float: left">{{ item.label }}</span>
            </el-option>
          </el-option-group>
        </el-select>
      </el-col>
      <!-- <el-col :span="10">

        </el-col> -->
      <el-col :span="20" class="text-right text-sm">
        <!-- <span class="pr-3">{{ tableDataLength }} results</span> -->
        <!-- Clear -->
        <!-- <el-button size="small" type="danger" plain @click="$emit('clear')">
              <el-icon><document-delete /></el-icon>
            </el-button> -->

        <el-button
          size="small"
          type="primary"
          plain
          @click="tableSettingsDialog = true"
        >
          <el-icon><Grid /></el-icon>
        </el-button>
        <el-button size="small" @click="handleExport">
          <el-icon><Download /></el-icon>.xls
        </el-button>
      </el-col>
    </el-row>
    <DataTableFixed
      :tableColumns="visibleTableColumns"
      :data="project.tableData"
      :totalCount="project.tableDataLength"
      :loading="project.tableLoading"
      :loadingMore="false"
      :sort="project.sort"
      :loadWindow="loadWindow"
      :sortData="sortData"
      :loadData="loadData"
      :fixedColumns="2"
      :heightOffset="380"
    />

    <el-dialog
      width="900px"
      :title="t('crawler.tableSettingsTitle')"
      v-model="tableSettingsDialog"
    >
      <div class="text-center">
        <el-transfer
          v-model="currentTableColumns"
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
            {{ t("crawler.tableSettingsConfirm") }}
          </el-button>
        </span>
      </template>
    </el-dialog>
  </el-card>
</template>

<script setup>
import moment from "moment";
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from "vue";
import { useI18n } from "vue-i18n";
import { useProjectStore } from "../../stores/project";
import { exportCrawlerData } from "../../stores/export";
import { ElMessage } from "element-plus";
import DataTableFixed from "../DataTableFixed.vue";
import { Grid, Download } from "@element-plus/icons-vue";
import activeColumnsJson from "../../stores/schema/table-active-colums.json";

const { t } = useI18n();

const project = useProjectStore();
// Handler that calls exportCrawlerData and shows messages to the user
const handleExport = async () => {
  try {
    const result = await exportCrawlerData();
    if (!result) {
      ElMessage({
        message:
          "В таблице нет данных для экспорта. Проверьте выбранный отчет, фильтры и повторите попытку.",
        type: "warning",
      });
      return;
    }

    ElMessage({ message: "Экспорт успешно завершён.", type: "success" });
  } catch (err) {
    console.error("Error during export:", err);
    ElMessage({
      message: "Ошибка при экспорте.",
      type: "error",
    });
  }
};
// Wrapper functions for DataTable
const loadWindow = (newWindowStart) => {
  try {
    project.getsortedDb({
      id: project.data.id,
      sort: project.sort,
      skip: newWindowStart,
      limit: 300, // load a windowed chunk instead of all rows
      db: project.currentDb,
    });
  } catch (e) {
    console.error("loadWindow failed:", e);
  }
};

const sortData = (options) => {
  try {
    // Сохраняем текущую сортировку в store в числовом формате (совместно с DataTableFixed)
    project.sort = options;

    // Request a paged result instead of full dataset to keep UI responsive
    project.getsortedDb({
      id: project.data.id,
      sort: options,
      skip: 0,
      limit: 300,
      db: project.currentDb,
    });
  } catch (e) {
    console.error("sortData failed:", e);
  }
};

const loadData = (projectId, options = {}) => {
  try {
    project.getsortedDb({
      id: projectId || project.data.id,
      sort: project.sort,
      skip: options.skip || 0,
      // default to a windowed load to avoid freezing the UI
      limit: options.limit || 300,
      db: project.currentDb,
    });
  } catch (e) {
    console.error("loadData failed:", e);
  }
};
const tableSettingsDialog = ref(false);
const resizing = ref(false);
const currentColumn = ref(null);
const startX = ref(0);
const startWidth = ref(0);
const columnWidths = ref({});
const tableCardRef = ref(null);
const windowHeight = ref(window.innerHeight);

// Virtual scroll variables
const scroller = ref(null);
const pageSize = ref(20); // Инициализируем с разумным значением по умолчанию
const start = ref(0);
const htop = ref(0);
const handleDragging = ref(false);
const rowHeight = 35; // Высота строки в пикселях (используется в вычислениях)

// Computed property для текущих колонок таблицы
const currentTableColumns = computed({
  get() {
    // If explicit columns are configured for the current DB, use them
    if (project.data?.columns && project.data.columns[project.currentDb]) {
      return project.data.columns[project.currentDb];
    }

    // Try static defaults per table (urls, html, disallow, etc.)
    const dbKey = project.currentDb;
    if (
      activeColumnsJson &&
      typeof activeColumnsJson === "object" &&
      activeColumnsJson[dbKey] &&
      Array.isArray(activeColumnsJson[dbKey])
    ) {
      return activeColumnsJson[dbKey];
    }

    // Fallback: prefer a small sensible default to avoid showing many empty columns
    const sensibleDefault = ["url", "created_at", "date"];
    // Validate that these props exist in project's allColumns; if not, use all props
    const availableProps = (project.allColumns || []).map((c) => c.prop);
    const filtered = sensibleDefault.filter((p) => availableProps.includes(p));
    if (filtered.length > 0) return filtered;

    // Last resort: return all available column props
    const allColumns = project.allColumns || [];
    return allColumns.map((col) => col.prop);
  },
  set(value) {
    if (!project.data.columns) {
      project.data.columns = {};
    }

    project.data.columns[project.currentDb] = value;

    console.log(
      `🔧 HTML Table: Изменение колонок для таблицы "${project.currentDb}":`,
      value
    );

    project.updateProject();
  },
});

// Set cursor style for the entire document during resizing
const documentStyle = computed(() => {
  return resizing.value ? { cursor: "col-resize" } : {};
});

// Dedup and normalize columns for Transfer: unique by `prop`, fill empty names with prop
const transferColumns = computed(() => {
  const source = project.allColumns || [];
  const seen = new Set();
  const result = [];
  for (const c of source) {
    if (!c || typeof c !== "object") continue;
    const prop = c.prop;
    if (!prop || typeof prop !== "string") continue;
    if (seen.has(prop)) continue;
    const name = c.name && String(c.name).trim() ? c.name : prop;
    result.push({ ...c, name });
    seen.add(prop);
  }
  return result;
});

// Ensure ElTransfer always receives an Array
const transferData = computed(() => {
  const d = transferColumns.value;
  return Array.isArray(d) ? d : [];
});

const dataComp = computed(() => {
  const filtered = project.tableData.filter((item) => !item._placeholder);
  const processed = filtered.map((item) => {
    const processedItem = { ...item };
    if (item.date) {
      processedItem.date = moment(item.date).format("YYYY-MM-DD HH:mm:ss");
    }
    return processedItem;
  });

  console.log(
    `Data processing: original=${project.tableData.length}, filtered=${filtered.length}, processed=${processed.length}`
  );

  return processed;
});

// Computed property для видимой страницы виртуальной прокрутки
const visiblePage = computed(() => {
  // Проверяем доступность данных
  if (!dataComp.value || !Array.isArray(dataComp.value)) {
    return [];
  }

  // Убеждаемся, что start и pageSize являются числами
  const currentStart = Number.isFinite(start.value) ? start.value : 0;
  const currentPageSize = Number.isFinite(pageSize.value) ? pageSize.value : 20;

  // Добавляем буфер в 2 строки сверху и снизу для плавного скроллинга
  const bufferSize = 2;
  const startWithBuffer = Math.max(0, currentStart - bufferSize);
  const endWithBuffer = Math.min(
    dataComp.value.length,
    currentStart + currentPageSize + bufferSize
  );
  const result = dataComp.value.slice(startWithBuffer, endWithBuffer);

  console.log(
    `Visible page: start=${currentStart}, pageSize=${currentPageSize}, buffer=${bufferSize}, startWithBuffer=${startWithBuffer}, endWithBuffer=${endWithBuffer}, visible=${result.length}, total=${dataComp.value.length}`
  );

  return result;
});

// Computed property для начального индекса видимой страницы
const visiblePageStartIndexComputed = computed(() => {
  // Проверяем доступность данных
  if (!dataComp.value || !Array.isArray(dataComp.value)) {
    return 0;
  }

  // Убеждаемся, что start является числом
  const currentStart = Number.isFinite(start.value) ? start.value : 0;

  // Добавляем буфер в 2 строки сверху и снизу для плавного скроллинга
  const bufferSize = 2;
  const startWithBuffer = Math.max(0, currentStart - bufferSize);

  console.log(
    `visiblePageStartIndex: start=${currentStart}, startWithBuffer=${startWithBuffer}`
  );

  return startWithBuffer;
});

// Computed property для определения необходимости скроллинга
const needsScrolling = computed(() => {
  if (!dataComp.value || !Array.isArray(dataComp.value)) {
    return false;
  }
  return dataComp.value.length > pageSize.value;
});

// Columns to pass to DataTableFixed - exclude the row number column which DataTableFixed adds itself
const visibleTableColumns = computed(() => {
  try {
    const cols = project.tableColumns || [];
    return cols.filter((c) => c && c.prop !== "_rowNumber");
  } catch (e) {
    return project.tableColumns || [];
  }
});

// Computed property для расчета высоты ползунка скроллера
const handleHeight = computed(() => {
  if (!needsScrolling.value || !scroller.value) return "20px"; // Минимальная высота по умолчанию

  if (!dataComp.value || !Array.isArray(dataComp.value)) {
    return "20px";
  }

  const scrollerHeight = scroller.value.clientHeight - 10; // Высота скроллера минус отступы
  const totalRows = dataComp.value.length;
  const visibleRows = pageSize.value;

  if (totalRows <= visibleRows) {
    return `${scrollerHeight}px`; // Ползунок на всю высоту скроллера
  }

  // Пропорциональная высота: (видимые строки / общее количество строк) * высота скроллера
  const proportion = visibleRows / totalRows;
  const calculatedHeight = Math.max(
    20,
    Math.floor(scrollerHeight * proportion)
  ); // Минимум 20px

  return `${calculatedHeight}px`;
});

// Computed property для расчета высоты таблицы
const tableHeight = computed(() => {
  if (!tableCardRef.value) return "500px"; // Значение по умолчанию

  // Рассчитываем высоту на основе количества строк, а не доступного пространства
  const contentHeight = project.tableDataLength * rowHeight;

  // Добавляем высоту шапки таблицы (примерно 50px)
  const headerHeight = 50;

  // Общая высота таблицы
  const totalHeight = contentHeight + headerHeight;

  // Минимальная и максимальная высота (без учета высоты окна)
  const minHeight = 200;
  const maxHeight = 1000; // Фиксированный максимум вместо процента от окна

  // Возвращаем высоту, ограниченную разумными пределами
  return Math.max(minHeight, Math.min(totalHeight, maxHeight)) + "px";
});

// Computed property для позиции второго фиксированного столбца
const secondColumnLeft = computed(() => {
  const firstColumnWidth = getColumnWidth("_rowNumber");
  return firstColumnWidth + "px";
});

function formatCellValue(value, columnProp) {
  if (!value) return "";

  if (columnProp === "date" && value) {
    return moment(value).format("YYYY-MM-DD HH:mm:ss");
  }

  // Убрана жесткая обрезка URL - теперь обрезка происходит по ширине столбца через CSS
  // if (columnProp === "url" && value.length > 60) {
  //   return value.substring(0, 60) + "...";
  // }

  return value;
}

function getSortClass(columnProp) {
  const sortKey = Object.keys(project.sort || {})[0];
  const sortDirection = project.sort?.[sortKey];

  if (sortKey !== columnProp && sortKey !== "id" && columnProp !== "_id") {
    return "";
  }

  // Учитываем маппинг _id <-> id
  const isCurrentColumn =
    sortKey === columnProp ||
    (sortKey === "id" && columnProp === "_id") ||
    (sortKey === "_id" && columnProp === "id");

  if (!isCurrentColumn) return "";

  return sortDirection === 1 ? "sort-asc" : "sort-desc";
}

function handleSort(columnProp) {
  let sortVal = {};
  let sortField = columnProp;

  console.log(`🔍 HTML Table: Клик по колонке: "${columnProp}"`);

  // Преобразуем _id в id для SQLite
  if (sortField === "_id") {
    sortField = "id";
    console.log(`🔄 HTML Table: Маппинг _id → id`);
  }

  // Определяем текущее направление сортировки
  const currentSortKey = Object.keys(project.sort || {})[0];
  const currentDirection = project.sort?.[currentSortKey];

  const isCurrentColumn =
    currentSortKey === sortField ||
    (currentSortKey === "id" && columnProp === "_id") ||
    (currentSortKey === "_id" && columnProp === "id");

  if (isCurrentColumn && currentDirection === 1) {
    // Сортируем по убыванию
    sortVal[sortField] = -1;
    console.log("✅ HTML Table: Сортировка по убыванию:", sortVal);
  } else {
    // Сортируем по возрастанию
    sortVal[sortField] = 1;
    console.log("✅ HTML Table: Сортировка по возрастанию:", sortVal);
  }

  project.sort = sortVal;
  getsortedDb(sortVal);
}

// Функция удалена, т.к. больше не используется пагинация
// Оставляем для совместимости, чтобы не было ошибок если вызывается где-то еще
function changeCurrentPage(val) {
  // Просто делегируем в getsortedDb без пагинации
  project.tableLoading = true;
  project.tableData = [];

  console.log(
    `📄 HTML Table: Запрос всех данных (пагинация отключена): projectId=${project.data.id}, currentDb=${project.currentDb}`
  );

  project.getsortedDb({
    id: project.data.id,
    sort: project.sort,
    skip: 0,
    limit: 0, // 0 означает "без лимита" - загрузить все
    db: project.currentDb,
  });
}

function handleTableChange(selectedDb) {
  console.log(`🔄 HTML Table: Изменение таблицы на "${selectedDb}"`);

  // Reset column widths when changing tables
  columnWidths.value = {};

  // Load stored column widths from localStorage first
  const storageKey = `table-column-widths-${project.data.id}-${selectedDb}`;
  const stored = localStorage.getItem(storageKey);
  if (stored) {
    try {
      const storedWidths = JSON.parse(stored);
      columnWidths.value = { ...storedWidths };
      console.log(
        "Loaded column widths from localStorage for new table:",
        storedWidths
      );
    } catch (e) {
      console.warn("Failed to load column widths from localStorage:", e);
    }
  } else if (
    project.data.columnWidths &&
    project.data.columnWidths[selectedDb]
  ) {
    // Fallback to project data
    columnWidths.value = { ...project.data.columnWidths[selectedDb] };
  }

  project.tableData = [];
  project.tableLoading = true;
  project.currentPage = 1;

  project.getsortedDb({
    id: project.data.id,
    sort: project.sort,
    skip: 0,
    limit: 300, // load a windowed chunk instead of all rows
    db: selectedDb,
  });
}

function getsortedDb(sort) {
  project.tableLoading = true;
  project.tableData = [];
  project.currentPage = 1;

  console.log(
    `📊 HTML Table: Запрос сортировки: sort=${JSON.stringify(
      sort
    )}, projectId=${project.data.id}, currentDb=${project.currentDb}`
  );

  project.getsortedDb({
    id: project.data.id,
    sort: sort,
    skip: 0,
    limit: 300, // load a windowed chunk instead of all rows
    db: project.currentDb,
  });
}

// Функция для загрузки дополнительных данных
function loadMoreData() {
  if (project.tableLoading) return;

  console.log(
    `📊 HTML Table: Запрос дополнительных данных, текущих: ${dataComp.value.length}`
  );

  project.getsortedDb({
    id: project.data.id,
    sort: project.sort,
    skip: dataComp.value.length, // Начинаем с текущего количества
    limit: 100, // Загружаем дополнительные 100 записей
    db: project.currentDb,
  });
}

// Column resizing functions
function getColumnWidth(columnProp) {
  // First check if we have a temporarily stored width from active resizing
  if (columnWidths.value[columnProp]) {
    return columnWidths.value[columnProp];
  }

  // Check if width is stored in project data for current table
  if (
    project.data.columnWidths &&
    project.data.columnWidths[project.currentDb] &&
    project.data.columnWidths[project.currentDb][columnProp]
  ) {
    return project.data.columnWidths[project.currentDb][columnProp];
  }

  // Find the column in project's tableColumns
  const column = (project.tableColumns || []).find(
    (col) => col.prop === columnProp
  );
  return column?.width || 300;
}

function startResize(event, columnProp) {
  event.stopPropagation();
  resizing.value = true;
  currentColumn.value = columnProp;
  startX.value = event.pageX;

  // Get current width
  startWidth.value = getColumnWidth(columnProp);

  // Add event listeners
  document.addEventListener("mousemove", handleResize);
  document.addEventListener("mouseup", stopResize);
}

function handleResize(event) {
  if (!resizing.value || !currentColumn.value) return;

  const diff = event.pageX - startX.value;
  // Minimum width depends on column type
  const minWidth = currentColumn.value === "_rowNumber" ? 40 : 80;
  const newWidth = Math.max(minWidth, startWidth.value + diff);

  // Update column width in local state for immediate visual feedback
  columnWidths.value = {
    ...columnWidths.value,
    [currentColumn.value]: newWidth,
  };
}

function stopResize() {
  if (resizing.value && currentColumn.value) {
    // Save the final width to the project store
    saveColumnWidth(
      currentColumn.value,
      columnWidths.value[currentColumn.value]
    );
  }

  resizing.value = false;
  currentColumn.value = null;
  document.removeEventListener("mousemove", handleResize);
  document.removeEventListener("mouseup", stopResize);
}

function saveColumnWidth(columnProp, width) {
  // Make sure columnWidths structure exists in project data
  if (!project.data.columnWidths) {
    project.data.columnWidths = {};
  }

  // Initialize current DB column widths if not exist
  if (!project.data.columnWidths[project.currentDb]) {
    project.data.columnWidths[project.currentDb] = {};
  }

  // Save width to the project data
  project.data.columnWidths[project.currentDb][columnProp] = width;

  // Find the column in the default settings or parser columns and update there too
  const defaultColumnIndex = project.defaultColumns.findIndex(
    (col) => col.prop === columnProp
  );
  if (defaultColumnIndex !== -1) {
    project.defaultColumns[defaultColumnIndex].width = width;
  } else {
    // Try to find in the parser columns
    const parserColumnIndex = project.data.parser?.findIndex(
      (col) => col.prop === columnProp
    );
    if (parserColumnIndex !== -1) {
      project.data.parser[parserColumnIndex].width = width;
    }
  }

  // Save to localStorage
  saveColumnWidthsToLocalStorage(columnProp, width);

  // Only save to database when resizing is complete to avoid too many updates
  if (!resizing.value) {
    console.log(`Column width saved: ${columnProp} = ${width}px`);
    project.updateProject();
  }
}

// Функция сохранения ширины столбцов в localStorage
function saveColumnWidthsToLocalStorage(columnProp, width) {
  const storageKey = `table-column-widths-${project.data.id}-${project.currentDb}`;
  let storedWidths = {};

  // Загружаем существующие ширины из localStorage
  const stored = localStorage.getItem(storageKey);
  if (stored) {
    try {
      storedWidths = JSON.parse(stored);
    } catch (e) {
      console.warn("Failed to parse column widths from localStorage:", e);
      storedWidths = {};
    }
  }

  // Обновляем ширину для конкретного столбца
  storedWidths[columnProp] = width;

  // Сохраняем обратно в localStorage
  try {
    localStorage.setItem(storageKey, JSON.stringify(storedWidths));
    console.log(
      `Column width saved to localStorage: ${columnProp} = ${width}px`
    );
  } catch (e) {
    console.warn("Failed to save column widths to localStorage:", e);
  }
}

// Функция загрузки ширины столбцов из localStorage
function loadColumnWidthsFromLocalStorage() {
  const storageKey = `table-column-widths-${project.data.id}-${project.currentDb}`;
  const stored = localStorage.getItem(storageKey);

  if (stored) {
    try {
      const storedWidths = JSON.parse(stored);
      console.log("Loaded column widths from localStorage:", storedWidths);

      // Обновляем columnWidths в компоненте
      columnWidths.value = { ...storedWidths };

      // Также обновляем в project data, если нужно
      if (!project.data.columnWidths) {
        project.data.columnWidths = {};
      }
      if (!project.data.columnWidths[project.currentDb]) {
        project.data.columnWidths[project.currentDb] = {};
      }
      Object.assign(project.data.columnWidths[project.currentDb], storedWidths);

      return storedWidths;
    } catch (e) {
      console.warn("Failed to load column widths from localStorage:", e);
      return {};
    }
  }

  return {};
}

// Функция для синхронизации ширины столбцов шапки и тела таблицы
const syncHeaderAndBodyColumns = () => {
  const headerCols = document.querySelectorAll(".table-header-container th");
  const bodyCols = document.querySelectorAll(
    ".table-body-container tr:first-child td"
  );

  if (headerCols.length === bodyCols.length) {
    headerCols.forEach((headerCol, index) => {
      const width = headerCol.offsetWidth;
      if (bodyCols[index]) {
        bodyCols[index].style.width = `${width}px`;
        bodyCols[index].style.minWidth = `${width}px`;
      }
    });
  }
};

// Clean up event listeners when component is unmounted
onMounted(async () => {
  // Ждем следующего тика для получения DOM элементов
  await nextTick();

  // Функция обновления высоты окна
  const updateWindowHeight = () => {
    windowHeight.value = window.innerHeight;
  };

  // Добавляем слушатель изменения размера окна
  window.addEventListener("resize", updateWindowHeight);

  // Загружаем ширину колонок из localStorage
  const localWidths = loadColumnWidthsFromLocalStorage();

  // Инициализация ширины колонок (сначала из localStorage, затем из project data)
  if (Object.keys(localWidths).length > 0) {
    columnWidths.value = { ...localWidths };
  } else if (
    project.data.columnWidths &&
    project.data.columnWidths[project.currentDb]
  ) {
    columnWidths.value = { ...project.data.columnWidths[project.currentDb] };
  }

  // Handle database changes to initialize column widths
  const handleTableChange = () => {
    // Сначала пробуем загрузить из localStorage
    const localWidths = loadColumnWidthsFromLocalStorage();
    if (Object.keys(localWidths).length > 0) {
      columnWidths.value = { ...localWidths };
    } else if (
      project.data.columnWidths &&
      project.data.columnWidths[project.currentDb]
    ) {
      columnWidths.value = { ...project.data.columnWidths[project.currentDb] };
    } else {
      // Reset column widths when switching to a table with no stored widths
      columnWidths.value = {};
    }
  };

  // Initialize virtual scroll
  const updatePageSize = () => {
    if (tableCardRef.value) {
      const cardElement = tableCardRef.value.$el || tableCardRef.value;
      const cardRect = cardElement.getBoundingClientRect();
      // Учитываем высоту заголовка (примерно 50px) и отступы
      const headerHeight = 200; // Высота заголовка + границы
      const availableHeight = cardRect.height - headerHeight;

      // Если высота еще не рассчитана, используем значение по умолчанию
      if (availableHeight <= headerHeight) {
        console.log("Container height not ready, keeping default pageSize");
        return;
      }

      // Более точный расчет высоты строки: padding + line-height + border
      const oldPageSize = pageSize.value;
      pageSize.value = Math.floor(availableHeight / rowHeight);
      // Увеличиваем минимальный размер страницы для лучшей видимости
      if (pageSize.value < 5) pageSize.value = 5;
      // Устанавливаем максимальный размер для предотвращения слишком большого количества строк
      if (pageSize.value > 50) pageSize.value = 50;

      // Проверяем доступность dataComp перед использованием
      if (!dataComp.value || !Array.isArray(dataComp.value)) {
        console.warn(
          "updatePageSize: dataComp.value is not available or not an array"
        );
        return;
      }

      // virtual scroll: computed values (logging removed)

      // После изменения pageSize нужно скорректировать start, если он стал слишком большим
      const maxStart = Math.max(0, dataComp.value.length - pageSize.value);
      if (start.value > maxStart) {
        start.value = maxStart;
      }
    } else {
      // tableCardRef not ready: keep default pageSize
    }
  };

  updatePageSize();

  // Запускаем синхронизацию при изменении размера окна
  window.addEventListener("resize", syncHeaderAndBodyColumns);
  window.addEventListener("resize", updatePageSize);

  // Add virtual scroll event listeners
  window.addEventListener("mousemove", handleMouseMove);
  window.addEventListener("mouseup", stopHandle);

  // Запускаем синхронизацию после загрузки данных
  watch(
    () => project.tableData,
    () => {
      setTimeout(syncHeaderAndBodyColumns, 100);
      updatePageSize();
      start.value = 0; // Reset to top when data changes
      updateHandlePosition();
    },
    { deep: true }
  );

  // Следим за изменениями pageSize и количества данных для обновления позиции ползунка
  watch([pageSize, () => dataComp.value?.length || 0], () => {
    // Проверяем доступность dataComp
    if (!dataComp.value || !Array.isArray(dataComp.value)) {
      console.warn("Watcher: dataComp.value is not available or not an array");
      return;
    }

    console.log(
      `Watcher triggered: pageSize=${pageSize.value}, dataLength=${dataComp.value.length}, needsScrolling=${needsScrolling.value}, currentStart=${start.value}`
    );

    // Если скроллинг больше не нужен, сбрасываем позицию
    if (!needsScrolling.value) {
      start.value = 0;
      htop.value = 0;
      console.log("Reset to top: no scrolling needed");
    } else {
      // Иначе корректируем позицию start
      const maxStart = Math.max(0, dataComp.value.length - pageSize.value);
      console.log(
        `Calculated maxStart=${maxStart}, current start=${start.value}`
      );

      if (start.value > maxStart) {
        console.log(`Correcting start from ${start.value} to ${maxStart}`);
        start.value = maxStart;
      }
      updateHandlePosition();
    }
  });

  // Отслеживаем изменения в start для отладки виртуального скроллинга
  watch(
    () => start.value,
    (newStart, oldStart) => {
      console.log(
        `🔄 Start changed: ${oldStart} -> ${newStart}, visiblePageStartIndexComputed should update`
      );
    }
  );

  // Отслеживаем изменения в исходных данных для отладки

  // Отслеживаем изменения в visiblePageStartIndex для отладки нумерации строк
  watch(
    () => visiblePageStartIndexComputed.value,
    (newIndex, oldIndex) => {
      console.log(
        `📊 visiblePageStartIndexComputed changed: ${oldIndex} -> ${newIndex}, row numbers should update`
      );
    }
  );

  // Следим за количеством данных и запрашиваем дополнительные, если их меньше 50

  // Отслеживаем изменения в visiblePage для отладки виртуального скроллинга
  watch(
    () => visiblePage.value,
    (newPage, oldPage) => {
      console.log(
        `📄 Visible page changed: ${oldPage?.length || 0} -> ${
          newPage?.length || 0
        } items`
      );
    },
    { deep: true }
  );

  // Запускаем синхронизацию сразу после монтирования

  // Listen for project data changes
  const unwatch = project.$subscribe((mutation, state) => {
    if (mutation.type === "direct" && mutation.storeId === "project") {
      handleTableChange();
    }
  });

  // Сохраняем ссылку на функцию для удаления в onUnmounted
  window.updateWindowHeight = updateWindowHeight;

  // Обеспечиваем правильный расчет pageSize после монтирования
  onMounted(() => {
    nextTick(() => {
      updatePageSize();
      console.log(`Component mounted, pageSize set to: ${pageSize.value}`);
    });
  });
});

onUnmounted(() => {
  document.removeEventListener("mousemove", handleResize);
  document.removeEventListener("mouseup", stopResize);
  // Очищаем обработчик синхронизации при размонтировании компонента
  window.removeEventListener("resize", syncHeaderAndBodyColumns);
  // Remove virtual scroll event listeners
  window.removeEventListener("mousemove", handleMouseMove);
  window.removeEventListener("mouseup", stopHandle);
  // Очищаем обработчик изменения высоты окна
  if (window.updateWindowHeight) {
    window.removeEventListener("resize", window.updateWindowHeight);
  }
});

// Virtual scroll methods
function mousewheel(e) {
  if (!needsScrolling.value) return;

  // Проверяем доступность dataComp
  if (!dataComp.value || !Array.isArray(dataComp.value)) {
    console.warn("mousewheel: dataComp.value is not available or not an array");
    return;
  }

  // Увеличиваем чувствительность скроллинга для лучшего контроля
  const scrollSpeed = 1; // Можно настроить для более плавного скроллинга
  const move = Math.floor(e.deltaY / 100) * scrollSpeed;

  const oldStart = start.value;
  start.value += move;
  if (start.value < 0) start.value = 0;

  const maxStart = Math.max(0, dataComp.value.length - pageSize.value);
  if (start.value > maxStart) {
    start.value = maxStart;
  }

  console.log(
    `Scroll: deltaY=${e.deltaY}, move=${move}, oldStart=${oldStart}, newStart=${start.value}, maxStart=${maxStart}, dataLength=${dataComp.value.length}, pageSize=${pageSize.value}`
  );

  // Принудительно обновляем компонент после изменения start
  nextTick(() => {
    updateHandlePosition();
  });
}

function startHandle() {
  if (handleDragging.value) return;
  handleDragging.value = true;
}

function stopHandle() {
  if (!handleDragging.value) return;
  handleDragging.value = false;
}

function handleMouseMove(e) {
  if (!handleDragging.value || !needsScrolling.value) return;

  // Проверяем доступность необходимых значений
  if (
    !scroller.value ||
    !dataComp.value ||
    !Array.isArray(dataComp.value) ||
    !handleHeight.value
  ) {
    console.warn("handleMouseMove: required values not available", {
      scroller: !!scroller.value,
      dataComp: !!dataComp.value,
      isArray: Array.isArray(dataComp.value),
      handleHeight: !!handleHeight.value,
    });
    return;
  }

  let top = htop.value + e.movementY;
  const scrollerHeight = scroller.value.clientHeight - 10;
  const handleHeightPx = parseInt(handleHeight.value);
  const maxTop = scrollerHeight - handleHeightPx;

  if (top < 0) top = 0;
  else if (top > maxTop) top = maxTop;

  htop.value = top;

  const maxStart = Math.max(0, dataComp.value.length - pageSize.value);
  const availableHeight = Math.max(1, scrollerHeight - handleHeightPx); // Избегаем деления на 0

  if (maxStart > 0) {
    start.value = Math.floor((maxStart / availableHeight) * htop.value + 0.5);
  } else {
    start.value = 0;
  }

  if (maxStart > 0) {
    start.value = Math.floor((maxStart / availableHeight) * htop.value + 0.5);
  } else {
    start.value = 0;
  }

  // Всегда проверяем границы, независимо от maxStart
  if (start.value > maxStart) {
    start.value = maxStart;
  }
  if (start.value < 0) {
    start.value = 0;
  }

  console.log(
    `Handle drag: htop=${htop.value}, maxTop=${maxTop}, start=${start.value}, maxStart=${maxStart}, dataLength=${dataComp.value.length}`
  );

  // Принудительно обновляем компонент после изменения start
  nextTick(() => {
    updateHandlePosition();
  });
}

function updateHandlePosition() {
  if (!scroller.value || !needsScrolling.value) {
    htop.value = 0;
    return;
  }

  // Проверяем, что dataComp.value существует и является массивом
  if (!dataComp.value || !Array.isArray(dataComp.value)) {
    console.warn(
      "updateHandlePosition: dataComp.value is not available or not an array"
    );
    htop.value = 0;
    return;
  }

  const scrollerHeight = scroller.value.clientHeight - 10; // Высота скроллера минус отступы
  const maxStart = Math.max(0, dataComp.value.length - pageSize.value);

  if (maxStart === 0) {
    htop.value = 0;
  } else {
    // Проверяем, что handleHeight.value существует
    if (!handleHeight.value) {
      console.warn("updateHandlePosition: handleHeight.value is not available");
      htop.value = 0;
      return;
    }

    // Рассчитываем позицию ползунка с учетом его высоты
    const handleHeightPx = parseInt(handleHeight.value);
    const availableHeight = scrollerHeight - handleHeightPx;
    htop.value = Math.floor((availableHeight / maxStart) * start.value + 0.5);
  }
}
</script>

<style scoped>
/* Стили для столбца с номерами строк */
.row-number-header {
  background: var(--el-bg-color);
  border-right: 1px solid var(--el-border-color);
  text-align: center;
  font-weight: 600;
  position: sticky;
  left: 0;
  z-index: 10;
}

.row-number-cell {
  background: var(--el-bg-color);
  border-right: 1px solid var(--el-border-color);
  text-align: center;
  font-weight: 500;
  position: sticky;
  left: 0;
  z-index: 5;
}

.row-number-cell .cell-content {
  text-align: center;
  justify-content: center;
}

.filters-container {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.filter-input {
  flex: 1;
}

.table-cart {
  min-height: 200p113x;
  display: flex;
  flex-direction: column;
}

.table-container {
  position: relative;
  width: 100%;
  border: 1px solid var(--el-border-color);
  border-radius: 0px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  height: var(--table-height);
}

/* Контейнер шапки таблицы */
.table-header-container {
  width: 100%;
  position: sticky;
  top: 0;
  z-index: 20; /* Больше чем у фиксированного столбца */
  background-color: var(--el-bg-color);
  overflow: hidden; /* Шапка не должна скроллиться */
  height: auto; /* Высота по содержимому */
  min-height: 50px; /* Минимальная высота шапки */
  display: block; /* Гарантируем корректное отображение */
  margin-bottom: 0; /* Убираем отступ снизу */
  padding-bottom: 0; /* Убираем отступ снизу */
  border-bottom: 1px solid var(--el-border-color);
}

/* Контейнер шапки таблицы - таблица внутри */
.table-header-container .custom-table {
  display: table;
  width: 100%;
  table-layout: fixed;
  margin-bottom: 0; /* Убираем отступ снизу */
}

/* Контейнер тела таблицы */
.table-body-container {
  width: 100%;
  flex: 1;
  overflow-y: auto; /* Вертикальный скролл для данных */
  position: relative;
  /* Стили для скроллбара */
  scrollbar-width: thin; /* Firefox */
  scrollbar-color: var(--el-border-color-lighter) transparent; /* Firefox */
  /* Улучшаем фиксацию элементов при прокрутке */
  will-change: transform; /* Подсказка браузеру для оптимизации */
  margin-top: 0; /* Убираем отступ сверху */
  padding-top: 0; /* Убираем отступ сверху */
  scroll-margin-top: 80px; /* высота вашей шапки */
  outline: 2px solid red; /* Временный стиль для отладки */
}

/* Контейнер тела таблицы - таблица внутри */
.table-body-container .custom-table {
  display: table;
  width: 100%;
  table-layout: fixed;
}

/* Стили для Firefox в темной теме */
html.dark .table-container {
  scrollbar-color: var(--el-border-color-darker) var(--el-bg-color); /* Firefox темная тема */
}

/* Стили для скроллбара WebKit (Chrome, Safari, Edge) */
.table-body-container::-webkit-scrollbar {
  height: 8px;
  width: 8px;
  margin: 2px;
}

.table-body-container::-webkit-scrollbar-track {
  background: transparent;
  border-radius: 4px;
}

.table-body-container::-webkit-scrollbar-thumb {
  background-color: var(--el-border-color-lighter);
  border-radius: 4px;
  border: 1px solid transparent;
  background-clip: padding-box;
}

.table-body-container::-webkit-scrollbar-thumb:hover {
  background-color: var(--el-border-color);
}

/* Темная тема для скроллбара */
html.dark .table-body-container::-webkit-scrollbar-track {
  background: var(--el-bg-color); /* Темный фон для трека скроллбара */
  border-radius: 4px;
}

html.dark .table-body-container::-webkit-scrollbar-thumb {
  background-color: var(--el-border-color-darker);
  border: 1px solid transparent;
  background-clip: padding-box;
}

html.dark .table-body-container::-webkit-scrollbar-thumb:hover {
  background-color: var(--el-text-color-secondary);
}

/* Стиль для угла пересечения скроллбаров */
.table-body-container::-webkit-scrollbar-corner {
  background: transparent; /* По умолчанию прозрачный */
}

/* Темная тема для угла скроллбаров */
html.dark .table-body-container::-webkit-scrollbar-corner {
  background: var(--el-bg-color); /* Темный фон для угла скроллбаров */
}

.loading-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(255, 255, 255, 0.8);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  z-index: 10;
  font-size: 14px;
  color: var(--el-text-color-regular);
}

html.dark .loading-overlay {
  background: rgba(0, 0, 0, 0.8);
}

.custom-table {
  width: 100%;
  min-width: 100%; /* Минимальная ширина таблицы */
  border-collapse: separate;
  border-spacing: 0;
  font-size: 12px;
  background: var(--el-bg-color);
  table-layout: fixed; /* Фиксированная ширина столбцов для предотвращения расширения */
  position: relative; /* Необходимо для корректного позиционирования фиксированных элементов */
  /* Улучшаем контраст границ в светлой теме */
  border: none;
  margin: 0; /* Убираем отступы */
}

.custom-table tbody {
  margin-top: 0; /* Убираем отступы */
  border-top: 0; /* Убираем отступы */
}

/* Темная тема для заголовков таблицы */
html.dark .custom-table thead {
  background: var(--el-bg-color);
}

html.dark .custom-table th {
  border-right: 1px solid var(--el-border-color-darker);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

html.dark .custom-table td {
  border-bottom: 1px solid var(--el-border-color-darker);
  border-right: 1px solid var(--el-border-color-darker);
}

.custom-table thead {
  background: var(--el-bg-color) !important;
  z-index: 10; /* Увеличиваем z-index для шапки */
  border-bottom: 1px solid var(--el-border-color);
  display: table-header-group; /* Явно задаем как отображать заголовок */
  height: auto; /* Высота по содержимому */
  min-height: 50px; /* Минимальная высота шапки */
  vertical-align: middle; /* Выравнивание по вертикали */
}

.custom-table thead th {
  position: sticky;
  top: 0; /* Фиксируем шапку сверху */
  z-index: 10; /* Увеличиваем z-index для корректного наложения */
  background-color: var(--el-bg-color); /* Фон для шапки */
  border-bottom: 1px solid var(--el-border-color); /* Граница снизу */
}

.custom-table th {
  padding: 12px 8px;
  text-align: left;
  font-weight: 600;
  white-space: nowrap; /* Запрещаем перенос текста */
  overflow: hidden;
  text-overflow: ellipsis;
}

.column-resizer {
  position: absolute;
  top: 0;
  right: 0;
  width: 8px;
  height: 100%;
  background-color: transparent;
  cursor: col-resize;
  z-index: 10;
  transition: background-color 0.2s;
}

.column-resizer:hover {
  background-color: var(--el-color-primary-light-5);
}

.column-resizer:active {
  background-color: var(--el-color-primary-light-5);
}

/* Add a visual indicator for dark theme */
html.dark .column-resizer:hover {
  background-color: var(--el-color-primary-light-5);
}

html.dark .column-resizer:active {
  background-color: var(--el-color-primary-light-5);
}

.custom-table th:last-child {
  border-right: none;
}

.sortable-header {
  cursor: pointer;
  transition: background-color 0.2s;
}

.sortable-header:hover {
  background-color: #f5f5f5 !important;
}

html.dark .sortable-header:hover {
  /* use Element Plus fill variables so theme can be adjusted centrally */
  background-color: var(--el-fill-color-darker) !important;
}

.header-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
}

.sort-indicator {
  display: flex;
  flex-direction: column;
  margin-left: 4px;
}

.sort-arrow {
  font-size: 10px;
  color: var(--el-text-color-placeholder);
}

.sort-arrow.sort-asc::before {
  content: "▲";
  color: var(--el-color-primary);
}

.sort-arrow.sort-desc::before {
  content: "▼";
  color: var(--el-color-primary);
}

.sort-arrow:not(.sort-asc):not(.sort-desc)::before {
  content: "⬍";
}

.custom-table td {
  padding: 8px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
  border-right: 1px solid var(--el-border-color-extra-light);
  color: var(--el-text-color-regular);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  height: 35px !important;
  max-height: 35px !important;
}

/* Темная тема для ячеек таблицы */
html.dark .custom-table td {
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  border-right: 1px solid var(--el-border-color-darker);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  height: 35px !important;
  max-height: 35px !important;
}

.custom-table td:last-child {
  border-right: none;
}

/* Стили для нечетных и четных строк с высокой специфичностью */
.custom-table tbody tr.odd-row {
  background-color: var(--el-bg-color) !important;
  height: 35px !important;
  max-height: 35px !important;
  min-height: 35px !important;
}

.custom-table tbody tr.even-row {
  background-color: #f7f7f7 !important; /* Непрозрачный серый цвет для светлой темы */
  height: 35px !important;
  max-height: 35px !important;
  min-height: 35px !important;
}

/* Темная тема для чередующихся строк */
html.dark .custom-table tbody tr.odd-row {
  background-color: var(--el-bg-color) !important;
  height: 35px !important;
  max-height: 35px !important;
  min-height: 35px !important;
}

html.dark .custom-table tbody tr.even-row {
  /* prefer Element Plus fill/bg variables for dark theme consistency */
  background-color: var(--el-fill-color) !important;
  height: 35px !important;
  max-height: 35px !important;
  min-height: 35px !important;
}

/* Стили для наведения с увеличенной специфичностью */
.custom-table tbody tr.odd-row:hover,
.custom-table tbody tr.even-row:hover {
  background: #f0f0f0 !important; /* light theme hover restored */
  height: 35px !important;
  max-height: 35px !important;
  min-height: 35px !important;
}

/* Dark theme hover should use Element Plus variables so it respects central theme */
html.dark .custom-table tbody tr.odd-row:hover,
html.dark .custom-table tbody tr.even-row:hover {
  background: #2d3748 !important; /* dark theme hover */
  height: 35px !important;
  max-height: 35px !important;
  min-height: 35px !important;
}

/* Ховер для фиксированной колонки */
.custom-table tbody tr:hover .fixed-column {
  background-color: rgba(
    0,
    0,
    0,
    0.03
  ) !important; /* Точно такой же как у обычных ячеек */
}

.table-cell {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 0; /* Позволяет ячейке сжиматься до минимума при table-layout: fixed */
}

/* Стили для фиксированного столбца */
.fixed-column {
  position: sticky;
  left: 0;
  z-index: 5;
  background-color: var(
    --el-bg-color
  ) !important; /* Устанавливаем непрозрачный фон */
  border-right: 1px solid var(--el-border-color);
  backdrop-filter: none !important; /* Отключаем эффекты прозрачности */
  opacity: 1 !important; /* Максимальная непрозрачность */
  /* Дополнительные свойства для полной непрозрачности */
  -webkit-backdrop-filter: none !important;
  background-blend-mode: normal !important;
  mix-blend-mode: normal !important;
}

/* Первый фиксированный столбец */
.fixed-column:nth-child(1) {
  left: 0;
  z-index: 10 !important; /* Более высокий z-index для первого столбца */
}

/* Второй фиксированный столбец */
.fixed-column:nth-child(2) {
  left: var(
    --second-column-left,
    60px
  ); /* Используем CSS переменную с fallback на 60px */
  z-index: 10 !important; /* Высокий z-index для второго столбца */
}

/* Третий и последующие столбцы не фиксированные */
.fixed-column:nth-child(n + 3) {
  position: static;
  left: auto;
}

/* Стили для заголовка третьего и последующих столбцов */
.custom-table thead th.fixed-column:nth-child(n + 3) {
  position: static;
  left: auto;
}

/* Дополнительные стили для четных и нечетных строк с фиксированным столбцом */
.custom-table tbody tr.odd-row .fixed-column {
  /* Совпадает с цветом строки */
  background-color: inherit !important;
  border-right: 1px solid var(--el-border-color);
}

.custom-table tbody tr.even-row .fixed-column {
  /* Совпадает с цветом строки */
  background-color: inherit !important;
  border-right: 1px solid var(--el-border-color);
}

/* Темная тема для фиксированного столбца */
html.dark .custom-table tbody tr.odd-row .fixed-column {
  background-color: inherit !important;
  border-right: 1px solid var(--el-border-color-darker);
}

html.dark .custom-table tbody tr.even-row .fixed-column {
  background-color: inherit !important;
  border-right: 1px solid var(--el-border-color-darker);
}

/* Стили для фиксированного заголовка */
.custom-table thead .fixed-column {
  background-color: var(--el-bg-color) !important;
  z-index: 15 !important; /* Выше, чем у шапки и обычных фиксированных ячеек */
  position: sticky;
  left: 0; /* Только горизонтальная фиксация для заголовка */
  border-right: 1px solid var(--el-border-color);
  border-bottom: 1px solid var(--el-border-color);
  opacity: 1 !important;
  /* Дополнительные свойства для полной непрозрачности */
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
  background-blend-mode: normal !important;
  mix-blend-mode: normal !important;
  /* box-shadow: 2px 0 5px rgba(0, 0, 0, 0.1); Добавляем тень для визуального разделения */
}

/* Второй фиксированный столбец в заголовке */
.custom-table thead th.fixed-column:nth-child(2) {
  position: sticky !important;
  left: 60px; /* Ширина первого столбца (номера строк) */
  z-index: 20 !important; /* Высокий z-index для второго столбца */
  background-color: var(--el-bg-color) !important;
  border-right: 1px solid var(--el-border-color);
  border-bottom: 1px solid var(--el-border-color);
  opacity: 1 !important;
  box-shadow: 2px 0 5px rgba(0, 0, 0, 0.1);
  /* Дополнительные свойства для полной непрозрачности */
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
  background-blend-mode: normal !important;
  mix-blend-mode: normal !important;
}

/* Первый фиксированный столбец в заголовке */
.custom-table thead th.fixed-column:nth-child(1) {
  position: sticky !important;
  left: 0;
  z-index: 25 !important; /* Самый высокий z-index для первого столбца */
  background-color: var(--el-bg-color) !important;
  border-right: 1px solid var(--el-border-color);
  border-bottom: 1px solid var(--el-border-color);
  opacity: 1 !important;
  /* Дополнительные свойства для полной непрозрачности */
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
  background-blend-mode: normal !important;
  mix-blend-mode: normal !important;
}

/* Второй фиксированный столбец в заголовке */
.custom-table thead th.fixed-column:nth-child(2) {
  left: var(
    --second-column-left,
    60px
  ); /* Используем CSS переменную с fallback на 60px */
}

/* Третий и последующие столбцы в заголовке не фиксированные */
.custom-table thead th.fixed-column:nth-child(n + 3) {
  position: static;
  left: auto;
}

html.dark .custom-table thead .fixed-column {
  background-color: var(--el-bg-color) !important;
  z-index: 15 !important;
  border-right: 1px solid var(--el-border-color-darker);
  border-bottom: 1px solid var(--el-border-color-darker);
  opacity: 1 !important;
  /* Дополнительное визуальное выделение для темной темы */
  position: sticky;
  left: 0; /* Только горизонтальная фиксация */
  box-shadow: 2px 0 5px rgba(0, 0, 0, 0.3); /* Более темная тень для темной темы */
  /* Дополнительные свойства для полной непрозрачности */
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
  background-blend-mode: normal !important;
  mix-blend-mode: normal !important;
}

/* Специальные z-index для первого и второго столбцов в темной теме */
html.dark .custom-table thead th.fixed-column:nth-child(1) {
  position: sticky !important;
  left: 0 !important;
  z-index: 25 !important;
  background-color: var(--el-bg-color) !important;
  border-right: 1px solid var(--el-border-color-darker);
  border-bottom: 1px solid var(--el-border-color-darker);
  opacity: 1 !important;
  /* Дополнительные свойства для полной непрозрачности */
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
  background-blend-mode: normal !important;
  mix-blend-mode: normal !important;
}

html.dark .custom-table thead th.fixed-column:nth-child(2) {
  position: sticky !important;
  left: var(--second-column-left, 60px) !important;
  z-index: 20 !important;
  background-color: var(--el-bg-color) !important;
  border-right: 1px solid var(--el-border-color-darker);
  border-bottom: 1px solid var(--el-border-color-darker);
  opacity: 1 !important;
  box-shadow: 2px 0 5px rgba(0, 0, 0, 0.3);
  /* Дополнительные свойства для полной непрозрачности */
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
  background-blend-mode: normal !important;
  mix-blend-mode: normal !important;
}

/* Hover для фиксированного столбца в шапке */
.custom-table thead .fixed-column:hover {
  background-color: #f5f5f5 !important;
}

html.dark .custom-table thead .fixed-column:hover {
  background-color: #2a2a2a !important;
}

/* Темная тема для столбца с номерами строк */
html.dark .row-number-header {
  background: var(--el-bg-color);
  border-right-color: var(--el-border-color-darker);
  color: var(--el-text-color-primary);
}

html.dark .row-number-cell {
  background: var(--el-bg-color);
  border-right-color: var(--el-border-color-darker);
  color: var(--el-text-color-regular);
}

/* Стили для ховера с фиксированным столбцом */
.custom-table tbody tr:hover .fixed-column {
  background: inherit !important; /* hover совпадает с цветом строки */
}

html.dark .custom-table tbody tr:hover .fixed-column {
  background: inherit !important;
}

.cell-content {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}

/* Стили для строки "Нет данных" в таблице */
.no-data-row {
  background-color: var(--el-bg-color);
}

.no-data-cell {
  text-align: center;
  padding: 40px 20px;
  border: none;
  background-color: var(--el-bg-color);
}

.no-data-cell .el-empty {
  margin: 0;
}

/* Убрана жесткая ширина для URL - теперь обрезка происходит по ширине столбца */
/* .url-cell .cell-content {
    max-width: 400px;
  } */

.no-data {
  padding: 40px;
  text-align: center;
}

/* Контейнер виртуальной прокрутки */
.virtual-scroll-container {
  position: relative;
  width: 100%;
  height: 100%;
  overflow-x: auto; /* Горизонтальный скролл для широких таблиц */
  overflow-y: hidden; /* Вертикальный скролл через виртуальную прокрутку */
  user-select: none;
}

/* Ползунок для виртуальной прокрутки */
.scroller {
  position: absolute;
  top: 58px;
  bottom: 14px;
  right: 8px;
  width: 4px;
  background: #eee;
  border-radius: 2px;
}

.handle {
  position: absolute;
  width: 10px;
  height: 8px;
  top: 0;
  border: 1px solid #ccc;
  border-radius: 3px;
  left: -4px;
  background: #fff;
  cursor: ns-resize;
}

.handle:hover {
  background: #f0f0f0;
}

.handle:active {
  background: #f0f0f0;
}

/* Контейнер вертикального ползунка */
.vertical-scroller-container {
  position: absolute;
  top: 45px; /* Уменьшено на 5px */
  bottom: 2px; /* Уменьшено на 5px */
  right: 1px;
  width: 12px;
  pointer-events: none; /* Чтобы не мешать горизонтальному скроллу */
  z-index: 10;
}

.vertical-scroller {
  position: absolute;
  top: 0;
  bottom: 0;
  right: 0;
  width: 12px;
  background: var(--el-bg-color);
  border-radius: 6px;
  /* border: 1px solid var(--el-border-color-lighter); */
  pointer-events: auto;
}

.vertical-handle {
  position: absolute;
  width: 8px;
  /* height: 20px; - убрана фиксированная высота, теперь динамическая */
  top: 0;
  left: 2px;
  border-radius: 4px;
  background: var(--el-border-color-lighter);
  cursor: ns-resize;
  transition: background-color 0.2s;
}

.vertical-handle:hover {
  background: var(--el-border-color);
}

.vertical-handle:active {
  background: var(--el-border-color);
}

/* Темная тема для вертикального ползунка */
html.dark .vertical-scroller {
  background: var(--el-bg-color);
  border-color: var(--el-border-color-darker);
}

html.dark .vertical-handle {
  background: var(--el-border-color-darker);
}

html.dark .vertical-handle:hover {
  background: var(--el-text-color-secondary);
}

html.dark .vertical-handle:active {
  background: var(--el-text-color-secondary);
}

/* Стили для горизонтального скроллбара виртуального контейнера */
.virtual-scroll-container::-webkit-scrollbar {
  height: 8px;
  width: 8px;
}

.virtual-scroll-container::-webkit-scrollbar-track {
  background: transparent;
  border-radius: 4px;
}

.virtual-scroll-container::-webkit-scrollbar-thumb {
  background-color: var(--el-border-color-lighter);
  border-radius: 4px;
  border: 1px solid transparent;
  background-clip: padding-box;
}

.virtual-scroll-container::-webkit-scrollbar-thumb:hover {
  background-color: var(--el-border-color);
}

/* Темная тема для горизонтального скроллбара */
html.dark .virtual-scroll-container::-webkit-scrollbar-track {
  background: var(--el-bg-color);
  border-radius: 4px;
}

html.dark .virtual-scroll-container::-webkit-scrollbar-thumb {
  background-color: var(--el-border-color-darker);
  border: 1px solid transparent;
  background-clip: padding-box;
}

html.dark .virtual-scroll-container::-webkit-scrollbar-thumb:hover {
  background-color: var(--el-text-color-secondary);
}

/* Firefox поддержка для горизонтального скроллбара */
.virtual-scroll-container {
  scrollbar-width: thin;
  scrollbar-color: var(--el-border-color-lighter) var(--el-bg-color);
}

/* Темная тема Firefox */
html.dark .virtual-scroll-container {
  scrollbar-color: var(--el-border-color-darker) var(--el-bg-color);
}

/* Make el-transfer scrollbar look same as table scrollbar */
.el-transfer-panel__list::-webkit-scrollbar {
  height: 8px;
  width: 8px;
}

.el-transfer-panel__list::-webkit-scrollbar-track {
  background: transparent;
  border-radius: 4px;
}

.el-transfer-panel__list::-webkit-scrollbar-thumb {
  background-color: var(--el-border-color-lighter);
  border-radius: 4px;
  border: 1px solid transparent;
  background-clip: padding-box;
}

.el-transfer-panel__list::-webkit-scrollbar-thumb:hover {
  background-color: var(--el-border-color);
}

html.dark .el-transfer-panel__list::-webkit-scrollbar-track {
  background: var(--el-bg-color);
  border-radius: 4px;
}

html.dark .el-transfer-panel__list::-webkit-scrollbar-thumb {
  background-color: var(--el-border-color-darker);
  border: 1px solid transparent;
  background-clip: padding-box;
}

html.dark .el-transfer-panel__list::-webkit-scrollbar-thumb:hover {
  background-color: var(--el-text-color-secondary);
}

.el-transfer-panel__list {
  scrollbar-width: thin;
  scrollbar-color: var(--el-border-color-lighter) var(--el-bg-color);
}

html.dark .el-transfer-panel__list {
  scrollbar-color: var(--el-border-color-darker) var(--el-bg-color);
}
</style>
