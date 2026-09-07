import type { TerminalEndpoint, TerminalUpgradeServer } from './endpoint';

export {
  createTerminalEndpoint,
  type TerminalAuthPort,
  type TerminalEndpoint,
  type TerminalEndpointDeps,
  type TerminalSocketData,
  type TerminalUpgradeServer,
} from './endpoint';

export function createFetchWithTerminal(
  appFetch: (request: Request) => Response | Promise<Response>,
  endpoint: TerminalEndpoint
): (request: Request, server: TerminalUpgradeServer) => Promise<Response | undefined> {
  return async (request, server) => {
    const pathname = new URL(request.url).pathname;
    if (endpoint.matches(pathname)) return endpoint.handleUpgrade(request, server);
    return appFetch(request);
  };
}
