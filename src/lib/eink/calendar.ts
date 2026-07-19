export type CalendarEvent = {
  summary: string;
  start: Date;
  end: Date | null;
  allDay: boolean;
};

function unfoldIcal(raw: string): string {
  return raw.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "");
}

function unescapeText(value: string): string {
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

/** Parses DATE (YYYYMMDD) or DATE-TIME (YYYYMMDDTHHMMSS[Z]). */
export function parseIcalDate(
  value: string,
  params: string,
): { date: Date; allDay: boolean } | null {
  const trimmed = value.trim();
  const isAllDay = /VALUE=DATE/i.test(params) || /^\d{8}$/.test(trimmed);

  if (/^\d{8}$/.test(trimmed)) {
    const y = Number(trimmed.slice(0, 4));
    const m = Number(trimmed.slice(4, 6)) - 1;
    const d = Number(trimmed.slice(6, 8));
    return { date: new Date(y, m, d), allDay: true };
  }

  const match = trimmed.match(
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/,
  );
  if (!match) return null;

  const [, ys, ms, ds, hs, mins, ss, z] = match;
  const y = Number(ys);
  const mo = Number(ms) - 1;
  const d = Number(ds);
  const h = Number(hs);
  const mi = Number(mins);
  const s = Number(ss);

  if (z === "Z") {
    return { date: new Date(Date.UTC(y, mo, d, h, mi, s)), allDay: false };
  }

  // Floating local time — treat as America/Sao_Paulo wall clock via Date parts
  // (server TZ may differ; we format with Intl later).
  return { date: new Date(y, mo, d, h, mi, s), allDay: isAllDay };
}

function getProp(
  block: string,
  name: string,
): { params: string; value: string } | null {
  const re = new RegExp(`(?:^|\\n)${name}([^:]*):(.*?)(?=\\n[A-Z]|$)`, "i");
  const m = block.match(re);
  if (!m) return null;
  return { params: m[1] ?? "", value: (m[2] ?? "").trim() };
}

export function parseIcalEvents(raw: string): CalendarEvent[] {
  const text = unfoldIcal(raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n"));
  const blocks = text.split(/BEGIN:VEVENT/i).slice(1);
  const events: CalendarEvent[] = [];

  for (const chunk of blocks) {
    const block = chunk.split(/END:VEVENT/i)[0] ?? "";
    const summaryProp = getProp(block, "SUMMARY");
    const startProp = getProp(block, "DTSTART");
    if (!summaryProp || !startProp) continue;

    const start = parseIcalDate(startProp.value, startProp.params);
    if (!start) continue;

    const endProp = getProp(block, "DTEND");
    let end: Date | null = null;
    if (endProp) {
      const parsed = parseIcalDate(endProp.value, endProp.params);
      end = parsed?.date ?? null;
    }

    events.push({
      summary: unescapeText(summaryProp.value) || "(sem título)",
      start: start.date,
      end,
      allDay: start.allDay,
    });
  }

  return events;
}

function dateKeyInTz(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function addDaysToKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d! + days));
  return dt.toISOString().slice(0, 10);
}

export function upcomingEvents(
  events: CalendarEvent[],
  now: Date,
  limit = 5,
  timeZone = "America/Sao_Paulo",
): CalendarEvent[] {
  const todayKey = dateKeyInTz(now, timeZone);
  const tomorrowKey = addDaysToKey(todayKey, 1);
  const allowed = new Set([todayKey, tomorrowKey]);

  return events
    .filter((e) => allowed.has(dateKeyInTz(e.start, timeZone)))
    .filter((e) => e.allDay || e.start.getTime() >= now.getTime() - 30 * 60 * 1000)
    .sort((a, b) => a.start.getTime() - b.start.getTime())
    .slice(0, limit);
}

export async function fetchCalendarEvents(
  icalUrl: string,
  now: Date,
  timeZone = "America/Sao_Paulo",
): Promise<CalendarEvent[] | null> {
  if (!icalUrl) return [];
  try {
    const res = await fetch(icalUrl, {
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(10000),
      headers: { "User-Agent": "godri.dev-eink/1.0" },
    });
    if (!res.ok) return null;
    const raw = await res.text();
    return upcomingEvents(parseIcalEvents(raw), now, 5, timeZone);
  } catch {
    return null;
  }
}
