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
        :rows="5"
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
        <div v-if="isAddingWithProgress" class="flex items-center gap-3">
          <el-progress
            :text-inside="true"
            :stroke-width="26"
            :percentage="addProgress"
          />
          <span
            v-if="addProgressText"
            class="text-sm text-gray-600 dark:text-gray-400"
          >
            {{ addProgressText }}
          </span>
        </div>
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
        :totalCount="stopWords.length"
        :loading="loading"
        :loadingMore="loadingMore"
        :sort="sort"
        :loadWindow="loadWindow"
        :sortData="sortData"
        :loadData="loadData"
        dbKey="stopwords"
        @delete-row="removeRow"
        @delete-all="deleteAll"
        :fixedHeight="315"
      />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { markRaw } from "vue";
import { Delete, InfoFilled } from "@element-plus/icons-vue";
import DataTableFixed from "../../DataTableFixed.vue";
import ipcClient from "../../../stores/socket-client";
import { useProjectStore } from "../../../stores/project";
import { useKeywordsStore } from "../../../stores/keywords";

const project = useProjectStore();
const keywordsStore = useKeywordsStore();

const stopWordsText = ref("");
const stopWords = ref([]);

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

// UI / progress flags (по аналогии с categoriesStore)
const isAddingWithProgress = ref(false);
const addProgress = ref(0);
const addProgressText = ref("");
const loading = ref(false);
const loadingMore = ref(false);
const sort = ref({});

// Настройка колонок для DataTableFixed
const tableColumns = ref([
  { prop: "word", name: "Слово" },
  // служебный столбец с действиями (удаление)
  { prop: "_actions", name: "", width: 40 },
]);

// Data loading helpers
async function loadWindow(start) {
  // For stopwords we load all data
  await loadData();
}
function sortData(newSort) {
  sort.value = newSort;
  // server-side sorting can be added if needed
}
async function loadData() {
  if (!currentProjectId.value) return;

  loading.value = true;
  try {
    const data = await ipcClient.getStopwordsAll(currentProjectId.value);
    stopWords.value = data || [];
  } catch (error) {
    console.error("Error loading stopwords:", error);
    ElMessage.error("Ошибка загрузки стоп-слов");
  } finally {
    loading.value = false;
  }
}

const currentProjectId = ref(null);

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

  isAddingWithProgress.value = true;
  addProgress.value = 0;
  addProgressText.value = `Добавление ${items.length} слов...`;

  try {
    let added = 0;
    for (const word of items) {
      console.log(
        "[StopWords] Inserting word:",
        word,
        "for project:",
        currentProjectId.value
      );
      const result = await ipcClient.insertStopword(
        currentProjectId.value,
        word
      );
      console.log("[StopWords] Insert result:", result);
      added++;
      addProgress.value = Math.round((added / items.length) * 100);
    }

    ElMessage.success(`Добавлено ${added} стоп-слов`);
    stopWordsText.value = "";
    console.log("[StopWords] Loading stopwords list...");
    await loadData();
    console.log("[StopWords] Stopwords list loaded");

    // Перезагружаем данные keywords, чтобы обновились колонки "Целевой запрос" и "Правило исключения"
    if (keywordsStore.currentProjectId) {
      console.log("[StopWords] Reloading keywords after stopwords added");
      await keywordsStore.loadKeywords(keywordsStore.currentProjectId, {
        skip: 0,
        limit: keywordsStore.windowSize,
        sort: keywordsStore.sort,
      });
    }
  } catch (error) {
    console.error("Error adding stopwords:", error);
    ElMessage.error("Ошибка добавления стоп-слов");
  } finally {
    isAddingWithProgress.value = false;
    addProgress.value = 0;
    addProgressText.value = "";
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

    await ipcClient.deleteStopword(row.id);
    ElMessage.success("Стоп-слово удалено");
    await loadData();

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

    await ipcClient.deleteStopwordsByProject(currentProjectId.value);
    ElMessage.success("Все стоп-слова удалены");
    await loadData();

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
    currentProjectId.value = newId;
    if (newId) {
      await loadData();
    } else {
      stopWords.value = [];
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
