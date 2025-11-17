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

  // Загрузка категорий для проекта
  async function loadCategories(
    projectId: string | number,
    _options: LoadCategoriesOptions = {}
  ) {
    if (!projectId) {
      console.error("Project ID is required to load categories");
      return;
    }

    setLoading(true);
    setError(null);
    setCurrentProjectId(projectId);

    try {
      const data = await ipcClient.getCategoriesAll(Number(projectId));
      setCategories(data || []);
      setTotalCount(data?.length || 0);
      setHasMore(false);
    } catch (err: any) {
      console.error("Error loading categories:", err);
      setError(err.message || "Failed to load categories");
      ElMessage.error(`Ошибка загрузки категорий: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  // Сортировка категорий
  function sortCategories(sortOptions: Record<string, number>) {
    console.log("=== sortCategories called ===");
    console.log("sortOptions:", JSON.stringify(sortOptions, null, 2));
    console.log("currentProjectId:", currentProjectId.value);

    if (!currentProjectId.value) {
      console.warn("No project selected for sorting");
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
    loadCategories(currentProjectId.value as string | number, {
      skip: 0,
      limit: windowSize.value,
      sort: sortOptions,
    });
  }

    // Загрузить окно данных для виртуального скролла
  async function loadWindow(_startIndex: number) {
    // Для категорий загружаем все данные сразу (обычно их немного)
    if (currentProjectId.value) {
      await loadCategories(currentProjectId.value as string | number);
    }
  }

  // Добавление категорий
  async function addCategories(categoriesText: string) {
    console.log("addCategories called in store with:", categoriesText);

    if (!currentProjectId.value) {
      console.error("No current project ID set");
      ElMessage.error("Проект не выбран");
      return;
    }

    resetAddProgress();
    isAddingWithProgress.value = true;

    try {
      // Парсим категории из текста (каждая строка - категория)
  const lines = categoriesText.split('\n').map(line => line.trim()).filter(Boolean);
      
      for (let i = 0; i < lines.length; i++) {
        const category = lines[i];
  // Берём только имя (цвет удалён)
  const name = category.split('|')[0].trim();

  const res = await ipcClient.insertCategory(name, Number(currentProjectId.value));
        if (!res) {
          throw new Error(`Не удалось добавить категорию: ${name}`);
        }

        // Обновляем прогресс только после успешной вставки
        const progress = Math.round(((i + 1) / lines.length) * 100);
        setAddProgress(progress, `Обработано ${i + 1} из ${lines.length}`, true);
      }

      ElMessage.success(`Добавлено ${lines.length} категорий`);
      await loadCategories(currentProjectId.value as string | number);
    } catch (error: any) {
      console.error("Error adding categories:", error);
      ElMessage.error(`Ошибка: ${error?.message || error}`);
    } finally {
      resetAddProgress();
    }
  }

  // Очистка всех категорий проекта
  async function clearCategories() {
    if (!currentProjectId.value) {
      console.error("No current project ID set");
      return;
    }

    try {
      // Удаляем все категории по одной (нет метода deleteByProject для categories)
      const categoriesToDelete = [...categories.value];
      for (const category of categoriesToDelete) {
        if (category.id !== undefined) {
          await ipcClient.deleteCategory(Number(category.id));
        }
      }
      
      setCategories([]);
      setTotalCount(0);
      ElMessage.success("Все категории удалены");
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

    try {
      await ipcClient.deleteCategory(Number(id));
      ElMessage.success("Категория удалена");
      await loadCategories(currentProjectId.value as string | number);
    } catch (error: any) {
      console.error("Error deleting category:", error);
      ElMessage.error(`Ошибка: ${error.message}`);
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
