import { computed } from "vue";

function formatFinishedAtLabel(finishedAt) {
  const dt = new Date(finishedAt);
  const pad = (n) => String(n).padStart(2, "0");
  return `Проверено ${pad(dt.getDate())}.${pad(
    dt.getMonth() + 1,
  )}.${dt.getFullYear()} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

export function useProgressState({
  isRunning,
  percentageSource,
  currentProjectIdSource,
  getFinishedAt,
}) {
  const displayPercentage = computed(() => {
    const value = Number(percentageSource() || 0);
    return Math.max(0, Math.min(100, value));
  });

  const completionText = computed(() => {
    try {
      if (isRunning.value) return "";
      const pid = String(currentProjectIdSource() || "");
      const finishedAt = getFinishedAt(pid);
      if (!finishedAt) return "";
      return formatFinishedAtLabel(finishedAt);
    } catch (_) {
      return "";
    }
  });

  const formatProgressText = (percentage) => {
    if (completionText.value) return "";
    const value = Number(percentage || percentageSource() || 0);
    const normalized = Math.max(0, Math.min(100, Math.round(value)));
    if (!isRunning.value && normalized <= 0) return "";
    return `${normalized}%`;
  };

  return {
    displayPercentage,
    completionText,
    formatProgressText,
  };
}
