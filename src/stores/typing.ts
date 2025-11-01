import { defineStore } from "pinia";
import { ref } from "vue";
import ipcClient from "../stores/socket-client";
import type { Sample, LoadSamplesOptions } from "../types/schema";

export const useTypingStore = defineStore("typing", () => {
  const samples = ref<Sample[]>([]);
  const totalCount = ref(0);
  const loading = ref(false);
  const loadingMore = ref(false);
  const currentProjectId = ref<string | number | null>(null);

  // windowing/pagination params for DataTableFixed
  const windowSize = ref(300);
  const bufferSize = ref(50);
  const windowStart = ref(0);

  function setCurrentProject(projectId: string | number) {
    currentProjectId.value = projectId;
  }

  async function loadSamples(projectId: string | number, _options: LoadSamplesOptions = {}) {
    if (!projectId) return;
    currentProjectId.value = projectId;
    loading.value = true;
    
    try {
      const data = await ipcClient.getTypingAll(Number(projectId));
      samples.value = data || [];
      totalCount.value = data?.length || 0;
    } catch (error) {
      console.error("Error loading typing samples:", error);
    } finally {
      loading.value = false;
      loadingMore.value = false;
    }
  }

  async function addSamples(projectId: string | number, parsedSamples: any[]) {
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
    
    try {
      for (const sample of norm) {
        await ipcClient.insertTyping(
          Number(projectId),
          sample.label,
          sample.text,
          new Date().toISOString()
        );
      }
      await loadSamples(projectId);
    } catch (error) {
      console.error("Error adding typing samples:", error);
    }
  }

  async function clearSamples(projectId: string | number) {
    if (!projectId) return;
    currentProjectId.value = projectId;
    
    try {
      await ipcClient.deleteTypingByProject(Number(projectId));
      await loadSamples(projectId);
    } catch (error) {
      console.error("Error clearing typing samples:", error);
    }
  }

  async function deleteSample(projectId: string | number | undefined, id: string | number) {
    // Allow calling deleteSample(id) when currentProjectId is set in the store
    const pid = projectId || currentProjectId.value;
    if (!pid || !id) return;
    
    try {
      await ipcClient.deleteTyping(Number(id));
      await loadSamples(pid);
    } catch (error) {
      console.error("Error deleting typing sample:", error);
    }
  }

  async function updateSample(projectId: string | number | undefined, id: string | number, fields: any) {
    const pid = projectId || currentProjectId.value;
    if (!pid || !id || !fields || typeof fields !== "object") return;
    
    try {
      await ipcClient.updateTyping(
        fields.url || '',
        fields.sample || '',
        fields.date || new Date().toISOString(),
        Number(id)
      );
      await loadSamples(pid);
    } catch (error) {
      console.error("Error updating typing sample:", error);
    }
  }

  async function loadWindow(startIndex: number) {
    if (!currentProjectId.value) return;
    loadingMore.value = true;
    const newWindowStart = Math.max(0, startIndex - bufferSize.value);
    windowStart.value = newWindowStart;
    
    // For now, load all data (can be optimized later with windowing in db-worker)
    await loadSamples(currentProjectId.value);
  }

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
