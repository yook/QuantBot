<!--
  DataTableFixed - компонент таблицы с фиксированной высотой и виртуальной прокруткой.

  Отличия от DataTable:
  - Всегда использует фиксированную высоту из props.fixedHeight
  - Не реагирует на изменения размера окна для пересчета высоты
  - Упрощенная логика расчета pageSize

  Принимаемые props:
  - tableColumns: Array - массив объектов столбцов { prop: string, name: string, width: number }
  - data: Array - массив данных для отображения
  - totalCount: Number - общее количество записей
  - loading: Boolean - флаг загрузки данных
  - loadingMore: Boolean - флаг догрузки данных
  - sort: Object - объект сортировки в числовом формате, например { fieldName: 1 } (1 = ASC, -1 = DESC)
  - loadWindow: Function - функция загрузки окна данных (newWindowStart: number) => Promise
  - sortData: Function - функция сортировки (options: object) => void
  - loadData: Function - функция загрузки данных (projectId: string, options: object) => Promise
  - fixedHeight: Number - фиксированная высота таблицы в пикселях (обязательный)
-->
<template>
  <div
    ref="tableCardRef"
    :style="{
      '--table-height': tableHeight,
      '--second-column-left': secondColumnLeft,
    }"
  >
    <div class="table-container">
      <div class="virtual-scroll-container" @wheel.prevent="mousewheel">
        <table class="custom-table">
          <thead>
            <tr>
              <th
                v-for="(column, columnIndex) in tableColumnsWithRowNumber"
                :key="column.prop"
                :style="{
                  minWidth:
                    (getColumnWidth(column.prop) || column.width || 200) + 'px',
                  width:
                    (getColumnWidth(column.prop) || column.width || 300) + 'px',
                }"
                :class="[
                  'sortable-header',
                  columnIndex < props.fixedColumns ? 'fixed-column' : '',
                  column.prop === '_rowNumber' &&
                  columnIndex < props.fixedColumns
                    ? 'row-number-header'
                    : '',
                ]"
              >
                <div
                  :class="[
                    'header-content',
                    column.prop === '_rowNumber' ||
                    column.prop === '_actions' ||
                    column.prop === 'target_query'
                      ? 'center-header'
                      : '',
                  ]"
                  @click="
                    column.prop !== '_rowNumber' && column.prop !== '_actions'
                      ? handleSort(column.prop)
                      : null
                  "
                >
                  <span v-if="column.prop !== '_actions'">{{
                    column.name
                  }}</span>
                  <el-icon
                    v-else
                    @click.stop="emit('delete-all')"
                    style="cursor: pointer; color: var(--el-color-danger)"
                    title="Удалить все записи"
                  >
                    <DeleteFilled />
                  </el-icon>
                  <span
                    v-if="
                      column.prop !== '_rowNumber' && column.prop !== '_actions'
                    "
                    class="sort-indicator"
                  >
                    <i
                      class="sort-arrow"
                      :class="getSortClass(column.prop)"
                    ></i>
                  </span>
                </div>
                <div
                  class="column-resizer"
                  v-if="column.prop !== '_actions'"
                  @mousedown.prevent="startResize($event, column.prop)"
                  title="Drag to resize column"
                ></div>
              </th>
            </tr>
          </thead>
          <tbody
            v-loading="showLoadingMore"
            element-loading-background="transparent"
          >
            <tr
              v-for="(row, index) in visiblePage"
              :key="row.id || start + index"
              :class="{
                'even-row': (start + index) % 2 === 1,
                'odd-row': (start + index) % 2 === 0,
              }"
            >
              <td
                v-for="(column, columnIndex) in tableColumnsWithRowNumber"
                :key="column.prop"
                :class="[
                  'table-cell',
                  column.prop === 'keyword' ? 'url-cell' : '',
                  columnIndex < props.fixedColumns ? 'fixed-column' : '',
                  column.prop === '_rowNumber' &&
                  columnIndex < props.fixedColumns
                    ? 'row-number-cell'
                    : '',
                ]"
                :style="{
                  minWidth:
                    (getColumnWidth(column.prop) || column.width || 200) + 'px',
                  width:
                    (getColumnWidth(column.prop) || column.width || 300) + 'px',
                }"
              >
                <div
                  class="cell-content"
                  :class="{
                    'center-cell':
                      column.prop === '_actions' ||
                      column.prop === 'target_query',
                  }"
                  :style="{
                    textAlign: column.prop === '_rowNumber' ? 'center' : 'left',
                  }"
                >
                  <span v-if="column.prop === '_rowNumber'">{{
                    row._rowNumber
                  }}</span>
                  <span v-else-if="column.prop === '_actions'">
                    <el-icon
                      @click="emit('delete-row', row)"
                      style="cursor: pointer; color: var(--el-color-danger)"
                    >
                      <Delete />
                    </el-icon>
                  </span>
                  <span v-else>
                    <template
                      v-if="
                        column.prop === 'category_info' ||
                        column.prop === 'class_info'
                      "
                    >
                      <span class="category-info-inline">
                        <span
                          class="category-name"
                          :title="
                            column.prop === 'category_info'
                              ? row.category_name
                              : row.class_name
                          "
                          >{{
                            column.prop === "category_info"
                              ? row.category_name
                              : row.class_name
                          }}</span
                        >
                        <el-tooltip
                          v-if="
                            column.prop === 'category_info'
                              ? row.category_similarity
                              : row.class_similarity
                          "
                          content="достоверность"
                          placement="top"
                          trigger="click"
                        >
                          <el-tag
                            type="primary"
                            size="small"
                            style="cursor: pointer"
                            >{{
                              formatSimilarity(
                                column.prop === "category_info"
                                  ? row.category_similarity
                                  : row.class_similarity
                              )
                            }}</el-tag
                          >
                        </el-tooltip>
                      </span>
                    </template>
                    <template v-else-if="column.prop === 'target_query'">
                      <el-icon
                        v-if="
                          row.target_query === 1 || row.target_query === true
                        "
                        style="color: var(--el-color-success); font-size: 18px"
                      >
                        <Check />
                      </el-icon>
                      <el-icon
                        v-else-if="
                          row.target_query === 0 || row.target_query === false
                        "
                        style="color: var(--el-color-danger); font-size: 18px"
                      >
                        <Close />
                      </el-icon>
                      <span v-else>{{ row.target_query }}</span>
                    </template>
                    <template v-else>
                      {{ formatCellValue(row[column.prop], column.prop) }}
                    </template>
                  </span>
                </div>
              </td>
            </tr>
            <tr
              v-if="
                ((visiblePage.length === 0 && props.totalCount === 0) ||
                  !props.data ||
                  props.data.length === 0) &&
                !props.loading &&
                !props.loadingMore
              "
              class="no-data-row"
            >
              <td
                :colspan="tableColumnsWithRowNumber.length"
                class="no-data-cell"
              >
                <el-empty
                  description="Нет данных для отображения"
                  :image-size="80"
                />
              </td>
            </tr>
          </tbody>
        </table>
        <!-- Скрытая область для имитации общей высоты всех строк -->
        <div
          v-if="props.totalCount > 0"
          class="total-height-spacer"
          :style="{ height: totalTableHeight + 'px' }"
        ></div>
      </div>
      <!-- Вертикальный ползунок вынесен за пределы прокручиваемого контейнера -->
      <div
        v-if="dataComp.length && needsScrolling"
        class="vertical-scroller-container"
      >
        <div ref="scroller" class="vertical-scroller">
          <div
            class="vertical-handle"
            :style="{
              top: htop + 'px',
              height: handleHeight,
            }"
            @mousedown="startHandle"
            @click="handleScrollbarClick"
          ></div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import moment from "moment";
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from "vue";
import { useProjectStore } from "../stores/project";
import { Delete, DeleteFilled, Check, Close } from "@element-plus/icons-vue";

