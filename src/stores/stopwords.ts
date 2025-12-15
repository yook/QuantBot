import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { ElMessage } from "element-plus";
import ipcClient from "./socket-client";
import type { Stopword } from "../types/schema";

interface LoadStopwordsOptions {
  skip?: number;
  limit?: number;
  sort?: Record<string, number>;
}

export const useStopwordsStore = defineStore("stopwords", () => {
  // State
  const stopwords = ref<Stopword[]>([]);
  const loading = ref<boolean>(false);
  const error = ref<string | null>(null);
  const currentProjectId = ref<string | number | null>(null);
  const totalCount = ref<number>(0);
  const hasMore = ref<boolean>(false);
  const currentSkip = ref<number>(0);
  const pageSize = ref<number>(100);

  // Параметры сортировки
  const sort = ref<Record<string, number>>({}); // Объект сортировки в числовом формате

  // Новые параметры для окна данных
  const windowSize = ref(300); // Размер окна данных (видимые + буфер)
  const bufferSize = ref(50); // Размер буфера сверху и снизу
  const windowStart = ref(0); // Начало окна в общем массиве данных
  const visibleStart = ref(0); // Начало видимой области в окне
  const loadingMore = ref(false); // Флаг загрузки дополнительных данных

  // Прогресс добавления стоп-слов
  const addProgress = ref(0); // Процент выполнения (0-100)
  const addProgressText = ref(""); // Текст прогресса
  const isAddingWithProgress = ref(false); // Флаг показа прогресса

  // Getters
  const stopwordCount = computed(() => stopwords.value?.length || 0);
  const isEmpty = computed(
    () => !stopwords.value || stopwords.value.length === 0
  );

  // Actions
  function initializeState() {
    setStopwords([]);
    loading.value = false;
    error.value = null;
    currentProjectId.value = null;
    totalCount.value = 0;
    hasMore.value = false;
    currentSkip.value = 0;
    sort.value = {};
    addProgress.value = 0;
    addProgressText.value = "";
    isAddingWithProgress.value = false;
    windowStart.value = 0;
    visibleStart.value = 0;
    loadingMore.value = false;
  }

  function setStopwords(newStopwords: any) {
    stopwords.value = Array.isArray(newStopwords) ? newStopwords : [];
  }

  function setLoading(state: boolean) {
    loading.value = state;
  }

  function setError(err: string | null) {
    error.value = err;
  }

  function setCurrentProjectId(id: string | number | null) {
    currentProjectId.value = id;
  }

  function setTotalCount(count: number) {
    totalCount.value = count;
  }

  function setHasMore(more: boolean) {
    hasMore.value = more;
  }

  function setCurrentSkip(skip: number) {
    currentSkip.value = skip;
  }

  function setWindowStart(start: number) {
    windowStart.value = start;
  }

  function setSort(newSort: Record<string, number>) {
    sort.value = newSort;
  }

  function resetAddProgress() {
    addProgress.value = 0;
    addProgressText.value = "";
    isAddingWithProgress.value = false;
  }

  async function loadStopwords(projectId: string | number, options?: LoadStopwordsOptions) {
    if (!options) options = {};
    const skip = options.skip || 0;
    const limit = options.limit || windowSize.value;
    const sortOptions = options.sort || sort.value;

    try {
      loading.value = true;
      const result = await ipcClient.getStopwordsWindow(Number(projectId), skip, limit, sortOptions);
      if (result) {
        setTotalCount(result.total || 0);
        setHasMore((result.data?.length || 0) >= limit);
        setCurrentSkip(skip);
        setWindowStart(skip); // Устанавливаем windowStart
        setStopwords(result.data || []);
      } else {
        setStopwords([]);
        setTotalCount(0);
        setHasMore(false);
      }
      setError(null);
    } catch (err: any) {
      console.error("Error loading stopwords:", err);
      setError(err.message);
      ElMessage.error(`Ошибка загрузки стоп-слов: ${err.message}`);
    } finally {
      loading.value = false;
    }
  }

  async function sortStopwords(newSort: Record<string, number>) {
    setSort(newSort);
    if (!currentProjectId.value) return;
    await loadStopwords(currentProjectId.value, {
      skip: windowStart.value,
      limit: windowSize.value,
      sort: newSort,
    });
  }

  async function loadWindow(newWindowStart: number) {
    if (!currentProjectId.value) return;
    loadingMore.value = true;
    try {
      await loadStopwords(currentProjectId.value, {
        skip: newWindowStart,
        limit: windowSize.value,
        sort: sort.value,
      });
    } finally {
      loadingMore.value = false;
    }
  }

  async function addStopwords(text: string) {
    if (!currentProjectId.value) {
      error.value = "No project selected";
      return;
    }

    loading.value = true;
    error.value = null;

    try {
      // Парсим стоп-слова
      // Сохраняем регулярные выражения в оригинальном виде, простые слова приводим к lower-case
      const regexLike = /^\/(?:\\.|[^\\\/])+\/[gimsuy]*$/;
      let parsedStopwords = text
        .split(/[\,\n]/)
        .map((k) => k.trim())
        .filter((k) => k.length > 0)
        .map((k) => {
          if (regexLike.test(k)) return k; // regex - keep as entered
          return k.toLowerCase();
        });

      if (parsedStopwords.length === 0) {
        ElMessage.warning("Нет стоп-слов для добавления");
        loading.value = false;
        return;
      }

      // Если больше 20000 записей, показываем прогресс
      if (parsedStopwords.length > 20000) {
        isAddingWithProgress.value = true;
        addProgress.value = 0;
      }

      // Вызываем IPC метод для массового добавления
      const result = await ipcClient.importStopwords(
        currentProjectId.value as number,
        parsedStopwords,
        true
      );

      if (result) {
        const { inserted, skipped } = result;
        if (skipped > 0) {
          ElMessage.success(`Добавлено ${inserted} новых стоп-слов (${skipped} дубликатов пропущено)`);
        } else {
          ElMessage.success(`Добавлено ${inserted} стоп-слов`);
        }
        // Перезагружаем текущее окно
        await loadStopwords(currentProjectId.value, {
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
        console.error("Result is null or undefined");
        ElMessage.error("Ошибка при добавлении стоп-слов");
      }
    } catch (err: any) {
      console.error("Error adding stopwords:", err);
      error.value = err.message;
      ElMessage.error(`Ошибка: ${err.message}`);
    } finally {
      loading.value = false;
    }
  }



  async function deleteStopword(id: number | string) {
    if (!currentProjectId.value) {
      console.error("No current project ID set");
      ElMessage.error("Проект не выбран");
      return;
    }

    if (!id) {
      console.error("No id provided to deleteStopword");
      return;
    }

    try {
      console.log("Store: deleting stopword with id:", id);
      const result = await ipcClient.deleteStopword(Number(id));

      if (result !== null) {
        ElMessage.success("Стоп-слово удалено");
        // Перезагружаем текущее окно
        await loadStopwords(currentProjectId.value, {
          skip: windowStart.value,
          limit: windowSize.value,
          sort: sort.value,
        });
      } else {
        ElMessage.error("Ошибка при удалении");
      }
    } catch (err: any) {
      console.error("Error deleting stopword:", err);
      ElMessage.error(`Ошибка: ${err.message}`);
    }
  }

  async function deleteAllStopwords() {
    if (!currentProjectId.value) {
      ElMessage.error("Проект не выбран");
      return;
    }

    try {
      const result = await ipcClient.deleteStopwordsByProject(Number(currentProjectId.value));
      if (result !== null) {
        ElMessage.success("Все стоп-слова удалены");
        // Перезагружаем
        await loadStopwords(currentProjectId.value, {
          skip: 0,
          limit: windowSize.value,
          sort: sort.value,
        });
      } else {
        ElMessage.error("Ошибка при удалении");
      }
    } catch (err: any) {
      console.error("Error deleting all stopwords:", err);
      ElMessage.error(`Ошибка: ${err.message}`);
    }
  }

  return {
    // State
    stopwords,
    loading,
    loadingMore,
    error,
    currentProjectId,
    totalCount,
    hasMore,
    currentSkip,
    pageSize,
    sort,
    windowSize,
    bufferSize,
    windowStart,
    visibleStart,
    addProgress,
    addProgressText,
    isAddingWithProgress,
    // Getters
    stopwordCount,
    isEmpty,
    // Actions
    initializeState,
    setStopwords,
    setLoading,
    setError,
    setCurrentProjectId,
    setTotalCount,
    setHasMore,
    setCurrentSkip,
    setWindowStart,
    setSort,
    resetAddProgress,
    loadStopwords,
    loadWindow,
    sortStopwords,
    addStopwords,
    deleteStopword,
    deleteAllStopwords,
  };
});
