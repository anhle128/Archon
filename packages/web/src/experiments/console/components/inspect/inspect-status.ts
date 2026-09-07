export type InspectStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export function inspectStatus(value: string): InspectStatus {
  if (value === 'awaiting') return 'running';
  if (
    value === 'pending' ||
    value === 'running' ||
    value === 'completed' ||
    value === 'failed' ||
    value === 'skipped'
  ) {
    return value;
  }
  return 'pending';
}

export function inspectStatusLabel(value: string): string {
  return value === 'awaiting' ? 'running' : value;
}

export function isInspectRunLive(status: string): boolean {
  return status === 'running' || status === 'paused';
}
