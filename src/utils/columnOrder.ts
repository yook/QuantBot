// Utility to persist column order both to project data and to localStorage
export function saveColumnOrder(project: any, dbKey: string, order: string[]) {
    try {
      if (!project || !project.data) return;
      if (!Array.isArray(order)) return;

      if (!project.data.columns) project.data.columns = {};
      project.data.columns[dbKey] = order;

      try {
        // Persist to DB via store
        if (typeof project.updateProject === 'function') {
          project.updateProject();
        }
      } catch (e) {
        // ignore update errors
      }

      try {
        const pid = project.data && project.data.id ? project.data.id : 'anon';
        const storageKey = `table-columns-${pid}-${dbKey}`;
        localStorage.setItem(storageKey, JSON.stringify(order));
      } catch (e) {
        // ignore storage errors
      }
    } catch (e) {
      // ignore overall errors
    }
}

export default saveColumnOrder;
