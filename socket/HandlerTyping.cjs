const {
  typingSamplesFindByProject,
  typingSamplesInsertBatch,
  typingSamplesClear,
  typingSamplesDelete,
  typingSamplesUpdate,
  clearEmbeddingsCache,
  getEmbeddingsCacheSize,
} = require("./db-sqlite.cjs");
// embeddings are computed via a separate Train action

const registerTyping = (io, socket) => {
  console.log("Registering typing handlers for socket:", socket.id);

  socket.on("typing:samples:get", async (data) => {
    try {
      const projectId = data.projectId;
      if (!projectId) {
        socket.emit("typing:error", { message: "projectId is required" });
        return;
      }
      const res = await typingSamplesFindByProject(projectId, {
        skip: data.skip || 0,
        limit: data.limit || 500,
      });
      socket.emit("typing:samples:list", {
        projectId,
        samples: res.samples,
        total: res.total,
      });
    } catch (err) {
      console.error("typing:samples:get error:", err);
      socket.emit("typing:error", { message: "Failed to load samples" });
    }
  });

  socket.on("typing:samples:add", async (data) => {
    try {
      const { projectId, samples } = data;
      if (!projectId || !Array.isArray(samples)) {
        socket.emit("typing:error", {
          message: "projectId and samples are required",
        });
        return;
      }
      // Server-side validation: limit batch size and text length
      const MAX_BATCH = 500; // reasonable upper bound for insertion
      const MAX_TEXT_CHARS = 20000; // allow larger text here; training step will validate tokens
      if (samples.length > MAX_BATCH) {
        socket.emit("typing:error", {
          message: `Too many samples in one batch (max ${MAX_BATCH})`,
        });
        return;
      }

      for (const s of samples) {
        const t = s && s.text ? String(s.text) : "";
        if (!t || t.length === 0) {
          socket.emit("typing:error", {
            message: "Empty text in samples is not allowed",
          });
          return;
        }
        if (t.length > MAX_TEXT_CHARS) {
          socket.emit("typing:error", {
            message: `Sample text too long (max ${MAX_TEXT_CHARS} chars)`,
          });
          return;
        }
      }

      // Defensive normalization already occurs in db-sqlite.js (lowercase + dedup per sample)
      const res = await typingSamplesInsertBatch(projectId, samples);
      // Emit added event and also send refreshed list so client updates immediately
      socket.emit("typing:samples:added", { projectId, added: res.added });
      try {
        const res2 = await typingSamplesFindByProject(projectId, {
          skip: 0,
          limit: 200,
        });
        socket.emit("typing:samples:list", {
          projectId,
          samples: res2.samples,
          total: res2.total,
        });
      } catch (e) {
        // nothing
      }
    } catch (err) {
      console.error("typing:samples:add error:", err);
      socket.emit("typing:error", { message: "Failed to add samples" });
    }
  });

  socket.on("typing:samples:delete", async (data) => {
    try {
      const { id, projectId } = data || {};
      if (!id || !projectId) {
        socket.emit("typing:error", {
          message: "id and projectId are required",
        });
        return;
      }
      console.log(
        `typing:samples:delete received id=${id} projectId=${projectId}`
      );
      const ok = await typingSamplesDelete(id);
      if (!ok) {
        console.warn(`typing:samples:delete failed for id=${id}`);
        socket.emit("typing:error", { message: "Failed to delete sample" });
        return;
      }
      // After successful deletion, return refreshed list for the project so client UI updates
      try {
        const res = await typingSamplesFindByProject(projectId, {
          skip: 0,
          limit: 200,
        });
        socket.emit("typing:samples:list", {
          projectId,
          samples: res.samples,
          total: res.total,
        });
      } catch (e) {
        // Fallback to emit deleted event
        socket.emit("typing:samples:deleted", { projectId, id });
      }
    } catch (err) {
      console.error("typing:samples:delete error:", err);
      socket.emit("typing:error", { message: "Failed to delete sample" });
    }
  });

  socket.on("typing:samples:update", async (data) => {
    try {
      const { id, projectId, fields } = data || {};
      if (!id || !projectId) {
        socket.emit("typing:error", {
          message: "id and projectId are required",
        });
        return;
      }
      // fields.text will be normalized (lowercase + dedup) in db-sqlite.js
      const ok = await typingSamplesUpdate(id, fields);
      if (!ok) {
        socket.emit("typing:error", { message: "Failed to update sample" });
        socket.emit("typing:samples:updated", {
          projectId,
          id,
          ok: false,
          message: "Failed to update sample",
        });
        return;
      }
      // Acknowledge update for the specific id
      socket.emit("typing:samples:updated", { projectId, id, ok: true });

      // Return refreshed list for the project
      try {
        const res = await typingSamplesFindByProject(projectId, {
          skip: 0,
          limit: 200,
        });
        socket.emit("typing:samples:list", {
          projectId,
          samples: res.samples,
          total: res.total,
        });
      } catch (e) {
        // already emitted ack above
      }
    } catch (err) {
      console.error("typing:samples:update error:", err);
      socket.emit("typing:error", { message: "Failed to update sample" });
    }
  });

  socket.on("typing:samples:clear", async (data) => {
    try {
      const { projectId } = data;
      if (!projectId) {
        socket.emit("typing:error", { message: "projectId is required" });
        return;
      }
      const ok = await typingSamplesClear(projectId);
      if (ok) socket.emit("typing:samples:cleared", { projectId });
      else socket.emit("typing:error", { message: "Failed to clear samples" });
    } catch (err) {
      console.error("typing:samples:clear error:", err);
      socket.emit("typing:error", { message: "Failed to clear samples" });
    }
  });

  socket.on("clear-embeddings-cache", async () => {
    try {
      const ok = await clearEmbeddingsCache();
      if (ok) socket.emit("embeddings-cache-cleared");
      else
        socket.emit("typing:error", {
          message: "Failed to clear embeddings cache",
        });
    } catch (err) {
      console.error("clear-embeddings-cache error:", err);
      socket.emit("typing:error", {
        message: "Failed to clear embeddings cache",
      });
    }
  });

  socket.on("get-embeddings-cache-size", async () => {
    try {
      const size = await getEmbeddingsCacheSize();
      socket.emit("embeddings-cache-size", { size });
    } catch (err) {
      console.error("get-embeddings-cache-size error:", err);
      socket.emit("typing:error", {
        message: "Failed to get embeddings cache size",
      });
    }
  });
};

module.exports = registerTyping;
