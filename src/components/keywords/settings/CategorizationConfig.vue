<template>
  <div>
    <div class="demo-collapse mb-4">
      <el-collapse accordion>
        <el-collapse-item name="1">
          <template #title="{ isActive }">
            <div :class="['title-wrapper', { 'is-active': isActive }]">
              Классификация по ближайшему соседу (косинусное сходство)
              <el-icon class="header-icon">
                <InfoFilled />
              </el-icon>
            </div>
          </template>
          <div class="text-sm">
            <div class="mb-2">
              <h3></h3>
              <strong>Цель</strong><br />
              Присвоение каждому запросу той категории, с которой у него
              максимальное семантическое сходство.
              <br /><br />
              <strong>Описание</strong><br />
              Для каждого запроса вычисляется embedding (векторное
              представление) с помощью OpenAI Embeddings. Аналогично, для каждой
              категории формируется embedding (например, embedding названия
              категории, краткого описания или набора типичных запросов для
              категории). Затем каждый запрос автоматически присваивается той
              категории, с embedding которой у него максимальное значение
              косинусного сходства.
            </div>
            <div>
              <strong>Алгоритм</strong><br />
              • Для каждого запроса вычислить embedding.<br />
              • Для каждой категории вычислить embedding.<br />
              • Рассчитать косинусное сходство между embedding запроса и
              embedding каждой категории.<br />
              • Присвоить запрос той категории, с которой сходство максимальное.
            </div>
          </div>
        </el-collapse-item>
      </el-collapse>
    </div>

    <el-form>
      <el-input
        v-model="categories"
        type="textarea"
        placeholder="Введите категории, каждая с новой строки"
        :rows="4"
        :disabled="categoriesStore.isAddingWithProgress"
      />
      <div class="flex items-center mt-4">
        <div class="ml-auto">
          <el-button
            type="primary"
            @click="addCategories"
            :loading="categoriesStore.isAddingWithProgress"
            :disabled="categoriesStore.isAddingWithProgress"
          >
            Добавить категории
          </el-button>
        </div>
      </div>
    </el-form>

    <!-- Таблица категорий -->
    <div class="mt-6">
      <DataTableFixed
        :tableColumns="tableColumns"
        :data="categoriesData"
        :totalCount="categoriesStore.totalCount"
        :loading="categoriesStore.loading"
        :loadingMore="categoriesStore.loadingMore"
        :sort="categoriesStore.sort"
        :windowStart="categoriesStore.windowStart"
        :loadWindow="loadWindow"
        :sortData="sortData"
        :loadData="loadData"
        dbKey="categories"
        @delete-row="deleteCategory"
        @delete-all="deleteAllCategories"
        :fixedHeight="215"
        @columns-reorder="onColumnsReorder"
      />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, markRaw } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { Delete, InfoFilled } from "@element-plus/icons-vue";
import DataTableFixed from "../../DataTableFixed.vue";
import saveColumnOrder from "../../../utils/columnOrder";

const categories = ref("");

async function addCategories() {
  if (!categories.value.trim()) {
    ElMessage.warning("Введите категории");
    return;
  }

  if (!project.currentProjectId) {
    ElMessage.error("Проект не выбран");
    return;
  }

  try {
    // Вызываем стор и ждём завершения — стор выставляет флаги прогресса
    await categoriesStore.addCategories(categories.value);
    // Очистим поле ввода после успешного добавления
    categories.value = "";
  } catch (e) {
    // Ошибки уже обрабатываются в сторе, но на всякий случай логируем
    console.error("addCategories error", e);
  }
  // Не блокируем UI здесь — стор управляет флагом isAddingWithProgress
}

function startCategorization() {
  if (!project.currentProjectId) {
    ElMessage.error("Проект не выбран");
    return;
  }
  if (!categoriesStore.totalCount || categoriesStore.totalCount === 0) {
    ElMessage.warning("Нет категорий. Сначала добавьте категории.");
    return;
  }
  keywordsStore.startCategorizationOnly();
}

// Регистрация обработчиков при монтировании
import { onMounted, onUnmounted } from "vue";
import { useProjectStore } from "../../../stores/project";
import { useCategoriesStore } from "../../../stores/categories";
import { useKeywordsStore } from "../../../stores/keywords";

const project = useProjectStore();
const categoriesStore = useCategoriesStore();
const keywordsStore = useKeywordsStore();

const isMounted = ref(true);

onUnmounted(() => {
  isMounted.value = false;
});

// Столбцы для таблицы категорий
const tableColumns = ref([
  {
    prop: "category_name",
    name: "Название категории",
    width: 200,
  },
  {
    prop: "_actions",
    name: "",
    width: 40,
  },
]);

// Удаление одной категории (вызывается из DataTable)
function deleteCategory(row) {
  if (!row || !row.id) return;

  ElMessageBox.confirm(
    `Удалить категорию "${row.category_name || row.id}"?`,
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
      console.log("Delete category:", row.id);
      // Делегируем удаление в стор (он вызовет socket.emit и проверит соединение)
      categoriesStore.deleteCategory(row.id);
    })
    .catch(() => {
      // Пользователь отменил удаление
    });
}

