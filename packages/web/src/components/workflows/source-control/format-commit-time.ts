const SECOND_MS = 1_000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const RELATIVE_LIMIT_MS = 30 * DAY_MS;

const relativeFormatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const absoluteFormatter = new Intl.DateTimeFormat('en', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

function roundedRelativeValue(deltaMs: number, unitMs: number): number {
  if (deltaMs === 0) return 0;
  return Math.sign(deltaMs) * Math.max(1, Math.round(Math.abs(deltaMs) / unitMs));
}

export function formatCommitTime(iso: string, nowMs: number): string {
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) return 'Unknown time';

  const deltaMs = timestamp - nowMs;
  const absoluteDelta = Math.abs(deltaMs);
  if (absoluteDelta >= RELATIVE_LIMIT_MS) {
    return absoluteFormatter.format(new Date(timestamp));
  }
  if (absoluteDelta < MINUTE_MS) {
    return relativeFormatter.format(roundedRelativeValue(deltaMs, SECOND_MS), 'second');
  }
  if (absoluteDelta < HOUR_MS) {
    return relativeFormatter.format(roundedRelativeValue(deltaMs, MINUTE_MS), 'minute');
  }
  if (absoluteDelta < DAY_MS) {
    return relativeFormatter.format(roundedRelativeValue(deltaMs, HOUR_MS), 'hour');
  }
  return relativeFormatter.format(roundedRelativeValue(deltaMs, DAY_MS), 'day');
}
