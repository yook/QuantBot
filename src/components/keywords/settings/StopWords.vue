<template>
  <div>
    <div class="demo-collapse mb-4">
      <el-collapse accordion>
        <el-collapse-item name="1">
          <template #title="{ isActive }">
            <div :class="['title-wrapper', { 'is-active': isActive }]">
              Фильтрация по стоп-словам
              <el-icon class="header-icon">
                <InfoFilled />
              </el-icon>
            </div>
          </template>
          <div class="text-sm">
            <div class="mb-2">
              <strong>Цель:</strong><br />
              Автоматическое исключение нерелевантных ключевых слов из списка
              целевых запросов.
              <br /><br />
              <strong>Описание:</strong><br />
              Стоп-слово — это слово или шаблон, при совпадении которого
              ключевая фраза перестаёт считаться целевой. Существуют два
              варианта записи:
              <br />• Обычное слово — сравнивается как подстрока без учёта
              регистра (все символы приводятся к нижнему регистру). <br />•
              Регулярное выражение в формате <code>/pattern/flags</code> — даёт
              гибкие правила (якоря, группы, альтернативы и т.п.).
            </div>
            <div>
              <strong>Алгоритм:</strong><br />
              • Берём ключевые слова и список стоп-слов. <br />• Для каждого
              обычного стоп-слова ищем его как подстроку в нижнем регистре.
              <br />• Для каждого шаблона /.../ создаём JavaScript RegExp и
              проверяем совпадение. <br />• При совпадении устанавливаем
              <code><strong>Целевой запрос</strong> = 0</code> и записываем в
              <strong>Правило исключения</strong> само стоп-слово или паттерн.
            </div>
            <div class="mt-2">
              <strong>Примеры:</strong><br />
              • <code>free</code> — отключит ключи, содержащие "free". <br />•
              <code>/^test/i</code> — отключит ключи, начинающиеся с "test" (без
              учёта регистра). <br />• <code>/\d{3,}/</code> — отключит ключи,
              содержащие длинные числа (3+ цифры).
            </div>
            <div class="mt-2">
              <strong>Подсказки:</strong><br />
              • Сначала добавляйте простые слова — это быстрее и безопаснее.
              <br />• Используйте RegExp, когда нужна точная фильтрация (якоря ^
              $, группы, классы). <br />• Избегайте слишком общих паттернов
              (например, <code>/.+/</code>) — они отключат почти всё.
            </div>
          </div>
        </el-collapse-item>
      </el-collapse>
    </div>

    <el-form>
      <el-input
        v-model="stopWordsText"
        type="textarea"
        placeholder="Введите стоп-слова, каждое с новой строки"
        :rows="4"
        :disabled="isAddingWithProgress"
      />
      <div class="text-sm">
        Вы можете добавлять обычные слова или регулярные выражения в формате
        <code>/pattern/flags</code> (например <code>/^sale/i</code>).
        <span v-if="regexLines.length">
          Найдено регулярных: {{ regexLines.length }}.</span
        >
      </div>
      <div v-if="invalidRegexLines.length" class="mt-2 text-sm text-red-600">
        Неверные регулярные выражения:
        <ul class="ml-4 list-disc">
          <li v-for="(r, idx) in invalidRegexLines" :key="idx">{{ r }}</li>
        </ul>
      </div>
      <div class="flex items-center justify-between mt-4">
        <!-- Progress UI removed: worker progress events are no longer forwarded -->
        <div class="ml-auto">
          <el-button
            v-if="!isAddingWithProgress"
            type="primary"
            @click="addStopWords"
          >
            Добавить стоп-слова
          </el-button>
          <el-button
            v-else
            type="primary"
            :loading="isAddingWithProgress"
            loading-text="Добавление..."
          >
            Добавить
          </el-button>
        </div>
      </div>
    </el-form>

    <!-- Таблица стоп-слов -->
    <div class="mt-6">
      <DataTableFixed
        :tableColumns="tableColumns"
        :data="stopWords"
        :totalCount="stopwordsStore.totalCount"
        :loading="loading"
        :loadingMore="loadingMore"
        :sort="sort"
        :windowStart="stopwordsStore.windowStart"
        :loadWindow="loadWindow"
        :sortData="sortData"
        :loadData="loadData"
        dbKey="stopwords"
        @delete-row="removeRow"
        @delete-all="deleteAll"
        :fixedHeight="215"
        @columns-reorder="onColumnsReorder"
      />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onUnmounted } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { markRaw } from "vue";