// Удаление всех категорий
function deleteAllCategories() {
  if (!categoriesStore.totalCount || categoriesStore.totalCount === 0) {
    ElMessage.warning("Нет категорий для удаления");
    return;
  }

  ElMessageBox.confirm(
    `Удалить все категории (${categoriesStore.totalCount} шт.)?`,
    "Подтверждение удаления",
    {
      confirmButtonText: "Удалить все",
      cancelButtonText: "Отмена",
      type: "error",
      icon: markRaw(Delete),
      customClass: "delete-msgbox-class",
    }
  )
    .then(() => {
      console.log("Delete all categories");
      // Предполагаем, что в categoriesStore есть метод deleteAllCategories
      categoriesStore.deleteAllCategories();
    })
    .catch(() => {
      // Пользователь отменил удаление
    });
}

// Данные для таблицы
const categoriesData = computed(() => {
  console.log("Categories data:", categoriesStore.categories);
  return categoriesStore.categories;
});
// Функции для таблицы
const loadWindow = (newWindowStart) =>
  categoriesStore.loadWindow(newWindowStart);
const sortData = (options) => categoriesStore.sortCategories(options);
const loadData = (projectId, options) =>
  categoriesStore.loadCategories(projectId, options);

// Установить текущий проект ID при монтировании
onMounted(() => {
  console.log("Project data on mount:", project.data);
  console.log("Current project ID:", project.currentProjectId);
  if (project.currentProjectId) {
    categoriesStore.setCurrentProjectId(project.currentProjectId);
    // Загрузить категории для проекта
    categoriesStore.loadCategories(project.currentProjectId);
  }
  console.log("Categories Store Data:", categoriesStore.categories);
});

// Слушаем изменения currentProjectId и загружаем категории для нового проекта
watch(
  () => project.currentProjectId,
  (newProjectId) => {
    if (!isMounted.value) return;

    // Очищаем поле при смене проекта
    categories.value = "";
    if (newProjectId) {
      categoriesStore.setCurrentProjectId(newProjectId);
      categoriesStore.loadCategories(newProjectId);
    }
  }
);

// Handle columns reorder: update local tableColumns and persist
function onColumnsReorder(newOrder) {
  try {
    if (!Array.isArray(newOrder)) return;
    const existing = tableColumns.value || [];
    const remaining = [...existing];
    const ordered = [];
    for (const p of newOrder) {
      const idx = remaining.findIndex((c) => c.prop === p);
      if (idx !== -1) {
        ordered.push(remaining.splice(idx, 1)[0]);
      } else {
        ordered.push({ prop: p, name: p });
      }
    }
    for (const r of remaining) ordered.push(r);
    tableColumns.value = ordered;
    try {
      saveColumnOrder(project, "categories", newOrder);
    } catch (e) {
      console.error("saveColumnOrder categories failed", e);
    }
  } catch (e) {
    console.error("onColumnsReorder categories error", e);
  }
}

// Слушаем событие успешного добавления для очистки поля
import { watch } from "vue";

watch(
  () => categoriesStore.isAddingWithProgress,
  (running) => {
    // Очищаем поле после завершения операции (флаг завершился)
    if (!running && categories.value) {
      categories.value = "";
    }
  }
);
</script>

<style scoped>
/* Стили аналогично KeywordsAdd */
.el-input--large .el-input__wrapper {
  padding: 1px;
  border-color: #fafcff;
}

.site-input .el-input__wrapper .el-input__inner {
  padding: 0 10px;
  border-radius: 3px;
  background-color: #fafcff;
}

/* Стили для темной темы */
html.dark .el-input--large .el-input__wrapper {
  border-color: var(--el-border-color);
  background-color: var(--el-fill-color);
}

html.dark .site-input .el-input__wrapper .el-input__inner {
  background-color: var(--el-fill-color);
  color: var(--el-text-color-primary);
  border: 1px solid var(--el-border-color);
}

html.dark .site-input .el-input__wrapper .el-input__inner:focus {
  border-color: var(--el-color-primary);
  background-color: var(--el-fill-color-light);
}

html.dark .site-input .el-input__wrapper .el-input__inner::placeholder {
  color: var(--el-text-color-placeholder);
}

/* Стили для progress bar в темной теме */
html.dark .el-progress {
  --el-progress-text-color: var(--el-text-color-primary);
}

html.dark .el-progress-bar__outer {
  background-color: var(--el-fill-color-darker) !important;
  border: 1px solid var(--el-border-color) !important;
}

html.dark .el-progress-bar__inner {
  background-color: #2d3748 !important;
  background-image: none !important;
}

html.dark .el-progress__text {
  color: var(--el-text-color-primary) !important;
}

html.dark .el-progress--line.el-progress--striped .el-progress-bar__inner {
  background-image: none !important;
  background-size: auto !important;
}

.title-wrapper {
  display: flex;
  align-items: center;
  gap: 4px;
}

.title-wrapper.is-active {
  color: var(--el-color-primary);
}
</style>

<style scoped>
/* Ограничение ширины таблицы и горизонтальная прокрутка — как в StopWords.vue */
:deep(.table-container) {
  position: relative;
  width: 100%;
  max-width: 100% !important;
  overflow-x: auto !important;
  box-sizing: border-box;
}
</style>
