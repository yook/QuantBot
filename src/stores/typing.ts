import { defineStore } from "pinia";
import { ref } from "vue";
import socket from "../stores/socket-client";
import type { Sample, LoadSamplesOptions } from "../types/schema";

export const useTypingStore = defineStore("typing", () => {
  const samples = ref<Sample[]>([]);
  const totalCount = ref(0);
  const loading = ref(false);

  function setCurrentProject(projectId: string | number) {
    // no-op for now, kept for parity
    currentProjectId.value = projectId;
  }

  function loadSamples(projectId: string | number, options: LoadSamplesOptions = {}) {
    if (!projectId) return;
    // remember current project for windowed loads / subsequent actions
    currentProjectId.value = projectId;
    loading.value = true;
    const payload: any = { projectId };
    if (options && typeof options === "object") {
      if (typeof options.skip !== "undefined") payload.skip = options.skip;
      if (typeof options.limit !== "undefined") payload.limit = options.limit;
    }
  socket.emit("typing:samples:get", payload);
  }

  function addSamples(projectId: string | number, parsedSamples: any[]) {
    if (!projectId || !Array.isArray(parsedSamples)) return;
    currentProjectId.value = projectId;
    // Normalize each sample: lowercase phrases, deduplicate
    const norm = [];
    for (const s of parsedSamples) {
      if (!s || !s.label || !s.text) continue;
      const label = String(s.label).trim();
      // split text by comma or newline similar to frontend logic
      const parts = String(s.text)
        .split(/[\,\n]+/)
        .map((p: string) => p.trim().toLowerCase())
        .filter(Boolean);
      const unique = Array.from(new Set(parts));
      if (unique.length === 0) continue;
      norm.push({ label, text: unique.join(", ") });
    }
    if (norm.length === 0) return;
  socket.emit("typing:samples:add", { projectId, samples: norm });
  }

  function clearSamples(projectId: string | number) {
    if (!projectId) return;
    currentProjectId.value = projectId;
  socket.emit("typing:samples:clear", { projectId });
  }

  function deleteSample(projectId: string | number | undefined, id: string | number) {
    // Allow calling deleteSample(id) when currentProjectId is set in the store
    const pid = projectId || currentProjectId.value;
    if (!pid || !id) return;
  socket.emit("typing:samples:delete", { projectId: pid, id });
  }

  function updateSample(projectId: string | number | undefined, id: string | number, fields: any) {
    const pid = projectId || currentProjectId.value;
    if (!pid || !id || !fields || typeof fields !== "object") return;
  socket.emit("typing:samples:update", { projectId: pid, id, fields });
  }
  const loadingMore = ref(false);
  const currentProjectId = ref<string | number | null>(null);

  // windowing/pagination params for DataTableFixed
  const windowSize = ref(300);
  const bufferSize = ref(50);
  const windowStart = ref(0);

  // Socket listeners
  socket.on("typing:samples:list", (data) => {
    samples.value = data.samples || [];
    totalCount.value = data.total || (data.samples && data.samples.length) || 0;
    loading.value = false;
    loadingMore.value = false;
  });

  socket.on("typing:samples:added", (data) => {
    // reload samples for simplicity
    if (data && data.projectId) loadSamples(data.projectId);
  });

  socket.on("typing:samples:updated", (data) => {
    // reload samples for simplicity
    if (data && data.projectId) loadSamples(data.projectId);
  });

  function loadWindow(startIndex: number) {
    if (!currentProjectId.value) return;
    loadingMore.value = true;
    const newWindowStart = Math.max(0, startIndex - bufferSize.value);
    windowStart.value = newWindowStart;
  socket.emit("typing:samples:get", {
      projectId: currentProjectId.value,
      skip: newWindowStart,
      limit: windowSize.value,
    });
  }

  socket.on("typing:samples:deleted", (data) => {
    if (data && data.projectId) loadSamples(data.projectId);
  });

  socket.on("typing:samples:cleared", (data) => {
    if (data && data.projectId) loadSamples(data.projectId);
  });

  socket.on("typing:error", (data) => {
    console.error("Typing socket error:", data);
    loading.value = false;
  });

  return {
    samples,
    totalCount,
    loading,
    setCurrentProject,
    // expose windowing and manipulation helpers
    loadSamples,
    loadWindow,
    addSamples,
    updateSample,
    clearSamples,
    deleteSample,
    loadingMore,
    currentProjectId,
    windowSize,
    windowStart,
    bufferSize,
  };
});
