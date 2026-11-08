/**
 * Times on the design pages. The agreement's examples happened on 1 to 4 November 2026, so
 * the design pages read them as if it were 10:30 pm India time on 4 November: every "35 min
 * ago" stays the same however late a preview is opened. Screens show India time (agreement,
 * "Rules for every record").
 */
export const DESIGN_NOW = Date.parse('2026-11-04T17:00:00Z');

const INDIA = 'Asia/Kolkata';

const clockFormat = new Intl.DateTimeFormat('en-IN', {
  timeZone: INDIA,
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

const dayFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: INDIA,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});

/** "9:35 pm", in India time. */
export function clock(iso: string): string {
  return clockFormat
    .format(Date.parse(iso))
    .replace(/\s?(am|pm)$/i, (m) => ` ${m.trim().toLowerCase()}`);
}

/** "Wed 4 Nov", in India time. */
export function day(iso: string): string {
  return dayFormat.format(Date.parse(iso)).replace(',', '');
}

/** "35 min ago", "5 h ago", or the day for anything older than a day. */
export function ago(iso: string, now = DESIGN_NOW): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return day(iso);
}

/** "58 s", "1:32", for a video's length. */
export function duration(seconds: number): string {
  const whole = Math.round(seconds);
  if (whole < 60) return `0:${String(whole).padStart(2, '0')}`;
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}