const emit = defineEmits(["delete-row", "delete-all"]);

const props = defineProps({
  tableColumns: {
    type: Array,
    required: true,
  },
  data: {
    type: Array,
    default: () => [],
  },
  totalCount: {
    type: Number,
    default: 0,
  },
  loading: {
    type: Boolean,
    default: false,
  },
  loadingMore: {
    type: Boolean,
    default: false,
  },
  sort: {
    type: Object,
    default: () => ({}),
  },
  loadWindow: {
    type: Function,
    required: true,
  },
  sortData: {
    type: Function,
    required: true,
  },
  loadData: {
    type: Function,
    required: true,
  },
  // start index of the data window provided in props.data
  windowStart: {
    type: Number,
    default: 0,
  },
  fixedHeight: {
    type: Number,
    required: true,
  },
  // Vertical offset subtracted from window height when computing available table area
  heightOffset: {
    type: Number,
    default: 250,
  },
  fixedColumns: {
    type: Number,
    default: 0,
  },
  // Optional explicit key for storing per-table column widths
  // If not provided, falls back to project.currentDb
  dbKey: {
    type: String,
    default: undefined,
  },
});

const project = useProjectStore();

// Helper to determine which table key to use for storage and width mapping
function getDbKey() {
  try {
    return props.dbKey || project.currentDb;
  } catch (e) {
    return project.currentDb;
  }
}

// Локальные переменные для виртуальной прокрутки
const windowStart = ref(0);
const bufferSize = 50;

const resizing = ref(false);
const currentColumn = ref(null);
const startX = ref(0);
const startWidth = ref(0);
const columnWidths = ref({});
const tableCardRef = ref(null);
const windowHeight = ref(window.innerHeight);

// Virtual scroll variables
const scroller = ref(null);
const pageSize = ref(20); // Количество видимых строк
const scrollTop = ref(0); // Текущая позиция скролла в пикселях
const start = ref(0); // Начальная позиция видимого окна (в строках)
const htop = ref(0);
const handleDragging = ref(false);
const rowHeight = 35; // Высота строки в пикселях
const lastScrollTime = ref(0); // Для throttling скролла
const lastLoadTime = ref(0); // Для throttling загрузки данных
const lastWindowStart = ref(null); // Track the last window start value

// Set cursor style for the entire document during resizing
const documentStyle = computed(() => {
  return resizing.value ? { cursor: "col-resize" } : {};
});

const dataComp = computed(() => {
  try {
    // Проверяем, что keywords существует и является массивом
    if (!props.data || !Array.isArray(props.data)) {
      return [];
    }

    // Preserve original item fields (so tables using other props like category_name work)
    const result = props.data.map((item, index) => {
      // If item is an object, spread it and ensure id exists
      if (item && typeof item === "object") {
        return {
          ...item,
          id: item.id || windowStart.value + index + 1,
        };
      }

      // For primitive values, keep as value field
      return {
        id: windowStart.value + index + 1,
        value: item,
      };
    });

    return result;
  } catch (error) {
    return [];
  }
});

// Computed property для видимой страницы виртуальной прокрутки
const visiblePage = computed(() => {
  try {
    // Если данные еще загружаются, возвращаем пустой массив
    if (props.loading || props.loadingMore) {
      return [];
    }

    // Если массив данных пустой, но загрузка завершена, возвращаем пустой массив
    if ((!props.data || props.data.length === 0) && !props.loading) {
      return [];
    }

    // Проверяем доступность dataComp
    if (
      !dataComp.value ||
      !Array.isArray(dataComp.value) ||
      dataComp.value.length === 0
    ) {
      return [];
    }

    // Рассчитываем видимые строки на основе scrollTop
    const startRow = Math.floor(scrollTop.value / rowHeight);
    const endRow = Math.min(startRow + pageSize.value, props.totalCount);

    // Если видимый диапазон пустой, возвращаем пустой массив
    if (endRow <= startRow) {
      return [];
    }

    // Определяем, какие данные из окна показать
    const windowStartRow = windowStart.value;
    const windowEndRow = windowStartRow + (props.data?.length || 0);

    // Если данные еще загружаются для этой позиции, показываем лоудер
    if (props.loadingMore) {
      return [];
    }

    // Если видимая область находится в текущем окне
    if (
      startRow >= windowStartRow &&
      endRow <= windowEndRow &&
      props.data?.length > 0
    ) {
      const startInWindow = startRow - windowStartRow;
      const endInWindow = Math.min(endRow - windowStartRow, props.data.length);

      // Дополнительная проверка границ
      if (
        startInWindow < 0 ||
        endInWindow <= startInWindow ||
        startInWindow >= dataComp.value.length
      ) {
        console.warn("visiblePage: Invalid window bounds", {
          startInWindow,
          endInWindow,
          dataLength: dataComp.value.length,
          startRow,
          endRow,
          windowStartRow,
          windowEndRow,
        });
        return [];
      }

      const result = dataComp.value
        .slice(startInWindow, endInWindow)
        .map((item, index) => ({
          ...item,
          _rowNumber: startRow + index + 1, // Глобальный номер строки на основе scrollTop
        }));

      console.log("visiblePage: Showing rows", {
        startRow,
        endRow,
        resultLength: result.length,
        windowStart: windowStartRow,
        sort: props.sort,
      });

      return result;
    }

    // Если видимая область частично перекрывается с окном, показываем доступную часть
    if (
      startRow < windowEndRow &&
      endRow > windowStartRow &&
      props.data?.length > 0
    ) {
      const overlapStart = Math.max(startRow, windowStartRow);
      const overlapEnd = Math.min(endRow, windowEndRow);

      if (overlapEnd > overlapStart) {
        const startInWindow = overlapStart - windowStartRow;
        const endInWindow = overlapEnd - windowStartRow;

        if (startInWindow >= 0 && endInWindow <= dataComp.value.length) {
          const result = dataComp.value
            .slice(startInWindow, endInWindow)
            .map((item, index) => ({
              ...item,
              _rowNumber: overlapStart + index + 1,
            }));

          console.log("visiblePage: Showing partial overlap", {
            overlapStart,
            overlapEnd,
            resultLength: result.length,
          });

          return result;
        }
      }
    }

    // Если видимая область не в текущем окне, автоматически загружаем данные
    const newWindowStart = Math.max(0, startRow - bufferSize);

    if (
      newWindowStart !== windowStart.value &&
      newWindowStart !== lastWindowStart.value && // Prevent duplicate calls
      !props.loadingMore
    ) {
      lastWindowStart.value = newWindowStart; // Update the last window start value
      windowStart.value = newWindowStart;
      props.loadWindow(newWindowStart);
    }

    // Пока данные загружаются, возвращаем пустой массив (лоудер будет показан)
    return [];
  } catch (error) {
    return [];
  }
}); // Computed property для определения необходимости скроллинга
const needsScrolling = computed(() => {
  try {
    // Если данные еще загружаются, считаем что скроллинг нужен
    if (props.loading) {
      return true;
    }

    // Если данных нет вообще, скроллинг не нужен
    if (props.totalCount === 0) {
      return false;
    }

    // Скроллинг нужен если общее количество строк больше видимых
    return props.totalCount > pageSize.value;
  } catch (error) {
    return false;
  }
});

