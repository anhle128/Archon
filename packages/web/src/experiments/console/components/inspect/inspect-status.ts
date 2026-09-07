export type InspectStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'awaiting';

export function inspectStatus(value: string): InspectStatus {
  if (
    value === 'pending' ||
    value === 'running' ||
    value === 'completed' ||
    value === 'failed' ||
    value === 'skipped' ||
    value === 'awaiting'
  ) {
    return value;
  }
  return 'pending';
}

export function inspectStatusLabel(value: string): string {
  return value === 'awaiting' ? 'waiting on you' : value;
}

export function isInspectRunLive(status: string): boolean {
  return status === 'running' || status === 'paused';
}
