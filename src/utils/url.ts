import validator from "validator";

export function normalizeUrlCandidate(value: unknown): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (validator.isURL(raw, { require_protocol: true })) return raw;
  const withProtocol = `https://${raw}`;
  if (validator.isURL(withProtocol, { require_protocol: true })) return withProtocol;
  return "";
}

export function isValidUrl(value: unknown): boolean {
  const normalized = normalizeUrlCandidate(value);
  return normalized.length > 0 && validator.isURL(normalized);
}