import { Delete, InfoFilled } from "@element-plus/icons-vue";
import DataTableFixed from "../../DataTableFixed.vue";
import saveColumnOrder from "../../../utils/columnOrder";
import ipcClient from "../../../stores/socket-client";
import { useProjectStore } from "../../../stores/project";
import { useKeywordsStore } from "../../../stores/keywords";
import { useStopwordsStore } from "../../../stores/stopwords";

const project = useProjectStore();
const keywordsStore = useKeywordsStore();
const stopwordsStore = useStopwordsStore();

const stopWordsText = ref("");
// Use store data instead of local ref
const stopWords = computed(() => stopwordsStore.stopwords);

const isMounted = ref(true);

onUnmounted(() => {
  isMounted.value = false;
});

// Computed helpers to show regex hints and validate regex lines
const inputLines = computed(() => {
  return stopWordsText.value
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
});

const regexLines = computed(() => {
  return inputLines.value.filter((l) => /^\/.+\/[gimsuy]*$/.test(l));
});

const invalidRegexLines = computed(() => {
  return regexLines.value.filter((l) => {
    try {
      const m = l.match(/^\/(.+)\/([gimsuy]*)$/);
      if (!m) return true;
      new RegExp(m[1], m[2] || "");
      return false;
    } catch (e) {
      return true;
    }
  });
});

// UI / progress flags (use store values)
const isAddingWithProgress = computed(
  () => stopwordsStore.isAddingWithProgress
);
const addProgress = computed(() => stopwordsStore.addProgress);
const addProgressText = computed(() => stopwordsStore.addProgressText);
const loading = computed(() => stopwordsStore.loading);
const loadingMore = computed(() => stopwordsStore.loadingMore);
const sort = computed(() => stopwordsStore.sort);

// Настройка колонок для DataTableFixed
const tableColumns = ref([
  { prop: "word", name: "Слово" },
  // служебный столбец с действиями (удаление)
  { prop: "_actions", name: "", width: 40 },
]);

// Data loading helpers
async function loadWindow(start) {
  await stopwordsStore.loadWindow(start);
}
function sortData(newSort) {
  stopwordsStore.sortStopwords(newSort);
}
async function loadData() {
  if (!currentProjectId.value) return;
  await stopwordsStore.loadStopwords(currentProjectId.value);
}

const currentProjectId = ref(null);

// Handle column reorder: update local tableColumns and persist via util
function onColumnsReorder(newOrder) {
  try {
    if (!Array.isArray(newOrder)) return;
    // Map props to existing ColumnDef objects when possible
    const existing = tableColumns.value || [];
    const remaining = [...existing];
    const ordered = [];
    for (const p of newOrder) {
      const idx = remaining.findIndex((c) => c.prop === p);
      if (idx !== -1) {
        ordered.push(remaining.splice(idx, 1)[0]);
      } else {
        // create minimal def if missing
        ordered.push({ prop: p, name: p });
      }
    }
    // append any leftovers (safety)
    for (const r of remaining) ordered.push(r);

    tableColumns.value = ordered;

    // Persist using shared util
    try {
      saveColumnOrder(project, "stopwords", newOrder);
    } catch (e) {
      console.error("saveColumnOrder stopwords failed", e);
    }
  } catch (e) {
    console.error("onColumnsReorder stopwords error", e);
  }
}

