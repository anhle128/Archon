export function isValidGitFilePath(raw: string): boolean {
  if (raw.length === 0 || raw.includes('\0')) return false;
  if (raw.startsWith('/') || raw.startsWith('\\') || /^[A-Za-z]:[\\/]/.test(raw)) {
    return false;
  }
  const segments = raw.split(/[\\/]/);
  return !segments.some(segment => segment === '..') && segments[0]?.toLowerCase() !== '.git';
}

export function isValidGitObjectId(raw: string): boolean {
  return /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(raw);
}
