import { defineStore } from "pinia";
import { ref } from "vue";
import { ElMessage } from "element-plus";
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
    if (!projectId || !Array.isArray(parsedSamples)) return false;
    currentProjectId.value = projectId;
    
    // Normalize input and build counts for duplicates
    const countsMap = new Map<string, { label: string; text: string; count: number }>();
    const uniqueKeys: string[] = [];
    for (const s of parsedSamples) {
      if (!s || !s.label || !s.text) continue;
      const label = String(s.label).trim();
      const parts = String(s.text)
        .split(/[\,\n]+/)
        .map((p: string) => p.trim())
        .filter(Boolean);
      for (const part of parts) {
        const key = `${label}||${part.toLowerCase()}`; // case-insensitive on text
        if (!countsMap.has(key)) {
          countsMap.set(key, { label, text: part, count: 1 });
          uniqueKeys.push(key);
        } else {
          const v = countsMap.get(key)!;
          v.count = v.count + 1;
          countsMap.set(key, v);
        }
      }
    }

    if (uniqueKeys.length === 0) return false;

    try {
      // Fetch existing samples to avoid inserting duplicates
      const existing = await ipcClient.getTypingAll(Number(projectId));
      const existingSet = new Set((existing || []).map((r: any) => `${String(r.label || '').trim()}||${String(r.text || '').trim().toLowerCase()}`));

      let added = 0;
      let skippedExisting = 0;
      let skippedDuplicatesInInput = 0;
      let skippedError = 0;

      for (let i = 0; i < uniqueKeys.length; i++) {
        const key = uniqueKeys[i];
        const entry = countsMap.get(key)!;

        if (existingSet.has(key)) {
          skippedExisting += entry.count;
        } else {
          try {
            const res = await ipcClient.insertTyping(
              Number(projectId),
              entry.label,
              entry.text,
              new Date().toISOString()
            );
            if (res) {
              added++;
              if (entry.count > 1) skippedDuplicatesInInput += (entry.count - 1);
            } else {
              skippedError += entry.count;
            }
          } catch (e) {
            skippedError += entry.count;
            console.warn('insertTyping failed for', entry, e);
          }
        }

        // optional: update progress (relative to unique keys)
        // const progress = Math.round(((i + 1) / uniqueKeys.length) * 100);
        // could expose progress to UI if desired
      }

      const skippedTotal = skippedExisting + skippedDuplicatesInInput + skippedError;
      ElMessage.success(`Добавлено ${added} новых образцов, пропущено ${skippedTotal} (включая дубликаты)`);
      await loadSamples(projectId);
      return true;
    } catch (error) {
      console.error("Error adding typing samples:", error);
      return false;
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
