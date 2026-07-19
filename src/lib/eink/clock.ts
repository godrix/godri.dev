import { EINK_TIMEZONE } from "./config";

export type ClockSnapshot = {
  time: string;
  dateLabel: string;
  dateKey: string;
};

export function getClockSnapshot(
  now: Date = new Date(),
  timeZone = EINK_TIMEZONE,
): ClockSnapshot {
  const time = new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);

  const dateLabel = new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(now);

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";

  return {
    time,
    dateLabel,
    dateKey: `${y}-${m}-${d}`,
  };
}

export function formatEventTime(
  date: Date,
  allDay: boolean,
  timeZone = EINK_TIMEZONE,
): string {
  if (allDay) return "dia todo";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function formatEventDay(
  date: Date,
  now: Date,
  timeZone = EINK_TIMEZONE,
): string {
  const dayFmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const eventKey = dayFmt.format(date);
  const todayKey = dayFmt.format(now);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowKey = dayFmt.format(tomorrow);

  if (eventKey === todayKey) return "hoje";
  if (eventKey === tomorrowKey) return "amanhã";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(date);
}
