<template>
  <el-card shadow="never">
    <div class="flex items-center justify-between">
      <el-button
        :icon="CirclePlus"
        type="primary"
        plain
        size="large"
        class="add-start"
        @click="dialogVisible = true"
        >Добавить ключевые запросы
      </el-button>
      <div class="flex items-center">
        <el-progress
          :text-inside="true"
          :stroke-width="40"
          :percentage="keywordsStore.percentage"
          class="ml-3"
          striped
          :striped-flow="keywordsStore.running"
          :duration="7"
        />
        <el-button
          v-if="!keywordsStore.running"
          class="add-start ml-3"
          type="primary"
          size="large"
          :loading="keywordsStore.running"
          @click="keywordsStore.startCategorization"
        >
          <el-icon class="text-2xl"><VideoPlay /></el-icon>
        </el-button>

        <el-button
          v-if="keywordsStore.running"
          class="ml-3"
          size="large"
          type="primary"
          @click="freezeQueue"
        >
          <el-icon class="text-2xl"><VideoPause /></el-icon>
        </el-button>
      </div>
    </div>
    <el-dialog
      v-model="dialogVisible"
      title="Добавить ключевые запросы"
      width="900px"
      :close-on-click-modal="!addingKeywords"
      :close-on-press-escape="!addingKeywords"
      :show-close="!addingKeywords"
    >
      <el-form>
        <el-input
          v-model="keywords"
          type="textarea"
          placeholder="Введите ключевые запросы, разделенные запятыми или новой строкой"
          :rows="5"
          :disabled="addingKeywords"
        />
      </el-form>
      <template #footer>
        <div class="flex items-center justify-between w-full">
          <!-- Прогресс-бар в левой части -->
          <div
            v-if="keywordsStore.isAddingWithProgress"
            class="flex items-center gap-3 flex-shrink-0"
          >
            <el-progress
              :text-inside="true"
              :stroke-width="26"
              :percentage="keywordsStore.addProgress"
            />
            <span
              v-if="keywordsStore.addProgressText"
              class="text-sm text-gray-600 dark:text-gray-400"
            >
              {{ keywordsStore.addProgressText }}
            </span>
          </div>

          <!-- Кнопки в правой части -->
          <div class="flex gap-2 ml-auto">
            <el-button
              @click="dialogVisible = false"
              :disabled="addingKeywords"
            >
              Отмена
            </el-button>
            <el-button
              v-if="!addingKeywords"
              type="primary"
              @click="addKeywords"
            >
              Добавить
            </el-button>
            <el-button
              v-else
              type="primary"
              :loading="addingKeywords"
              loading-text="Добавление ключевых слов..."
            >
              Добавить
            </el-button>
          </div>
        </div>
      </template>
    </el-dialog>
  </el-card>
</template>

<script setup>
import { ref, reactive, inject, onMounted, onUnmounted } from "vue";
import validator from "validator";
import { ElMessage } from "element-plus";
import { useI18n } from "vue-i18n";
import { CirclePlus, VideoPlay, VideoPause } from "@element-plus/icons-vue";
import { useProjectStore } from "../../stores/project";
import { useKeywordsStore } from "../../stores/keywords";
import socket from "../../stores/socket-client";

const project = useProjectStore();
const keywordsStore = useKeywordsStore();
const { t } = useI18n();

const dirname = ref("");
const dialogVisible = ref(false);
const keywords = ref("");
const addingKeywords = ref(false);
let messageShown = false; // Флаг для предотвращения дублирования сообщений
let callCount = 0; // Счетчик вызовов для отладки

function submitSite() {
  // let url = urlm.value.trim();
  let url = project.data.url.trim();
  if (!validator.isURL(url, { require_protocol: true })) {
    url = "https://" + url;
  }
  if (!validator.isURL(url)) {
    ElMessage.error(t("isNotURL"));
  } else {
    project.start(url);
  }
}

function freezeQueue() {
  project.freeze();
}

function addKeywords() {
  console.log("=== addKeywords called ===");
  console.log("Call timestamp:", new Date().toISOString());
  console.log("Current keywords:", keywords.value);
  console.log("Previous messageShown flag:", messageShown);
  console.log("Previous callCount:", callCount);

  if (keywords.value.trim()) {
    console.log("✅ Keywords provided, resetting flags");
    messageShown = false; // Сбрасываем флаг при начале добавления
    callCount = 0; // Сбрасываем счетчик вызовов
    addingKeywords.value = true;
    keywordsStore.addKeywords(keywords.value);
    // Не закрываем диалог сразу - ждем завершения добавления
  } else {
    console.log("❌ No keywords provided");
    ElMessage.warning("Введите ключевые запросы");
  }
}

function refreshTable() {
  // Обновляем таблицу ключевых слов после успешного добавления
  if (keywordsStore.currentProjectId) {
    keywordsStore.loadKeywords(keywordsStore.currentProjectId);
  }
}

