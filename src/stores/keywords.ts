import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { ElMessage } from "element-plus";
import { ipcClient } from "./socket-client";
import { i18n } from "../i18n";
import { useProjectStore } from "./project";
import type { Keyword, LoadKeywordsOptions } from "../types/schema";

export const useKeywordsStore = defineStore("keywords", () => {
  // Access project store for clustering settings (eps, method)
  const projectStore = useProjectStore();
  // State
  const keywords = ref<Keyword[]>([]);
  const loading = ref(false);
  const loadingMore = ref(false);
  const error = ref<string | null>(null);
  const currentProjectId = ref<string | number | null>(null);
  const totalCount = ref(0);
  const hasMore = ref(false);
  const currentSkip = ref(0);
  const pageSize = ref(100);

  // Новые параметры для окна данных
  const windowSize = ref(300); // Размер окна данных (видимые + буфер)
  const bufferSize = ref(50); // Размер буфера сверху и снизу
  const windowStart = ref(0); // Начало окна в общем массиве данных
  const visibleStart = ref(0); // Начало видимой области в окне
  // Трекинг последнего запрошенного окна, чтобы игнорировать устаревшие ответы
  const lastRequestedWindowStart = ref(-1);

  // Параметры сортировки
  // Используем единый числовой формат: { columnName: 1 } где 1 = ASC, -1 = DESC
  const sort = ref({}); // Объект сортировки в числовом формате

  // Прогресс добавления ключевых слов
  const addProgress = ref(0); // Процент выполнения (0-100)
  const addProgressText = ref(""); // Текст прогресса
  const isAddingWithProgress = ref(false); // Флаг показа прогресса

  // Поиск
  const searchQuery = ref(""); // Текущий поисковый запрос
  // Флаги для фоновых процессов, например категоризация
  const running = ref(false);
  const percentage = ref(0);

  // Отслеживание состояния процессов категоризации и типизации
  const categorizationRunning = ref(false);
  const typingRunning = ref(false);
  const clusteringRunning = ref(false);
  const stopwordsRunning = ref(false);
  const stopwordsFinished = ref(false);
  const stopwordsPercent = ref(0);
  const categorizationFinished = ref(false);
  const typingFinished = ref(false);
  const clusteringFinished = ref(false);
  // Individual progress percentages (0..100) for each process
  const categorizationPercent = ref(0);
  const typingPercent = ref(0);
  const clusteringPercent = ref(0);

  // UI helpers for detailed progress
  const currentProcessLabel = ref("");
  const currentProcessed = ref(0);
  const currentTotal = ref(0);

  // Целевые флаги: какие процессы пользователь намерен запускать (используются для прогресса/сброса)
  const targetCategorization = ref(false);
  const targetTyping = ref(false);
  const targetClustering = ref(false);
  const targetStopwords = ref(false);

  function updateOverallProgress() {
    // Учитываем только те процессы, которые пользователь запустил (target*)
    const targets = [
      targetCategorization.value ? categorizationPercent.value : null,
      targetTyping.value ? typingPercent.value : null,
      targetClustering.value ? clusteringPercent.value : null,
      targetStopwords.value ? stopwordsPercent.value : null,
    ].filter((v) => v !== null) as number[];

    if (targets.length === 0) {
      percentage.value = 0;
    } else {
      const sum = targets.reduce((a, b) => a + (isFinite(b) ? b : 0), 0);
      percentage.value = Math.round(sum / targets.length);
    }

    const anyRunning =
      (targetCategorization.value && categorizationRunning.value) ||
      (targetTyping.value && typingRunning.value) ||
      (targetClustering.value && clusteringRunning.value);

    // include stopwords
    const anyStopwordsRunning = targetStopwords.value && stopwordsRunning.value;

    const allTargetFinished =
      (!targetCategorization.value || categorizationFinished.value) &&
      (!targetTyping.value || typingFinished.value) &&
      (!targetClustering.value || clusteringFinished.value);

    running.value = (anyRunning || anyStopwordsRunning) && !allTargetFinished;
  }

  // Короткое понятное сообщение пользователю при ошибках 429/квоты
  const RATE_LIMIT_MESSAGE = 'Не удалось получить эмбеддинги для классификации. Проверьте OpenAI ключ.';

  function mapErrorMessage(payload?: any): string {
    if (!payload) return 'Произошла ошибка';
    // Support both object payloads and plain strings
    if (typeof payload === 'object') {
      // Prefer explicit `message` field if present (display raw message text)
      if (payload.message && typeof payload.message === 'string' && payload.message.trim() !== '') {
        return payload.message;
      }
      // Fallback to messageKey translation if message is not provided
      if (payload.messageKey && typeof payload.messageKey === 'string') {
        try {
          return i18n.global.t(payload.messageKey as any) as string;
        } catch (e) {
          // fallback to raw message if translation fails
        }
      }
      // If `message` itself contains a translation key (e.g. 'keywords.noTargetKeywords'), try resolving it
      if (payload.message && typeof payload.message === 'string' && payload.message.indexOf('.') !== -1 && !/\s/.test(payload.message)) {
        try {
          return i18n.global.t(payload.message as any) as string;
        } catch (e) {
          // ignore and continue
        }
      }
      if (payload.status === 429) return RATE_LIMIT_MESSAGE;
      const msg = payload.message || '';
      if (/429/.test(String(msg)) || /rate limit/i.test(String(msg))) return RATE_LIMIT_MESSAGE;
      return msg || 'Произошла ошибка';
    }
    const msg = String(payload);
    // If payload is a string and looks like a translation key, try resolving it
    if (msg.indexOf('.') !== -1 && !/\s/.test(msg)) {
      try {
        return i18n.global.t(msg as any) as string;
      } catch (e) {}
    }
    if (/429/.test(msg) || /rate limit/i.test(msg)) return RATE_LIMIT_MESSAGE;
    return msg || 'Произошла ошибка';
  }

  // Getters
  const keywordCount = computed(() => keywords.value?.length || 0);
  const isEmpty = computed(
    () => !keywords.value || keywords.value.length === 0
  );
  const canLoadMore = computed(() => hasMore.value && !loadingMore.value);
  const visibleKeywords = computed(() => {
    if (!keywords.value || !Array.isArray(keywords.value)) {
      return [];
    }
    const start = visibleStart.value;
    const end = Math.min(start + 50, keywords.value.length); // Предполагаем 50 видимых строк
    return keywords.value.slice(start, end);
  });

  // Actions
  function setKeywords(newKeywords: any) {
    // Гарантируем, что keywords всегда является массивом
    keywords.value = Array.isArray(newKeywords) ? newKeywords : [];
  }

  function initializeState() {
    // Гарантируем начальное состояние
    setKeywords([]);
    loading.value = false;
    loadingMore.value = false;
    error.value = null;
    totalCount.value = 0;
    hasMore.value = false;
    currentSkip.value = 0;
    windowStart.value = 0;
    visibleStart.value = 0;
    sort.value = {};
    addProgress.value = 0;
    addProgressText.value = "";
    isAddingWithProgress.value = false;
  }

  async function addKeywords(newKeywords: string) {
    // logging removed for production: addKeywords called
    
    if (!currentProjectId.value) {
      error.value = "No project selected" as any;
      console.error('[Keywords Store] No project selected');
      return;
    }

    loading.value = true;
    error.value = null;

    try {
      // Парсим ключевые слова
      let parsedKeywords = newKeywords
        .split(/[\,\n]/)
        .map((k) => k.trim())
        .filter((k) => k.length > 0)
        .map((k) => k.toLowerCase());

      // parsed keywords (logging removed)

      if (parsedKeywords.length === 0) {
        ElMessage.warning("Нет ключевых слов для добавления");
        loading.value = false;
        return;
      }

      // Если больше 20000 записей, показываем прогресс
      if (parsedKeywords.length > 20000) {
        isAddingWithProgress.value = true;
        addProgress.value = 0;
      }

      // adding keywords (logging removed)
      
      // Вызываем IPC метод для массового добавления
      const result = await ipcClient.insertKeywordsBulk(
        parsedKeywords,
        currentProjectId.value as number
      );

      // insertKeywordsBulk result received

      if (result) {
        const { inserted, skipped } = result;
        if (skipped > 0) {
          ElMessage.success(`Добавлено ${inserted} новых ключевых слов (${skipped} дубликатов пропущено)`);
        } else {
          ElMessage.success(`Добавлено ${inserted} ключевых слов`);
        }
        // Перезагружаем текущее окно
        await loadKeywords(currentProjectId.value as number, {
          skip: windowStart.value,
          limit: windowSize.value,
          sort: sort.value,
        });
        // Дадим прогресс-бару время отобразиться перед сбросом состояния
        setTimeout(() => {
          isAddingWithProgress.value = false;
          addProgress.value = 0;
        }, 2000);
      } else {
        console.error('[Keywords Store] Result is null or undefined');
        ElMessage.error("Ошибка при добавлении ключевых слов");
      }
    } catch (err: any) {
      console.error("[Keywords Store] Error adding keywords:", err);
      console.error("[Keywords Store] Error stack:", err.stack);
      error.value = err.message;
      ElMessage.error(`Ошибка: ${err.message}`);
    } finally {
      loading.value = false;
    }
  }

  // TODO: IPC migration - migrate removeKeyword
  /*
  function removeKeyword(index: number) {
    const pid = currentProjectId.value;
    if (index >= 0 && index < keywords.value.length && pid != null) {
      const k = keywords.value[index];
      const kw = typeof k === "string" ? k : (k && typeof k.keyword === "string" ? k.keyword : "");
      if (!kw) return;
      socket.emit("keywords:remove", {
        projectId: pid as string | number,
        keyword: kw,
        windowStart: windowStart.value,
        windowSize: windowSize.value,
      });
    }
  }

  function clearKeywords() {
    const pid = currentProjectId.value;
    if (pid == null) return;
    socket.emit("keywords:clear", {
      projectId: pid as string | number,
    });
  }
  */

  async function deleteKeyword(id: number | string) {
    if (!currentProjectId.value) {
      console.error("No current project ID set");
      ElMessage.error("Проект не выбран");
      return;
    }

    if (!id) {
      console.error("No id provided to deleteKeyword");
      return;
    }

    try {
      console.log("Store: deleting keyword with id:", id);
      const result = await ipcClient.deleteKeyword(Number(id));
      
      if (result !== null) {
        ElMessage.success("Ключевое слово удалено");
        // Перезагружаем текущее окно
        await loadKeywords(currentProjectId.value as number, {
          skip: windowStart.value,
          limit: windowSize.value,
          sort: sort.value,
        });
      } else {
        ElMessage.error("Ошибка при удалении");
      }
    } catch (err: any) {
      console.error("Error deleting keyword:", err);
      ElMessage.error(`Ошибка: ${err.message}`);
    }
  }

  async function searchKeywords(query: string) {
    if (!currentProjectId.value) {
      console.error("No current project ID set");
      return;
    }

    // Устанавливаем поисковый запрос
    searchQuery.value = query || "";
    console.log("Store: searching keywords with query:", query);
    
    // Сбрасываем позицию окна и перезагружаем с начала
    windowStart.value = 0;
    visibleStart.value = 0;
    currentSkip.value = 0;
    lastRequestedWindowStart.value = 0;
    
    await loadKeywords(currentProjectId.value as number, {
      skip: 0,
      limit: windowSize.value,
      sort: sort.value,
    });
  }

  async function sortKeywords(sortOptions: Record<string, number>) {
    console.log("=== sortKeywords called ===");
    console.log("sortOptions:", JSON.stringify(sortOptions, null, 2));
    console.log("currentProjectId:", currentProjectId.value);

    if (!currentProjectId.value) {
      console.log("No project selected for sorting");
      return;
    }

    console.log("Обновляем sort.value...");
    // Обновляем параметры сортировки
    sort.value = sortOptions;
    console.log(
      "sort.value после обновления:",
      JSON.stringify(sort.value, null, 2)
    );

    // Перезагружаем данные с новыми параметрами сортировки
    windowStart.value = 0;
    visibleStart.value = 0;
    currentSkip.value = 0;
    lastRequestedWindowStart.value = 0;
    loadKeywords(currentProjectId.value, {
      skip: 0,
      limit: windowSize.value,
      sort: sortOptions,
    });
  }

  function loadWindow(startIndex: number) {
    console.log("=== loadWindow called ===");
    console.log("startIndex:", startIndex);
    console.log("currentProjectId:", currentProjectId.value);
    console.log("bufferSize:", bufferSize.value);

    if (!currentProjectId.value) {
      console.log("No currentProjectId, skipping loadWindow");
      return;
    }

    if (loadingMore.value) {
      console.log("Skipping loadWindow because loadingMore is already true");
      return;
    }

    let newWindowStart = Math.max(0, startIndex - bufferSize.value);
    const maxStartAllowed = Math.max(0, totalCount.value - windowSize.value);
    if (newWindowStart > maxStartAllowed) newWindowStart = maxStartAllowed;

    if (newWindowStart === windowStart.value) {
      console.log("loadWindow: newWindowStart equals current windowStart, skipping", newWindowStart);
      return;
    }

    if (newWindowStart === lastRequestedWindowStart.value) {
      console.log("loadWindow: newWindowStart equals lastRequestedWindowStart, skipping", newWindowStart);
      return;
    }

    loadingMore.value = true;
    lastRequestedWindowStart.value = newWindowStart;
    console.log("Loading window with skip:", newWindowStart, "limit:", windowSize.value);

    loadKeywords(currentProjectId.value, {
      skip: newWindowStart,
      limit: windowSize.value,
      sort: sort.value,
    });
  }

  // Вспомогательное: сбросить состояние прогресса/флагов
  function resetProcessState() {
    categorizationRunning.value = false;
    typingRunning.value = false;
    clusteringRunning.value = false;
    categorizationFinished.value = false;
    typingFinished.value = false;
    clusteringFinished.value = false;
    categorizationPercent.value = 0;
    typingPercent.value = 0;
    clusteringPercent.value = 0;
    running.value = false;
    percentage.value = 0;
    targetCategorization.value = false;
    targetTyping.value = false;
    targetClustering.value = false;
    // stopwords
    stopwordsRunning.value = false;
    stopwordsFinished.value = false;
    stopwordsPercent.value = 0;
    targetStopwords.value = false;
    currentProcessLabel.value = "";
    currentProcessed.value = 0;
    currentTotal.value = 0;
  }

  // Запуск всех процессов последовательно (сохранено для удобства)
  async function startAllProcesses() {
    if (!currentProjectId.value) {
      ElMessage.error("Проект не выбран");
      return;
    }
    resetProcessState();
    // Отмечаем цели
    targetCategorization.value = true;
    targetTyping.value = true;
    targetClustering.value = true;
    running.value = true;
    updateOverallProgress();
    try {
      const epsFromProject = Number((projectStore?.data as any)?.clustering_eps ?? 0.5);
      const algorithm = String((projectStore?.data as any)?.clustering_algorithm ?? "components");
      const dbscanEps = Number((projectStore?.data as any)?.clustering_dbscan_eps ?? 0.3);
      const dbscanMinPts = Number((projectStore?.data as any)?.clustering_dbscan_minPts ?? 2);

      // First: apply stop-words if any (run before other processes)
      try {
        targetStopwords.value = true;
        stopwordsRunning.value = true;
        running.value = true;
        updateOverallProgress();
        await ipcClient.startApplyStopwords(Number(currentProjectId.value));
        stopwordsFinished.value = true;
        stopwordsRunning.value = false;
        // reload keywords after applying stopwords in the Start All flow
        try {
          if (currentProjectId.value) {
            await loadKeywords(currentProjectId.value as number, {
              skip: windowStart.value,
              limit: windowSize.value,
              sort: sort.value,
            });
          }
        } catch (e) {
          console.error('[Keywords Store] Error reloading keywords after startAll stopwords apply', e);
        }
      } catch (swErr) {
        console.error('Error applying stopwords:', swErr);
        stopwordsRunning.value = false;
        // proceed with other processes even if stopwords application fails
      }

      await ipcClient.startCategorization(Number(currentProjectId.value));
      categorizationRunning.value = true;
      updateOverallProgress();

      await ipcClient.startTyping(Number(currentProjectId.value));
      typingRunning.value = true;
      updateOverallProgress();

      await ipcClient.startClustering(
        Number(currentProjectId.value),
        algorithm,
        algorithm === "components" ? epsFromProject : dbscanEps,
        algorithm === "dbscan" ? dbscanMinPts : undefined
      );
      clusteringRunning.value = true;
      updateOverallProgress();

      ElMessage.success("Все процессы запущены");
    } catch (err: any) {
      console.error("Error starting processes:", err);
      ElMessage.error(`Ошибка запуска процессов: ${err.message}`);
      running.value = anyProcessRunning();
    }
  }

  // Запуск только категоризации
  async function startCategorizationOnly() {
    if (!currentProjectId.value) {
      ElMessage.error("Проект не выбран");
      return;
    }
    try {
      // Сброс и установка цели только для категоризации
      resetProcessState();
      targetCategorization.value = true;
      categorizationRunning.value = true;
      running.value = true;
      updateOverallProgress();
  await ipcClient.startCategorization(Number(currentProjectId.value));
    } catch (err: any) {
      console.error("Error starting categorization:", err);
      categorizationRunning.value = false;
      running.value = anyProcessRunning();
      ElMessage.error(`Ошибка запуска категоризации: ${err.message}`);
    }
  }

  // Запуск только типизации
  async function startTypingOnly() {
    if (!currentProjectId.value) {
      ElMessage.error("Проект не выбран");
      return;
    }
    try {
      resetProcessState();
      targetTyping.value = true;
      typingRunning.value = true;
      running.value = true;
      updateOverallProgress();
  await ipcClient.startTyping(Number(currentProjectId.value));
    } catch (err: any) {
  console.error("Error starting typing:", err);
  typingRunning.value = false;
  running.value = anyProcessRunning();
  ElMessage.error(`Ошибка запуска классификации: ${err.message}`);
    }
  }

  // Запуск только применения стоп-слов
  async function startStopwordsOnly() {
    if (!currentProjectId.value) {
      ElMessage.error("Проект не выбран");
      return;
    }
    try {
      resetProcessState();
      targetStopwords.value = true;
      stopwordsRunning.value = true;
      running.value = true;
      updateOverallProgress();
      await ipcClient.startApplyStopwords(Number(currentProjectId.value));
      stopwordsFinished.value = true;
      // Reload keywords to reflect applied stop-words
      try {
        if (currentProjectId.value) {
          await loadKeywords(currentProjectId.value as number, {
            skip: windowStart.value,
            limit: windowSize.value,
            sort: sort.value,
          });
        }
      } catch (e) {
        console.error('[Keywords Store] Error reloading keywords after startStopwordsOnly', e);
      }
      ElMessage.success("Применение стоп-слов завершено");
    } catch (err: any) {
      console.error("Error applying stopwords:", err);
      stopwordsRunning.value = false;
      running.value = anyProcessRunning();
      ElMessage.error(`Ошибка применения стоп-слов: ${err.message}`);
    }
  }

  // Запуск только кластеризации
  async function startClusteringOnly() {
    if (!currentProjectId.value) {
      ElMessage.error("Проект не выбран");
      return;
    }
    try {
      const epsFromProject = Number((projectStore?.data as any)?.clustering_eps ?? 0.5);
      const algorithm = String((projectStore?.data as any)?.clustering_algorithm ?? "components");
      const dbscanEps = Number((projectStore?.data as any)?.clustering_dbscan_eps ?? 0.3);
      const dbscanMinPts = Number((projectStore?.data as any)?.clustering_dbscan_minPts ?? 2);

      resetProcessState();
      targetClustering.value = true;
      clusteringRunning.value = true;
      running.value = true;
      updateOverallProgress();
      await ipcClient.startClustering(
        Number(currentProjectId.value),
        algorithm,
        algorithm === "components" ? epsFromProject : dbscanEps,
        algorithm === "dbscan" ? dbscanMinPts : undefined
      );
    } catch (err: any) {
      console.error("Error starting clustering:", err);
      clusteringRunning.value = false;
      running.value = anyProcessRunning();
      ElMessage.error(`Ошибка запуска кластеризации: ${err.message}`);
    }
  }

  function anyProcessRunning() {
    return (
      categorizationRunning.value || typingRunning.value || clusteringRunning.value
    );
  }

  // Очистить все ключевые слова в текущем проекте
  async function clearKeywords() {
    if (!currentProjectId.value) {
      ElMessage.error("Проект не выбран");
      return;
    }
    
    try {
      console.log("clearKeywords called for project:", currentProjectId.value);
      
      // Удаляем все keywords через IPC
      const result = await ipcClient.deleteKeywordsByProject(Number(currentProjectId.value));
      
      if (result) {
        console.log("Keywords cleared successfully:", result);
        
        // Очищаем локальное состояние
        keywords.value = [];
        totalCount.value = 0;
        hasMore.value = false;
        windowStart.value = 0;
        
        ElMessage.success(`Удалено ключевых слов: ${result.changes || 0}`);
      } else {
        ElMessage.warning("Не удалось удалить ключевые слова");
      }
    } catch (err: any) {
      console.error("Error clearing keywords:", err);
      ElMessage.error(`Ошибка: ${err.message}`);
    }
  }

  async function loadKeywords(projectId: string | number, options: LoadKeywordsOptions = {}) {
    console.log("=== loadKeywords called ===");
    console.log("projectId:", projectId);
    console.log("options:", options);

    if (!projectId) {
      console.log("No projectId provided, skipping load");
      return;
    }

    currentProjectId.value = projectId;
    const {
      skip = 0,
      limit = windowSize.value,
      sort: sortOptions,
      resetSearch,
    } = options;

    console.log("skip:", skip, "limit:", limit);
    console.log("windowSize:", windowSize.value);

    // Если переданы параметры сортировки, сохраняем их
    if (sortOptions) {
      sort.value = sortOptions;
      console.log("Updated sort:", sort.value);
    }

    // If caller requested to reset search (clear filter), clear local searchQuery
    if (resetSearch) {
      searchQuery.value = "";
    }

    // Если это первая загрузка (skip === 0), показываем основной лоадер
    // Иначе показываем loadingMore для подгрузки следующего окна
    if (skip === 0) {
      console.log("First load: clearing keywords array and showing main loader");
      setKeywords([]);
      windowStart.value = 0;
      visibleStart.value = 0;
      currentSkip.value = 0;
      loading.value = true;
      loadingMore.value = false;
    } else {
      console.log("Loading more data, showing loadingMore");
      loading.value = false;
      loadingMore.value = true;
    }

    try {
      console.log("Loading keywords window via IPC for project:", projectId);
      const result = await ipcClient.getKeywordsWindow(
        Number(projectId), 
        skip, 
        limit, 
        sort.value,
        searchQuery.value
      );
      
      if (!result) {
        throw new Error("No result from getKeywordsWindow");
      }

      console.log(`Loaded window: ${result.keywords.length} keywords, total: ${result.total}`);
      
      // Обновляем данные окна
      totalCount.value = result.total;
      windowStart.value = skip;
      currentSkip.value = skip;
      hasMore.value = (skip + result.keywords.length) < result.total;
      setKeywords(result.keywords);
      
      console.log("Window state:", {
        windowStart: windowStart.value,
        keywordsLength: result.keywords.length,
        totalCount: totalCount.value,
        hasMore: hasMore.value
      });
      
    } catch (err: any) {
      console.error("Error loading keywords:", err);
      error.value = err.message;
      ElMessage.error(`Ошибка загрузки: ${err.message}`);
    } finally {
      loading.value = false;
      loadingMore.value = false;
    }
  }

  // TODO: IPC migration - remove loadMoreKeywords (loading all data at once now)
  /*
  function loadMoreKeywords() {
    if (!canLoadMore.value || !currentProjectId.value) return;

    loadingMore.value = true;
    const nextSkip = currentSkip.value + pageSize.value;

  socket.emit("keywords:load-more", {
      projectId: currentProjectId.value as string | number,
      skip: nextSkip,
      limit: pageSize.value,
    });
  }
  */

  // TODO: IPC migration - remove loadWindow (not needed with full data load)
  /*
  function loadWindow(startIndex: number) {
    console.log("=== loadWindow called ===");
    console.log("startIndex:", startIndex);
    console.log("currentProjectId:", currentProjectId.value);
    console.log("bufferSize:", bufferSize.value);

    if (!currentProjectId.value) {
      console.log("No currentProjectId, skipping loadWindow");
      return;
    }

    // Добавлена проверка, чтобы предотвратить повторные вызовы loadWindow, если loadingMore уже true.
    if (loadingMore.value) {
      console.log("Skipping loadWindow because loadingMore is already true");
      return;
    }

    let newWindowStart = Math.max(0, startIndex - bufferSize.value);
    // Clamp to valid range so we don't request beyond available data
    try {
      const maxStartAllowed = Math.max(0, totalCount.value - windowSize.value);
      if (newWindowStart > maxStartAllowed) newWindowStart = maxStartAllowed;
    } catch (e) {}

    // If windowStart would not change, avoid emitting (prevents repeated identical requests)
    if (newWindowStart === windowStart.value) {
      console.log(
        "loadWindow: newWindowStart equals current windowStart, skipping emit",
        newWindowStart
      );
      return;
    }

    if (newWindowStart === lastRequestedWindowStart.value) {
      console.log(
        "loadWindow: newWindowStart equals lastRequestedWindowStart, skipping emit",
        newWindowStart
      );
      return;
    }

    loadingMore.value = true;
    lastRequestedWindowStart.value = newWindowStart;
    console.log("Set loadingMore to true");
    console.log(
      "Emitting keywords:get with skip:",
      newWindowStart,
      "limit:",
      windowSize.value
    );

    // Добавляем таймаут для сброса loadingMore в случае ошибки
    const timeoutId = window.setTimeout(() => {
      if (loadingMore.value) {
        console.warn("=== loadWindow timeout - resetting loadingMore ===");
        loadingMore.value = false;
      }
    }, 10000); // 10 секунд таймаут

    // Include current searchQuery so server returns filtered results when a search is active
  socket.emit("keywords:get", {
      projectId: currentProjectId.value as string | number,
      skip: newWindowStart,
      limit: windowSize.value,
      sort: sort.value,
      searchQuery: searchQuery.value || undefined,
      timeoutId: timeoutId, // Передаем ID таймаута для отмены
    });

    // Добавляем логирование для отладки загрузки окна
    console.log("Debug loadWindow:", {
      startIndex,
      newWindowStart,
      windowSize: windowSize.value,
      totalCount: totalCount.value,
    });
  }
  */

  // TODO: IPC migration - remove or refactor
  /*
  function saveKeywords() {
    // Не нужно, так как изменения сохраняются через socket
  }
  */

  function resetAddProgress() {
    isAddingWithProgress.value = false;
    addProgress.value = 0;
    addProgressText.value = "";
  }

  // Запустить процесс категоризации на сервере
  // TODO: IPC migration - implement categorization/typing/clustering via IPC
  /*
  function startCategorization() {
    if (!currentProjectId.value) {
      ElMessage.error("Проект не выбран");
      return;
    }
    if (!socket.connected) {
      ElMessage.error("Нет подключения к серверу");
      return;
    }

    // Сбрасываем состояние процессов
  categorizationRunning.value = false;
  typingRunning.value = false;
  clusteringRunning.value = false;
  categorizationFinished.value = false;
  typingFinished.value = false;
  clusteringFinished.value = false;
  categorizationPercent.value = 0;
  typingPercent.value = 0;
  clusteringPercent.value = 0;
  running.value = true;
  percentage.value = 0;

    // Emit старт процессов категоризации и типизации
    console.log(
      "Emitting keywords:start-categorization and keywords:start-typing for project",
      currentProjectId.value
    );
    // Determine clustering parameters from project settings (persisted by ClusteringConfig)
    const epsFromProject = Number((projectStore?.data as any)?.clustering_eps ?? 0.5);
    const algorithm = String((projectStore?.data as any)?.clustering_algorithm ?? "components");
    const dbscanEps = Number((projectStore?.data as any)?.clustering_dbscan_eps ?? 0.3);
    const dbscanMinPts = Number((projectStore?.data as any)?.clustering_dbscan_minPts ?? 2);

    console.log("Emitting keywords:start-clustering for project", {
      projectId: currentProjectId.value,
      algorithm,
      eps: algorithm === "components" ? epsFromProject : dbscanEps,
      minPts: algorithm === "dbscan" ? dbscanMinPts : undefined,
    });
  socket.emit("keywords:start-categorization", {
      projectId: currentProjectId.value,
    });
  socket.emit("keywords:start-typing", {
      projectId: currentProjectId.value,
    });
  socket.emit("keywords:start-clustering", {
      projectId: currentProjectId.value,
      algorithm,
      eps: algorithm === "components" ? epsFromProject : dbscanEps,
      minPts: algorithm === "dbscan" ? dbscanMinPts : undefined,
    });
  }
  */

  // Проверка завершения всех процессов
  function checkBothProcessesFinished() {
    const allTargetFinished =
      (!targetCategorization.value || categorizationFinished.value) &&
      (!targetTyping.value || typingFinished.value) &&
      (!targetClustering.value || clusteringFinished.value);

    updateOverallProgress();

    if (allTargetFinished) {
      running.value = false;
      console.log("Выбранные процессы завершены");
    }
  }

  // Socket listeners
  // TODO: IPC migration - socket events removed, now using direct IPC calls
  /*
  function setupSocketListeners() {
  socket.on("keywords:list", (data) => {
      console.log("=== keywords:list received ===");
      console.log("data:", data);
      console.log("currentProjectId:", currentProjectId.value);
      console.log("data.projectId:", data.projectId);
  console.log("Match:", String(data.projectId) === String(currentProjectId.value));
      console.log("data.skip:", data.skip);
      console.log(
        "data.keywords.length:",
        data.keywords ? data.keywords.length : "undefined"
      );

      // Отменяем таймаут если он был установлен
      if (data.timeoutId) {
        clearTimeout(data.timeoutId);
        console.log("Timeout cancelled for keywords:list");
      }

  if (String(data.projectId) === String(currentProjectId.value)) {
        // Если пришёл ответ не для последнего запрошенного окна, игнорируем его
        if (
          typeof data.skip === "number" &&
          lastRequestedWindowStart.value >= 0 &&
          data.skip !== lastRequestedWindowStart.value
        ) {
          console.warn(
            "Ignoring out-of-order window payload:",
            "received skip=",
            data.skip,
            "expected=",
            lastRequestedWindowStart.value
          );
          // Не меняем loadingMore тут намеренно: оставим до актуального ответа
          return;
        }
        console.log("Processing keywords data for current project");
        console.log("data.keywords:", data.keywords);
        console.log("data.totalCount:", data.totalCount);

        // Проверяем, не совпадают ли новые данные с текущими
        if (
          keywords.value.length === data.keywords.length &&
          JSON.stringify(keywords.value) === JSON.stringify(data.keywords)
        ) {
          console.log("Skipping duplicate keywords data");
          // Ensure we don't leave loading flags set which would show an infinite loader
          loading.value = false;
          loadingMore.value = false;
          // Cancel timeout if provided
          try {
            if (data.timeoutId) clearTimeout(data.timeoutId);
          } catch (e) {}
          return;
        }

        // Для окна данных всегда заменяем весь массив
        setKeywords(data.keywords);
        windowStart.value = data.skip;
        lastRequestedWindowStart.value = data.skip;
        currentSkip.value = data.skip + data.keywords.length;

        totalCount.value = data.totalCount;
        hasMore.value = data.hasMore;
        searchQuery.value = data.searchQuery || ""; // Обновляем поисковый запрос
        loading.value = false;
        loadingMore.value = false;

        console.log("Updated store state:");
        console.log("- keywords.length:", keywords.value.length);
        console.log("- windowStart:", windowStart.value);
        console.log("- totalCount:", totalCount.value);
        console.log("- loading:", loading.value);
        console.log("- loadingMore:", loadingMore.value);
        console.log("=== keywords:list processing completed ===");

        // Принудительно триггерим обновление компонента
        nextTick(() => {
          console.log("=== nextTick after keywords:list processing ===");
          console.log("Final loadingMore state:", loadingMore.value);

          // Вызываем resolve если он передан в данных
          if (
            data.promiseResolve &&
            typeof data.promiseResolve === "function"
          ) {
            data.promiseResolve();
          }
        });
      } else {
        console.log("Ignoring keywords data for different project");
        console.log(
          "Expected projectId:",
          currentProjectId.value,
          "Received:",
          data.projectId
        );
        // Даже для другого проекта сбрасываем loadingMore, чтобы избежать зацикливания
        loadingMore.value = false;
      }
    });

  socket.on("keywords:loaded-more", (data) => {
  if (String(data.projectId) === String(currentProjectId.value)) {
        // Для окна данных заменяем, а не добавляем
        setKeywords(data.keywords);
        windowStart.value = data.skip;
        currentSkip.value = data.skip + data.keywords.length;
        totalCount.value = data.totalCount;
        hasMore.value = data.hasMore;
        loadingMore.value = false;
      }
    });

    // Receive single-row updates (e.g. from categorization worker)
  socket.on("keywords:updated", (data) => {
      try {
        if (!data || String(data.projectId) !== String(currentProjectId.value) || !data.keyword)
          return;

        const updated = data.keyword;

        // Find in current window and merge/replace
        // Be tolerant to id type differences (number vs string) when matching
        const idx = keywords.value.findIndex((k) => k.id == updated.id);
        if (idx !== -1) {
          // Merge fields to preserve other client-side-only fields
          keywords.value[idx] = { ...keywords.value[idx], ...updated };
        } else {
          // If not found but falls into current window range, insert at appropriate position
          // Compute local index based on windowStart
          if (
            typeof windowStart.value === "number" &&
            typeof updated.id === "number"
          ) {
            // Simple heuristic: if updated.id is within current window range, insert
            // Note: this is conservative and may be skipped for out-of-window rows
            const localPos = updated.id - windowStart.value - 1;
            if (localPos >= 0 && localPos <= windowSize.value) {
              // Insert at the end of current array to avoid reordering issues
              keywords.value.push(updated);
            }
          }
        }
      } catch (e) {
        console.error("Error handling keywords:updated", e);
      }
    });

  socket.on("keywords:added", (data) => {
      console.log(
        "=== keywords:added received in store (should not show message) ==="
      );
      console.log("data:", data);

      // Сбрасываем прогресс
      resetAddProgress();

      console.log("Current totalCount:", totalCount.value);
      console.log("Current windowStart:", windowStart.value);
      console.log("Current windowSize:", windowSize.value);

      // Таблица будет обновлена в компоненте после закрытия диалога
      // Убираем автоматическое обновление, чтобы избежать конфликтов

      loading.value = false;
    });

  socket.on("keywords:removed", (data) => {
      console.log("=== keywords:removed received ===");
      console.log("data:", data);

      // После удаления ключевых слов перезагружаем текущее окно данных
      if (currentProjectId.value) {
        console.log("Reloading current window after removing keywords");
        // Небольшая задержка, чтобы сервер успел обработать удаление
        setTimeout(() => {
          loadWindow(windowStart.value);
        }, 100);
      }

      loading.value = false;
    });

  socket.on("keywords:cleared", (data) => {
      if (data.projectId === currentProjectId.value) {
        setKeywords([]);
        totalCount.value = 0;
        hasMore.value = false;
        currentSkip.value = 0;
        windowStart.value = 0;
        visibleStart.value = 0;
      }
    });

    socket.on("crawler-data-cleared", (data: { projectId: string | number }) => {
      // Очищаем ключевые запросы при очистке данных краулера для текущего проекта
      const projectStore = useProjectStore();
      if (String(data.projectId) === String(projectStore.currentProjectId)) {
        setKeywords([]);
        loading.value = false;
      }
    });

  socket.on("keywords:progress", (data) => {
      console.log("=== keywords:progress received ===");
      console.log("Progress:", data.progress, "%");
      console.log("data:", data);

      if (data.projectId === currentProjectId.value) {
        addProgress.value = data.progress;
        if (data.processed && data.total) {
          addProgressText.value = `${data.processed} из ${data.total}`;
        }
      }
    });

    // Categorization progress events from server
  socket.on("keywords:categorization-started", (data) => {
      if (data.projectId === currentProjectId.value) {
        categorizationRunning.value = true;
        categorizationFinished.value = false;
        categorizationPercent.value = 0;
        running.value = true;
        updateOverallProgress();
      }
    });

  socket.on("keywords:categorization-progress", (data) => {
      if (data.projectId === currentProjectId.value) {
        if (typeof data.percentage !== "undefined") {
          categorizationPercent.value = Math.max(0, Math.min(100, Math.round(data.percentage)));
          updateOverallProgress();
        }
      }
    });

  socket.on("keywords:categorization-finished", (data) => {
      if (data.projectId === currentProjectId.value) {
        categorizationRunning.value = false;
        categorizationFinished.value = true;
        categorizationPercent.value = 100;
        checkBothProcessesFinished();
      }
    });

  socket.on("keywords:categorization-error", (data) => {
      if (data.projectId === currentProjectId.value) {
        categorizationRunning.value = false;
        running.value = false;
        ElMessage.error(mapErrorMessage(data) || "Ошибка категоризации");
      }
    });

    // Typing progress events from server
  socket.on("keywords:typing-started", (data) => {
      if (data.projectId === currentProjectId.value) {
        typingRunning.value = true;
        typingFinished.value = false;
        typingPercent.value = 0;
        running.value = true;
        updateOverallProgress();
      }
    });

  socket.on("keywords:typing-progress", (data) => {
      if (data.projectId === currentProjectId.value) {
        if (typeof data.percentage !== "undefined") {
          typingPercent.value = Math.max(0, Math.min(100, Math.round(data.percentage)));
          updateOverallProgress();
        }
      }
    });

  socket.on("keywords:typing-finished", (data) => {
      if (data.projectId === currentProjectId.value) {
        typingRunning.value = false;
        typingFinished.value = true;
        typingPercent.value = 100;
        checkBothProcessesFinished();
      }
    });

  socket.on("keywords:typing-error", (data) => {
      if (data.projectId === currentProjectId.value) {
        typingRunning.value = false;
        running.value = false;
        ElMessage.error(mapErrorMessage(data) || "Ошибка типизации");
      }
    });

    // Clustering progress events
  socket.on("keywords:clustering-started", (data) => {
      if (data.projectId === currentProjectId.value) {
        clusteringRunning.value = true;
        clusteringFinished.value = false;
        clusteringPercent.value = 0;
        running.value = true;
        updateOverallProgress();
      }
    });

  socket.on("keywords:clustering-progress", (data) => {
      if (data.projectId === currentProjectId.value) {
        if (typeof data.percentage !== "undefined") {
          clusteringPercent.value = Math.max(0, Math.min(100, Math.round(data.percentage)));
          updateOverallProgress();
        }
      }
    });

  socket.on("keywords:clustering-finished", (data) => {
      if (data.projectId === currentProjectId.value) {
        clusteringRunning.value = false;
        clusteringFinished.value = true;
        clusteringPercent.value = 100;
        checkBothProcessesFinished();
        // Refresh the current window to ensure cluster_label changes (if any) are visible.
        // Small delay lets the server complete any final writes.
        setTimeout(() => {
          try {
            loadWindow(windowStart.value);
          } catch (e) {
            console.error(
              "Failed to reload window after clustering finished",
              e
            );
          }
        }, 120);
      }
    });

  socket.on("keywords:clustering-error", (data) => {
      if (data.projectId === currentProjectId.value) {
        clusteringRunning.value = false;
        running.value = false;
        ElMessage.error(mapErrorMessage(data) || "Ошибка кластеризации");
      }
    });

  socket.on("keywords:error", (data: ErrorPayload) => {
      // Сбрасываем прогресс при ошибке
      resetAddProgress();

      error.value = mapErrorMessage(data);
      loading.value = false;
    });
  }
  */

  // Инициализация
  // TODO: IPC migration - socket listeners removed
  // setupSocketListeners();

  // Setup IPC event listeners for worker progress
  function setupIpcListeners() {
    console.log('[Keywords Store] Setting up IPC listeners');
    
    // Categorization events
    ipcClient.on('keywords:categorization-progress', (data: any) => {
      console.log('[Keywords Store] Received categorization-progress:', data);
      if (String(data.projectId) === String(currentProjectId.value)) {
        categorizationRunning.value = true;
        
        // Update label and counts based on stage
        if (data.stage === 'embeddings') {
          currentProcessLabel.value = "Собираю эмбендинги";
          currentProcessed.value = data.fetched || 0;
          currentTotal.value = data.total || 0;
        } else if (data.stage === 'categorization') {
          if ((data.processed || 0) === 0) {
            return;
          }
          currentProcessLabel.value = "Присваиваю категорию";
          currentProcessed.value = data.processed || 0;
          currentTotal.value = data.total || 0;
          } else {
            if ((data.processed || 0) === 0) {
             return;
            }
            // Fallback
            currentProcessLabel.value = "Категоризация";
            currentProcessed.value = data.processed || 0;
            currentTotal.value = data.total || 0;
          }

        // Prefer explicit `percent` from workers (fetched/total), fall back to `progress`.
        const raw = typeof data.percent !== 'undefined' ? data.percent : data.progress;
        const val = Number(raw || 0);
        categorizationPercent.value = Math.max(0, Math.min(100, Math.round(val)));
        checkBothProcessesFinished();
      }
    });

    ipcClient.on('keywords:categorization-finished', (data: any) => {
      console.log('[Keywords Store] Received categorization-finished:', data);
      if (String(data.projectId) === String(currentProjectId.value)) {
        categorizationRunning.value = false;
        categorizationFinished.value = true;
        categorizationPercent.value = 100;
        // Clear detailed progress fields so UI can switch to next process or default state
        currentProcessLabel.value = "";
        currentProcessed.value = 0;
        currentTotal.value = 0;
        
        checkBothProcessesFinished();
        // Reload keywords to show updated categories (сохраняем окно и сортировку)
        if (currentProjectId.value) {
          loadKeywords(currentProjectId.value as number, {
            skip: windowStart.value,
            limit: windowSize.value,
            sort: sort.value,
          });
        }
      }
    });

    ipcClient.on('keywords:categorization-error', (data: any) => {
      if (!data || String(data.projectId) !== String(currentProjectId.value)) return;
        categorizationRunning.value = false;
        categorizationFinished.value = true;
        targetCategorization.value = false;
        categorizationPercent.value = 0;
        currentProcessLabel.value = "";
        currentProcessed.value = 0;
        currentTotal.value = 0;
        updateOverallProgress();
        // Log detailed payload to renderer console for diagnostics (status/debug)
        try {
          console.error('[Worker Error] keywords:categorization-error', data, 'status=', data?.status, 'debug=', data?.debug || data?.error || null);
        } catch (e) {}
        ElMessage.error(mapErrorMessage(data));
    });

    ipcClient.on('keywords:categorization-stopped', (data: any) => {
      if (!data || String(data.projectId) !== String(currentProjectId.value)) return;
      categorizationRunning.value = false;
      targetCategorization.value = false;
      categorizationPercent.value = 0;
      currentProcessLabel.value = 'Остановлено';
      currentProcessed.value = 0;
      currentTotal.value = 0;
      updateOverallProgress();
      ElMessage.info('Категоризация остановлена');
    });

    // Typing events
    ipcClient.on('keywords:typing-progress', (data: any) => {
      if (String(data.projectId) === String(currentProjectId.value)) {
        typingRunning.value = true;
        
        // Update label and counts based on stage
        if (data.stage === 'embeddings' || data.stage === 'embeddings-categories') {
          currentProcessLabel.value = "Собираю эмбендинги";
          currentProcessed.value = data.fetched || data.processed || 0;
          currentTotal.value = data.total || 0;
        } else if (data.stage === 'classification') {
          currentProcessLabel.value = "Присваиваю класс";
          currentProcessed.value = data.processed || 0;
          currentTotal.value = data.total || 0;
        } else {
           // Fallback
           currentProcessLabel.value = "Определение класса";
           currentProcessed.value = data.processed || 0;
           currentTotal.value = data.total || 0;
        }

        // Prefer explicit `percent` from workers, fall back to `progress`.
        const raw = typeof data.percent !== 'undefined' ? data.percent : data.progress;
        const val = Number(raw || 0);
        typingPercent.value = Math.max(0, Math.min(100, Math.round(val)));
        checkBothProcessesFinished();
      }
    });

    ipcClient.on('keywords:typing-finished', (data: any) => {
      if (String(data.projectId) === String(currentProjectId.value)) {
        typingRunning.value = false;
        typingFinished.value = true;
        typingPercent.value = 100;
        // Clear detailed progress fields
        currentProcessLabel.value = "";
        currentProcessed.value = 0;
        currentTotal.value = 0;
        
        checkBothProcessesFinished();
        // После завершения типизации перезагрузим текущее окно, чтобы гарантированно увидеть class_name
        if (currentProjectId.value) {
          loadKeywords(currentProjectId.value as number, {
            skip: windowStart.value,
            limit: windowSize.value,
            sort: sort.value,
          });
        }
      }
    });

    ipcClient.on('keywords:typing-error', (data: any) => {
      if (!data || String(data.projectId) !== String(currentProjectId.value)) return;
        typingRunning.value = false;
        typingFinished.value = true;
        targetTyping.value = false;
        typingPercent.value = 0;
        currentProcessLabel.value = "";
        currentProcessed.value = 0;
        currentTotal.value = 0;
        updateOverallProgress();
        try {
          console.error('[Worker Error] keywords:typing-error', data, 'status=', data?.status, 'debug=', data?.debug || data?.error || null);
        } catch (e) {}
        ElMessage.error(mapErrorMessage(data));
    });

    ipcClient.on('keywords:typing-stopped', (data: any) => {
      if (!data || String(data.projectId) !== String(currentProjectId.value)) return;
      typingRunning.value = false;
      targetTyping.value = false;
      typingPercent.value = 0;
      currentProcessLabel.value = 'Остановлено';
      currentProcessed.value = 0;
      currentTotal.value = 0;
      updateOverallProgress();
      ElMessage.info('Определение класса остановлено');
    });

    // Stop-words apply events (worker streams apply-progress)
    ipcClient.on('stopwords:apply-progress', (data: any) => {
      try {
        if (!data || String(data.projectId) !== String(currentProjectId.value)) return;

        // If worker reported an error object, show it
        if (data.type === 'error') {
          stopwordsRunning.value = false;
          stopwordsFinished.value = true;
          targetStopwords.value = false;
          stopwordsPercent.value = 0;
          updateOverallProgress();
          ElMessage.error(mapErrorMessage(data));
          return;
        }

        stopwordsRunning.value = true;
        stopwordsPercent.value = Math.max(0, Math.min(100, Number(data.percent) || 0));

        if (stopwordsPercent.value === 100) {
          stopwordsRunning.value = false;
          stopwordsFinished.value = true;
          // Reload keywords window to reflect updated target_query/blocking_rule
          try {
            if (currentProjectId.value) {
              loadKeywords(currentProjectId.value as number, {
                skip: windowStart.value,
                limit: windowSize.value,
                sort: sort.value,
              });
            }
          } catch (e) {
            console.error('[Keywords Store] Error reloading keywords after stopwords apply', e);
          }
        }

        updateOverallProgress();
      } catch (e) {
        // ignore handler errors
        console.error('[Keywords Store] stopwords:apply-progress handler error', e);
      }
    });

    // Clustering events
    ipcClient.on('keywords:clusters-reset', (data: any) => {
      try {
        if (!data || String(data.projectId) !== String(currentProjectId.value)) return;
        // Wipe previous clustering fields locally to avoid stale UI
        if (Array.isArray(keywords.value)) {
          for (let i = 0; i < keywords.value.length; i++) {
            const k: any = keywords.value[i];
            if (!k) continue;
            // reset only known clustering fields
            if ('cluster' in k) k.cluster = null;
            if ('cluster_label' in k) k.cluster_label = null;
          }
        }
        // Reset visible progress for clarity when a new run starts
        clusteringPercent.value = 0;
        clusteringFinished.value = false;
        updateOverallProgress();
      } catch (e) {
        console.warn('[Keywords Store] Failed to process keywords:clusters-reset', e);
      }
    });
    ipcClient.on('keywords:clustering-progress', (data: any) => {
      if (String(data.projectId) === String(currentProjectId.value)) {
        clusteringRunning.value = true;
        
        // Update label and counts based on stage
        if (data.stage === 'embeddings') {
          currentProcessLabel.value = "Собираю эмбендинги";
          currentProcessed.value = data.fetched || 0;
          currentTotal.value = data.total || 0;
        } else if (data.stage === 'clustering') {
          currentProcessLabel.value = "Кластеризация";
          currentProcessed.value = data.processed || 0;
          currentTotal.value = data.total || 0;
        } else {
           // Fallback
           currentProcessLabel.value = "Кластеризация";
           currentProcessed.value = data.processed || 0;
           currentTotal.value = data.total || 0;
        }

        // Prefer explicit `percent` from workers, fall back to `progress`.
        const raw = typeof data.percent !== 'undefined' ? data.percent : data.progress;
        const val = Number(raw || 0);
        clusteringPercent.value = Math.max(0, Math.min(100, Math.round(val)));
        checkBothProcessesFinished();
      }
    });

    ipcClient.on('keywords:clustering-finished', (data: any) => {
      if (String(data.projectId) === String(currentProjectId.value)) {
        clusteringRunning.value = false;
        clusteringFinished.value = true;
        clusteringPercent.value = 100;
        // Clear detailed progress fields
        currentProcessLabel.value = "";
        currentProcessed.value = 0;
        currentTotal.value = 0;
        
        checkBothProcessesFinished();
        // Перезагружаем окно, чтобы отобразить изменения кластеров
        if (currentProjectId.value) {
          loadKeywords(currentProjectId.value as number, {
            skip: windowStart.value,
            limit: windowSize.value,
            sort: sort.value,
          });
        }
      }
    });

    ipcClient.on('keywords:clustering-error', (data: any) => {
      if (String(data.projectId) === String(currentProjectId.value)) {
        clusteringRunning.value = false;
        clusteringFinished.value = true;
        targetClustering.value = false;
        clusteringPercent.value = 0;
        currentProcessLabel.value = "";
        currentProcessed.value = 0;
        currentTotal.value = 0;
        updateOverallProgress();
        try {
          console.error('[Worker Error] keywords:clustering-error', data, 'status=', data?.status, 'debug=', data?.debug || data?.error || null);
        } catch (e) {}
        ElMessage.error(mapErrorMessage(data) || "Ошибка кластеризации");
      }
    });

    ipcClient.on('keywords:clustering-stopped', (data: any) => {
      if (!data || String(data.projectId) !== String(currentProjectId.value)) return;
      clusteringRunning.value = false;
      targetClustering.value = false;
      clusteringPercent.value = 0;
      currentProcessLabel.value = 'Остановлено';
      currentProcessed.value = 0;
      currentTotal.value = 0;
      updateOverallProgress();
      ElMessage.info('Кластеризация остановлена');
    });

    // Progress events from db-worker for bulk import
    ipcClient.on('keywords:import-progress', (data: any) => {
      try {
        console.log('[Keywords Store] Received import-progress:', data);
        // data may be { type: 'progress', stage, inserted, total, percent }
        if (!data) return;
        if (data.type === 'error') {
          addProgressText.value = mapErrorMessage(data) || 'Ошибка';
          ElMessage.error(mapErrorMessage(data) || 'Ошибка при импорте');
          return;
        }
        // Accept percent even if 0, but only while importing into temp
        if (data.stage === 'import' && typeof data.percent !== 'undefined') {
          addProgress.value = Math.max(0, Math.min(100, Number(data.percent) || 0));
          isAddingWithProgress.value = true;
        }
        if (typeof data.inserted !== 'undefined' && typeof data.total !== 'undefined') {
          addProgressText.value = `${data.inserted} из ${data.total}`;
        }
      } catch (e) {
        console.error('[Keywords Store] Error handling import-progress', e);
      }
    });

    // Единичные обновления строк (категоризация/типизация/кластеризация) — приходят по мере работы воркеров
    ipcClient.on('keywords:updated', (data: any) => {
      try {
        if (!data || String(data.projectId) !== String(currentProjectId.value) || !data.keyword) return;
        const updated: any = data.keyword;
        const idx = keywords.value.findIndex((k) => (k as any).id == updated.id);
        if (idx !== -1) {
          keywords.value[idx] = { ...keywords.value[idx], ...updated } as any;
        }
      } catch (e) {
        console.error('[Keywords Store] Error handling IPC keywords:updated', e);
      }
    });
  }

  // Initialize IPC listeners
  setupIpcListeners();

  async function stopCurrentProcess() {
    if (!currentProjectId.value) return;
    const pid = Number(currentProjectId.value);

    if (categorizationRunning.value) {
      await ipcClient.invoke('keywords:stop-process', pid, 'categorization');
      categorizationRunning.value = false;
    }
    if (typingRunning.value) {
      await ipcClient.invoke('keywords:stop-process', pid, 'typing');
      typingRunning.value = false;
    }
    if (clusteringRunning.value) {
      await ipcClient.invoke('keywords:stop-process', pid, 'clustering');
      clusteringRunning.value = false;
    }
    
    running.value = false;
    currentProcessLabel.value = "Остановлено";
  }

  return {
    // State
    keywords,
    loading,
    loadingMore,
    error,
    currentProjectId,
    totalCount,
    hasMore,
    currentSkip,
    pageSize,
    windowSize,
    bufferSize,
    windowStart,
    visibleStart,
    addProgress,
    addProgressText,
    isAddingWithProgress,
    sort,

    // Getters
    keywordCount,
    isEmpty,
    canLoadMore,
    visibleKeywords,
    searchQuery,

    // Actions
    initializeState,
    setKeywords,
    addKeywords,
    // removeKeyword, // TODO: IPC migration
    clearKeywords, // Stub - shows warning message
    deleteKeyword,
    searchKeywords,
    loadKeywords,
    loadWindow, // Stub for compatibility (all data loaded at once now)
    // loadMoreKeywords, // TODO: IPC migration - not needed
    // saveKeywords, // TODO: IPC migration
    resetAddProgress,
    sortKeywords,
  // Запуски процессов
  startAllProcesses,
  startCategorizationOnly,
  startTypingOnly,
  startStopwordsOnly,
  startClusteringOnly,
  stopCurrentProcess,
    // New actions/flags
    // startCategorization, // TODO: IPC migration
    // Background process flags
    running,
    percentage,
    currentProcessLabel,
    currentProcessed,
    currentTotal,
  };
});
