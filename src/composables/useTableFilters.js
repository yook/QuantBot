import { computed, ref } from "vue";
import { normalizeFilterRequestValue } from "../stores/table-filters-service";

export function useTableFilters({
  project,
  tableProfile,
  storageKey = "crawler.activeFilters",
}) {
  const activeFilterTags = ref([]);
  const filterDraft = ref({
    field: "",
    operator: "",
    value: "",
    secondValue: "",
  });
  let filterTagSeq = 0;

  const filtersStorageScope = computed(() => {
    const projectId = String(project.currentProjectId || "");
    const profile = String(tableProfile.value || "urls");
    return `${storageKey}:${projectId}:${profile}`;
  });

  const activeFiltersForRequest = computed(() =>
    (activeFilterTags.value || []).map((item) => ({
      field: String(item.field || ""),
      operator: String(item.operator || ""),
      value: normalizeFilterRequestValue(item.field, item.value),
      secondValue: normalizeFilterRequestValue(item.field, item.secondValue),
      label: String(item.label || ""),
    })),
  );

  function resetFilterDraft() {
    filterDraft.value.field = "";
    filterDraft.value.operator = "";
    filterDraft.value.value = "";
    filterDraft.value.secondValue = "";
  }

  function syncActiveFiltersToStore() {
    project.currentTableFilters = activeFiltersForRequest.value;
  }

  function getActiveFiltersSignature() {
    try {
      return JSON.stringify(activeFiltersForRequest.value || []);
    } catch (_) {
      return String(activeFilterTags.value?.length || 0);
    }
  }

  function pushFilterTag(tag) {
    const label = String(tag?.label || "");
    if (!label) return false;
    const exists = activeFilterTags.value.some((item) => item.label === label);
    if (exists) return false;
    filterTagSeq += 1;
    activeFilterTags.value.push({
      id: `f-${filterTagSeq}`,
      field: String(tag.field || ""),
      operator: String(tag.operator || ""),
      value: String(tag.value || ""),
      secondValue: String(tag.secondValue || ""),
      label,
    });
    return true;
  }

  function removeFilterTag(tagId) {
    const index = activeFilterTags.value.findIndex(
      (tag) => String(tag.id) === String(tagId),
    );
    if (index >= 0) {
      activeFilterTags.value.splice(index, 1);
      return true;
    }
    return false;
  }

  function restoreFilterTagsFromStorage() {
    try {
      if (!project.currentProjectId) {
        activeFilterTags.value = [];
        syncActiveFiltersToStore();
        return;
      }
      const raw = localStorage.getItem(filtersStorageScope.value);
      if (!raw) {
        activeFilterTags.value = [];
        syncActiveFiltersToStore();
        return;
      }
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        activeFilterTags.value = [];
        syncActiveFiltersToStore();
        return;
      }
      const normalized = parsed
        .filter((item) => item && typeof item === "object")
        .map((item, idx) => ({
          id: item.id ? String(item.id) : `f-${idx + 1}`,
          field: String(item.field || ""),
          operator: String(item.operator || ""),
          value: String(item.value || ""),
          secondValue: String(item.secondValue || ""),
          label: String(item.label || ""),
        }))
        .filter((item) => item.field && item.operator && item.label);
      activeFilterTags.value = normalized;
      filterTagSeq = normalized.length;
      syncActiveFiltersToStore();
    } catch (_) {
      activeFilterTags.value = [];
      syncActiveFiltersToStore();
    }
  }

  function persistFilterTagsToStorage() {
    try {
      if (!project.currentProjectId) return;
      localStorage.setItem(
        filtersStorageScope.value,
        JSON.stringify(activeFilterTags.value || []),
      );
    } catch (_) {}
  }

  return {
    activeFilterTags,
    filterDraft,
    filtersStorageScope,
    activeFiltersForRequest,
    resetFilterDraft,
    syncActiveFiltersToStore,
    getActiveFiltersSignature,
    pushFilterTag,
    removeFilterTag,
    restoreFilterTagsFromStorage,
    persistFilterTagsToStorage,
  };
}