// Обработчик успешного добавления ключевых слов
function handleKeywordsAdded(data) {
  callCount++;
  console.log(`=== handleKeywordsAdded called (call #${callCount}) ===`);
  console.log("Call timestamp:", new Date().toISOString());
  console.log("Current progress:", keywordsStore.addProgress);
  console.log("Is adding with progress:", keywordsStore.isAddingWithProgress);
  console.log("Data:", JSON.stringify(data, null, 2));
  console.log("Current messageShown flag:", messageShown);

  // Предотвращаем дублирование сообщений
  if (messageShown) {
    console.log(
      `❌ Call #${callCount}: Message already shown, skipping duplicate`
    );
    console.log("messageShown is true, returning early");
    return;
  }

  // Дополнительная защита: если это не первый вызов, игнорируем
  if (callCount > 1) {
    console.log(
      `❌ Call #${callCount}: Multiple calls detected, this should not happen!`
    );
    return;
  }

  console.log(`✅ Call #${callCount}: Processing keywords addition`);
  addingKeywords.value = false;
  keywordsStore.resetAddProgress();
  ElMessage.success("Ключевые запросы добавлены");
  messageShown = true;
  keywords.value = "";

  // Небольшая задержка, чтобы прогресс успел обновиться до 100%

  // Небольшая задержка, чтобы прогресс успел обновиться до 100%
  setTimeout(() => {
    console.log("=== Closing dialog after delay ===");
    dialogVisible.value = false;
    // Обновляем таблицу после закрытия диалога
    refreshTable();
    // Сбрасываем флаг после закрытия диалога
    setTimeout(() => {
      console.log("Resetting messageShown flag to false");
      messageShown = false;
      callCount = 0; // Сбрасываем счетчик вызовов
    }, 1000);
  }, 200);
}

// Обработчик ошибки при добавлении ключевых слов
function handleKeywordsError(data) {
  console.log("Keywords add error:", data);
  addingKeywords.value = false;
  keywordsStore.resetAddProgress();
  ElMessage.error(data.message || "Ошибка при добавлении ключевых слов");

  // Не закрываем диалог при ошибке, чтобы пользователь мог попробовать снова
}

// Настройка socket listeners
onMounted(() => {
  console.log("=== KeywordsAdd onMounted - registering socket listeners ===");
  socket.on("keywords:added", handleKeywordsAdded);
  socket.on("keywords:error", handleKeywordsError);
});

onUnmounted(() => {
  console.log("=== KeywordsAdd onUnmounted - removing socket listeners ===");
  socket.off("keywords:added", handleKeywordsAdded);
  socket.off("keywords:error", handleKeywordsError);
});
</script>

<style>
.el-input--large .el-input__wrapper {
  padding: 1px;
  border-color: #fafcff;
  /* border-radius: 0; */
}
.w-500 {
  width: 500px;
}

/* Стили для темной темы */
html.dark .el-input--large .el-input__wrapper {
  border-color: var(--el-border-color);
  background-color: var(--el-fill-color);
}

/* Apply background and border color to the wrapper only - Element Plus already has border structure */
html.dark .site-input .el-input__wrapper {
  background-color: var(--el-fill-color);
  color: var(--el-text-color-primary);
  border-color: var(--el-border-color);
}

html.dark .site-input input,
html.dark .site-input textarea {
  background-color: transparent;
  color: var(--el-text-color-primary);
  border: none;
}

html.dark .site-input .el-textarea__inner {
  background-color: var(--el-fill-color);
  color: var(--el-text-color-primary);
  border-color: var(--el-border-color);
}

/* Focus and placeholder styles should target the visible element (wrapper or textarea inner) */
html.dark .site-input .el-input__wrapper:focus-within {
  border-color: var(--el-color-primary);
  background-color: var(--el-fill-color-light);
}

html.dark .site-input .el-textarea__inner::placeholder,
html.dark .site-input input::placeholder,
html.dark .site-input textarea::placeholder {
  color: var(--el-text-color-placeholder);
}

/* Ensure inner input elements don't draw their own border or shadow -- keep only wrapper border */
.site-input .el-input__wrapper .el-input__inner {
  border: none !important;
  box-shadow: none !important;
  outline: none !important;
  background: transparent !important;
}

.site-input input,
.site-input textarea {
  border: none !important;
  box-shadow: none !important;
  outline: none !important;
}

.site-input .el-textarea__inner {
  box-shadow: none !important;
  outline: none !important;
  background: transparent !important;
}

html.dark .el-card {
  background-color: var(--el-bg-color);
  border-color: var(--el-border-color);
}

/* Стили для progress bar в темной теме */
html.dark .el-progress {
  --el-progress-text-color: var(--el-text-color-primary);
}

html.dark .el-progress-bar__outer {
  background-color: var(--el-bg-color) !important;
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
</style>
