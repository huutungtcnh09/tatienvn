const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("vi-VN");
const DATE_ONLY_FORMATTER = new Intl.DateTimeFormat("vi-VN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

function parseDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDateTimeVN(value, fallback = "-") {
  const date = parseDate(value);
  return date ? DATE_TIME_FORMATTER.format(date) : fallback;
}

export function formatDateVN(value, fallback = "-") {
  const date = parseDate(value);
  return date ? DATE_ONLY_FORMATTER.format(date) : fallback;
}
