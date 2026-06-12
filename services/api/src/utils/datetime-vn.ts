export const VN_UTC_OFFSET_HOURS = 7;
const VN_UTC_OFFSET_MS = VN_UTC_OFFSET_HOURS * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const YMD_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export type VietnamDateRange = { dateFrom: Date; dateTo: Date };
export type VietnamPreset = "today" | "this-week" | "this-month" | "this-quarter" | "this-year" | "last-year";
export type VietnamTimePeriod = "this-year" | "last-year" | "this-month" | "this-quarter";

function createUtcFromVietnam(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  millisecond = 0
) {
  return new Date(Date.UTC(year, month - 1, day, hour - VN_UTC_OFFSET_HOURS, minute, second, millisecond));
}

export function parseVietnamYmd(value: string) {
  const match = YMD_PATTERN.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;

  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    return null;
  }

  return { year, month, day };
}

export function toUtcRangeForVietnamDate(value: string): { start: Date; end: Date } | null {
  const parsed = parseVietnamYmd(value);
  if (!parsed) return null;

  const { year, month, day } = parsed;
  const start = createUtcFromVietnam(year, month, day, 0, 0, 0, 0);
  const end = createUtcFromVietnam(year, month, day, 23, 59, 59, 999);
  return { start, end };
}

function getVietnamNow(now = new Date()) {
  return new Date(now.getTime() + VN_UTC_OFFSET_MS);
}

function getVietnamTodayParts(now = new Date()) {
  const vietnamNow = getVietnamNow(now);
  return {
    year: vietnamNow.getUTCFullYear(),
    month: vietnamNow.getUTCMonth() + 1,
    day: vietnamNow.getUTCDate()
  };
}

export function getTodayVietnamUtcRange(now = new Date()) {
  const { year, month, day } = getVietnamTodayParts(now);
  return {
    start: createUtcFromVietnam(year, month, day, 0, 0, 0, 0),
    end: createUtcFromVietnam(year, month, day, 23, 59, 59, 999)
  };
}

export function getVietnamYearUtcRange(year: number): VietnamDateRange {
  return {
    dateFrom: createUtcFromVietnam(year, 1, 1, 0, 0, 0, 0),
    dateTo: createUtcFromVietnam(year, 12, 31, 23, 59, 59, 999)
  };
}

export function getVietnamMonthUtcRange(year: number, month: number): VietnamDateRange {
  const dateFrom = createUtcFromVietnam(year, month, 1, 0, 0, 0, 0);
  let nextYear = year;
  let nextMonth = month + 1;
  if (nextMonth > 12) {
    nextMonth = 1;
    nextYear += 1;
  }
  const nextMonthStart = createUtcFromVietnam(nextYear, nextMonth, 1, 0, 0, 0, 0);
  return {
    dateFrom,
    dateTo: new Date(nextMonthStart.getTime() - 1)
  };
}

export function getVietnamPresetUtcRange(preset: VietnamPreset, now = new Date()): VietnamDateRange {
  const today = getTodayVietnamUtcRange(now);
  const { year, month } = getVietnamTodayParts(now);

  if (preset === "today") {
    return { dateFrom: today.start, dateTo: today.end };
  }

  if (preset === "this-week") {
    const todayStart = today.start;
    const weekday = getVietnamNow(now).getUTCDay();
    const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
    const mondayStart = new Date(todayStart);
    mondayStart.setUTCDate(mondayStart.getUTCDate() + mondayOffset);
    return {
      dateFrom: mondayStart,
      dateTo: new Date(mondayStart.getTime() + (7 * DAY_MS) - 1)
    };
  }

  if (preset === "this-month") {
    return getVietnamMonthUtcRange(year, month);
  }

  if (preset === "this-quarter") {
    const quarterStartMonth = Math.floor((month - 1) / 3) * 3 + 1;
    const dateFrom = createUtcFromVietnam(year, quarterStartMonth, 1, 0, 0, 0, 0);
    const nextQuarterMonth = quarterStartMonth + 3;
    const nextQuarterStart = nextQuarterMonth > 12
      ? createUtcFromVietnam(year + 1, nextQuarterMonth - 12, 1, 0, 0, 0, 0)
      : createUtcFromVietnam(year, nextQuarterMonth, 1, 0, 0, 0, 0);
    return {
      dateFrom,
      dateTo: new Date(nextQuarterStart.getTime() - 1)
    };
  }

  if (preset === "this-year") {
    return getVietnamYearUtcRange(year);
  }

  return getVietnamYearUtcRange(year - 1);
}

export function getVietnamTimePeriodUtcRange(timePeriod: VietnamTimePeriod, now = new Date()): VietnamDateRange {
  const { year, month } = getVietnamTodayParts(now);

  if (timePeriod === "this-year") {
    return getVietnamYearUtcRange(year);
  }

  if (timePeriod === "last-year") {
    return getVietnamYearUtcRange(year - 1);
  }

  if (timePeriod === "this-month") {
    return getVietnamMonthUtcRange(year, month);
  }

  const quarterStartMonth = Math.floor((month - 1) / 3) * 3 + 1;
  const dateFrom = createUtcFromVietnam(year, quarterStartMonth, 1, 0, 0, 0, 0);
  const nextQuarterMonth = quarterStartMonth + 3;
  const nextQuarterStart = nextQuarterMonth > 12
    ? createUtcFromVietnam(year + 1, nextQuarterMonth - 12, 1, 0, 0, 0, 0)
    : createUtcFromVietnam(year, nextQuarterMonth, 1, 0, 0, 0, 0);

  return {
    dateFrom,
    dateTo: new Date(nextQuarterStart.getTime() - 1)
  };
}

export function getVietnamDateKey(date: Date) {
  const vietnam = new Date(date.getTime() + VN_UTC_OFFSET_MS);
  const year = vietnam.getUTCFullYear();
  const month = String(vietnam.getUTCMonth() + 1).padStart(2, "0");
  const day = String(vietnam.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getVietnamMonthKey(date: Date) {
  const vietnam = new Date(date.getTime() + VN_UTC_OFFSET_MS);
  const year = vietnam.getUTCFullYear();
  const month = String(vietnam.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export function getVietnamQuarterKey(date: Date) {
  const vietnam = new Date(date.getTime() + VN_UTC_OFFSET_MS);
  const year = vietnam.getUTCFullYear();
  const quarter = Math.floor(vietnam.getUTCMonth() / 3) + 1;
  return `${year}-Q${quarter}`;
}

export function getVietnamYearKey(date: Date) {
  const vietnam = new Date(date.getTime() + VN_UTC_OFFSET_MS);
  return String(vietnam.getUTCFullYear());
}
