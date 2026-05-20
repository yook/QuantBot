import { onMounted, watch, nextTick } from "vue";

export function useFilterPersistence({
  project,
  filtersStorageScope,
  isSelectedProjectDataReady,
  activeFilterTags,
  tableLoading,
  restoreFilterTagsFromStorage,
  persistFilterTagsToStorage,
  syncActiveFiltersToStore,
  getActiveFiltersSignature,
  applyRestoredFilters,
  onAfterApply,
}) {
  let restoredFiltersAppliedKey = "";

  function applyRestoredFiltersOnce() {
    if (!isSelectedProjectDataReady.value || !activeFilterTags.value.length) return;
    if (tableLoading.value) return;
    const key = `${filtersStorageScope.value}:${project.data?.id || ""}:${getActiveFiltersSignature()}`;
    if (restoredFiltersAppliedKey === key) return;
    restoredFiltersAppliedKey = key;
    applyRestoredFilters();
    if (typeof onAfterApply === "function") onAfterApply();
  }

  onMounted(async () => {
    await nextTick();
    restoreFilterTagsFromStorage();
    applyRestoredFiltersOnce();
  });

  watch(
    () => filtersStorageScope.value,
    () => {
      restoredFiltersAppliedKey = "";
      restoreFilterTagsFromStorage();
      applyRestoredFiltersOnce();
    },
  );

  watch(
    () => [project.currentProjectId, project.data?.id, isSelectedProjectDataReady.value],
    async ([currentProjectId, dataId, ready]) => {
      if (!currentProjectId || !dataId || !ready) return;
      restoreFilterTagsFromStorage();
      if (!activeFilterTags.value.length) return;
      await nextTick();
      setTimeout(() => applyRestoredFiltersOnce(), 0);
    },
  );

  watch(
    () => tableLoading.value,
    (loading) => {
      if (loading || !isSelectedProjectDataReady.value || !activeFilterTags.value.length) return;
      applyRestoredFiltersOnce();
    },
  );

  watch(
    () => activeFilterTags.value,
    () => {
      syncActiveFiltersToStore();
      persistFilterTagsToStorage();
    },
    { deep: true },
  );

  return {
    applyRestoredFiltersOnce,
  };
}
