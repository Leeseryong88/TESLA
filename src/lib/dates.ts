import { Timestamp } from "firebase/firestore";

const KST_OFFSET = "+09:00";
const KST_TIME_ZONE = "Asia/Seoul";

const dateIdFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: KST_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const shortDateFormatter = new Intl.DateTimeFormat("ko-KR", {
  timeZone: KST_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  weekday: "short",
});

const compactDateFormatter = new Intl.DateTimeFormat("ko-KR", {
  timeZone: KST_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const dateTimeFormatter = new Intl.DateTimeFormat("ko-KR", {
  timeZone: KST_TIME_ZONE,
  month: "2-digit",
  day: "2-digit",
  weekday: "short",
  hour: "numeric",
  minute: "2-digit",
});

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function getDateIdWeekday(dateId: string) {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: KST_TIME_ZONE,
    weekday: "short",
  }).format(dateIdToStartDate(dateId));

  const weekdays: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  return weekdays[weekday];
}

export function shiftDateId(dateId: string, amount: number) {
  const date = dateIdToStartDate(dateId);
  const shifted = new Date(date.getTime() + amount * ONE_DAY_MS);
  return dateIdFormatter.format(shifted);
}

export function getWeekendReservationFridayDateId(dateId: string) {
  const weekday = getDateIdWeekday(dateId);

  if (weekday === 5) {
    return dateId;
  }

  if (weekday === 6) {
    return shiftDateId(dateId, -1);
  }

  if (weekday === 0) {
    return shiftDateId(dateId, -2);
  }

  return null;
}

export type WeekendGroupRole = "start" | "middle" | "end";

export function getWeekendReservationGroupRole(dateId: string): WeekendGroupRole | null {
  const weekday = getDateIdWeekday(dateId);

  if (weekday === 5) {
    return "start";
  }

  if (weekday === 6) {
    return "middle";
  }

  if (weekday === 0) {
    return "end";
  }

  return null;
}

export function isWeekendReservationIncludedDate(dateId: string) {
  const weekday = getDateIdWeekday(dateId);
  return weekday === 0 || weekday === 6;
}

export function getTodayId() {
  return dateIdFormatter.format(new Date());
}

export function toDateId(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");

  return `${year}-${month}-${day}`;
}

export function dateIdToStartDate(dateId: string) {
  return new Date(`${dateId}T12:00:00${KST_OFFSET}`);
}

export function isWeekendReservationStartDate(dateId: string) {
  return getDateIdWeekday(dateId) === 5;
}

export function isReservableDateId(dateId: string) {
  const weekday = getDateIdWeekday(dateId);
  return weekday !== 0 && weekday !== 6;
}

export function getReservationWindow(dateId: string) {
  const start = dateIdToStartDate(dateId);
  const durationDays = isWeekendReservationStartDate(dateId) ? 3 : 1;
  const end = new Date(start.getTime() + durationDays * ONE_DAY_MS);

  return {
    start,
    end,
    startAt: Timestamp.fromDate(start),
    endAt: Timestamp.fromDate(end),
  };
}

export function formatDateId(dateId: string) {
  return shortDateFormatter.format(new Date(`${dateId}T12:00:00${KST_OFFSET}`));
}

export function formatCompactDateId(dateId: string) {
  return compactDateFormatter.format(new Date(`${dateId}T12:00:00${KST_OFFSET}`));
}

function toDottedDateParts(dateId: string) {
  const [year, month, day] = dateId.split("-");

  return {
    year,
    month,
    day,
    full: `${year}.${month}.${day}`,
  };
}

export function formatReservationUsagePeriod(dateId: string) {
  const durationDays = isWeekendReservationStartDate(dateId) ? 3 : 1;
  const endDateId = shiftDateId(dateId, durationDays === 1 ? 1 : durationDays - 1);
  const start = toDottedDateParts(dateId);
  const end = toDottedDateParts(endDateId);

  if (dateId === endDateId) {
    return start.full;
  }

  const endLabel = start.year === end.year ? `${end.month}.${end.day}` : end.full;

  return `${start.full}~${endLabel}`;
}

export function formatReservationWindow(dateId: string) {
  const { start, end } = getReservationWindow(dateId);
  return `${dateTimeFormatter.format(start)} - ${dateTimeFormatter.format(end)}`;
}

export function formatTimestamp(value: Timestamp) {
  return dateTimeFormatter.format(value.toDate());
}

export function getMonthCells(monthDate: Date) {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const firstWeekday = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: Array<{ date: Date; dateId: string; day: number; isCurrentMonth: boolean }> = [];

  for (let index = 0; index < 42; index += 1) {
    const day = index - firstWeekday + 1;
    const date = new Date(year, month, day);

    cells.push({
      date,
      dateId: toDateId(date),
      day: date.getDate(),
      isCurrentMonth: day >= 1 && day <= daysInMonth,
    });
  }

  return cells;
}

export function getMonthTitle(monthDate: Date) {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
  }).format(monthDate);
}

export function shiftMonth(monthDate: Date, amount: number) {
  return new Date(monthDate.getFullYear(), monthDate.getMonth() + amount, 1);
}
