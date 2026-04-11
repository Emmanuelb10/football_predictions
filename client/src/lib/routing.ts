import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import customParseFormat from 'dayjs/plugin/customParseFormat';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);

export const LAUNCH_DATE = '2026-03-16';
export const SERVER_TZ = 'Africa/Nairobi';
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Returns the current date in the server's timezone, formatted as YYYY-MM-DD.
 * This must match how the server computes "today" so the client never
 * redirects to a date that has no data.
 */
export function todayString(): string {
  return dayjs().tz(SERVER_TZ).format('YYYY-MM-DD');
}

export function todayPath(): string {
  return `/${todayString()}`;
}

export type DateValidationResult =
  | { valid: true; date: string }
  | { valid: false; reason: 'invalid-format' | 'pre-launch' };

/**
 * Strict validator for the `:date` URL param. Checks format, calendar validity,
 * and that the date is on or after the launch date. Returns a structured
 * failure reason so NotFound can customize its message.
 */
export function isValidDateParam(str: string | undefined): DateValidationResult {
  if (!str || !DATE_REGEX.test(str)) {
    return { valid: false, reason: 'invalid-format' };
  }
  if (!dayjs(str, 'YYYY-MM-DD', true).isValid()) {
    return { valid: false, reason: 'invalid-format' };
  }
  if (str < LAUNCH_DATE) {
    return { valid: false, reason: 'pre-launch' };
  }
  return { valid: true, date: str };
}
