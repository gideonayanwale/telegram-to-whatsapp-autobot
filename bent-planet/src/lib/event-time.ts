/**
 * Timezone-aware event timing helpers.
 *
 * Conferences store a local wall-clock date (`conference_date`), an optional
 * start time (`conference_time`), an optional last day (`end_date`, for
 * multi-day events) and an IANA `timezone`. All reminder/replay scheduling
 * must be computed against the event's local wall clock, not raw UTC dates.
 *
 * Pure functions only — no I/O — so they can be unit tested and shared by
 * server routes, cron jobs and email copy.
 */

export type EventTimingInput = {
  conferenceDate: string | null; // YYYY-MM-DD (event-local date)
  endDate?: string | null; // YYYY-MM-DD, last day of a multi-day event
  conferenceTime?: string | null; // HH:MM or HH:MM:SS (event-local time)
  timezone?: string | null; // IANA timezone, e.g. "Africa/Lagos"
};

export const DEFAULT_TIMEZONE = "Africa/Lagos";

/** Assumed duration when an event has no explicit end time. */
export const DEFAULT_EVENT_DURATION_MS = 3 * 60 * 60 * 1000; // 3 hours

/** Replay emails are due at the first cron run after the event end + this delay. */
export const REPLAY_DELAY_MS = 60 * 60 * 1000; // 1 hour after the event ends

/**
 * Safety window: never send replay emails for events that ended more than
 * this long ago (protects against back-filling old conferences after a
 * feature launch or a long outage).
 */
export const REPLAY_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

/** 7-day reminder: send once while the start is more than 30h and at most 7.5 days away. */
export const REMINDER_7D_MAX_LEAD_MS = 7.5 * 24 * 60 * 60 * 1000;
export const REMINDER_7D_MIN_LEAD_MS = 30 * 60 * 60 * 1000;

/** 24-hour reminder: send once while the start is at most 26h away and hasn't happened. */
export const REMINDER_24H_MAX_LEAD_MS = 26 * 60 * 60 * 1000;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;

/** Offset (ms) of `timeZone` at the given instant: localWallClock = utc + offset. */
function tzOffsetMs(timeZone: string, instant: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  // Intl may render hour "24" for midnight in some environments; normalize.
  const hour = get("hour") % 24;
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), hour, get("minute"), get("second"));
  return asUtc - instant.getTime();
}

function resolveTimeZone(tz: string | null | undefined): string {
  if (!tz) return DEFAULT_TIMEZONE;
  try {
    // Throws RangeError for unknown IANA names.
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

/**
 * Convert an event-local wall clock (date + optional time) in `timezone`
 * to a UTC Date. Handles DST transitions via a two-pass offset lookup.
 * Returns null when the date is missing or unparseable.
 */
export function zonedWallClockToUtc(
  dateStr: string | null | undefined,
  timeStr: string | null | undefined,
  timezone: string | null | undefined
): Date | null {
  if (!dateStr) return null;
  const dateMatch = DATE_RE.exec(dateStr.trim());
  if (!dateMatch) return null;

  let hh = 0;
  let mm = 0;
  let ss = 0;
  if (timeStr) {
    const timeMatch = TIME_RE.exec(timeStr.trim());
    if (!timeMatch) return null;
    hh = Number(timeMatch[1]);
    mm = Number(timeMatch[2]);
    ss = Number(timeMatch[3] ?? 0);
    if (hh > 23 || mm > 59 || ss > 59) return null;
  }

  const tz = resolveTimeZone(timezone);
  const wallAsUtc = Date.UTC(Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3]), hh, mm, ss);

  // Two-pass iteration converges for DST edges.
  let ts = wallAsUtc - tzOffsetMs(tz, new Date(wallAsUtc));
  ts = wallAsUtc - tzOffsetMs(tz, new Date(ts));
  return new Date(ts);
}

/** Start instant of the event (first day + start time, in event timezone). */
export function getEventStartInstant(input: EventTimingInput): Date | null {
  return zonedWallClockToUtc(input.conferenceDate, input.conferenceTime ?? null, input.timezone ?? null);
}

/**
 * End instant of the event. Multi-day events end on `endDate`; every event is
 * assumed to run `DEFAULT_EVENT_DURATION_MS` past its start time (we do not
 * store an end time).
 */
export function getEventEndInstant(input: EventTimingInput): Date | null {
  const lastDay = input.endDate || input.conferenceDate;
  const lastDayStart = zonedWallClockToUtc(lastDay, input.conferenceTime ?? null, input.timezone ?? null);
  if (!lastDayStart) return null;

  const start = getEventStartInstant(input);
  // A multi-day event ends at the same wall clock on its last day, plus duration.
  // Guard against endDate before startDate in bad data: fall back to start + duration.
  if (start && lastDayStart.getTime() < start.getTime()) {
    return new Date(start.getTime() + DEFAULT_EVENT_DURATION_MS);
  }
  return new Date(lastDayStart.getTime() + DEFAULT_EVENT_DURATION_MS);
}

export type ReminderKind = "reminder_7d" | "reminder_24h" | "none";

/**
 * Which reminder (if any) is due for an event as of `now`, based on lead time
 * to the event start. The caller still deduplicates per subscriber using the
 * `reminder_7d_sent` / `reminder_24h_sent` flags.
 */
export function classifyReminder(input: EventTimingInput, now: Date): ReminderKind {
  const start = getEventStartInstant(input);
  if (!start) return "none";

  const leadMs = start.getTime() - now.getTime();
  if (leadMs <= 0) return "none"; // already started / in the past
  if (leadMs <= REMINDER_24H_MAX_LEAD_MS) return "reminder_24h";
  if (leadMs <= REMINDER_7D_MAX_LEAD_MS && leadMs > REMINDER_7D_MIN_LEAD_MS) return "reminder_7d";
  return "none";
}

/**
 * Post-conference replay emails are due once — at the first cron run at least
 * REPLAY_DELAY_MS after the event (last day) has ended, and only within
 * REPLAY_MAX_AGE_MS of the end. For multi-day events this is after the final
 * day, never in the middle of the event.
 */
export function isReplayDue(
  input: EventTimingInput & { enableReplay?: boolean | null },
  now: Date
): boolean {
  if (input.enableReplay === false) return false;
  const end = getEventEndInstant(input);
  if (!end) return false;

  const dueAt = end.getTime() + REPLAY_DELAY_MS;
  const expiresAt = end.getTime() + REPLAY_MAX_AGE_MS;
  return now.getTime() >= dueAt && now.getTime() <= expiresAt;
}

/**
 * Human-friendly "when" label for reminder email copy, computed from actual
 * lead time so the copy never claims "tomorrow" for a 7-day reminder.
 */
export function reminderLeadLabel(input: EventTimingInput, now: Date): string {
  const kind = classifyReminder(input, now);
  if (kind === "reminder_24h") return "tomorrow";
  const days = (() => {
    const start = getEventStartInstant(input);
    if (!start) return 7;
    return Math.max(1, Math.round((start.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)));
  })();
  return `in ${days} days`;
}
