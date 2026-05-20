import { ref, watch, onMounted, onUnmounted } from "vue";

export function useTableRowsCount({
  project,
  effectiveDb,
  activeFiltersForRequest,
  loadCount,
}) {
  const liveRowsCount = ref(0);
  let rowsCountRefreshTimer = null;

  async function refreshRowsCountFromDb() {
    if (!project.data?.id) return;
    try {
      const count = await loadCount({
        projectId: project.data.id,
        db: effectiveDb.value,
        filters: activeFiltersForRequest.value,
      });
      liveRowsCount.value = Number.isFinite(Number(count)) ? Number(count) : 0;
    } catch (_) {}
  }

  function scheduleRowsCountRefresh() {
    if (rowsCountRefreshTimer) {
      clearTimeout(rowsCountRefreshTimer);
      rowsCountRefreshTimer = null;
    }
    rowsCountRefreshTimer = setTimeout(() => {
      refreshRowsCountFromDb();
    }, 450);
  }

  onMounted(() => {
    liveRowsCount.value = Number(project.tableTotalCount || 0);
  });

  watch(
    () => project.tableTotalCount,
    (next) => {
      const parsed = Number(next || 0);
      liveRowsCount.value = Number.isFinite(parsed) ? parsed : 0;
    },
  );

  watch(
    () => [project.tableDataLength, project.isCrawlerRunning, project.isParserRunning, effectiveDb.value],
    ([, crawlerRunning, parserRunning]) => {
      if (crawlerRunning || parserRunning) {
        scheduleRowsCountRefresh();
      }
    },
  );

  onUnmounted(() => {
    if (rowsCountRefreshTimer) {
      clearTimeout(rowsCountRefreshTimer);
      rowsCountRefreshTimer = null;
    }
  });

  return {
    liveRowsCount,
    refreshRowsCountFromDb,
    scheduleRowsCountRefresh,
  };
}
