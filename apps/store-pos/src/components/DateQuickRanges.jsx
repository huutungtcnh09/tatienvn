function toYmd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function startOfWeek(date) {
  const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = copy.getDay();
  const diff = (day + 6) % 7; // Monday = 0
  copy.setDate(copy.getDate() - diff);
  return copy;
}

function endOfWeek(date) {
  const start = startOfWeek(date);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return end;
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function startOfQuarter(date) {
  const quarterStartMonth = Math.floor(date.getMonth() / 3) * 3;
  return new Date(date.getFullYear(), quarterStartMonth, 1);
}

function startOfYear(date) {
  return new Date(date.getFullYear(), 0, 1);
}

function endOfYear(date) {
  return new Date(date.getFullYear(), 11, 31);
}

function quickRanges() {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  const last7Start = new Date(today);
  last7Start.setDate(today.getDate() - 6);

  const last30Start = new Date(today);
  last30Start.setDate(today.getDate() - 29);

  const thisWeekStart = startOfWeek(today);
  const thisWeekEnd = endOfWeek(today);

  const prevWeekEnd = new Date(thisWeekStart);
  prevWeekEnd.setDate(thisWeekStart.getDate() - 1);
  const prevWeekStart = startOfWeek(prevWeekEnd);

  const thisMonthStart = startOfMonth(today);
  const thisMonthEnd = endOfMonth(today);

  const prevMonthRef = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const prevMonthStart = startOfMonth(prevMonthRef);
  const prevMonthEnd = endOfMonth(prevMonthRef);

  const thisQuarterStart = startOfQuarter(today);
  const thisQuarterEnd = endOfMonth(new Date(thisQuarterStart.getFullYear(), thisQuarterStart.getMonth() + 2, 1));

  const thisYearStart = startOfYear(today);
  const thisYearEnd = endOfYear(today);

  const prevYearRef = new Date(today.getFullYear() - 1, 0, 1);
  const prevYearStart = startOfYear(prevYearRef);
  const prevYearEnd = endOfYear(prevYearRef);

  return [
    { id: "today", label: "Hôm nay", from: toYmd(today), to: toYmd(today) },
    { id: "yesterday", label: "Hôm qua", from: toYmd(yesterday), to: toYmd(yesterday) },
    { id: "last7", label: "7 ngày qua", from: toYmd(last7Start), to: toYmd(today) },
    { id: "last30", label: "30 ngày qua", from: toYmd(last30Start), to: toYmd(today) },
    { id: "thisWeek", label: "Tuần này", from: toYmd(thisWeekStart), to: toYmd(thisWeekEnd) },
    { id: "prevWeek", label: "Tuần trước", from: toYmd(prevWeekStart), to: toYmd(prevWeekEnd) },
    { id: "thisMonth", label: "Tháng này", from: toYmd(thisMonthStart), to: toYmd(thisMonthEnd) },
    { id: "prevMonth", label: "Tháng trước", from: toYmd(prevMonthStart), to: toYmd(prevMonthEnd) },
    { id: "thisQuarter", label: "Quý này", from: toYmd(thisQuarterStart), to: toYmd(thisQuarterEnd) },
    { id: "thisYear", label: "Năm nay", from: toYmd(thisYearStart), to: toYmd(thisYearEnd) },
    { id: "prevYear", label: "Năm trước", from: toYmd(prevYearStart), to: toYmd(prevYearEnd) }
  ];
}

export default function DateQuickRanges({ fromDate, toDate, setFromDate, setToDate }) {
  const ranges = quickRanges();

  return (
    <div className="advanced-quick-ranges" role="group" aria-label="Mốc thời gian nhanh">
      <button
        type="button"
        className={`quick-range-btn ${!fromDate && !toDate ? "active" : ""}`}
        onClick={() => {
          setFromDate("");
          setToDate("");
        }}
      >
        Tất cả
      </button>
      {ranges.map((range) => {
        const active = fromDate === range.from && toDate === range.to;
        return (
          <button
            key={range.id}
            type="button"
            className={`quick-range-btn ${active ? "active" : ""}`}
            onClick={() => {
              setFromDate(range.from);
              setToDate(range.to);
            }}
          >
            {range.label}
          </button>
        );
      })}
    </div>
  );
}
