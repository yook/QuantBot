// Categories socket handlers
// Wires client <-> server events for categories using SQLite helpers

const {
  categoriesFindByProject,
  categoriesInsertBatch,
  categoriesClear,
  categoriesDelete,
} = require("./db-sqlite.cjs");

/**
 * Register categories event handlers on a socket connection
 * @param {import('socket.io').Server} io
 * @param {import('socket.io').Socket} socket
 */
module.exports = function registerCategories(io, socket) {
  // List categories with paging/sort
  socket.on("categories:get", async (payload = {}) => {
    try {
      const projectId = payload.projectId;
      const skip = Number(payload.skip || 0);
      const limit = Number(payload.limit || 300);
      const sort = payload.sort || null;
      if (!projectId) return;

      const { categories, total } = await categoriesFindByProject(projectId, {
        skip,
        limit,
        sort,
      });

      socket.emit("categories:list", {
        projectId,
        categories,
        totalCount: total || 0,
        skip,
        hasMore: skip + (categories?.length || 0) < (total || 0),
      });
    } catch (err) {
      console.error("categories:get error:", err);
      socket.emit("categories:error", {
        projectId: payload?.projectId,
        message: err?.message || "Failed to load categories",
      });
    }
  });

  // Add categories (newline-separated string)
  socket.on("categories:add", async (payload = {}) => {
    try {
      const projectId = payload.projectId;
      const raw = (payload.categories || "").toString();
      if (!projectId || !raw.trim()) return;

      const lines = raw
        .split(/\r?\n/) // split by new lines
        .map((s) => s.trim())
        .filter(Boolean);

      if (lines.length === 0) {
        socket.emit("categories:added", { projectId, added: 0 });
        return;
      }

      // Progress callback
      const onProgress = ({ processed, total }) => {
        const progress = total ? Math.round((processed / total) * 100) : 0;
        socket.emit("categories:progress", {
          projectId,
          progress,
          processed,
          total,
        });
      };

      const result = await categoriesInsertBatch(
        projectId,
        lines,
        null,
        onProgress
      );

      // Final event
      socket.emit("categories:added", {
        projectId,
        added: result?.totalAdded || 0,
      });

      // Optionally, send refreshed list (first page)
      const { categories, total } = await categoriesFindByProject(projectId, {
        skip: 0,
        limit: 300,
      });
      socket.emit("categories:list", {
        projectId,
        categories,
        totalCount: total || 0,
        skip: 0,
        hasMore: (categories?.length || 0) < (total || 0),
      });
    } catch (err) {
      console.error("categories:add error:", err);
      socket.emit("categories:error", {
        projectId: payload?.projectId,
        message: err?.message || "Failed to add categories",
      });
    }
  });

  // Clear all categories for a project
  socket.on("categories:clear", async (payload = {}) => {
    try {
      const projectId = payload.projectId;
      if (!projectId) return;
      await categoriesClear(projectId);
      socket.emit("categories:cleared", { projectId });
      // Also push empty list
      socket.emit("categories:list", {
        projectId,
        categories: [],
        totalCount: 0,
        skip: 0,
        hasMore: false,
      });
    } catch (err) {
      console.error("categories:clear error:", err);
      socket.emit("categories:error", {
        projectId: payload?.projectId,
        message: err?.message || "Failed to clear categories",
      });
    }
  });

  // Delete single category by id
  socket.on("categories:delete", async (payload = {}) => {
    try {
      const projectId = payload.projectId;
      const id = payload.id;
      if (!projectId || !id) return;
      await categoriesDelete(id);
      // Refresh list first page to reflect deletion
      const { categories, total } = await categoriesFindByProject(projectId, {
        skip: 0,
        limit: 300,
      });
      socket.emit("categories:list", {
        projectId,
        categories,
        totalCount: total || 0,
        skip: 0,
        hasMore: (categories?.length || 0) < (total || 0),
      });
    } catch (err) {
      console.error("categories:delete error:", err);
      socket.emit("categories:error", {
        projectId: payload?.projectId,
        message: err?.message || "Failed to delete category",
      });
    }
  });

  return {
    // no-op placeholder for potential external calls
  };
};
