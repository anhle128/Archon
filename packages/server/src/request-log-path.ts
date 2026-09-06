const RAW_GIT_FILE_ROUTE = /^(\/api\/workflows\/runs\/[^/]+\/git\/file)(?:\/|$)/;

/** Keep raw repository filenames out of request logs for the wildcard file route. */
export function requestLogPath(path: string): string {
  const match = RAW_GIT_FILE_ROUTE.exec(path);
  return match ? `${match[1]}/*` : path;
}