// Computed property для расчета высоты ползунка скроллера
const handleHeight = computed(() => {
  try {
    if (!needsScrolling.value || !scroller.value) return "20px"; // Минимальная высота по умолчанию

    const totalRows = props.totalCount || pageSize.value; // Если totalCount неизвестен, используем pageSize как минимум
    const visibleRows = pageSize.value;

    if (totalRows <= visibleRows) {
      return `${scroller.value.clientHeight - 10}px`; // Ползунок на всю высоту скроллера
    }

    // Пропорциональная высота: (видимые строки / общее количество строк) * высота скроллера
    const proportion = visibleRows / totalRows;
    const calculatedHeight = Math.max(
      20,
      Math.floor((scroller.value.clientHeight - 10) * proportion)
    ); // Минимум 20px

    return `${calculatedHeight}px`;
  } catch (error) {
    return "20px";
  }
});

// Computed property для расчета высоты таблицы.
// Если props.fixedHeight передан и >0 — используем его, иначе вычисляем как
// floor((window.innerHeight - 400) / rowHeight) * rowHeight — чтобы высота была кратна rowHeight.
const tableHeight = computed(() => {
  try {
    // 1) Явно заданная высота имеет приоритет
    if (
      props.fixedHeight &&
      typeof props.fixedHeight === "number" &&
      props.fixedHeight > 0
    ) {
      return props.fixedHeight + "px";
    }

    // Базируем высоту на количестве строк: каждая строка 35px + высота заголовка ≈ 35px
    const totalRows = Number(props.totalCount) || 0;
    const header = rowHeight; // приблизительная высота заголовка
    const contentHeight =
      totalRows > 0
        ? totalRows * rowHeight + header
        : Math.max(270, header + rowHeight * 3); // минимальная комфортная высота, если данных нет

    // Если окно доступно — ограничиваем только сверху: если контента мало, роли не играет
    if (typeof window !== "undefined" && windowHeight.value) {
      const available = Math.max(270, windowHeight.value - props.heightOffset);
      // Если строк мало и контента меньше доступной высоты, скролла не будет (берём contentHeight)
      // Если строк много — ограничим высоту доступной областью (будет внутренний скролл)
      const final = Math.min(contentHeight, available);
      return final + "px";
    }

    // Без доступа к окну: используем контентную высоту с нижней границей
    return Math.max(270, contentHeight) + "px";
  } catch (e) {
    return "600px";
  }
});

// Computed property для общей высоты таблицы (все строки)
const totalTableHeight = computed(() => {
  try {
    // Если данные еще загружаются и totalCount неизвестен, используем минимальную высоту
    if (props.loading && props.totalCount === 0) {
      return pageSize.value * rowHeight; // Минимальная высота для видимой области
    }

    // Базовая логика: суммарная высота контента = количество строк * высота строки
    if (props.totalCount > 0) {
      return props.totalCount * rowHeight;
    }

    // Если данных нет, возвращаем 0
    return 0;
  } catch (error) {
    return 0;
  }
});

// Computed property для позиции второго фиксированного столбца
const secondColumnLeft = computed(() => {
  const firstColumnWidth = getColumnWidth("_rowNumber");
  return firstColumnWidth + "px";
});

// Computed property для отображения лоудера при загрузке дополнительных данных
const showLoadingMore = computed(() => {
  try {
    return visiblePage.value.length === 0 && props.loadingMore;
  } catch (error) {
    return false;
  }
});

// Новое вычисляемое свойство для столбцов таблицы с номером строки
const tableColumnsWithRowNumber = computed(() => [
  {
    prop: "_rowNumber",
    name: "#",
    width: 30,
    formatter: (_, __, rowIndex) => rowIndex + 1, // Форматируем номер строки
  },
  ...props.tableColumns,
]);

function formatCellValue(value, columnProp, row = null) {
  try {
    // Treat null/undefined/empty string as empty; allow numeric 0
    if (value === null || typeof value === "undefined" || value === "")
      return "";

    if (columnProp === "category_info") {
      try {
        // The template sometimes passes the whole row as the first argument
        // (formatCellValue(row, 'category_info')) and sometimes passes the
        // cell value as the first arg and row as the third param. Support both.
        const r = row || value;
        if (!r) return "";
        const name = typeof r.category_name === "string" ? r.category_name : "";
        const similarity = r.category_similarity;
        const simFormatted = similarity ? formatSimilarity(similarity) : "";
        // Use inline-flex wrapper so the tag can be right-aligned inside the cell.
        // Escape the category name to avoid accidental HTML injection.
        return `<span class="category-info-inline"><span class="category-name" title="${escapeHtml(
          name
        )}">${escapeHtml(
          name
        )}</span><span class="similarity-tag">${simFormatted}</span></span>`;
      } catch (e) {
        console.error("Error in category_info formatting:", e);
        return "";
      }
    }

    if (columnProp === "date" && value) {
      return moment(value).format("YYYY-MM-DD HH:mm:ss");
    }

    if (columnProp === "created_at" && value) {
      // Обрабатываем как ISO строку или как строку в формате YYYY-MM-DD HH:mm:ss
      const date = moment(value);
      if (date.isValid()) {
        return date.format("YYYY-MM-DD HH:mm:ss");
      }
      return value; // Если не удалось распарсить, возвращаем как есть
    }

    // Display similarity fields as percent (0.0 - 1.0 => 0% - 100%) or numeric 0-100
    if (
      columnProp === "category_similarity" ||
      columnProp === "class_similarity"
    ) {
      // Accept values in [0,1] or [0,100]
      const num = Number(value);
      if (Number.isNaN(num)) return value;
      const v = num <= 1 ? num * 100 : num;
      return `${v.toFixed(2)}%`;
    }

    // Убрана жесткая обрезка URL - теперь обрезка происходит по ширине столбца через CSS
    // if (columnProp === "url" && value.length > 60) {
    //   return value.substring(0, 60) + "...";
    // }

    return value;
  } catch (error) {
    return value || "";
  }
}

function formatSimilarity(value) {
  const num = Number(value);
  if (Number.isNaN(num)) return "";
  const v = num <= 1 ? num * 100 : num;
  return `${v.toFixed(2)}%`;
}