function parseInputText(text) {
  return text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function addStopWords() {
  const items = parseInputText(stopWordsText.value);
  console.log("[StopWords] addStopWords called with items:", items);
  console.log("[StopWords] currentProjectId:", currentProjectId.value);

  if (items.length === 0) {
    ElMessage.warning("Ничего не введено");
    return;
  }
  // Prevent submission if any regex lines are invalid
  if (invalidRegexLines.value && invalidRegexLines.value.length > 0) {
    ElMessage.error(
      "Есть неверные регулярные выражения. Исправьте их перед отправкой."
    );
    return;
  }

  try {
    // Normalize stop-words: lowercase plain words, preserve regex lines (/pattern/flags)
    const normalized = items.map((it) => {
      const trimmed = String(it).trim();
      if (/^\/.*\/[gimsuy]*$/.test(trimmed)) return trimmed; // regex - keep as is
      return trimmed.toLowerCase();
    });

    // Join back to text format for the store
    const text = normalized.join("\n");

    // Use store method
    await stopwordsStore.addStopwords(text);
    stopWordsText.value = "";
  } catch (error) {
    console.error("Error adding stopwords:", error);
    ElMessage.error("Ошибка добавления стоп-слов");
  }
}

async function removeRow(row) {
  try {
    await ElMessageBox.confirm(
      `Удалить стоп-слово "${row.word}"?`,
      "Подтверждение удаления",
      {
        confirmButtonText: "Удалить",
        cancelButtonText: "Отмена",
        type: "error",
        icon: markRaw(Delete),
        customClass: "delete-msgbox-class",
      }
    );

    await stopwordsStore.deleteStopword(row.id);

    // Перезагружаем данные keywords, чтобы обновились колонки "Целевой запрос" и "Правило исключения"
    if (keywordsStore.currentProjectId) {
      console.log("[StopWords] Reloading keywords after stopword deleted");
      await keywordsStore.loadKeywords(keywordsStore.currentProjectId, {
        skip: 0,
        limit: keywordsStore.windowSize,
        sort: keywordsStore.sort,
      });
    }
  } catch (error) {
    if (error !== "cancel") {
      console.error("Error deleting stopword:", error);
      ElMessage.error("Ошибка удаления");
    }
  }
}

async function deleteAll() {
  try {
    await ElMessageBox.confirm(
      `Удалить все стоп-слова для проекта?`,
      "Подтверждение удаления",
      {
        confirmButtonText: "Удалить все",
        cancelButtonText: "Отмена",
        type: "error",
        icon: markRaw(Delete),
        customClass: "delete-msgbox-class",
      }
    );

    await stopwordsStore.deleteAllStopwords();

    // Перезагружаем данные keywords, чтобы обновились колонки "Целевой запрос" и "Правило исключения"
    if (keywordsStore.currentProjectId) {
      console.log("[StopWords] Reloading keywords after all stopwords deleted");
      await keywordsStore.loadKeywords(keywordsStore.currentProjectId, {
        skip: 0,
        limit: keywordsStore.windowSize,
        sort: keywordsStore.sort,
      });
    }
  } catch (error) {
    if (error !== "cancel") {
      console.error("Error deleting all stopwords:", error);
      ElMessage.error("Ошибка удаления");
    }
  }
}

// Watch project changes
watch(
  () => project.data?.id,
  async (newId) => {
    if (!isMounted.value) return;

    // Очищаем поле при смене проекта
    stopWordsText.value = "";
    currentProjectId.value = newId;
    stopwordsStore.setCurrentProjectId(newId);
    if (newId) {
      await loadData();
    } else {
      stopwordsStore.initializeState();
    }
  },
  { immediate: true }
);
</script>

<style scoped>
.mt-3 {
  margin-top: 12px;
}
.mt-4 {
  margin-top: 16px;
}
.mt-6 {
  margin-top: 24px;
}
.flex {
  display: flex;
}
.items-center {
  align-items: center;
}
.justify-between {
  justify-content: space-between;
}
.ml-auto {
  margin-left: auto;
}
.gap-3 > * + * {
  margin-left: 12px;
}
.text-sm {
  font-size: 0.875rem;
}
/* Removed forced color rules to inherit global theme colors */

.title-wrapper {
  display: flex;
  align-items: center;
  gap: 4px;
}

.title-wrapper.is-active {
  color: var(--el-color-primary);
}

/* Ограничение ширины таблицы */
:deep(.table-container) {
  position: relative;
  width: 100%;
  max-width: 100% !important;
  overflow-x: auto !important;
  box-sizing: border-box;
}
</style>
