function pad2(value) {
  return String(value).padStart(2, "0");
}

function parseYmdHmsLocal(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(
    value,
  );
  if (!match) return null;
  const [, year, month, day, hours, minutes, seconds] = match;
  return new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hours),
    Number(minutes),
    Number(seconds),
  );
}

export function parseDateTime(value) {
  if (value === null || typeof value === "undefined" || value === "") {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "number") {
    const fromNumber = new Date(value);
    return Number.isNaN(fromNumber.getTime()) ? null : fromNumber;
  }
  if (typeof value === "string") {
    const normalized = value.trim();
    if (!normalized) return null;
    const localDate = parseYmdHmsLocal(normalized);
    if (localDate && !Number.isNaN(localDate.getTime())) return localDate;
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

export function formatDateTime(value) {
  const date = parseDateTime(value);
  if (!date) return "";
  return [
    date.getFullYear(),
    pad2(date.getMonth() + 1),
    pad2(date.getDate()),
  ].join("-")
    .concat(" ")
    .concat(
      [pad2(date.getHours()), pad2(date.getMinutes()), pad2(date.getSeconds())]
        .join(":"),
    );
}
