export async function loadTablePage({
  projectStore,
  projectId,
  sort,
  skip = 0,
  limit = 300,
  db = "urls",
  filters = [],
}) {
  return projectStore.getsortedDb({
    id: projectId,
    sort,
    skip,
    limit,
    db,
    filters,
  });
}

export async function reloadFirstPage({
  projectStore,
  projectId,
  sort,
  db = "urls",
  filters = [],
  limit = 300,
}) {
  return loadTablePage({
    projectStore,
    projectId,
    sort,
    skip: 0,
    limit,
    db,
    filters,
  });
}

export async function loadTablePageAndCount({
  projectStore,
  ipcClient,
  projectId,
  sort,
  skip = 0,
  limit = 300,
  db = "urls",
  filters = [],
}) {
  await loadTablePage({
    projectStore,
    projectId,
    sort,
    skip,
    limit,
    db,
    filters,
  });

  const totalCount = await ipcClient.getUrlsCount(
    Number(projectId),
    String(db || "urls"),
    Array.isArray(filters) ? filters : [],
  );
  return Number.isFinite(Number(totalCount)) ? Number(totalCount) : 0;
}

export async function loadTableCount({
  ipcClient,
  projectId,
  db = "urls",
  filters = [],
}) {
  const totalCount = await ipcClient.getUrlsCount(
    Number(projectId),
    String(db || "urls"),
    Array.isArray(filters) ? filters : [],
  );
  return Number.isFinite(Number(totalCount)) ? Number(totalCount) : 0;
}
