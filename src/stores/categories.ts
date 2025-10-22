import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { ElMessage } from "element-plus";
import socket from "./socket-client";
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
  function loadCategories(
    projectId: string | number,
    options: LoadCategoriesOptions = {}
  ) {
    if (!projectId) {
      console.error("Project ID is required to load categories");
      return;
    }

    setLoading(true);
    setError(null);
    setCurrentProjectId(projectId);

    const { skip = 0, limit = pageSize.value, sort: sortOptions } = options;

  socket.emit("categories:get", {
      projectId,
      skip,
      limit,
      sort: sortOptions,
    });
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

  // Загрузка окна данных для виртуального скроллинга
  function loadWindow(startIndex: number) {
    console.log("=== loadWindow called for categories ===");
    console.log("startIndex:", startIndex);
    console.log("currentProjectId:", currentProjectId.value);
    console.log("bufferSize:", bufferSize.value);

    if (!currentProjectId.value) {
      console.log("No currentProjectId, skipping loadWindow");
      return;
    }

    loadingMore.value = true;
    const newWindowStart = Math.max(0, startIndex - bufferSize.value);
    windowStart.value = newWindowStart;

    console.log("Set loadingMore to true");
    console.log("Set windowStart to:", newWindowStart);
    console.log(
      "Emitting categories:get with skip:",
      newWindowStart,
      "limit:",
      windowSize.value
    );

    // Добавляем таймаут для сброса loadingMore в случае ошибки
    const timeoutId = setTimeout(() => {
      if (loadingMore.value) {
        console.warn("=== loadWindow timeout - resetting loadingMore ===");
        loadingMore.value = false;
      }
    }, 10000); // 10 секунд таймаут

    socket.emit("categories:get", {
      projectId: currentProjectId.value,
      skip: newWindowStart,
      limit: windowSize.value,
      sort: sort.value,
      timeoutId: Number(timeoutId), // Передаем ID таймаута как number
    });

    // Добавляем логирование для отладки загрузки окна
    console.log("Debug loadWindow:", {
      startIndex,
      newWindowStart,
      windowSize: windowSize.value,
      totalCount: totalCount.value,
    });
  }

  // Добавление категорий
  function addCategories(categoriesText: string) {
    console.log("addCategories called in store with:", categoriesText);

    if (!currentProjectId.value) {
      console.error("No current project ID set");
      ElMessage.error("Проект не выбран");
      return;
    }

    if (!socket.connected) {
      console.error("Socket not connected");
      ElMessage.error("Нет подключения к серверу");
      return;
    }

    resetAddProgress();
    isAddingWithProgress.value = true;

    console.log(
      "Emitting categories:add with projectId:",
      currentProjectId.value
    );

  socket.emit("categories:add", {
      projectId: currentProjectId.value,
      categories: categoriesText,
    });

    // Добавляем таймаут на случай, если сервер не отвечает
    setTimeout(() => {
      if (isAddingWithProgress.value) {
        console.error("Timeout: No response from server for categories:add");
        resetAddProgress();
        ElMessage.error("Превышено время ожидания ответа от сервера");
      }
    }, 30000); // 30 секунд таймаут
  }

  // Очистка категорий
  function clearCategories() {
    if (!currentProjectId.value) {
      console.error("No current project ID set");
      return;
    }

  socket.emit("categories:clear", {
      projectId: currentProjectId.value,
    });
  }

  // Удалить одну категорию по id (переносим emit в стор)
  function deleteCategory(id: number | string) {
    if (!currentProjectId.value) {
      console.error("No current project ID set");
      ElMessage.error("Проект не выбран");
      return;
    }

    if (!id) {
      console.error("No id provided to deleteCategory");
      return;
    }

    if (!socket.connected) {
      console.error("Socket not connected");
      ElMessage.error("Нет подключения к серверу");
      return;
    }

    const payload = { id, projectId: currentProjectId.value };
    console.log("Store: emitting categories:delete with payload:", payload);
  socket.emit("categories:delete", payload);
  }

  // Удалить все категории в текущем проекте
  function deleteAllCategories() {
    if (!currentProjectId.value) {
      console.error("No current project ID set");
      ElMessage.error("Проект не выбран");
      return;
    }

    if (!socket.connected) {
      console.error("Socket not connected");
      ElMessage.error("Нет подключения к серверу");
      return;
    }

    const payload = { projectId: currentProjectId.value };
    console.log("Store: emitting categories:clear with payload:", payload);
    // Server handler listens for 'categories:clear' to remove all categories for a project
  socket.emit("categories:clear", payload);
  }

  // Socket event handlers
  function setupSocketListeners() {
    console.log("Setting up categories socket listeners");
  socket.on("categories:list", (data) => {
      console.log("Received categories:list data:", data);
      if (data.projectId === currentProjectId.value) {
        console.log("Setting categories:", data.categories);
        setCategories(data.categories);
        setTotalCount(data.totalCount);
        setCurrentSkip(data.skip);
        setHasMore(data.hasMore);
        setLoading(false);
        loadingMore.value = false; // Сбрасываем флаг загрузки окна
      }
    });

  socket.on("categories:progress", (data) => {
      if (data.projectId === currentProjectId.value) {
        setAddProgress(
          data.progress,
          `Обработано ${data.processed} из ${data.total}`,
          true
        );
      }
    });

  socket.on("categories:added", (data) => {
      if (data.projectId === currentProjectId.value) {
        resetAddProgress();
        ElMessage.success(`Добавлено ${data.added} категорий`);
        // Перезагрузить список категорий
        loadCategories(data.projectId as string | number);
      }
    });

  socket.on("categories:cleared", (data) => {
      if (data.projectId === currentProjectId.value) {
        setCategories([]);
        setTotalCount(0);
        setCurrentSkip(0);
        setHasMore(false);
      }
    });

  socket.on("categories:error", (data) => {
      setError(data.message);
      setLoading(false);
      resetAddProgress();
      ElMessage.error(data.message || "Ошибка при работе с категориями");
    });
  }

  function removeSocketListeners() {
    socket.off("categories:list");
    socket.off("categories:progress");
    socket.off("categories:added");
    socket.off("categories:cleared");
    socket.off("categories:error");
  }

  // Инициализация
  setupSocketListeners();

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
    setupSocketListeners,
    removeSocketListeners,
    deleteCategory,
    deleteAllCategories,
  };
});
