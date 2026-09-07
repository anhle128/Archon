export function consoleRunHref(projectId: string, runId: string, nodeId: string | null): string {
  const base = `/console/p/${encodeURIComponent(projectId)}/r/${encodeURIComponent(runId)}`;
  return nodeId === null ? base : `${base}?${new URLSearchParams({ node: nodeId }).toString()}`;
}
