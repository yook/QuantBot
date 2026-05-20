import { FREE_PLAN_LIMITS, isFreePlan } from "../config/plan-limits";

export function clampCrawlerConfigForPlan(input: any) {
  const crawler = input && typeof input === "object" ? { ...input } : {};
  if (!isFreePlan()) return crawler;

  const maxUrls = Number(crawler.maxUrls);
  if (!Number.isFinite(maxUrls) || maxUrls <= 0 || maxUrls > FREE_PLAN_LIMITS.urlsPerProject) {
    crawler.maxUrls = FREE_PLAN_LIMITS.defaultMaxUrls;
  } else {
    crawler.maxUrls = Math.floor(maxUrls);
  }

  const maxConcurrency = Number(crawler.maxConcurrency);
  if (!Number.isFinite(maxConcurrency) || maxConcurrency <= 0 || maxConcurrency > FREE_PLAN_LIMITS.crawlerConcurrency) {
    crawler.maxConcurrency = FREE_PLAN_LIMITS.defaultCrawlerConcurrency;
  } else {
    crawler.maxConcurrency = Math.floor(maxConcurrency);
  }

  const interval = Number(crawler.interval);
  if (!Number.isFinite(interval) || interval < FREE_PLAN_LIMITS.minCrawlerIntervalMs) {
    crawler.interval = FREE_PLAN_LIMITS.defaultCrawlerIntervalMs;
  } else {
    crawler.interval = Math.floor(interval);
  }

  crawler.renderEnabled = false;
  return crawler;
}