// Simple HTML escaper for values rendered via v-html
function escapeHtml(unsafe) {
  if (!unsafe && unsafe !== 0) return "";
  return String(unsafe)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getSortClass(columnProp) {
  try {
    const currentSort = props.sort || {};

    // Two supported shapes:
    // 1) { field: 'col', direction: 'ascending' }
    // 2) { col: 1 } or { col: -1 }

    let field = null;
    let direction = null;

    if (currentSort.field) {
      field = currentSort.field;
      direction =
        currentSort.direction === "ascending" ? "ascending" : "descending";
    } else {
      const keys = Object.keys(currentSort || {});
      if (keys.length > 0) {
        field = keys[0];
        const val = currentSort[field];
        direction = val === 1 ? "ascending" : "descending";
      }
    }

    if (!field) return "";

    // Debugging: log current sort and column being checked
    // eslint-disable-next-line no-console
    console.debug(
      "getSortClass: column=",
      columnProp,
      "sort=",
      currentSort,
      "derivedField=",
      field,
      "direction=",
      direction
    );

    // Учитываем маппинг _id <-> id
    // Также маппим логические столбцы на реальные поля: 'category_info' -> 'category_similarity', 'class_info' -> 'class_similarity'
    const mappedColumnProp =
      columnProp === "category_info"
        ? "category_similarity"
        : columnProp === "class_info"
        ? "class_similarity"
        : columnProp;
    const isCurrentColumn =
      field === mappedColumnProp ||
      (field === "id" && mappedColumnProp === "_id") ||
      (field === "_id" && mappedColumnProp === "id");

    if (!isCurrentColumn) return "";

    return direction === "ascending" ? "sort-asc" : "sort-desc";
  } catch (e) {
    return "";
  }
}

function handleSort(columnProp) {
  try {
    let sortField = columnProp;

    // Map logical columns to actual DB fields
    if (sortField === "category_info") {
      // sort by similarity value for category_info header
      sortField = "category_similarity";
    }
    if (sortField === "class_info") {
      // sort by similarity value for class_info header
      sortField = "class_similarity";
    }

    // Преобразуем _id в id для SQLite
    if (sortField === "_id") sortField = "id";

    // Detect current sort in both shapes
    const currentSort = props.sort || {};
    let currentField = null;
    let currentDir = null; // 'ascending' | 'descending'

    if (currentSort.field) {
      currentField = currentSort.field;
      currentDir =
        currentSort.direction === "ascending" ? "ascending" : "descending";
    } else {
      const keys = Object.keys(currentSort);
      if (keys.length > 0) {
        currentField = keys[0];
        currentDir =
          currentSort[currentField] === 1 ? "ascending" : "descending";
      }
    }

    // Toggle direction
    let newDir = "ascending";
    const isCurrentColumn =
      currentField === sortField ||
      (currentField === "id" && sortField === "_id");
    if (isCurrentColumn && currentDir === "ascending") {
      newDir = "descending";
    }

    // Reset scroll/virtual window and sync with store
    scrollTop.value = 0;
    start.value = 0;
    lastWindowStart.value = 0;
    windowStart.value = 0;

    // Backend expects numeric sort object like { col: 1 } where 1 = ASC, -1 = DESC
    const numeric = newDir === "ascending" ? 1 : -1;
    const sortObj = {};
    sortObj[sortField] = numeric;

    // Debugging: log the sort being emitted
    // eslint-disable-next-line no-console
    console.debug(
      "handleSort: emitting sortObj=",
      sortObj,
      "from column=",
      columnProp,
      "props.sort=",
      props.sort
    );

    props.sortData(sortObj);

    // Force window reload at 0 to avoid stale slice during rapid wheel scroll
    if (typeof props.loadWindow === "function") {
      props.loadWindow(0);
    }
  } catch (e) {
    console.error("handleSort error:", e);
  }
}

// Функция удалена, т.к. больше не используется пагинация
// Оставляем для совместимости, чтобы не было ошибок если вызывается где-то еще
function changeCurrentPage(val) {
  // Просто делегируем в getsortedDb без пагинации
  project.tableLoading = true;
  project.tableData = [];

  project.getsortedDb({
    id: project.data.id,
    sort: project.sort,
    skip: 0,
    limit: 0, // 0 означает "без лимита" - загрузить все
    db: project.currentDb,
  });
}

function handleTableChange(selectedDb) {
  console.log("Changing table to:", selectedDb);
  // Устанавливаем новую базу данных
  project.currentDb = selectedDb;

  // Reset column widths when changing tables
  columnWidths.value = {};

  // Load stored column widths from localStorage first
  const storageKey = `table-column-widths-${project.data.id}-${selectedDb}`;
  const stored = localStorage.getItem(storageKey);
  if (stored) {
    try {
      const storedWidths = JSON.parse(stored);
      columnWidths.value = { ...storedWidths };
    } catch (e) {
      // Ignore errors
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
    limit: 0, // 0 означает "без лимита" - загрузить все
    db: selectedDb,
  });
}

function getsortedDb(sort) {
  project.tableLoading = true;
  project.tableData = [];
  project.currentPage = 1;

  project.getsortedDb({
    id: project.data.id,
    sort: sort,
    skip: 0,
    limit: 0, // 0 означает "без лимита" - загрузить все
    db: project.currentDb,
  });
}

// Функция для загрузки дополнительных данных (отключена в пользу mousewheel логики)
function loadMoreData() {
  // Эта функция отключена, так как загрузка данных теперь управляется
  // напрямую из функции mousewheel для лучшей синхронизации
  console.log(
    "loadMoreData called but skipped - using mousewheel logic instead"
  );
  return;
}

// Ensure loadingMore is reset correctly after data loading
watch(
  () => props.loadingMore,
  (newVal) => {
    if (!newVal) {
      console.log("loadingMore reset to false"); // Debugging log
    }
  }
);

// Column resizing functions
function getColumnWidth(columnProp) {
  // First check if we have a temporarily stored width from active resizing
  if (columnWidths.value[columnProp]) {
    // Применяем минимальную ширину для _rowNumber
    if (columnProp === "_rowNumber") {
      return Math.max(30, columnWidths.value[columnProp]);
    }
    return columnWidths.value[columnProp];
  }

  // Check if width is stored in project data for current table
  if (
    project.data.columnWidths &&
    project.data.columnWidths[getDbKey()] &&
    project.data.columnWidths[getDbKey()][columnProp]
  ) {
    // Применяем минимальную ширину для _rowNumber
    if (columnProp === "_rowNumber") {
      return Math.max(30, project.data.columnWidths[getDbKey()][columnProp]);
    }
    return project.data.columnWidths[getDbKey()][columnProp];
  }

  // Find the column in tableColumns
  const column = props.tableColumns.find((col) => col.prop === columnProp);
  // Default widths: 30px for _rowNumber, otherwise 300px
  if (columnProp === "_rowNumber") return 30;
  return column?.width || 300;
}

function startResize(event, columnProp) {
  event.stopPropagation();
  // Do not allow resizing for action column only
  if (columnProp === "_actions") return;
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
  const minWidth = currentColumn.value === "_rowNumber" ? 30 : 80;
  const newWidth = Math.max(minWidth, startWidth.value + diff);

  // Update column width in local state for immediate visual feedback
  columnWidths.value = {
    ...columnWidths.value,
    [currentColumn.value]: newWidth,
  };
}

function stopResize() {
  if (resizing.value && currentColumn.value) {
    // First set resizing to false
    resizing.value = false;

    // Then save the final width to the project store
    saveColumnWidth(
      currentColumn.value,
      columnWidths.value[currentColumn.value]
    );
  }

  currentColumn.value = null;
  document.removeEventListener("mousemove", handleResize);
  document.removeEventListener("mouseup", stopResize);
}

function saveColumnWidth(columnProp, width) {
  // Применяем минимальную ширину для _rowNumber
  const finalWidth = columnProp === "_rowNumber" ? Math.max(30, width) : width;

  // Update columnWidths.value to include this new width
  columnWidths.value = {
    ...columnWidths.value,
    [columnProp]: finalWidth,
  };

  // Make sure columnWidths structure exists in project data
  if (!project.data.columnWidths) {
    project.data.columnWidths = {};
  }

  // Initialize current DB column widths if not exist
  if (!project.data.columnWidths[getDbKey()]) {
    project.data.columnWidths[getDbKey()] = {};
  }

  // Save ALL current column widths to project data (not just one)
  project.data.columnWidths[getDbKey()] = {
    ...project.data.columnWidths[getDbKey()],
    ...columnWidths.value,
  };

  // Find the column in the default settings or parser columns and update there too
  const defaultColumnIndex = project.defaultColumns.findIndex(
    (col) => col.prop === columnProp
  );
  if (defaultColumnIndex !== -1) {
    project.defaultColumns[defaultColumnIndex].width = finalWidth;
  } else {
    // Try to find in the parser columns (only if parser exists and is an array)
    if (Array.isArray(project.data.parser)) {
      const parserColumnIndex = project.data.parser.findIndex(
        (col) => col.prop === columnProp
      );
      if (parserColumnIndex !== -1) {
        project.data.parser[parserColumnIndex].width = finalWidth;
      }
    }
  }

  // Save ALL widths to localStorage (not just one)
  saveAllColumnWidthsToLocalStorage();

  // Only save to database when resizing is complete to avoid too many updates
  if (!resizing.value) {
    project.updateProject();
  }
}

// Функция сохранения ширины столбцов в localStorage
function saveColumnWidthsToLocalStorage(columnProp, width) {
  const storageKey = `table-column-widths-${project.data.id}-${getDbKey()}`;
  let storedWidths = {};

  // Загружаем существующие ширины из localStorage
  const stored = localStorage.getItem(storageKey);
  if (stored) {
    try {
      storedWidths = JSON.parse(stored);
    } catch (e) {
      storedWidths = {};
    }
  }

  // Обновляем ширину для конкретного столбца
  storedWidths[columnProp] = width;

  // Сохраняем обратно в localStorage
  try {
    localStorage.setItem(storageKey, JSON.stringify(storedWidths));
  } catch (e) {
    // Ignore errors
  }
}

// Функция сохранения ВСЕХ ширин столбцов в localStorage
function saveAllColumnWidthsToLocalStorage() {
  const storageKey = `table-column-widths-${project.data.id}-${getDbKey()}`;

  // Сохраняем все текущие ширины
  try {
    localStorage.setItem(storageKey, JSON.stringify(columnWidths.value));
  } catch (e) {
    // Ignore errors
  }
}

// Функция загрузки ширины столбцов из localStorage
function loadColumnWidthsFromLocalStorage() {
  const storageKey = `table-column-widths-${project.data.id}-${getDbKey()}`;
  const stored = localStorage.getItem(storageKey);

  if (stored) {
    try {
      const storedWidths = JSON.parse(stored);

      // Применяем минимальную ширину для _rowNumber
      const processedWidths = { ...storedWidths };
      if (processedWidths["_rowNumber"]) {
        processedWidths["_rowNumber"] = Math.max(
          30,
          processedWidths["_rowNumber"]
        );
      }

      // Обновляем columnWidths в компоненте
      columnWidths.value = { ...processedWidths };

      // Также обновляем в project data, если нужно
      if (!project.data.columnWidths) {
        project.data.columnWidths = {};
      }
      if (!project.data.columnWidths[getDbKey()]) {
        project.data.columnWidths[getDbKey()] = {};
      }
      Object.assign(project.data.columnWidths[getDbKey()], processedWidths);

      return processedWidths;
    } catch (e) {
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
  try {
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
      project.data.columnWidths[getDbKey()]
    ) {
      const projectWidths = { ...project.data.columnWidths[getDbKey()] };
      // Применяем минимальную ширину для _rowNumber
      if (projectWidths["_rowNumber"]) {
        projectWidths["_rowNumber"] = Math.max(30, projectWidths["_rowNumber"]);
      }
      columnWidths.value = { ...projectWidths };
    }

    // Sync column widths from storage or project data for current DB
    const updateColumnWidthsFromStore = () => {
      // Если идет ресайз, не обновляем из стора (чтобы не потерять текущие изменения)
      if (resizing.value) {
        return;
      }

      // Сначала пробуем загрузить из localStorage
      const localWidths = loadColumnWidthsFromLocalStorage();
      if (Object.keys(localWidths).length > 0) {
        columnWidths.value = { ...localWidths };
      } else if (
        project.data.columnWidths &&
        project.data.columnWidths[getDbKey()]
      ) {
        const projectWidths = {
          ...project.data.columnWidths[getDbKey()],
        };
        // Применяем минимальную ширину для _rowNumber
        if (projectWidths["_rowNumber"]) {
          projectWidths["_rowNumber"] = Math.max(
            30,
            projectWidths["_rowNumber"]
          );
        }
        columnWidths.value = { ...projectWidths };
      } else {
        // Reset column widths when switching to a table with no stored widths
        columnWidths.value = {};
      }
    };

    // Initialize virtual scroll
    const updatePageSize = () => {
      // window size and container height logging removed

      // Для фиксированной высоты рассчитываем pageSize на основе fixedHeight
      if (props.fixedHeight && props.fixedHeight > 0) {
        // Проверяем готовность tableCardRef
        if (!tableCardRef.value) {
          // tableCardRef not ready: keep default pageSize
          return;
        }

        // Вычисляем реальную высоту заголовка таблицы, вместо магической константы
        let headerHeight = 0;
        try {
          const cardElement = tableCardRef.value.$el || tableCardRef.value;
          const headerEl =
            cardElement.querySelector && cardElement.querySelector("thead");
          if (headerEl) {
            const hdrRect = headerEl.getBoundingClientRect();
            headerHeight = hdrRect.height || 0;
          }
        } catch (e) {
          headerHeight = 0;
        }

        // Фоллбек на разумное значение, если измерение не удалось
        // Используем высоту строки как разумную оценку высоты заголовка,
        // чтобы корректно умещать целое число строк без обрезания.
        if (!headerHeight || headerHeight < 24) headerHeight = rowHeight;

        const availableHeight = props.fixedHeight - headerHeight;

        // Если доступная высота недостаточна, используем минимальное значение
        if (availableHeight <= headerHeight || availableHeight < rowHeight) {
          pageSize.value = 1;
          return;
        }

        // Более точный расчет высоты строки: padding + line-height + border
        const oldPageSize = pageSize.value;
        pageSize.value = Math.floor(availableHeight / rowHeight);
        // Для фиксированной высоты не форсируем минимум 5, чтобы не обрезать последнюю строку
        if (pageSize.value < 1) pageSize.value = 1;
        if (pageSize.value > 50) pageSize.value = 50;

        // Проверяем доступность dataComp перед использованием
        if (!dataComp.value || !Array.isArray(dataComp.value)) {
          return;
        }

        // После изменения pageSize нужно скорректировать start, если он стал слишком большим
        const maxStart = Math.max(0, dataComp.value.length - pageSize.value);
        if (start.value > maxStart) {
          start.value = maxStart;
        }
      } else {
        // Если fixedHeight не передан, рассчитываем pageSize, вычитая реальную высоту заголовка
        try {
          // Измеряем высоту thead, чтобы не переоценивать видимые строки
          let headerHeight = 0;
          try {
            const cardElement = tableCardRef.value?.$el || tableCardRef.value;
            const headerEl =
              cardElement?.querySelector && cardElement.querySelector("thead");
            if (headerEl) {
              const hdrRect = headerEl.getBoundingClientRect();
              headerHeight = hdrRect.height || 0;
            }
          } catch (e) {
            headerHeight = 0;
          }
          if (!headerHeight || headerHeight < 24) headerHeight = rowHeight; // фоллбек

          // Доступная высота под строки = высота окна минус отступы и высота заголовка
          const available = Math.max(
            0,
            windowHeight.value - props.heightOffset - headerHeight
          );
          const rows = Math.floor(available / rowHeight);
          const effectiveRows = Math.max(1, rows);

          let newPageSize = effectiveRows;
          if (newPageSize < 5) newPageSize = 5;
          if (newPageSize > 50) newPageSize = 50;

          const oldPageSize = pageSize.value;
          pageSize.value = newPageSize;

          // После изменения pageSize нужно скорректировать start и scrollTop,
          // чтобы при изменении размера окна и нахождении у низа таблица не "растягивала" строки.
          // Рассчитываем новый максимально допустимый scrollTop и корректируем текущий.
          const newMaxScrollTop = Math.max(
            0,
            totalTableHeight.value - pageSize.value * rowHeight
          );
          if (scrollTop.value > newMaxScrollTop) {
            scrollTop.value = newMaxScrollTop;
          }

          // Корректируем start на основе (возможно) обновлённого scrollTop
          const newStartFromScroll = Math.floor(scrollTop.value / rowHeight);
          start.value = Math.min(
            start.value,
            Math.max(0, dataComp.value.length - pageSize.value)
          );
          // Также убеждаемся, что start синхронизирован с scrollTop
          if (start.value !== newStartFromScroll) {
            start.value = newStartFromScroll;
          }

          // Обновляем позицию ползунка
          nextTick(() => {
            updateHandlePosition();
          });
        } catch (e) {
          // ignore
        }
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
      () => props.data,
      () => {
        setTimeout(syncHeaderAndBodyColumns, 100);
        updatePageSize();
        // Only reset to top on initial window (windowStart === 0) or when no data
        try {
          if (props.windowStart === 0 || props.totalCount === 0) {
            start.value = 0;
          }
        } catch (e) {
          start.value = 0;
        }
        updateHandlePosition();
      },
      { deep: true }
    );

    // Следим за изменениями pageSize и количества данных для обновления позиции ползунка
    watch([pageSize, () => dataComp.value?.length || 0], () => {
      // Проверяем доступность dataComp
      if (!dataComp.value || !Array.isArray(dataComp.value)) {
        return;
      }

      // Если скроллинг больше не нужен, сбрасываем позицию
      if (!needsScrolling.value) {
        start.value = 0;
        htop.value = 0;
      } else {
        // Иначе корректируем позицию start
        const maxStart = Math.max(0, dataComp.value.length - pageSize.value);

        if (start.value > maxStart) {
          start.value = maxStart;
        }
        updateHandlePosition();
      }
    });

    // Отслеживаем изменения в start для отладки виртуального скроллинга
    watch(
      () => start.value,
      (newStart, oldStart) => {
        // Track start changes for debugging
      }
    );

    // Отслеживаем изменения в scrollTop для синхронизации с start
    watch(
      () => scrollTop.value,
      (newScrollTop) => {
        const newStart = Math.floor(newScrollTop / rowHeight);
        if (newStart !== start.value) {
          start.value = newStart;
        }
      }
    );

    // Следим за количеством данных и запрашиваем дополнительные, если их меньше 50

    // Отслеживаем изменения в visiblePage для отладки виртуального скроллинга
    watch(
      () => visiblePage.value,
      (newPage, oldPage) => {},
      { deep: true }
    );

    // Запускаем синхронизацию сразу после монтирования

    // Listen for project data changes
    const unwatch = project.$subscribe((mutation, state) => {
      if (mutation.type === "direct" && mutation.storeId === "project") {
        updateColumnWidthsFromStore();
      }
    });

    // Сохраняем ссылку на функцию для удаления в onUnmounted
    window.updateWindowHeight = updateWindowHeight;

    // Обеспечиваем правильный расчет pageSize после монтирования
    onMounted(() => {
      try {
        nextTick(() => {
          updatePageSize();

          // Если проект уже выбран, загружаем keywords
          if (project.currentProjectId) {
            props.loadData(project.currentProjectId);
          }
        });
      } catch (error) {
        // Ignore errors
      }
    });
  } catch (error) {
    // Ignore errors
  }
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

// Следим за изменениями проекта для загрузки keywords
watch(
  () => project.currentProjectId,
  (newProjectId, oldProjectId) => {
    if (newProjectId) {
      props.loadData(newProjectId);
    }
  }
);

// Sync internal windowStart with prop from parent store so component
// reflects server-side window changes (e.g. when keywords store sets windowStart)
watch(
  () => props.windowStart,
  (newVal) => {
    try {
      if (typeof newVal === "number") {
        windowStart.value = newVal;
        lastWindowStart.value = newVal;
        // Recalculate handle position when window changes
        // Align scrollTop to the new window start so visible rows match data
        const newScrollTop = Math.max(0, newVal * rowHeight);
        if (scrollTop.value !== newScrollTop) {
          scrollTop.value = newScrollTop;
          start.value = Math.floor(scrollTop.value / rowHeight);
        }
        nextTick(() => updateHandlePosition());
      }
    } catch (e) {}
  }
);

// Add logging for debugging scrollTop, windowStart, and newWindowStart
watch(
  [scrollTop, () => windowStart.value],
  ([newScrollTop, newWindowStart]) => {
    console.log(
      `Debug: scrollTop=${newScrollTop}, windowStart=${windowStart.value}, newWindowStart=${newWindowStart}`
    );
  }
);

// Virtual scroll methods
function mousewheel(e) {
  if (!needsScrolling.value) return;

  // Throttling: ограничиваем частоту вызовов до 16ms (примерно 60fps)
  const now = Date.now();
  if (now - lastScrollTime.value < 16) return;
  lastScrollTime.value = now;

  // Уменьшаем чувствительность скроллинга для более стабильного поведения
  const scrollSpeed = 0.8; // Уменьшено для лучшего контроля
  const deltaY = e.deltaY * scrollSpeed;

  const oldScrollTop = scrollTop.value;
  scrollTop.value += deltaY;

  // Ограничиваем scrollTop в допустимых пределах
  const maxScrollTop = Math.max(
    0,
    totalTableHeight.value - pageSize.value * rowHeight
  );

  if (scrollTop.value < 0) scrollTop.value = 0;
  if (scrollTop.value > maxScrollTop) {
    scrollTop.value = maxScrollTop;
  }

  // Snap scrollTop to whole-row multiples для избежания partial-row rendering
  scrollTop.value = Math.floor(scrollTop.value / rowHeight) * rowHeight;
  start.value = Math.floor(scrollTop.value / rowHeight);

  // Ограничиваем start в допустимых пределах
  const maxStart = Math.max(0, props.totalCount - pageSize.value);
  if (start.value > maxStart) start.value = maxStart;

  console.log("ScrollTop updated:", {
    oldScrollTop,
    newScrollTop: scrollTop.value,
    maxScrollTop,
    currentRow: start.value,
  });

  // Автоматическая загрузка нового окна данных при приближении к границам
  const threshold = 20; // Загружать, когда остается меньше 20 элементов от границы окна
  const currentRow = Math.floor(scrollTop.value / rowHeight);
  const currentWindowEnd = windowStart.value + (props.data?.length || 0);

  console.log("Load condition check:", {
    currentRow,
    currentWindowEnd,
    threshold,
    windowStart: windowStart.value,
    dataLength: props.data?.length,
  });

  // Проверяем, нужно ли загружать новое окно
  const newWindowStart = Math.max(0, currentRow - bufferSize);
  const shouldLoadNewWindow =
    currentRow >= currentWindowEnd - threshold || // приближаемся к концу окна
    (currentRow <= windowStart.value + threshold && windowStart.value > 0) || // приближаемся к началу окна
    currentRow < windowStart.value ||
    currentRow >= currentWindowEnd; // вышли за пределы текущего окна

  if (shouldLoadNewWindow && newWindowStart !== lastWindowStart.value) {
    console.log("Triggering new window load:", {
      newWindowStart,
      currentWindowStart: windowStart.value,
      reason:
        currentRow < windowStart.value
          ? "before window"
          : currentRow >= currentWindowEnd
          ? "after window"
          : "near boundary",
    });

    // Отмечаем последний запрошенный windowStart, чтобы избежать повторов
    lastWindowStart.value = newWindowStart;

    // Загружаем новое окно; store синхронизирует windowStart после получения ответа
    if (typeof props.loadWindow === "function") {
      props.loadWindow(newWindowStart);
    }
  }

  // Принудительно обновляем компонент после изменения scrollTop
  nextTick(() => {
    updateHandlePosition();
  });
}

// Функция-заглушка для клика по скроллбару (предотвращает ошибки)
function handleScrollbarClick(e) {
  // Предотвращаем всплытие события, чтобы не вызвать нежелательные действия
  e.stopPropagation();
}

// Track drag start state for stable dragging
const dragStartY = ref(0);
const handleStartTop = ref(0);

function startHandle(e) {
  if (handleDragging.value) return;
  handleDragging.value = true;
  try {
    dragStartY.value = e && typeof e.pageY === "number" ? e.pageY : 0;
    handleStartTop.value = htop.value || 0;
    e && e.preventDefault && e.preventDefault();
  } catch (err) {
    dragStartY.value = 0;
    handleStartTop.value = htop.value || 0;
  }
}

function stopHandle() {
  if (!handleDragging.value) return;
  handleDragging.value = false;
}

function handleMouseMove(e) {
  if (!handleDragging.value || !needsScrolling.value) return;

  // Stable absolute delta from drag start instead of movementY to avoid jumps
  const deltaY =
    (e && typeof e.pageY === "number" ? e.pageY : 0) - dragStartY.value;
  let top = handleStartTop.value + deltaY;
  const scrollerHeight = scroller.value.clientHeight - 10;
  const handleHeightPx = parseInt(handleHeight.value);
  const maxTop = scrollerHeight - handleHeightPx;

  if (top < 0) top = 0;
  else if (top > maxTop) top = maxTop;

  htop.value = top;

  // Рассчитываем scrollTop на основе позиции ползунка
  const maxScrollTop = Math.max(
    0,
    totalTableHeight.value - pageSize.value * rowHeight
  );
  const availableHeight = Math.max(1, scrollerHeight - handleHeightPx); // Избегаем деления на 0

  if (maxScrollTop > 0) {
    // Вычисляем и затем привязываем scrollTop к целому количеству строк
    const proportion = htop.value / availableHeight;
    const raw = Math.round(proportion * maxScrollTop);
    scrollTop.value = Math.round(raw / rowHeight) * rowHeight;
  } else {
    scrollTop.value = 0;
  }

  // Обновляем start на основе нового scrollTop
  start.value = Math.floor(scrollTop.value / rowHeight);
  const maxStart = Math.max(0, props.totalCount - pageSize.value);
  if (start.value > maxStart) start.value = maxStart;

  // Trigger data window loading when dragging near boundaries
  maybeRequestWindowByScroll();
}

function updateHandlePosition() {
  // Avoid fighting with manual drag updates
  if (handleDragging.value) return;
  if (!scroller.value || !needsScrolling.value) {
    htop.value = 0;
    return;
  }

  const scrollerHeight = scroller.value.clientHeight - 10; // Высота скроллера минус отступы
  const maxScrollTop = Math.max(
    0,
    totalTableHeight.value - pageSize.value * rowHeight
  );

  if (maxScrollTop === 0) {
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
    htop.value = Math.floor(
      (availableHeight / maxScrollTop) * scrollTop.value + 0.5
    );
  }
}

// Shared logic to request loading a new window based on current scrollTop
function maybeRequestWindowByScroll() {
  try {
    const threshold = 20;
    const currentRow = Math.floor(scrollTop.value / rowHeight);
    const currentWindowEnd = windowStart.value + (props.data?.length || 0);
    const newWindowStart = Math.max(0, currentRow - bufferSize);

    const shouldLoadNewWindow =
      currentRow >= currentWindowEnd - threshold ||
      (currentRow <= windowStart.value + threshold && windowStart.value > 0) ||
      currentRow < windowStart.value ||
      currentRow >= currentWindowEnd;

    if (
      shouldLoadNewWindow &&
      newWindowStart !== lastWindowStart.value &&
      typeof props.loadWindow === "function" &&
      !props.loadingMore
    ) {
      lastWindowStart.value = newWindowStart;
      props.loadWindow(newWindowStart);
    }
  } catch (e) {
    // ignore
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
  padding-left: 0 !important;
  padding-right: 0 !important;
}

.row-number-cell {
  background: var(--el-bg-color);
  border-right: 1px solid var(--el-border-color);
  text-align: center;
  font-weight: 500;
  position: sticky;
  left: 0;
  z-index: 5;
  padding-left: 0 !important;
  padding-right: 0 !important;
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
  min-height: 200px;
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
  height: 100%; /* Растягиваем таблицу на всю высоту контейнера */
}

.custom-table tbody {
  margin-top: 0; /* Убираем отступы */
  border-top: 0; /* Убираем отступы */
  position: relative; /* Необходимо для корректного позиционирования loading overlay */
}

/* Ограничиваем loading overlay только областью tbody */
.custom-table tbody .el-loading-mask {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 1000;
  background-color: rgba(255, 255, 255, 0.8);
  display: flex;
  align-items: center;
  justify-content: center;
}

/* Темная тема для loading overlay */
html.dark .custom-table tbody .el-loading-mask {
  background-color: rgba(0, 0, 0, 0.8);
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
  box-sizing: border-box; /* Учитываем padding и border в ширине */
}

html.dark .custom-table th:last-child {
  border-right: none !important;
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
  height: 35px; /* Фиксированная высота шапки */
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
  padding: 4px; /* Чуть меньше padding для узких столбцов */
  text-align: left;
  font-weight: 600;
  white-space: nowrap; /* Запрещаем перенос текста */
  overflow: hidden;
  text-overflow: ellipsis;
  box-sizing: border-box; /* Учитываем padding и border в ширине */
  border-right: 1px solid var(--el-border-color-extra-light); /* Добавляем правую границу */
  position: relative; /* Ensure absolute children (resizer) are positioned inside the header cell */
}

.column-resizer {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  right: 0;
  width: 8px;
  height: 28px; /* ограничиваем высоту только шапкой */
  background-color: transparent;
  cursor: col-resize;
  z-index: 30; /* чуть выше шапки */
  transition: background-color 0.2s;
}

.column-resizer:hover {
  /* Use a subtle blue tint to indicate active resize area (Element Plus primary) */
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
  border-right: none !important;
}

.sortable-header {
  position: relative; /* Ensure absolute children (resizer) are positioned inside the header cell */
  cursor: pointer;
  transition: background-color 0.2s;
}

.sortable-header:hover {
  background-color: #f5f5f5 !important;
}

html.dark .sortable-header:hover {
  background-color: var(--el-fill-color-darker) !important;
}

.header-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
}

.center-header {
  justify-content: center !important;
}

/* Make row-number header content tightly centered */
.row-number-header .header-content {
  justify-content: center;
  gap: 0;
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
  padding: 4px; /* Чуть меньше padding для узких столбцов */
  line-height: 12px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
  border-right: 1px solid var(--el-border-color-extra-light);
  color: var(--el-text-color-regular);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  box-sizing: border-box; /* Учитываем padding и border в ширине */
  /* Гарантируем, что высота строки не меньше 35px */
  height: 35px; /* для таблиц height на ячейке работает как минимум */
  vertical-align: middle;
}

/* Category inline layout and similarity tag */
.category-info-inline {
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
}
.category-info-inline .category-name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1 1 auto;
}
.similarity-tag {
  flex: 0 0 auto;
  background: var(--el-color-primary-light-5, #eef6ff);
  color: var(--el-color-primary, #409eff);
  border-radius: 10px;
  padding: 2px 6px;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}

/* Темная тема для ячеек таблицы */
html.dark .custom-table td {
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  border-right: 1px solid var(--el-border-color-darker);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  box-sizing: border-box; /* Учитываем padding и border в ширине */
  /* Гарантируем, что высота строки не меньше 35px */
  height: 35px;
  vertical-align: middle;
}

.custom-table td:last-child {
  border-right: none !important;
}

/* Убираем нижнюю границу у последней строки */
.custom-table tbody tr:last-child td {
  border-bottom: none !important;
}

/* Темная тема: убираем нижнюю границу у последней строки */
html.dark .custom-table tbody tr:last-child td {
  border-bottom: none !important;
}

/* Темная тема: убираем правую границу у последнего столбца */
html.dark .custom-table td:last-child {
  border-right: none !important;
}

/* Стили для нечетных и четных строк с высокой специфичностью */
.custom-table tbody tr.odd-row {
  background-color: var(--el-bg-color) !important;
}

.custom-table tbody tr.even-row {
  background-color: #f7f7f7 !important; /* light theme even row */
}

/* Темная тема для чередующихся строк */
html.dark .custom-table tbody tr.odd-row {
  background-color: var(--el-bg-color) !important;
}

html.dark .custom-table tbody tr.even-row {
  background-color: var(--el-fill-color) !important;
}

/* Стили для наведения с увеличенной специфичностью */
.custom-table tbody tr.odd-row:hover,
.custom-table tbody tr.even-row:hover {
  background: #f0f0f0 !important; /* light theme hover restored */
}

html.dark .custom-table tbody tr.odd-row:hover,
html.dark .custom-table tbody tr.even-row:hover {
  background: #2d3748 !important; /* dark theme hover */
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
  /* Фиксированная колонка использует тот же фон, что и строка */
  background-color: inherit !important;
  border-right: 1px solid var(--el-border-color);
}

.custom-table tbody tr.even-row .fixed-column {
  /* Тот же фон, что и строка */
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
  /* Hover наследует фон строки */
  background: inherit !important;
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

/* Центрируем контент для колонок с действиями */
.cell-content.center-cell {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
}

.cell-content.center-cell .el-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
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

/* Убрана жесткая ширина для URL - теперь обрезка происходит по ширине столбца через CSS */
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
  top: 40px; /* Уменьшено на 5px */
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

/* Скрытая область для имитации общей высоты таблицы */
.total-height-spacer {
  position: absolute;
  left: 0;

  top: 0;
  width: 1px;
  height: 1px; /* real height is kept in inline style for calculations, but spacer should not affect layout */
  visibility: hidden;
  pointer-events: none;
  overflow: hidden;
}

/* Стили для лоудера Element Plus */
.custom-table .el-loading-mask {
  z-index: 9;
}

/* Ограничиваем область загрузки только tbody */
.custom-table tbody .el-loading-mask {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(255, 255, 255, 0.8);
  display: flex;
  align-items: center;
  justify-content: center;
}

/* Темная тема для загрузки tbody */
html.dark .custom-table tbody .el-loading-mask {
  background-color: rgba(0, 0, 0, 0.8);
}

/* Стили для тега similarity */
.similarity-tag {
  display: inline-block;
  padding: 0 8px;
  height: 20px;
  line-height: 18px;
  font-size: 12px;
  color: var(--el-color-primary);
  background-color: var(--el-color-primary-light-5);
  border: 1px solid rgba(64, 158, 255, 0.15);
  border-radius: 4px;
  margin-left: 8px;
}

/* Темная тема для similarity-tag */
html.dark .similarity-tag {
  color: var(--el-color-primary-light-2);
  background-color: var(--el-fill-color-darker);
  border: 1px solid var(--el-border-color-darker);
}
</style>
