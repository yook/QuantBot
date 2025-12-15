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
            </div>

            <div class="mb-2">
              <strong>Описание:</strong><br />
              Стоп-слово — это слово или шаблон, при совпадении которого
              ключевая фраза перестаёт считаться целевой.<br />
              Есть два варианта записи:
              <ul class="list-disc">
                <li>
                  Обычное слово — сравнивается как подстрока без учёта регистра
                  (все символы приводятся к нижнему регистру).
                </li>
                <li>
                  Регулярное выражение в формате <code>/pattern/flags</code> —
                  даёт гибкие правила.
                </li>
              </ul>
            </div>

            <div>
              <div class="mt-2">
                <strong>Что можно использовать в <code>pattern</code></strong>
                <ul class="list-disc">
                  <li>
                    <strong>Символьные классы</strong> описывают набор символов
                    в одной позиции:
                    <ul class="list-disc">
                      <li><code>\d</code> — любая цифра (0-9).</li>
                      <li>
                        <code>\w</code> — буква/цифра/подчёркивание (эквивалент
                        <code>[A-Za-z0-9_]</code>, в Unicode-режиме включает
                        кириллицу).
                      </li>
                      <li>
                        <code>\s</code> — пробельный символ (пробел, таб,
                        перевод строки).
                      </li>
                      <li>
                        Отрицания <code>\D</code>, <code>\W</code>,
                        <code>\S</code> означают «не цифра», «не
                        буква/цифра/подчёркивание», «не пробел».
                      </li>
                    </ul>
                  </li>
                  <li>
                    <strong>Специальные символы:</strong>
                    <ul class="list-disc">
                      <li>
                        <code>.</code> — любой символ, кроме перевода строки.
                      </li>
                    </ul>
                  </li>
                  <li>
                    <strong>Диапазоны и наборы:</strong>
                    <ul class="list-disc">
                      <li>
                        <code>[abc]</code> — любой из символов a, b или c.
                      </li>
                      <li>
                        <code>[а-яё]</code> — любая буква кириллицы от а до я,
                        включая ё.
                      </li>
                    </ul>
                  </li>
                  <li>
                    <strong>Квантификаторы</strong> задают количество
                    повторений:
                    <ul class="list-disc">
                      <li><code>?</code> — 0 или 1 раз (опционально).</li>
                      <li><code>*</code> — 0 и более раз (жадно).</li>
                      <li><code>+</code> — 1 и более раз.</li>
                      <li><code>{n}</code> — ровно n повторений.</li>
                      <li><code>{n,}</code> — n и больше.</li>
                      <li><code>{n,m}</code> — от n до m включительно.</li>
                    </ul>
                  </li>
                  <li>
                    <strong>Якоря</strong> для точного позиционирования:
                    <ul class="list-disc">
                      <li><code>^</code> — начало строки.</li>
                      <li><code>$</code> — конец строки.</li>
                    </ul>
                  </li>
                  <li>
                    <strong>Группы и альтернативы:</strong>
                    <ul class="list-disc">
                      <li><code>(...)</code> — группировка.</li>
                      <li><code>a|b</code> — альтернатива (либо a, либо b).</li>
                    </ul>
                  </li>
                  <li>
                    <strong>Экранирование спецсимволов:</strong>
                    <ul class="list-disc">
                      <li>
                        <code>\.</code>, <code>\*</code>, <code>\+</code>,
                        <code>\?</code>, <code>\(</code>, <code>\)</code>,
                        <code>\[</code>, <code>\]</code>, <code>\/</code> и т.д.
                      </li>
                    </ul>
                  </li>
                </ul>
              </div>

              <div class="mt-2">
                <strong>flags</strong>
                <ul class="list-disc">
                  <li>
                    <code>i</code> — регистронезависимый поиск (рекомендуется).
                  </li>
                  <li>
                    <code>u</code> — Unicode-режим (рекомендуется для
                    кириллицы).
                  </li>
                  <li>
                    Дополнительно поддерживаются: <code>g</code>,
                    <code>m</code>, <code>s</code>, <code>y</code>.
                  </li>
                </ul>
              </div>

              <div class="mt-2">
                <strong>Примеры использования</strong>
                <ul class="list-disc">
                  <li>
                    <code>/^test/i</code> — отключит ключи, начинающиеся с
                    «test» (без учёта регистра).
                  </li>
                  <li>
                    <code>/\d{3,}/</code> — отключит ключи, содержащие числа из
                    3 и более цифр.
                  </li>
                  <li>
                    <code>/\bfree\b/i</code> — отключит ключи, где «free» стоит
                    отдельным словом.
                  </li>
                  <li>
                    <code>/[А-Яа-яЁё]{1,2}\\s+оптом/iu</code> — отключит ключи
                    вида «мясо оптом», «сахар оптом» и т.п.
                  </li>
                  <li>
                    <code>/\\s+бесплатно$/iu</code> — отключит ключи, которые
                    заканчиваются словом «бесплатно».
                  </li>
                  <li>
                    <code>/\\.(ru|com|net)\\b/i</code> — отключит ключи,
                    содержащие домены .ru, .com, .net.
                  </li>
                </ul>
              </div>
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
          Найдено регулярных: {{ regexLines.length }}.
        </span>
      </div>
      <div v-if="invalidRegexLines.length" class="mt-2 text-sm text-red-600">
        Неверные регулярные выражения:
        <ul class="list-disc">
          <li v-for="(r, idx) in invalidRegexLines" :key="idx">{{ r }}</li>
        </ul>
      </div>
      <div class="flex items-center justify-between mt-4">
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
  // match strings that look like /pattern/flags, allow escaped \\/ inside pattern
  return inputLines.value.filter((l) =>
    /^\/(?:\\.|[^\\\/])+\/[gimsuy]*$/.test(l)
  );
});

const invalidRegexLines = computed(() => {
  return regexLines.value.filter((l) => {
    try {
      const m = l.match(/^\/((?:\\.|[^\\\/])+)\/([gimsuy]*)$/);
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
      // detect regex-like lines (support escaped slashes in pattern)
      if (/^\/(?:\\.|[^\\\/])+\/[gimsuy]*$/.test(trimmed)) return trimmed; // regex - keep as is
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
