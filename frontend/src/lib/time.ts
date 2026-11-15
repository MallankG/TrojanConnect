/** Date helpers. Every event in the demo is on USC time, whatever the viewer's clock says. */

export const TZ = "America/Los_Angeles";

const partsFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  weekday: "short",
  hourCycle: "h23",
});

export type LaParts = { y: number; m: number; d: number; h: number; min: number; weekday: number };

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function laParts(date: Date): LaParts {
  const p: Record<string, string> = {};
  for (const part of partsFmt.formatToParts(date)) p[part.type] = part.value;
  return {
    y: +p.year,
    m: +p.month,
    d: +p.day,
    h: +p.hour,
    min: +p.minute,
    weekday: WEEKDAYS.indexOf(p.weekday),
  };
}

/** The instant at which it is the given wall-clock time in Los Angeles. */
export function laDate(y: number, m: number, d: number, h = 0, min = 0): Date {
  const utc = Date.UTC(y, m - 1, d, h, min);
  const p = laParts(new Date(utc));
  const seenAs = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min);
  return new Date(utc - (seenAs - utc));
}

/** A Los Angeles day `offset` days from `from`, at the given time. */
export function laDayOffset(from: Date, offset: number, h = 0, min = 0): Date {
  const p = laParts(from);
  // Date.UTC normalises day overflow, so month ends take care of themselves.
  const shifted = new Date(Date.UTC(p.y, p.m - 1, p.d + offset, 12));
  return laDate(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate(), h, min);
}

export function dateKey(iso: string | Date): string {
  const p = laParts(typeof iso === "string" ? new Date(iso) : iso);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

const timeFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  hour: "numeric",
  minute: "2-digit",
});
const dayFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ,
  weekday: "short",
  day: "numeric",
  month: "short",
});
const longDayFmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "numeric", month: "long" });
const weekdayFmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "long" });
const stampFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ,
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

export const fmtTime = (iso: string) => timeFmt.format(new Date(iso));
/** "Wed 25 Nov" */
export const fmtDay = (iso: string) => dayFmt.format(new Date(iso)).replace(",", "");
/** "25 Nov, 5:02 pm" for audit entries. */
export const fmtStamp = (iso: string) => stampFmt.format(new Date(iso));

/** "5:00 to 8:00 PM", dropping the first AM/PM when both halves share it. */
export function fmtTimeRange(start: string, end: string) {
  const a = fmtTime(start);
  const b = fmtTime(end);
  const sameHalf = a.slice(-2) === b.slice(-2);
  return `${sameHalf ? a.slice(0, -3) : a} to ${b}`;
}

/** "Wed 25 Nov, 5:00 to 8:00 PM" */
export const fmtRange = (start: string, end: string) =>
  `${fmtDay(start)}, ${fmtTimeRange(start, end)}`;

/** Heading for date-grouped lists: "Tomorrow" / "Wednesday", or "25 November" / "Wednesday". */
export function fmtDayHeading(iso: string, now = new Date()) {
  const key = dateKey(iso);
  const weekday = weekdayFmt.format(new Date(iso));
  if (key === dateKey(now)) return { primary: "Today", secondary: weekday };
  if (key === dateKey(laDayOffset(now, 1))) return { primary: "Tomorrow", secondary: weekday };
  if (key === dateKey(laDayOffset(now, -1))) return { primary: "Yesterday", secondary: weekday };
  return { primary: longDayFmt.format(new Date(iso)), secondary: weekday };
}

export function fmtRelative(iso: string, now = new Date()) {
  const seconds = Math.round((now.getTime() - new Date(iso).getTime()) / 1000);
  if (seconds < 45) return "Just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} ${days === 1 ? "day" : "days"} ago`;
  return fmtDay(iso);
}

export function minutesBetween(a: string, b: string) {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000);
}
