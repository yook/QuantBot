export const NUMERIC_FIELD_PROPS = new Set([
  "id",
  "depth",
  "code",
  "actualDataSize",
  "requestTime",
  "requestLatency",
  "downloadTime",
]);

export const ENUM_FIELD_PROPS = new Set([
  "status",
  "type",
  "protocol",
  "error_type",
  "contentType",
]);

export const NUMBER_OPERATORS = [
  { value: "eq", label: "Равно" },
  { value: "neq", label: "Не равно" },
  { value: "gt", label: "Больше" },
  { value: "gte", label: "Больше или равно" },
  { value: "lt", label: "Меньше" },
  { value: "lte", label: "Меньше или равно" },
  { value: "between", label: "Диапазон" },
];

export const TEXT_OPERATORS = [
  { value: "contains", label: "Содержит" },
  { value: "eq", label: "Равно" },
  { value: "neq", label: "Не равно" },
  { value: "startsWith", label: "Начинается с" },
  { value: "endsWith", label: "Заканчивается на" },
];

export function normalizeFilterRequestValue(field, value) {
  if (!NUMERIC_FIELD_PROPS.has(String(field || ""))) return value ?? "";
  const normalized = Number(String(value ?? "").trim().replace(",", "."));
  return Number.isFinite(normalized) ? normalized : "";
}

export function getFieldMeta(field) {
  const normalizedField = String(field || "");
  if (ENUM_FIELD_PROPS.has(normalizedField)) return { kind: "enum", inputType: "enum" };
  if (NUMERIC_FIELD_PROPS.has(normalizedField)) return { kind: "number", inputType: "number" };
  return { kind: "text", inputType: "text" };
}

export function getOperatorsForFieldMeta(fieldMeta) {
  return fieldMeta?.kind === "number" ? NUMBER_OPERATORS : TEXT_OPERATORS;
}

export function buildFilterTagLabel(draft, getFieldNameByProp, getOperatorLabel) {
  const fieldName = getFieldNameByProp(draft.field);
  const operatorName = getOperatorLabel(draft.operator);
  if (draft.operator === "between") {
    return `${fieldName} ${operatorName} ${draft.value} - ${draft.secondValue}`;
  }
  return `${fieldName} ${operatorName} ${draft.value}`;
}
