export type PlanType = "free" | "pro";

function readPlanFromEnv(): PlanType {
  const raw = String((import.meta as any)?.env?.VITE_APP_PLAN || "")
    .trim()
    .toLowerCase();
  return raw === "pro" ? "pro" : "free";
}

export const ACTIVE_PLAN: PlanType = readPlanFromEnv();

export const FREE_PLAN_LIMITS = {
  projects: 3,
  urlsPerProject: 1000,
  defaultMaxUrls: 1000,
  exportRows: 1000,
  crawlerConcurrency: 1,
  defaultCrawlerConcurrency: 1,
  minCrawlerIntervalMs: 1000,
  defaultCrawlerIntervalMs: 1000,
  renderingEnabled: false,
} as const;

export function isFreePlan(): boolean {
  return ACTIVE_PLAN === "free";
}

