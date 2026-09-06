export function isValidGitFilePath(raw: string): boolean {
  if (raw.length === 0 || raw.includes('\0')) return false;
  if (raw.startsWith('/') || raw.startsWith('\\') || /^[A-Za-z]:[\\/]/.test(raw)) {
    return false;
  }
  return !raw.split(/[\\/]/).some(segment => segment === '..');
}
