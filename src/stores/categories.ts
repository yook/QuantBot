import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { ElMessage } from "element-plus";
import ipcClient from "./socket-client";
import type { Category } from "../types/schema";

interface LoadCategoriesOptions {
  skip?: number;
  limit?: number;
  sort?: Record<string, number>;
}

export const useCategoriesStore = defineStore("categories", () => {
  // State
  const categories = ref<Category[]>([]);
  const loading = ref<boolean>(false);
  const error = ref<string | null>(null);
  const currentProjectId = ref<string | number | null>(null);
  const totalCount = ref<number>(0);
  const hasMore = ref<boolean>(false);
  const currentSkip = ref<number>(0);
  const pageSize = ref<number>(100);

  // Параметры сортировки
  // Используем единый числовой формат: { columnName: 1 } где 1 = ASC, -1 = DESC
  const sort = ref<Record<string, number>>({}); // Объект сортировки в числовом формате

  // Новые параметры для окна данных
  const windowSize = ref(300); // Размер окна данных (видимые + буфер)
  const bufferSize = ref(50); // Размер буфера сверху и снизу
  const windowStart = ref(0); // Начало окна в общем массиве данных
  const visibleStart = ref(0); // Начало видимой области в окне
  const loadingMore = ref(false); // Флаг загрузки дополнительных данных

  // Прогресс добавления категорий
  const addProgress = ref(0); // Процент выполнения (0-100)
  const addProgressText = ref(""); // Текст прогресса
  const isAddingWithProgress = ref(false); // Флаг показа прогресса

  // Getters
  const categoryCount = computed(() => categories.value?.length || 0);
  const isEmpty = computed(
    () => !categories.value || categories.value.length === 0
  );

  // Actions
  function initializeState() {
    // Гарантируем начальное состояние
    setCategories([]);
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

  function setCategories(newCategories: any) {
    categories.value = Array.isArray(newCategories) ? newCategories : [];
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

  function setAddProgress(
    progress: number,
    text: string = "",
    showProgress: boolean = false
  ) {
    addProgress.value = progress;
    addProgressText.value = text;
    isAddingWithProgress.value = showProgress;
  }

  async function loadCategories(projectId: string | number, options?: LoadCategoriesOptions) {
    if (!options) options = {};
    const skip = options.skip || 0;
    const limit = options.limit || windowSize.value;
    const sortOptions = options.sort || sort.value;

    try {
      loading.value = true;
      const result = await ipcClient.getCategoriesWindow(Number(projectId), skip, limit, sortOptions);
      if (result) {
        setTotalCount(result.total || 0);
        setHasMore((result.data?.length || 0) >= limit);
        setCurrentSkip(skip);
        setWindowStart(skip); // Устанавливаем windowStart
        setCategories(result.data || []);
      } else {
        setCategories([]);
        setTotalCount(0);
        setHasMore(false);
      }
      setError(null);
    } catch (err: any) {
      console.error("Error loading categories:", err);
      setError(err.message);
      ElMessage.error(`Ошибка загрузки категорий: ${err.message}`);
    } finally {
      loading.value = false;
    }
  }

  async function sortCategories(options: Record<string, number>) {
    setSort(options);
    if (!currentProjectId.value) return;
    await loadCategories(currentProjectId.value, {
      skip: windowStart.value,
      limit: windowSize.value,
      sort: options,
    });
  }

  async function loadWindow(newWindowStart: number) {
    if (!currentProjectId.value) return;
    loadingMore.value = true;
    try {
      await loadCategories(currentProjectId.value, {
        skip: newWindowStart,
        limit: windowSize.value,
        sort: sort.value,
      });
    } finally {
      loadingMore.value = false;
    }
  }

  // Добавление категорий
  async function addCategories(categoriesText: string) {
    if (!currentProjectId.value) {
      error.value = "No project selected";
      return;
    }

    loading.value = true;
    error.value = null;

    try {
      // Парсим категории
      let parsedCategories = categoriesText
        .split(/[\,\n]/)
        .map((k) => k.trim())
        .filter((k) => k.length > 0);

      if (parsedCategories.length === 0) {
        ElMessage.warning("Нет категорий для добавления");
        loading.value = false;
        return;
      }

      // Если больше 20000 записей, показываем прогресс
      if (parsedCategories.length > 20000) {
        isAddingWithProgress.value = true;
        addProgress.value = 0;
      }

      // Вызываем IPC метод для массового добавления
      const result = await ipcClient.insertCategoriesBulk(
        parsedCategories,
        currentProjectId.value as number
      );

      if (result) {
        const { inserted, skipped } = result;
        if (skipped > 0) {
          ElMessage.success(`Добавлено ${inserted} новых категорий (${skipped} дубликатов пропущено)`);
        } else {
          ElMessage.success(`Добавлено ${inserted} категорий`);
        }
        // Перезагружаем текущее окно
        await loadCategories(currentProjectId.value, {
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
        ElMessage.error("Ошибка при добавлении категорий");
      }
    } catch (err: any) {
      console.error("Error adding categories:", err);
      error.value = err.message;
      ElMessage.error(`Ошибка: ${err.message}`);
    } finally {
      loading.value = false;
    }
  }

  // Очистка всех категорий проекта
  async function clearCategories() {
    if (!currentProjectId.value) {
      console.error("No current project ID set");
      return;
    }

    try {
      const result = await ipcClient.deleteCategoriesByProject(Number(currentProjectId.value));
      if (result !== null) {
        ElMessage.success("Все категории удалены");
        // Перезагружаем
        await loadCategories(currentProjectId.value, {
          skip: 0,
          limit: windowSize.value,
          sort: sort.value,
        });
      } else {
        ElMessage.error("Ошибка при удалении");
      }
    } catch (error: any) {
      console.error("Error clearing categories:", error);
      ElMessage.error(`Ошибка: ${error.message}`);
    }
  }

  // Удалить одну категорию по id
  async function deleteCategory(id: number | string) {
    if (!currentProjectId.value) {
      console.error("No current project ID set");
      ElMessage.error("Проект не выбран");
      return;
    }

    if (!id) {
      console.error("No id provided to deleteCategory");
      return;
    }

    // Enqueue delete requests to avoid flooding the main process with
    // concurrent synchronous DB operations which can block the app.
    deleteQueue.value.push(Number(id));
    // Start processing if not already running
    if (!deleteProcessing.value) {
      processDeleteQueue();
    }
  }

  // Internal queue for serializing delete requests
  const deleteQueue = ref<number[]>([]);
  const deleteProcessing = ref(false);

  async function processDeleteQueue() {
    if (deleteProcessing.value) return;
    deleteProcessing.value = true;
    loading.value = true;
    try {
      while (deleteQueue.value.length > 0) {
        const id = deleteQueue.value.shift() as number;
        try {
          await ipcClient.deleteCategory(id);
          ElMessage.success(`Категория ${id} удалена`);
        } catch (err: any) {
          console.error("Error deleting category (queued):", err);
          ElMessage.error(`Ошибка при удалении категории ${id}: ${err?.message || String(err)}`);
        }

        // После каждой операции обновляем окно категорий, чтобы UI оставался консистентным
        try {
          await loadCategories(currentProjectId.value as number, {
            skip: windowStart.value,
            limit: windowSize.value,
            sort: sort.value,
          });
        } catch (e) {
          console.warn('Failed to reload categories after delete', e);
        }

        // Small delay to yield to the event loop and avoid tight CPU loop
        await new Promise((res) => setTimeout(res, 50));
      }
    } finally {
      deleteProcessing.value = false;
      loading.value = false;
    }
  }

  // Удалить все категории в текущем проекте
  async function deleteAllCategories() {
    await clearCategories();
  }

  return {
    // State
    categories,
    loading,
    error,
    currentProjectId,
    totalCount,
    hasMore,
    currentSkip,
    pageSize,
    sort,
    addProgress,
    addProgressText,
    isAddingWithProgress,
    windowSize,
    bufferSize,
    windowStart,
    visibleStart,
    loadingMore,

    // Getters
    categoryCount,
    isEmpty,

    // Actions
    initializeState,
    setCategories,
    setLoading,
    setError,
    setCurrentProjectId,
    setTotalCount,
    setHasMore,
    setCurrentSkip,
    setWindowStart,
    setSort,
    resetAddProgress,
    setAddProgress,
    loadCategories,
    sortCategories,
    loadWindow,
    addCategories,
    clearCategories,
    deleteCategory,
    deleteAllCategories,
  };
});
