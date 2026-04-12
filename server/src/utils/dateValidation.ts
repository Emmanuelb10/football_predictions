import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';

dayjs.extend(customParseFormat);

export const LAUNCH_DATE = '2026-03-16';
export const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Returns true if the string is a valid YYYY-MM-DD date on or after the launch date.
 * Used at API boundaries to reject malformed or pre-launch date params.
 */
export function isValidDateString(str: unknown): str is string {
  if (typeof str !== 'string') return false;
  if (!DATE_REGEX.test(str)) return false;
  if (!dayjs(str, 'YYYY-MM-DD', true).isValid()) return false;
  return str >= LAUNCH_DATE;
}
